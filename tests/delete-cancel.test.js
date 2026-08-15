const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

function fixture({ failCollection = "" } = {}) {
  const state = {
    users: new Map([["u", { _id: "u", openid: "openid-1", name: "妈妈", enabled: true }]]),
    products: new Map([
      ["p1", { _id: "p1", productCode: "SP000001", name: "女靴", enabled: true }],
      ["p2", { _id: "p2", productCode: "SP000002", name: "袜子", enabled: true }],
    ]),
    product_variants: new Map([
      ["v1", { _id: "v1", productId: "p1", variantCode: "V1", specification: "39码", stock: 4, enabled: true }],
      ["v2", { _id: "v2", productId: "p1", variantCode: "V2", specification: "鞋垫", stock: 3, enabled: true }],
      ["v3", { _id: "v3", productId: "p2", variantCode: "V3", specification: "", stock: 8, enabled: true }],
    ]),
    sale_orders: new Map([["ORDER_1", { _id: "ORDER_1", requestId: "ORDER_1", itemCount: 3, totalQuantity: 4, totalAmountCent: 17900, totalCostCent: 10000, grossProfitCent: 7900 }]]),
    sales: new Map([
      ["LINE_1", { _id: "LINE_1", orderId: "ORDER_1", lineNumber: 1, orderCountContribution: 1, productId: "p1", variantId: "v1", productName: "女靴", specification: "39码", quantity: 1, unitPriceCent: 15900, totalAmountCent: 15900, totalCostCent: 9000, grossProfitCent: 6900 }],
      ["LINE_2", { _id: "LINE_2", orderId: "ORDER_1", lineNumber: 2, orderCountContribution: 0, productId: "p2", variantId: "v3", productName: "袜子", specification: "", quantity: 2, unitPriceCent: 1000, totalAmountCent: 2000, totalCostCent: 800, grossProfitCent: 1200 }],
      ["LINE_3", { _id: "LINE_3", orderId: "ORDER_1", lineNumber: 3, orderCountContribution: 0, productId: "p1", variantId: "v2", productName: "鞋垫", specification: "", quantity: 1, unitPriceCent: 0, totalAmountCent: 0, totalCostCent: 200, grossProfitCent: -200, isGift: true }],
    ]),
    inventory_logs: new Map([
      ["LOG_ORDER_1_01", { _id: "LOG_ORDER_1_01", productId: "p1", variantId: "v1", type: "SALE", relatedId: "ORDER_1", relatedLineId: "LINE_1" }],
      ["LOG_ORDER_1_02", { _id: "LOG_ORDER_1_02", productId: "p2", variantId: "v3", type: "SALE", relatedId: "ORDER_1", relatedLineId: "LINE_2" }],
      ["LOG_ORDER_1_03", { _id: "LOG_ORDER_1_03", productId: "p1", variantId: "v2", type: "SALE", relatedId: "ORDER_1", relatedLineId: "LINE_3" }],
    ]),
    pending_sale_orders: new Map(),
  };
  let queue = Promise.resolve();
  function collectionApi(target, name) {
    const records = target[name];
    return {
      where(condition) {
        let list = [...records.values()].filter((item) => Object.entries(condition).every(([key, value]) => value && Array.isArray(value.in) ? value.in.includes(item[key]) : item[key] === value));
        const query = {
          orderBy(field, direction) { list.sort((a, b) => { const l = new Date(a[field] || 0).getTime(); const r = new Date(b[field] || 0).getTime(); return direction === "desc" ? r - l : l - r; }); return query; },
          limit(count) { list = list.slice(0, count); return query; },
          skip(count) { list = list.slice(count); return query; },
          async get() { return { data: clone(list) }; },
        };
        return query;
      },
      doc(id) {
        return {
          async get() { if (!records.has(id)) throw new Error("document not found"); return { data: clone(records.get(id)) }; },
          async update({ data }) { if (!records.has(id)) throw new Error("document not found"); if (name === failCollection) throw new Error("injected failure"); const next = { ...records.get(id) }; for (const [key, value] of Object.entries(data)) { if (value && value.__remove) delete next[key]; else next[key] = clone(value); } records.set(id, next); },
          async set({ data }) { records.set(id, { _id: id, ...clone(data) }); },
          async remove() { if (!records.has(id)) throw new Error("document not found"); if (name === failCollection) throw new Error("injected failure"); records.delete(id); },
        };
      },
    };
  }
  const database = {
    command: { in(values) { return { in: values }; }, remove() { return { __remove: true }; } },
    collection(name) { return collectionApi(state, name); },
    serverDate() { return new Date("2026-08-15T08:00:00.000Z"); },
    async runTransaction(callback) {
      let release; const previous = queue; queue = new Promise((resolve) => { release = resolve; }); await previous;
      const draft = Object.fromEntries(Object.entries(state).map(([name, records]) => [name, new Map(clone([...records]))]));
      try { const result = await callback({ collection: (name) => collectionApi(draft, name) }); for (const [name, records] of Object.entries(draft)) state[name] = records; return { result }; }
      finally { release(); }
    },
  };
  const sdk = { DYNAMIC_CURRENT_ENV: "dynamic", init() {}, database() { return database; }, getWXContext() { return { OPENID: "openid-1" }; } };
  return { state, sdk };
}

function loadCloud(name, sdk) {
  const original = Module._load;
  Module._load = function mock(request, parent, main) { if (request === "wx-server-sdk") return sdk; return original.call(this, request, parent, main); };
  const file = path.join(root, "cloudfunctions", name, "index.js"); delete require.cache[require.resolve(file)];
  try { return require(file).main; } finally { Module._load = original; }
}

async function testDeleteOneLine() {
  const current = fixture();
  const result = await loadCloud("deleteSale", current.sdk)({ orderId: "ORDER_1", saleId: "LINE_2" });
  assert.equal(result.success, true); assert.equal(result.data.orderDeleted, false);
  assert.equal(current.state.product_variants.get("v3").stock, 10);
  assert.equal(current.state.sales.has("LINE_2"), false); assert.equal(current.state.inventory_logs.has("LOG_ORDER_1_02"), false);
  const order = current.state.sale_orders.get("ORDER_1");
  assert.deepEqual([order.itemCount, order.totalQuantity, order.totalAmountCent, order.totalCostCent, order.grossProfitCent], [2, 2, 15900, 9200, 6700]);
}

async function testDeleteWholeOrderAndGift() {
  const current = fixture();
  const result = await loadCloud("deleteSale", current.sdk)({ orderId: "ORDER_1" });
  assert.equal(result.success, true); assert.equal(result.data.orderDeleted, true);
  assert.deepEqual([current.state.product_variants.get("v1").stock, current.state.product_variants.get("v2").stock, current.state.product_variants.get("v3").stock], [5, 4, 10]);
  assert.equal(current.state.sale_orders.size, 0); assert.equal(current.state.sales.size, 0); assert.equal(current.state.inventory_logs.size, 0);
}

async function testRollbackAndLegacy() {
  const failed = fixture({ failCollection: "inventory_logs" }); const old = console.error; console.error = () => {};
  const result = await loadCloud("deleteSale", failed.sdk)({ orderId: "ORDER_1", saleId: "LINE_2" }); console.error = old;
  assert.equal(result.success, false); assert.equal(failed.state.product_variants.get("v3").stock, 8); assert.equal(failed.state.sales.has("LINE_2"), true);
  const legacy = fixture(); legacy.state.sale_orders.clear(); legacy.state.sales.clear(); legacy.state.inventory_logs.clear();
  legacy.state.sales.set("SALE_LEGACY", { _id: "SALE_LEGACY", productId: "p2", variantId: "v3", productName: "袜子", quantity: 1, totalAmountCent: 1000, totalCostCent: 400, grossProfitCent: 600 });
  legacy.state.inventory_logs.set("LOG_SALE_LEGACY", { _id: "LOG_SALE_LEGACY", productId: "p2", variantId: "v3", type: "SALE" });
  assert.equal((await loadCloud("deleteSale", legacy.sdk)({ orderId: "SALE_LEGACY" })).success, true);
  assert.equal(legacy.state.product_variants.get("v3").stock, 9); assert.equal(legacy.state.sales.size, 0); assert.equal(legacy.state.inventory_logs.size, 0);
}

async function testProductCascade() {
  const current = fixture();
  current.state.pending_sale_orders.set("PENDING_1", { _id: "PENDING_1", status: "pending", items: [
    { productId: "p2", variantId: "v3", quantity: 2, unitPriceCent: 1000 },
    { productId: "p1", variantId: "v1", quantity: 1, unitPriceCent: 1000 },
  ] });
  await loadCloud("archiveProduct", current.sdk)({ productId: "p2" });
  const manage = loadCloud("manageArchivedProducts", current.sdk);
  const inspected = await manage({ action: "inspect", productId: "p2" });
  assert.equal(inspected.data.references.canPermanentlyDelete, true); assert.equal(inspected.data.references.saleLineCount, 1);
  const removed = await manage({ action: "permanentDelete", productId: "p2" });
  assert.equal(removed.success, true); assert.equal(current.state.products.has("p2"), false); assert.equal(current.state.product_variants.has("v3"), false);
  assert.equal(current.state.sales.has("LINE_2"), false); assert.equal(current.state.sales.has("LINE_1"), true);
  assert.deepEqual([current.state.sale_orders.get("ORDER_1").itemCount, current.state.sale_orders.get("ORDER_1").totalAmountCent], [2, 15900]);
  assert.equal(current.state.pending_sale_orders.get("PENDING_1").items.length, 1);
  await loadCloud("archiveProduct", current.sdk)({ productId: "p1" });
  assert.equal((await manage({ action: "restore", productId: "p1" })).success, true);
}

async function testMigrationNoStockRestore() {
  const current = fixture();
  for (const line of current.state.sales.values()) line.status = "cancelled";
  current.state.sale_orders.get("ORDER_1").status = "cancelled";
  for (let index = 1; index <= 3; index += 1) {
    const suffix = String(index).padStart(2, "0");
    current.state.inventory_logs.set("CANCEL_ORDER_1_" + suffix, { _id: "CANCEL_ORDER_1_" + suffix, type: "SALE_CANCEL", relatedId: "ORDER_1" });
  }
  const before = [...current.state.product_variants.values()].map((item) => item.stock);
  const migrate = loadCloud("migrateCancelledSales", current.sdk);
  const first = await migrate({ confirm: "DELETE_CANCELLED_SALES_V1" });
  assert.equal(first.success, true); assert.equal(first.data.restoredStock, false);
  assert.deepEqual([...current.state.product_variants.values()].map((item) => item.stock), before);
  assert.equal(current.state.sales.size, 0); assert.equal(current.state.sale_orders.size, 0); assert.equal(current.state.inventory_logs.size, 0);
  assert.equal((await migrate({ confirm: "DELETE_CANCELLED_SALES_V1" })).data.completed, true);
}

function testUi() {
  const detail = fs.readFileSync(path.join(root, "miniprogram/pages/sale-detail/index.wxml"), "utf8");
  const list = fs.readFileSync(path.join(root, "miniprogram/pages/sales/index.wxml"), "utf8");
  const service = fs.readFileSync(path.join(root, "miniprogram/services/statistics.js"), "utf8");
  assert.match(detail, /删除这笔销售/); assert.match(detail, /deleteLine/);
  for (const oldText of ["已撤销", "撤销原因", "撤销这笔销售"]) assert.equal(detail.includes(oldText) || list.includes(oldText), false);
  assert.equal(service.includes("cancelSale"), false); assert.equal(service.includes("deleteSale"), true);
}

async function run() {
  await testDeleteOneLine(); await testDeleteWholeOrderAndGift(); await testRollbackAndLegacy(); await testProductCascade(); await testMigrationNoStockRestore(); testUi();
  console.log("Delete/cascade tests passed: line delete, whole order, gift restore, rollback, legacy sale, product cascade, pending cleanup and no-stock migration.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
