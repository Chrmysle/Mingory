const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const projectRoot = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

function createFixture() {
  const state = {
    users: [{ _id: "user-1", openid: "openid-1", name: "妈妈", enabled: true }],
    products: [
      { _id: "p-tape", name: "透明胶带", supplier: "老王日杂批发", unit: "卷", hasVariants: true, enabled: true },
      { _id: "p-bag", name: "垃圾袋", supplier: "老王日杂批发", unit: "", hasVariants: false, enabled: true },
      { _id: "p-shoe", name: "男士拖鞋", supplier: "鸿运鞋业", unit: "双", hasVariants: true, enabled: true },
      { _id: "p-missing", name: "抹布", supplier: "", unit: "块", hasVariants: false, enabled: true },
      { _id: "p-disabled", name: "停用商品", supplier: "老王日杂批发", unit: "", enabled: false },
    ],
    product_variants: [
      { _id: "v-3", productId: "p-tape", variantCode: "V003", specification: "3cm", stock: 2, warningStock: 5, enabled: true },
      { _id: "v-5", productId: "p-tape", variantCode: "V005", specification: "5cm", stock: 10, warningStock: 5, enabled: true },
      { _id: "v-8", productId: "p-tape", variantCode: "V008", specification: "8cm", stock: 0, warningStock: 3, enabled: true },
      { _id: "v-bag", productId: "p-bag", variantCode: "VBAG", specification: "", stock: 5, warningStock: 5, enabled: true },
      { _id: "v-shoe", productId: "p-shoe", variantCode: "VSHOE", specification: "42码", stock: 9, warningStock: 3, enabled: true },
      { _id: "v-missing", productId: "p-missing", variantCode: "VMISS", specification: "", stock: 1, warningStock: 4, enabled: true },
      { _id: "v-no-warning", productId: "p-bag", variantCode: "VNOW", specification: "加厚", stock: 0, warningStock: null, enabled: true },
      { _id: "v-disabled-product", productId: "p-disabled", variantCode: "VDIS", specification: "", stock: 0, warningStock: 5, enabled: true },
    ],
  };
  const queryCounts = { productVariantsWhere: 0 };
  const command = { in: (values) => ({ __operator: "in", values }) };

  function matches(record, condition) {
    return Object.entries(condition).every(([key, expected]) => {
      if (expected && expected.__operator === "in") return expected.values.includes(record[key]);
      return record[key] === expected;
    });
  }

  function collection(name) {
    return {
      where(condition) {
        if (name === "product_variants") queryCounts.productVariantsWhere += 1;
        let list = state[name].filter((record) => matches(record, condition));
        let offset = 0;
        let limit = Infinity;
        const query = {
          skip(value) { offset = value; return query; },
          limit(value) { limit = value; return query; },
          field() { return query; },
          async get() { return { data: clone(list.slice(offset, offset + limit)) }; },
        };
        return query;
      },
    };
  }

  return {
    state,
    queryCounts,
    sdk: {
      DYNAMIC_CURRENT_ENV: "dynamic",
      init() {},
      database() { return { collection, command }; },
      getWXContext() { return { OPENID: "openid-1" }; },
    },
  };
}

function loadCloudFunction(sdk) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "wx-server-sdk") return sdk;
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = path.join(projectRoot, "cloudfunctions", "getSupplierRestock", "index.js");
  delete require.cache[require.resolve(modulePath)];
  try { return require(modulePath).main; }
  finally { Module._load = originalLoad; }
}

async function run() {
  const fixture = createFixture();
  const query = loadCloudFunction(fixture.sdk);

  const overview = await query({ action: "overview", tcbContext: { environment: "test" } });
  assert.equal(overview.success, true);
  assert.equal(overview.data.totalRestockSkuCount, 4);
  assert.equal(overview.data.suppliers.find((item) => item.supplier === "老王日杂批发").restockSkuCount, 3);
  assert.equal(overview.data.suppliers.find((item) => item.supplier === "鸿运鞋业").restockSkuCount, 0);
  assert.equal(overview.data.suppliers.find((item) => item.missingSupplier).restockSkuCount, 1);
  assert.equal(overview.data.outOfStockCount, 1);
  assert.equal(overview.data.lowStockCount, 3);
  assert.equal(overview.data.normalStockCount, 2);
  assert.equal(overview.data.warningUnsetCount, 1);
  assert.equal(overview.data.totalActiveSkuCount, 7);
  assert.equal(overview.data.urgentItems[0].variantId, "v-8");
  assert.equal(fixture.queryCounts.productVariantsWhere, 1);

  const wang = await query({ action: "items", supplier: "老王日杂批发", missingSupplier: false, includeAll: false });
  assert.equal(wang.success, true);
  assert.equal(wang.data.restockSkuCount, 3);
  assert.equal(wang.data.groups.length, 2);
  assert.equal(fixture.queryCounts.productVariantsWhere, 2);
  const tape = wang.data.groups.find((item) => item.productId === "p-tape");
  assert.deepEqual(tape.variants.map((item) => item.specification), ["8cm", "3cm"]);
  assert.equal(tape.variants[0].statusLabel, "缺货");
  assert.equal(tape.variants.some((item) => item.specification === "5cm"), false);
  const bag = wang.data.groups.find((item) => item.productId === "p-bag");
  assert.equal(bag.variants.length, 1);
  assert.equal(bag.variants[0].specification, "");
  assert.equal(bag.variants[0].stock, bag.variants[0].warningStock);

  const all = await query({ action: "items", supplier: "老王日杂批发", includeAll: true });
  assert.equal(all.data.groups.find((item) => item.productId === "p-bag").variants.some((item) => item.variantId === "v-no-warning"), true);
  assert.equal(all.data.groups.find((item) => item.productId === "p-bag").variants.find((item) => item.variantId === "v-no-warning").statusLabel, "未设置预警");
  assert.equal(all.data.groups.some((item) => item.productId === "p-disabled"), false);

  const missing = await query({ action: "items", supplier: "", missingSupplier: true });
  assert.equal(missing.data.displayName, "未设置供货商");
  assert.equal(missing.data.groups.length, 1);
  assert.equal(missing.data.groups[0].productId, "p-missing");

  const shoes = await query({ action: "items", supplier: "鸿运鞋业" });
  assert.equal(shoes.data.groups.length, 0);
  assert.equal(shoes.data.restockSkuCount, 0);

  fixture.state.product_variants.find((item) => item._id === "v-3").stock = 12;
  const refreshed = await query({ action: "items", supplier: "老王日杂批发" });
  assert.equal(refreshed.data.groups.find((item) => item.productId === "p-tape").variants.some((item) => item.variantId === "v-3"), false);

  const rejected = await query({ action: "overview", arbitraryField: "stock" });
  assert.equal(rejected.code, "INVALID_PARAMETER");
  assert.equal(fixture.queryCounts.productVariantsWhere < fixture.state.products.length * 7, true);

  console.log("Restock tests passed: supplier isolation, product grouping, equality threshold, zero stock, empty warning/supplier/specification, all-items mode, refresh and field whitelist.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
