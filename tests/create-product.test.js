const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

function fixture() {
  const state = {
    users: new Map([["user-1", { _id:"user-1", openid:"openid-1", name:"测试用户", enabled:true }]]),
    settings: new Map(),
    products: new Map(),
    product_variants: new Map(),
  };
  let idSeed = 0;

  function collectionApi(target, name) {
    const records = target[name];
    return {
      where(condition) {
        return { limit() { return { async get() {
          return { data:[...records.values()].filter((item) => Object.entries(condition).every(([key, value]) => item[key] === value)).map(clone) };
        } }; } };
      },
      orderBy(field, direction) {
        let list = [...records.values()].sort((left, right) => String(left[field] || "").localeCompare(String(right[field] || "")));
        if (direction === "desc") list.reverse();
        return { limit(count) { return { async get() { return { data:list.slice(0, count).map(clone) }; } }; } };
      },
      doc(id) {
        return {
          async get() {
            if (!records.has(id)) throw new Error("document not found");
            return { data:clone(records.get(id)) };
          },
          async set({ data }) { records.set(id, { _id:id, ...clone(data) }); },
        };
      },
      async add({ data }) {
        const id = `${name}-${idSeed += 1}`;
        records.set(id, { _id:id, ...clone(data) });
        return { _id:id };
      },
    };
  }

  const database = {
    collection(name) { return collectionApi(state, name); },
    serverDate() { return new Date("2026-08-16T00:00:00.000Z"); },
    async runTransaction(callback) {
      const draft = Object.fromEntries(Object.entries(state).map(([name, records]) => [name, new Map(clone([...records]))]));
      const result = await callback({ collection:(name) => collectionApi(draft, name) });
      for (const [name, records] of Object.entries(draft)) state[name] = records;
      return { result };
    },
  };
  return {
    state,
    sdk: {
      DYNAMIC_CURRENT_ENV:"dynamic",
      init() {},
      database() { return database; },
      getWXContext() { return { OPENID:"openid-1" }; },
    },
  };
}

function loadCreateProduct(sdk) {
  const original = Module._load;
  Module._load = function mock(request, parent, main) {
    if (request === "wx-server-sdk") return sdk;
    return original.call(this, request, parent, main);
  };
  const file = path.join(root, "cloudfunctions", "createProduct", "index.js");
  delete require.cache[require.resolve(file)];
  try { return require(file).main; }
  finally { Module._load = original; }
}

async function run() {
  const current = fixture();
  const createProduct = loadCreateProduct(current.sdk);
  const result = await createProduct({
    hasVariants:false,
    product:{ name:"洗洁精", unit:"", supplier:"", imageFileID:"", shelfLocation:"", remark:"" },
    variants:[{ specification:"", costPriceCent:800, salePriceCent:1200, stock:20, warningStock:null, barcode:"" }],
  });

  assert.equal(result.success, true);
  assert.equal(result.data.product.productCode, "SP000001");
  assert.equal(current.state.settings.get("productCode").value, 1);
  assert.equal(current.state.products.size, 1);
  assert.equal(current.state.product_variants.size, 1);

  current.state.settings.clear();
  const second = await createProduct({
    hasVariants:false,
    product:{ name:"垃圾袋", unit:"", supplier:"", imageFileID:"", shelfLocation:"", remark:"" },
    variants:[{ specification:"", costPriceCent:300, salePriceCent:500, stock:10, warningStock:null, barcode:"" }],
  });
  assert.equal(second.success, true);
  assert.equal(second.data.product.productCode, "SP000002");
  assert.equal(current.state.settings.get("productCode").value, 2);
  console.log("Create-product test passed: missing productCode counter initializes safely.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
