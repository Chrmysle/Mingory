const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

function fixture({ failCollection = "" } = {}) {
  const state = {
    users: new Map([["u", { _id: "u", openid: "openid-1", name: "妈妈", enabled: true }]]),
    products: new Map([["p1", { _id: "p1", productCode: "SP000001", name: "女靴", enabled: true }]]),
    product_variants: new Map([
      ["v1", { _id: "v1", productId: "p1", variantCode: "V1", specification: "39码", stock: 4, enabled: true }],
      ["v2", { _id: "v2", productId: "p1", variantCode: "V2", specification: "鞋垫", stock: 3, enabled: true }],
    ]),
    sale_orders: new Map([["SALE_ORDER_001", { _id: "SALE_ORDER_001", requestId: "SALE_ORDER_001", itemCount: 2, totalQuantity: 3, status: "normal" }]]),
    sales: new Map([
      ["LINE_1", { _id: "LINE_1", orderId: "SALE_ORDER_001", lineNumber: 1, productId: "p1", variantId: "v1", productCode: "SP000001", variantCode: "V1", productName: "女靴", specification: "39码", quantity: 1, status: "normal" }],
      ["LINE_2", { _id: "LINE_2", orderId: "SALE_ORDER_001", lineNumber: 2, productId: "p1", variantId: "v2", productCode: "SP000001", variantCode: "V2", productName: "鞋垫", specification: "", quantity: 2, status: "normal", isGift: true }],
    ]),
    inventory_logs: new Map(),
    pending_sale_orders: new Map(),
  };
  let queue = Promise.resolve();

  function collectionApi(target, name) {
    const records = target[name];
    return {
      where(condition) {
        let list = [...records.values()].filter((item) => Object.entries(condition).every(([key, value]) => value && Array.isArray(value.in) ? value.in.includes(item[key]) : item[key] === value));
        const query = {
          orderBy(field, direction) { list.sort((a, b) => direction === "desc" ? b[field] - a[field] : a[field] - b[field]); return query; },
          limit(count) { list = list.slice(0, count); return query; },
          skip(count) { list = list.slice(count); return query; },
          async get() { return { data: clone(list) }; },
        };
        return query;
      },
      doc(id) {
        return {
          async get() { if (!records.has(id)) throw new Error("document not found"); return { data: clone(records.get(id)) }; },
          async update({ data }) { if (!records.has(id)) throw new Error("document not found"); const next = { ...records.get(id) }; for (const [key, value] of Object.entries(data)) { if (value && value.__remove) delete next[key]; else next[key] = clone(value); } records.set(id, next); },
          async set({ data }) { if (name === failCollection) throw new Error("injected failure"); records.set(id, { _id: id, ...clone(data) }); },
          async remove() { if (!records.has(id)) throw new Error("document not found"); records.delete(id); },
        };
      },
    };
  }

  const database = {
    command: { in(values) { return { in: values }; }, remove() { return { __remove: true }; } },
    collection(name) { return collectionApi(state, name); },
    serverDate() { return new Date("2026-08-15T08:00:00.000Z"); },
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
  const sdk = { DYNAMIC_CURRENT_ENV: "dynamic", init() {}, database() { return database; }, getWXContext() { return { OPENID: "openid-1" }; } };
  return { state, sdk };
}

function loadCloud(name, sdk) {
  const original = Module._load;
  Module._load = function mock(request, parent, main) { if (request === "wx-server-sdk") return sdk; return original.call(this, request, parent, main); };
  const file = path.join(root, "cloudfunctions", name, "index.js");
  delete require.cache[require.resolve(file)];
  try { return require(file).main; } finally { Module._load = original; }
}

async function testArchiveAndRestoreProduct() {
  const current = fixture();
  const archive = loadCloud("archiveProduct", current.sdk);
  const first = await archive({ productId: "p1" });
  const second = await archive({ productId: "p1" });
  assert.equal(first.success, true);
  assert.equal(second.data.duplicate, true);
  assert.equal(current.state.products.get("p1").enabled, false);
  assert.equal(current.state.products.get("p1").status, "archived");
  assert.equal(current.state.products.get("p1").archivedByName, "妈妈");
  assert.equal(current.state.product_variants.get("v1").stock, 4);
  assert.equal(current.state.product_variants.get("v1").enabled, true);
  const manage = loadCloud("manageArchivedProducts", current.sdk);
  const inspected = await manage({ action: "inspect", productId: "p1" });
  assert.equal(inspected.data.references.canPermanentlyDelete, false);
  assert.equal(inspected.data.references.hasSales, true);
  const blocked = await manage({ action: "permanentDelete", productId: "p1" });
  assert.equal(blocked.code, "PRODUCT_REFERENCED");
  const restored = await manage({ action: "restore", productId: "p1" });
  assert.equal(restored.success, true);
  assert.equal(current.state.products.get("p1").enabled, true);
  assert.equal(current.state.products.get("p1").status, "active");
  assert.equal("archivedAt" in current.state.products.get("p1"), false);
}

async function testSafePermanentDelete() {
  const current = fixture();
  current.state.sale_orders.clear();
  current.state.sales.clear();
  const archive = loadCloud("archiveProduct", current.sdk);
  await archive({ productId: "p1" });
  const manage = loadCloud("manageArchivedProducts", current.sdk);
  const inspected = await manage({ action: "inspect", productId: "p1" });
  assert.equal(inspected.data.references.canPermanentlyDelete, true);
  const removed = await manage({ action: "permanentDelete", productId: "p1" });
  assert.equal(removed.success, true);
  assert.equal(removed.data.deletedVariantCount, 2);
  assert.equal(current.state.products.has("p1"), false);
  assert.equal(current.state.product_variants.size, 0);
}

async function testEveryReferenceBlocksDeletion() {
  const inventory = fixture();
  inventory.state.sale_orders.clear();
  inventory.state.sales.clear();
  inventory.state.inventory_logs.set("LOG_1", { _id: "LOG_1", productId: "p1", variantId: "v1", type: "STOCK_IN" });
  await loadCloud("archiveProduct", inventory.sdk)({ productId: "p1" });
  const inventoryResult = await loadCloud("manageArchivedProducts", inventory.sdk)({ action: "permanentDelete", productId: "p1" });
  assert.equal(inventoryResult.code, "PRODUCT_REFERENCED");
  assert.equal(inventoryResult.data.hasInventoryLogs, true);

  const pending = fixture();
  pending.state.sale_orders.clear();
  pending.state.sales.clear();
  pending.state.pending_sale_orders.set("PENDING_1", { _id: "PENDING_1", status: "pending", items: [{ productId: "p1", variantId: "v1" }] });
  await loadCloud("archiveProduct", pending.sdk)({ productId: "p1" });
  const pendingResult = await loadCloud("manageArchivedProducts", pending.sdk)({ action: "permanentDelete", productId: "p1" });
  assert.equal(pendingResult.code, "PRODUCT_REFERENCED");
  assert.equal(pendingResult.data.hasPendingSale, true);
}

async function testRestoreProvidesUsableVariant() {
  const current = fixture();
  current.state.sale_orders.clear();
  current.state.sales.clear();
  current.state.product_variants.get("v1").enabled = false;
  current.state.product_variants.get("v2").enabled = false;
  await loadCloud("archiveProduct", current.sdk)({ productId: "p1" });
  const restored = await loadCloud("manageArchivedProducts", current.sdk)({ action: "restore", productId: "p1" });
  assert.equal(restored.success, true);
  assert.equal([...current.state.product_variants.values()].some((item) => item.enabled === true), true);
}

async function testCancelOrder() {
  const current = fixture();
  const cancel = loadCloud("cancelSale", current.sdk);
  const first = await cancel({ orderId: "SALE_ORDER_001", reason: "顾客退回" });
  assert.equal(first.success, true);
  assert.equal(first.data.restoredQuantity, 3);
  assert.equal(current.state.product_variants.get("v1").stock, 5);
  assert.equal(current.state.product_variants.get("v2").stock, 5);
  assert.equal(current.state.sale_orders.get("SALE_ORDER_001").status, "cancelled");
  assert.equal(current.state.sales.get("LINE_1").status, "cancelled");
  assert.equal(current.state.inventory_logs.size, 2);
  assert.equal([...current.state.inventory_logs.values()].every((item) => item.type === "SALE_CANCEL" && item.changeQuantity > 0), true);
  const duplicate = await cancel({ orderId: "SALE_ORDER_001", reason: "重复提交" });
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.data.duplicate, true);
  assert.equal(current.state.product_variants.get("v1").stock, 5);
  assert.equal(current.state.inventory_logs.size, 2);
}

async function testCancelRollback() {
  const current = fixture({ failCollection: "inventory_logs" });
  const originalError = console.error; console.error = () => {};
  const result = await loadCloud("cancelSale", current.sdk)({ orderId: "SALE_ORDER_001" });
  console.error = originalError;
  assert.equal(result.success, false);
  assert.equal(current.state.product_variants.get("v1").stock, 4);
  assert.equal(current.state.sale_orders.get("SALE_ORDER_001").status, "normal");
  assert.equal(current.state.sales.get("LINE_1").status, "normal");
}

async function testLegacyCancel() {
  const current = fixture();
  current.state.sale_orders.clear();
  current.state.sales.clear();
  current.state.sales.set("SALE_LEGACY_001", { _id: "SALE_LEGACY_001", productId: "p1", variantId: "v1", productCode: "SP000001", variantCode: "V1", productName: "女靴", specification: "39码", quantity: 1, status: "normal" });
  const result = await loadCloud("cancelSale", current.sdk)({ orderId: "SALE_LEGACY_001" });
  assert.equal(result.success, true);
  assert.equal(current.state.product_variants.get("v1").stock, 5);
  assert.equal(current.state.sales.get("SALE_LEGACY_001").status, "cancelled");
  assert.equal(current.state.inventory_logs.get("CANCEL_SALE_LEGACY_001_01").type, "SALE_CANCEL");
}

function testUiAndQueryRules() {
  const productDetail = fs.readFileSync(path.join(root, "miniprogram/pages/product-detail/index.wxml"), "utf8");
  const saleDetail = fs.readFileSync(path.join(root, "miniprogram/pages/sale-detail/index.wxml"), "utf8");
  const search = fs.readFileSync(path.join(root, "cloudfunctions/searchProducts/index.js"), "utf8");
  assert.match(productDetail, /归档商品/);
  assert.match(productDetail, /恢复商品/);
  assert.match(productDetail, /永久删除/);
  assert.match(saleDetail, /撤销这笔销售/);
  assert.match(search, /enabled:true/);
}

async function run() {
  await testArchiveAndRestoreProduct();
  await testSafePermanentDelete();
  await testEveryReferenceBlocksDeletion();
  await testRestoreProvidesUsableVariant();
  await testCancelOrder();
  await testCancelRollback();
  await testLegacyCancel();
  testUiAndQueryRules();
  console.log("Archive/cancel tests passed: archive, restore, safe permanent delete, reference blocking, order cancellation, rollback and legacy compatibility.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
