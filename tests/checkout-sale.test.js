const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

function fixture({ stockA = 5, stockB = 5, failCollection = "" } = {}) {
  const state = {
    users: new Map([["u", { _id: "u", openid: "openid-1", name: "妈妈", enabled: true }]]),
    products: new Map([
      ["p-a", { _id: "p-a", productCode: "SP000001", name: "女靴", unit: "双", enabled: true }],
      ["p-b", { _id: "p-b", productCode: "SP000002", name: "鞋垫", unit: "双", enabled: true }],
    ]),
    product_variants: new Map([
      ["v-a", { _id: "v-a", productId: "p-a", variantCode: "V-A", specification: "39码", costPriceCent: 10000, salePriceCent: 15900, stock: stockA, enabled: true }],
      ["v-b", { _id: "v-b", productId: "p-b", variantCode: "V-B", specification: "", costPriceCent: 200, salePriceCent: 500, stock: stockB, enabled: true }],
    ]),
    sale_orders: new Map(), sales: new Map(), inventory_logs: new Map(),
  };
  let queue = Promise.resolve();
  function collectionApi(target, name) {
    const records = target[name];
    return {
      where(condition) {
        const list = [...records.values()].filter((item) => Object.entries(condition).every(([key, value]) => item[key] === value));
        return { limit() { return { async get() { return { data: clone(list) }; } }; } };
      },
      doc(id) {
        return {
          async get() { if (!records.has(id)) throw new Error("document not found"); return { data: clone(records.get(id)) }; },
          async update({ data }) { if (!records.has(id)) throw new Error("document not found"); records.set(id, { ...records.get(id), ...clone(data) }); },
          async set({ data }) { if (name === failCollection) throw new Error("injected failure"); records.set(id, { _id: id, ...clone(data) }); },
        };
      },
    };
  }
  const database = {
    collection(name) { return collectionApi(state, name); },
    serverDate() { return new Date("2026-08-15T04:00:00.000Z"); },
    async runTransaction(callback) {
      let release;
      const previous = queue;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      const draft = Object.fromEntries(Object.entries(state).map(([name, records]) => [name, new Map(clone([...records]))]));
      try {
        const result = await callback({ collection: (name) => collectionApi(draft, name) });
        for (const [name, records] of Object.entries(draft)) state[name] = records;
        return { result };
      } finally { release(); }
    },
  };
  return { state, sdk: { DYNAMIC_CURRENT_ENV: "dynamic", init() {}, database() { return database; }, getWXContext() { return { OPENID: "openid-1" }; } } };
}

function loadCheckout(sdk) {
  const original = Module._load;
  Module._load = function mock(request, parent, main) { if (request === "wx-server-sdk") return sdk; return original.call(this, request, parent, main); };
  const file = path.join(root, "cloudfunctions/checkoutSale/index.js");
  delete require.cache[require.resolve(file)];
  try { return require(file).main; } finally { Module._load = original; }
}

const orderInput = (requestId = "SALE_ORDER_TEST_001") => ({
  requestId,
  items: [
    { variantId: "v-a", quantity: 1, unitPriceCent: 15900, isGift: false },
    { variantId: "v-b", quantity: 2, unitPriceCent: 0, isGift: true },
  ],
});

async function run() {
  const first = fixture();
  const checkout = loadCheckout(first.sdk);
  const result = await checkout(orderInput());
  assert.equal(result.success, true);
  assert.equal(result.data.order.totalQuantity, 3);
  assert.equal(result.data.order.totalAmountCent, 15900);
  assert.equal(result.data.order.totalCostCent, 10400);
  assert.equal(result.data.order.grossProfitCent, 5500);
  assert.equal(first.state.product_variants.get("v-a").stock, 4);
  assert.equal(first.state.product_variants.get("v-b").stock, 3);
  assert.equal(first.state.sales.size, 2);
  assert.equal(first.state.inventory_logs.size, 2);
  const lines = [...first.state.sales.values()];
  assert.deepEqual(lines.map((item) => item.orderCountContribution), [1, 0]);
  assert.equal(lines[1].isGift, true);
  assert.equal(lines[1].grossProfitCent, -400);
  assert.equal([...first.state.inventory_logs.values()][1].remark, "赠品");

  const duplicate = await checkout(orderInput());
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(first.state.product_variants.get("v-a").stock, 4);

  const insufficientFixture = fixture({ stockB: 1 });
  const insufficient = await loadCheckout(insufficientFixture.sdk)(orderInput("SALE_ORDER_SHORT_001"));
  assert.equal(insufficient.success, false);
  assert.equal(insufficient.code, "INSUFFICIENT_STOCK");
  assert.equal(insufficient.data.variantId, "v-b");
  assert.equal(insufficientFixture.state.product_variants.get("v-a").stock, 5);
  assert.equal(insufficientFixture.state.sales.size, 0);
  assert.equal(insufficientFixture.state.sale_orders.size, 0);

  const rollbackFixture = fixture({ failCollection: "inventory_logs" });
  const originalError = console.error; console.error = () => {};
  const rollback = await loadCheckout(rollbackFixture.sdk)(orderInput("SALE_ORDER_ROLLBACK_001"));
  console.error = originalError;
  assert.equal(rollback.success, false);
  assert.equal(rollbackFixture.state.product_variants.get("v-a").stock, 5);
  assert.equal(rollbackFixture.state.sales.size, 0);

  const concurrentFixture = fixture({ stockA: 1 });
  const concurrentCheckout = loadCheckout(concurrentFixture.sdk);
  const [one, two] = await Promise.all([
    concurrentCheckout({ requestId: "SALE_ORDER_CONCURRENT_A", items: [{ variantId: "v-a", quantity: 1, unitPriceCent: 15900, isGift: false }] }),
    concurrentCheckout({ requestId: "SALE_ORDER_CONCURRENT_B", items: [{ variantId: "v-a", quantity: 1, unitPriceCent: 15900, isGift: false }] }),
  ]);
  assert.deepEqual([one.success, two.success].sort(), [false, true]);
  assert.equal(concurrentFixture.state.product_variants.get("v-a").stock, 0);
  assert.equal(concurrentFixture.state.sale_orders.size, 1);

  const invalid = await checkout({ requestId: "SALE_ORDER_INVALID_001", items: [{ variantId: "v-a", quantity: 1, unitPriceCent: 1, isGift: false }, { variantId: "v-a", quantity: 1, unitPriceCent: 1, isGift: false }] });
  assert.equal(invalid.code, "INVALID_PARAMETER");

  let storage;
  global.wx = { getStorageSync() { return storage; }, setStorageSync(_key, value) { storage = clone(value); } };
  const cartPath = path.join(root, "miniprogram/utils/sale-cart.js");
  delete require.cache[require.resolve(cartPath)];
  const cart = require(cartPath);
  const product = { _id: "p-a", name: "女靴", unit: "双" };
  const variant = { _id: "v-a", specification: "39码", salePriceCent: 15900, stock: 5 };
  cart.addProduct(product, variant); cart.addProduct(product, variant); cart.addProduct(product, variant);
  assert.equal(cart.getState().items.length, 1);
  assert.equal(cart.getState().items[0].quantity, 3);
  delete global.wx;

  console.log("Checkout tests passed: atomic multi-SKU sale, gift cost, rollback, idempotency, concurrency, duplicate rejection and repeated-scan cart merge.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
