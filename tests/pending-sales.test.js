const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

async function run() {
  let openid = "openid-1";
  const state = {
    users: new Map([
      ["u1", { _id: "u1", openid: "openid-1", name: "妈妈", enabled: true }],
      ["u2", { _id: "u2", openid: "openid-2", name: "爸爸", enabled: true }],
    ]),
    products: new Map([["p1", { _id: "p1", name: "袜子", unit: "双", enabled: true }]]),
    product_variants: new Map([["v1", { _id: "v1", productId: "p1", specification: "", salePriceCent: 1000, stock: 20, enabled: true }]]),
    pending_sale_orders: new Map(),
  };
  function collection(name) {
    const records = state[name];
    return {
      where(condition) {
        let list = [...records.values()].filter((item) => Object.entries(condition).every(([key, value]) => item[key] === value));
        const query = {
          orderBy(field, direction) { list.sort((a, b) => direction === "desc" ? new Date(b[field]) - new Date(a[field]) : new Date(a[field]) - new Date(b[field])); return query; },
          limit(count) { list = list.slice(0, count); return query; },
          async get() { return { data: clone(list) }; },
        };
        return query;
      },
      doc(id) { return {
        async get() { if (!records.has(id)) throw new Error("not found"); return { data: clone(records.get(id)) }; },
        async set({ data }) { records.set(id, { _id: id, ...clone(data) }); },
        async remove() { records.delete(id); },
      }; },
    };
  }
  const sdk = { DYNAMIC_CURRENT_ENV: "dynamic", init() {}, database() { return { collection, serverDate() { return new Date("2026-08-15T04:00:00Z"); } }; }, getWXContext() { return { OPENID: openid }; } };
  const original = Module._load;
  Module._load = function mock(request, parent, main) { if (request === "wx-server-sdk") return sdk; return original.call(this, request, parent, main); };
  const file = path.join(root, "cloudfunctions/managePendingSales/index.js");
  delete require.cache[require.resolve(file)];
  let manage;
  try { manage = require(file).main; } finally { Module._load = original; }

  const saved = await manage({ action: "save", pendingId: "PENDING_TEST_0001", requestId: "SALE_PENDING_TEST_0001", items: [{ variantId: "v1", quantity: 2, unitPriceCent: 1000, isGift: false }] });
  assert.equal(saved.success, true);
  assert.equal(saved.data.pending.totalQuantity, 2);
  assert.equal(saved.data.pending.items[0].productName, "袜子");
  assert.equal(state.product_variants.get("v1").stock, 20);

  openid = "openid-2";
  const shared = await manage({ action: "list" });
  assert.equal(shared.data.list.length, 1);
  assert.equal(shared.data.list[0].createdByName, "妈妈");

  await manage({ action: "remove", pendingId: "PENDING_TEST_0001" });
  assert.equal((await manage({ action: "list" })).data.list.length, 0);
  console.log("Pending-sale tests passed: cloud save, cross-device whitelist visibility, no stock change and removal.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
