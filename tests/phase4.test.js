const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const projectRoot = path.resolve(__dirname, "..");

function clone(value) {
  return structuredClone(value);
}

function createCloudFixture({ stock = 2, costPriceCent = 350, salePriceCent = 500, unit = "", failOnSetCollection = "", failOnGetCollection = "" } = {}) {
  const state = {
    users: new Map([["user-1", { _id: "user-1", openid: "openid-1", name: "测试用户", enabled: true }]]),
    products: new Map([["product-1", { _id: "product-1", productCode: "SP000001", name: "透明胶带", unit, enabled: true }]]),
    product_variants: new Map([["variant-1", {
      _id: "variant-1", productId: "product-1", variantCode: "SP000001-V001",
      specification: "5cm", costPriceCent, salePriceCent, stock, enabled: true,
    }]]),
    sales: new Map(),
    inventory_logs: new Map(),
  };
  let transactionQueue = Promise.resolve();

  function collectionApi(target, collectionName) {
    const records = target[collectionName];
    return {
      where(condition) {
        return {
          limit() {
            return {
              async get() {
                const data = [...records.values()].filter((item) => Object.entries(condition).every(([key, value]) => item[key] === value));
                return { data: clone(data) };
              },
            };
          },
        };
      },
      doc(id) {
        return {
          async get() {
            if (collectionName === failOnGetCollection) throw new Error("injected read failure");
            if (!records.has(id)) throw new Error("document not found");
            return { data: clone(records.get(id)) };
          },
          async update({ data }) {
            if (!records.has(id)) throw new Error("document not found");
            records.set(id, { ...records.get(id), ...clone(data) });
          },
          async set({ data }) {
            if (collectionName === failOnSetCollection) throw new Error("injected write failure");
            records.set(id, { _id: id, ...clone(data) });
          },
        };
      },
    };
  }

  const database = {
    collection(name) { return collectionApi(state, name); },
    serverDate() { return new Date("2026-08-14T00:00:00.000Z"); },
    async runTransaction(callback) {
      let unlock;
      const previous = transactionQueue;
      transactionQueue = new Promise((resolve) => { unlock = resolve; });
      await previous;
      const draft = Object.fromEntries(Object.entries(state).map(([name, records]) => [name, new Map(clone([...records]))]));
      try {
        const result = await callback({ collection: (name) => collectionApi(draft, name) });
        for (const [name, records] of Object.entries(draft)) state[name] = records;
        return { result };
      } finally {
        unlock();
      }
    },
  };

  return {
    state,
    sdk: {
      DYNAMIC_CURRENT_ENV: "dynamic",
      init() {},
      database() { return database; },
      getWXContext() { return { OPENID: "openid-1" }; },
    },
  };
}

async function testReadFailureDoesNotBypassIdempotency() {
  const fixture = createCloudFixture({ stock: 2, failOnGetCollection: "sales" });
  const main = loadSaleProduct(fixture.sdk);
  const response = await withoutExpectedErrorLog(() => main({ requestId: "SALE_read_error_001", variantId: "variant-1", quantity: 1, unitPriceCent: 500 }));
  assert.equal(response.success, false);
  assert.equal(response.code, "DATABASE_ERROR");
  assert.equal(fixture.state.product_variants.get("variant-1").stock, 2);
  assert.equal(fixture.state.sales.size, 0);
  assert.equal(fixture.state.inventory_logs.size, 0);
}

function loadSaleProduct(sdk) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) {
    if (request === "wx-server-sdk") return sdk;
    return originalLoad.call(this, request, parent, isMain);
  };
  const modulePath = path.join(projectRoot, "cloudfunctions", "saleProduct", "index.js");
  delete require.cache[require.resolve(modulePath)];
  try {
    return require(modulePath).main;
  } finally {
    Module._load = originalLoad;
  }
}

async function withoutExpectedErrorLog(callback) {
  const originalError = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = originalError;
  }
}

async function testTransactionAndSnapshot() {
  const fixture = createCloudFixture({ stock: 2, unit: "卷" });
  const main = loadSaleProduct(fixture.sdk);
  const response = await main({ requestId: "SALE_transaction_001", variantId: "variant-1", quantity: 2, unitPriceCent: 450 });
  assert.equal(response.success, true);
  assert.equal(fixture.state.product_variants.get("variant-1").stock, 0);
  assert.equal(fixture.state.product_variants.get("variant-1").salePriceCent, 500);
  assert.equal(fixture.state.sales.size, 1);
  assert.equal(fixture.state.inventory_logs.size, 1);
  const sale = fixture.state.sales.get("SALE_transaction_001");
  assert.deepEqual(
    { total: sale.totalAmountCent, cost: sale.totalCostCent, profit: sale.grossProfitCent, before: sale.beforeStock, after: sale.afterStock },
    { total: 900, cost: 700, profit: 200, before: 2, after: 0 }
  );
  assert.equal(sale.costPriceCent, 350);
  assert.equal(sale.unit, "卷");
  assert.equal(fixture.state.inventory_logs.get("LOG_SALE_transaction_001").relatedId, sale._id);
}

async function testWriteFailureRollback() {
  const fixture = createCloudFixture({ stock: 2, failOnSetCollection: "inventory_logs" });
  const main = loadSaleProduct(fixture.sdk);
  const response = await withoutExpectedErrorLog(() => main({ requestId: "SALE_rollback_001", variantId: "variant-1", quantity: 1, unitPriceCent: 500 }));
  assert.equal(response.success, false);
  assert.equal(response.code, "DATABASE_ERROR");
  assert.equal(fixture.state.product_variants.get("variant-1").stock, 2);
  assert.equal(fixture.state.sales.size, 0);
  assert.equal(fixture.state.inventory_logs.size, 0);
}

async function testIdempotency() {
  const fixture = createCloudFixture({ stock: 5 });
  const main = loadSaleProduct(fixture.sdk);
  const input = { requestId: "SALE_idempotent_001", variantId: "variant-1", quantity: 1, unitPriceCent: 500 };
  const first = await main(input);
  const second = await main(input);
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.data.duplicate, true);
  assert.equal(fixture.state.product_variants.get("variant-1").stock, 4);
  assert.equal(fixture.state.sales.size, 1);
  assert.equal(fixture.state.inventory_logs.size, 1);
}

async function testInsufficientStockRollback() {
  const fixture = createCloudFixture({ stock: 2 });
  const main = loadSaleProduct(fixture.sdk);
  const response = await main({ requestId: "SALE_insufficient_001", variantId: "variant-1", quantity: 3, unitPriceCent: 500 });
  assert.equal(response.success, false);
  assert.equal(response.code, "INSUFFICIENT_STOCK");
  assert.equal(response.data.currentStock, 2);
  assert.equal(fixture.state.product_variants.get("variant-1").stock, 2);
  assert.equal(fixture.state.sales.size, 0);
  assert.equal(fixture.state.inventory_logs.size, 0);
}

async function testConcurrentSale() {
  const fixture = createCloudFixture({ stock: 1 });
  const main = loadSaleProduct(fixture.sdk);
  const [one, two] = await Promise.all([
    main({ requestId: "SALE_concurrent_001", variantId: "variant-1", quantity: 1, unitPriceCent: 500 }),
    main({ requestId: "SALE_concurrent_002", variantId: "variant-1", quantity: 1, unitPriceCent: 500 }),
  ]);
  assert.deepEqual([one.success, two.success].sort(), [false, true]);
  assert.equal([one, two].find((item) => !item.success).code, "INSUFFICIENT_STOCK");
  assert.equal(fixture.state.product_variants.get("variant-1").stock, 0);
  assert.equal(fixture.state.sales.size, 1);
  assert.equal(fixture.state.inventory_logs.size, 1);
}

async function testZeroPriceAndHistoricalCost() {
  const fixture = createCloudFixture({ stock: 2, costPriceCent: 350 });
  const main = loadSaleProduct(fixture.sdk);
  const response = await main({ requestId: "SALE_free_item_001", variantId: "variant-1", quantity: 1, unitPriceCent: 0 });
  assert.equal(response.success, true);
  const sale = fixture.state.sales.get("SALE_free_item_001");
  assert.equal(sale.totalAmountCent, 0);
  assert.equal(sale.grossProfitCent, -350);
  fixture.state.product_variants.get("variant-1").costPriceCent = 400;
  assert.equal(fixture.state.sales.get("SALE_free_item_001").costPriceCent, 350);
}

function testStaticProjectIntegrity() {
  const jsonFiles = [];
  const jsFiles = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith(".json")) jsonFiles.push(fullPath);
      else if (entry.name.endsWith(".js")) jsFiles.push(fullPath);
    }
  }
  walk(projectRoot);
  for (const file of jsonFiles) JSON.parse(fs.readFileSync(file, "utf8"));
  for (const file of jsFiles) new Function(fs.readFileSync(file, "utf8"));
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/require\(["'](\.{1,2}\/[^"']+)["']\)/g)) {
      const base = path.resolve(path.dirname(file), match[1]);
      const resolved = [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")].find((candidate) => fs.existsSync(candidate));
      assert.ok(resolved, `无法解析模块 ${match[1]}（${path.relative(projectRoot, file)}）`);
    }
  }
  const appConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "miniprogram", "app.json"), "utf8"));
  for (const page of appConfig.pages) {
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      assert.equal(fs.existsSync(path.join(projectRoot, "miniprogram", `${page}.${extension}`)), true, `${page}.${extension} 不存在`);
    }
  }
  const saleTemplate = fs.readFileSync(path.join(projectRoot, "miniprogram", "pages", "sale", "index.wxml"), "utf8");
  assert.match(saleTemplate, /product\.unit\|\|''/, "unit 为空时应展示为空字符串");
}

async function testFrontEndDuplicateClickGuard() {
  let pageDefinition;
  let callCount = 0;
  let resolveCloudCall;
  global.Page = (definition) => { pageDefinition = definition; };
  global.wx = {
    cloud: {
      callFunction() {
        callCount += 1;
        return new Promise((resolve) => { resolveCloudCall = resolve; });
      },
    },
    showToast() {},
  };
  const pagePath = path.join(projectRoot, "miniprogram", "pages", "sale", "index.js");
  delete require.cache[require.resolve(pagePath)];
  require(pagePath);
  const context = {
    ...pageDefinition,
    requestId: "SALE_frontend_001",
    variantId: "variant-1",
    data: { ...clone(pageDefinition.data), quantity: 1, unitPrice: "5.00", variant: { salePriceCent: 500, stock: 2 } },
    setData(patch, callback) {
      for (const [key, value] of Object.entries(patch)) {
        if (key.includes(".")) {
          const [root, child] = key.split(".");
          this.data[root] = { ...this.data[root], [child]: value };
        } else this.data[key] = value;
      }
      if (callback) callback();
    },
  };
  const first = pageDefinition.submit.call(context);
  const second = pageDefinition.submit.call(context);
  assert.equal(callCount, 1);
  resolveCloudCall({ result: { success: true, data: { sale: { totalAmountCent: 500 }, remainingStock: 1 } } });
  await Promise.all([first, second]);
  assert.equal(context.data.variant.stock, 1);
  delete global.Page;
  delete global.wx;
}

async function testScanSaleTargetsMatchedVariant() {
  let switchedUrl = "";
  let storedCart;
  global.wx = {
    scanCode: async () => ({ result: "690000000001" }),
    cloud: { callFunction: async () => ({ result: { success: true, data: { product: { _id: "product-1", name: "透明胶带", unit: "卷", enabled: true }, variants: [{ _id: "variant-5cm", specification: "5cm", salePriceCent: 500, stock: 3, enabled: true }], matchedVariantId: "variant-5cm" } } }) },
    getStorageSync() { return storedCart; },
    setStorageSync(_key, value) { storedCart = clone(value); },
    switchTab({ url }) { switchedUrl = url; },
    showToast() {},
  };
  const scanPath = path.join(projectRoot, "miniprogram", "utils", "scan-sale.js");
  delete require.cache[require.resolve(scanPath)];
  await require(scanPath).scanSale();
  assert.equal(switchedUrl, "/pages/sell/index");
  assert.equal(storedCart.items[0].variantId, "variant-5cm");
  assert.equal(storedCart.items[0].quantity, 1);
  delete global.wx;
}

async function run() {
  testStaticProjectIntegrity();
  await testTransactionAndSnapshot();
  await testWriteFailureRollback();
  await testReadFailureDoesNotBypassIdempotency();
  await testIdempotency();
  await testInsufficientStockRollback();
  await testConcurrentSale();
  await testZeroPriceAndHistoricalCost();
  await testFrontEndDuplicateClickGuard();
  await testScanSaleTargetsMatchedVariant();
  console.log("Phase 4 tests passed: static, transaction rollback, snapshot, idempotency, insufficient stock, concurrency, zero-price sale, click guard, scan target.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
