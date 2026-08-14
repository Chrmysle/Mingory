const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const projectRoot = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

function createFixture({ stock = 10, costPriceCent = 300, failLogWrite = false } = {}) {
  const state = {
    users: new Map([["user-1", { _id: "user-1", openid: "openid-1", name: "测试用户", enabled: true }]]),
    products: new Map([["product-1", { _id: "product-1", productCode: "SP000001", name: "透明胶带", unit: "", enabled: true }]]),
    product_variants: new Map([
      ["variant-5cm", { _id: "variant-5cm", productId: "product-1", variantCode: "SP000001-V001", specification: "5cm", costPriceCent, salePriceCent: 500, stock, enabled: true }],
      ["variant-3cm", { _id: "variant-3cm", productId: "product-1", variantCode: "SP000001-V002", specification: "3cm", costPriceCent: 200, salePriceCent: 300, stock: 20, enabled: true }],
    ]),
    sales: new Map(),
    inventory_logs: new Map(),
  };
  let queue = Promise.resolve();

  function collectionApi(target, name) {
    const records = target[name];
    return {
      where(condition) {
        let list = [...records.values()].filter((item) => Object.entries(condition).every(([key, value]) => item[key] === value));
        const query = {
          orderBy(field, direction) { list.sort((a, b) => direction === "desc" ? new Date(b[field]) - new Date(a[field]) : new Date(a[field]) - new Date(b[field])); return query; },
          skip(count) { list = list.slice(count); return query; },
          limit(count) { list = list.slice(0, count); return query; },
          async get() { return { data: clone(list) }; },
        };
        return query;
      },
      doc(id) {
        return {
          async get() { if (!records.has(id)) throw new Error("document not found"); return { data: clone(records.get(id)) }; },
          async update({ data }) { if (!records.has(id)) throw new Error("document not found"); records.set(id, { ...records.get(id), ...clone(data) }); },
          async set({ data }) { if (failLogWrite && name === "inventory_logs") throw new Error("injected log failure"); records.set(id, { _id: id, ...clone(data) }); },
        };
      },
    };
  }

  const database = {
    collection(name) { return collectionApi(state, name); },
    serverDate() { return new Date(); },
    async runTransaction(callback) {
      let unlock;
      const previous = queue;
      queue = new Promise((resolve) => { unlock = resolve; });
      await previous;
      const draft = Object.fromEntries(Object.entries(state).map(([name, records]) => [name, new Map(clone([...records]))]));
      try {
        const result = await callback({ collection: (name) => collectionApi(draft, name) });
        for (const [name, records] of Object.entries(draft)) state[name] = records;
        return { result };
      } finally { unlock(); }
    },
  };
  return {
    state,
    sdk: { DYNAMIC_CURRENT_ENV: "dynamic", init() {}, database() { return database; }, getWXContext() { return { OPENID: "openid-1" }; } },
  };
}

function loadCloudFunction(name, sdk) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "wx-server-sdk") return sdk;
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = path.join(projectRoot, "cloudfunctions", name, "index.js");
  delete require.cache[require.resolve(modulePath)];
  try { return require(modulePath).main; }
  finally { Module._load = originalLoad; }
}

async function quiet(callback) {
  const original = console.error;
  console.error = () => {};
  try { return await callback(); }
  finally { console.error = original; }
}

async function testStockIn() {
  const fixture = createFixture();
  const stockIn = loadCloudFunction("stockIn", fixture.sdk);
  const first = await stockIn({ requestId: "STOCKIN_test_0001", variantId: "variant-5cm", quantity: 20, newCostPriceCent: 350, remark: "到货" });
  assert.equal(first.success, true);
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 30);
  assert.equal(fixture.state.product_variants.get("variant-5cm").costPriceCent, 350);
  const log = fixture.state.inventory_logs.get("LOG_STOCKIN_test_0001");
  assert.deepEqual({ type: log.type, before: log.beforeStock, change: log.changeQuantity, after: log.afterStock }, { type: "STOCK_IN", before: 10, change: 20, after: 30 });

  await stockIn({ requestId: "STOCKIN_test_0002", variantId: "variant-5cm", quantity: 1, remark: "补一件" });
  assert.equal(fixture.state.product_variants.get("variant-5cm").costPriceCent, 350);
  const replay = await stockIn({ requestId: "STOCKIN_test_0002", variantId: "variant-5cm", quantity: 1, remark: "补一件" });
  assert.equal(replay.data.duplicate, true);
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 31);
}

async function testStockInRollback() {
  const fixture = createFixture({ failLogWrite: true });
  const stockIn = loadCloudFunction("stockIn", fixture.sdk);
  const result = await quiet(() => stockIn({ requestId: "STOCKIN_rollback_1", variantId: "variant-5cm", quantity: 20, newCostPriceCent: 350, remark: "到货" }));
  assert.equal(result.code, "DATABASE_ERROR");
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 10);
  assert.equal(fixture.state.product_variants.get("variant-5cm").costPriceCent, 300);
  assert.equal(fixture.state.inventory_logs.size, 0);
}

async function testManualAdjustmentsAndStocktake() {
  const fixture = createFixture();
  const adjust = loadCloudFunction("adjustStock", fixture.sdk);
  await adjust({ requestId: "ADJUST_add_0001", variantId: "variant-5cm", type: "MANUAL_ADD", quantity: 2, remark: "找回商品" });
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 12);
  await adjust({ requestId: "ADJUST_sub_0001", variantId: "variant-5cm", type: "MANUAL_SUBTRACT", quantity: 2, remark: "商品损坏" });
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 10);

  const denied = await adjust({ requestId: "ADJUST_sub_0002", variantId: "variant-5cm", type: "MANUAL_SUBTRACT", quantity: 11, remark: "测试越界" });
  assert.equal(denied.code, "INSUFFICIENT_STOCK");
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 10);
  assert.equal(fixture.state.inventory_logs.has("LOG_ADJUST_sub_0002"), false);

  await adjust({ requestId: "ADJUST_take_001", variantId: "variant-5cm", type: "STOCKTAKE", actualStock: 8, remark: "盘点" });
  assert.equal(fixture.state.inventory_logs.get("LOG_ADJUST_take_001").changeQuantity, -2);
  await adjust({ requestId: "ADJUST_take_002", variantId: "variant-5cm", type: "STOCKTAKE", actualStock: 13, remark: "复盘" });
  assert.equal(fixture.state.inventory_logs.get("LOG_ADJUST_take_002").changeQuantity, 5);
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 13);
  assert.equal(fixture.state.product_variants.get("variant-3cm").stock, 20);

  const getLogs = loadCloudFunction("getInventoryLogs", fixture.sdk);
  const history = await getLogs({ variantId: "variant-5cm", page: 1, pageSize: 20 });
  assert.equal(history.success, true);
  assert.equal(history.data.list.length, 4);
  assert.equal(history.data.list.every((item) => item.variantId === "variant-5cm"), true);
  assert.equal(history.data.list.some((item) => item.variantId === "variant-3cm"), false);
  const globalHistory = await getLogs({ page: 1, pageSize: 20 });
  assert.equal(globalHistory.success, true);
  assert.equal(globalHistory.data.product, null);
  assert.equal(globalHistory.data.list.length, 4);
  const stockInOnly = await getLogs({ type: "STOCK_IN", page: 1, pageSize: 20 });
  assert.equal(stockInOnly.success, true);
  assert.equal(stockInOnly.data.list.length, 0);
}

async function testConcurrentSaleAndStockIn() {
  const fixture = createFixture({ stock: 10 });
  const sale = loadCloudFunction("saleProduct", fixture.sdk);
  const stockIn = loadCloudFunction("stockIn", fixture.sdk);
  const results = await Promise.all([
    sale({ requestId: "SALE_phase5_concurrent", variantId: "variant-5cm", quantity: 2, unitPriceCent: 500 }),
    stockIn({ requestId: "STOCKIN_concurrent_1", variantId: "variant-5cm", quantity: 20, remark: "并发到货" }),
  ]);
  assert.equal(results.every((item) => item.success), true);
  assert.equal(fixture.state.product_variants.get("variant-5cm").stock, 28);
  assert.equal(fixture.state.sales.size, 1);
  assert.equal(fixture.state.inventory_logs.size, 2);
  const logs = [...fixture.state.inventory_logs.values()];
  assert.equal(logs.every((log) => log.afterStock === log.beforeStock + log.changeQuantity), true);
}

async function run() {
  await testStockIn();
  await testStockInRollback();
  await testManualAdjustmentsAndStocktake();
  await testConcurrentSaleAndStockIn();
  console.log("Phase 5 tests passed: stock-in, cost update/retention, rollback, manual add/subtract, stocktake, variant isolation, sale/stock-in concurrency, idempotency.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
