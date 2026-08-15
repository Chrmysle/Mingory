const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");

const projectRoot = path.resolve(__dirname, "..");
const DAY_MS = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 7, 1) - 8 * 60 * 60 * 1000;

function createFixture({ empty = false } = {}) {
  const dailyRows = empty ? [] : [
    { _id: "2026-08-01", revenueCent: 1000, costCent: 700, grossProfitCent: 300, quantity: 2, saleCount: 1 },
    { _id: "2026-08-02", revenueCent: 0, costCent: 500, grossProfitCent: -500, quantity: 1, saleCount: 1 },
    { _id: "2026-08-03", revenueCent: 500, costCent: 200, grossProfitCent: 300, quantity: 1, saleCount: 1 },
  ];
  const skuRows = empty ? [] : [
    { _id: "v-tape", productId: "p-tape", productName: "透明胶带", specification: "5cm", unit: "卷", revenueCent: 600, costCent: 420, grossProfitCent: 180, quantity: 1, saleCount: 1 },
    { _id: "v-tape-8", productId: "p-tape", productName: "透明胶带", specification: "8cm", unit: "卷", revenueCent: 400, costCent: 280, grossProfitCent: 120, quantity: 1, saleCount: 1 },
    { _id: "v-bag", productId: "p-bag", productName: "垃圾袋", specification: "", unit: "包", revenueCent: 500, costCent: 200, grossProfitCent: 300, quantity: 1, saleCount: 1 },
    { _id: "v-gift", productId: "p-gift", productName: "赠品", specification: "", unit: "", revenueCent: 0, costCent: 500, grossProfitCent: -500, quantity: 1, saleCount: 1 },
  ];
  let aggregateCount = 0;
  const aggregateOperator = new Proxy({}, { get: (_, name) => (...args) => ({ operator: name, args }) });
  const command = {
    aggregate: aggregateOperator,
    gte(value) { return { and() { return { gte: value }; } }; },
    lt(value) { return { lt: value }; },
  };
  function aggregate() {
    const resultRows = aggregateCount++ === 0 ? dailyRows : skuRows;
    const pipeline = {
      match() { return pipeline; }, project() { return pipeline; }, group() { return pipeline; }, sort() { return pipeline; }, limit() { return pipeline; },
      async end() { return { list: structuredClone(resultRows) }; },
    };
    return pipeline;
  }
  return {
    get aggregateCount() { return aggregateCount; },
    sdk: {
      DYNAMIC_CURRENT_ENV: "dynamic",
      init() {},
      database() {
        return {
          command,
          collection(name) {
            if (name === "users") return { where() { return { limit() { return { async get() { return { data: [{ openid: "openid-1", enabled: true }] }; } }; } }; } };
            if (name === "sales") return { aggregate };
            throw new Error(`unexpected collection ${name}`);
          },
        };
      },
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
  const modulePath = path.join(projectRoot, "cloudfunctions/getStatisticsDashboard/index.js");
  delete require.cache[require.resolve(modulePath)];
  try { return require(modulePath).main; }
  finally { Module._load = originalLoad; }
}

async function run() {
  const fixture = createFixture();
  const dashboard = loadCloudFunction(fixture.sdk);
  const result = await dashboard({ startTime: START, endTime: START + 3 * DAY_MS, tcbContext: { environment: "test" } });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.summary, { revenueCent: 1500, costCent: 1400, grossProfitCent: 100, quantity: 4, saleCount: 3, grossMarginPercent: 6.67 });
  assert.equal(result.data.daily.length, 3);
  assert.equal(result.data.daily[1].grossMarginPercent, null);
  assert.equal(result.data.daily[1].grossProfitCent, -500);
  assert.equal(result.data.rankings.sku.quantity[0].variantId, "v-tape");
  assert.equal(result.data.rankings.product.quantity[0].productId, "p-tape");
  assert.equal(result.data.rankings.product.quantity[0].quantity, 2);
  assert.equal(result.data.rankings.product.grossProfit[0].grossProfitCent, 300);
  assert.equal(result.data.composition.length, 2);
  assert.equal(result.data.composition[0].sharePercent, 66.67);
  assert.equal(fixture.aggregateCount, 2);

  const emptyFixture = createFixture({ empty: true });
  const empty = await loadCloudFunction(emptyFixture.sdk)({ startTime: START, endTime: START + 3 * DAY_MS });
  assert.equal(empty.success, true);
  assert.equal(empty.data.daily.every((item) => item.revenueCent === 0), true);
  assert.equal(empty.data.summary.saleCount, 0);
  assert.deepEqual(empty.data.composition, []);

  const invalid = await dashboard({ startTime: START, endTime: START + 3 * DAY_MS, arbitraryField: true });
  assert.equal(invalid.code, "INVALID_PARAMETER");
  const source = fs.readFileSync(path.join(projectRoot, "cloudfunctions/getStatisticsDashboard/index.js"), "utf8");
  assert.equal(source.includes('timezone: "Asia/Shanghai"'), true);
  assert.equal(source.includes('.match(match)'), true);
  assert.equal(source.includes('status: "normal"'), false);
  const view = require(path.join(projectRoot, "miniprogram/utils/statistics-dashboard-view.js"));
  const optionalUnitRanking = view.buildRanking([{ productId: "p-gift", variantId: "v-gift", productName: "赠品", specification: "", unit: "", quantity: 1, revenueCent: 0, grossProfitCent: -500 }], "quantity");
  assert.equal(optionalUnitRanking[0].valueDisplay, "1");
  assert.equal(optionalUnitRanking[0].key, "v-gift");
  console.log("Statistics dashboard tests passed: Beijing daily aggregation, zero revenue margin, negative profit, rankings, composition, empty range, whitelist and two aggregate queries.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
