const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { getPresetRange, getCustomRange } = require("../miniprogram/utils/time-range");
const { formatSignedCent } = require("../miniprogram/utils/money");

const projectRoot = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);

function createFixture(sales = []) {
  const state = {
    users: new Map([["user", { _id: "user", openid: "openid-1", enabled: true }]]),
    sales: new Map(sales.map((sale) => [sale._id, sale])),
    sale_orders: new Map(),
  };
  const command = {
    gte(value) { return { gte: value, and(other) { return { ...this, ...other }; } }; },
    lt(value) { return { lt: value }; },
    aggregate: {
      sum(value) { return { op: "sum", value }; },
      first(value) { return { op: "first", value }; },
      ifNull(values) { return { op: "ifNull", values }; },
    },
  };

  function matches(item, condition) {
    return Object.entries(condition).every(([key, expected]) => {
      if (expected && (expected.gte || expected.lt)) {
        const actual = new Date(item[key]).getTime();
        return (!expected.gte || actual >= new Date(expected.gte).getTime()) && (!expected.lt || actual < new Date(expected.lt).getTime());
      }
      return item[key] === expected;
    });
  }

  function collection(name) {
    const records = state[name];
    return {
      where(condition) {
        let list = [...records.values()].filter((item) => matches(item, condition));
        const query = {
          orderBy(field, direction) { list.sort((a, b) => direction === "desc" ? new Date(b[field]) - new Date(a[field]) : new Date(a[field]) - new Date(b[field])); return query; },
          skip(count) { list = list.slice(count); return query; },
          limit(count) { list = list.slice(0, count); return query; },
          async get() { return { data: clone(list) }; },
        };
        return query;
      },
      doc(id) { return { async get() { if (!records.has(id)) throw new Error("document not found"); return { data: clone(records.get(id)) }; } }; },
      aggregate() {
        let list = [...records.values()];
        const valueOf = (record, expression) => {
          if (typeof expression === "string" && expression.startsWith("$")) return record[expression.slice(1)];
          if (expression && expression.op === "ifNull") {
            const first = valueOf(record, expression.values[0]);
            return first == null ? valueOf(record, expression.values[1]) : first;
          }
          return expression;
        };
        const pipeline = {
          match(condition) { list = list.filter((item) => matches(item, condition)); return pipeline; },
          project(definition) {
            list = list.map((item) => Object.fromEntries(Object.entries(definition).map(([key, expression]) => [key, expression === 1 ? item[key] : valueOf(item, expression)])));
            return pipeline;
          },
          group(definition) {
            const groups = new Map();
            for (const item of list) {
              const id = valueOf(item, definition._id);
              const key = JSON.stringify(id);
              const group = groups.get(key) || { _id: id, source: [] };
              group.source.push(item);
              groups.set(key, group);
            }
            list = [...groups.values()].map((group) => {
              const result = { _id: group._id };
              for (const [key, expression] of Object.entries(definition)) {
                if (key === "_id") continue;
                if (expression.op === "sum") result[key] = group.source.reduce((sum, item) => sum + Number(valueOf(item, expression.value) || 0), 0);
                if (expression.op === "first") result[key] = valueOf(group.source[0], expression.value);
              }
              return result;
            });
            return pipeline;
          },
          sort(definition) { const [field, direction] = Object.entries(definition)[0]; list.sort((a, b) => direction < 0 ? new Date(b[field]) - new Date(a[field]) : new Date(a[field]) - new Date(b[field])); return pipeline; },
          skip(count) { list = list.slice(count); return pipeline; },
          limit(count) { list = list.slice(0, count); return pipeline; },
          async end() { return { list: clone(list) }; },
        };
        return pipeline;
      },
    };
  }

  return { __state: state, DYNAMIC_CURRENT_ENV: "dynamic", init() {}, database() { return { command, collection }; }, getWXContext() { return { OPENID: "openid-1" }; } };
}

function loadCloudFunction(name, sdk) {
  const originalLoad = Module._load;
  Module._load = function mockLoad(request, parent, isMain) { if (request === "wx-server-sdk") return sdk; return originalLoad.call(this, request, parent, isMain); };
  const modulePath = path.join(projectRoot, "cloudfunctions", name, "index.js");
  delete require.cache[require.resolve(modulePath)];
  try { return require(modulePath).main; } finally { Module._load = originalLoad; }
}

function sale(id, createdAt, overrides = {}) {
  return {
    _id: id, requestId: id, status: "normal", createdAt: new Date(createdAt), productName: "透明胶带", specification: "5cm", productCode: "SP000001", variantCode: "SP000001-V001", unit: "卷",
    quantity: 1, unitPriceCent: 500, costPriceCent: 200, totalAmountCent: 500, totalCostCent: 200, grossProfitCent: 300, operatorName: "妈妈", ...overrides,
  };
}

function testBeijingRanges() {
  const beforeMidnight = Date.UTC(2026, 7, 14, 15, 59);
  const atMidnight = Date.UTC(2026, 7, 14, 16, 0);
  assert.deepEqual(getPresetRange("today", beforeMidnight), { startTime: Date.UTC(2026, 7, 13, 16), endTime: Date.UTC(2026, 7, 14, 16), label: "今天" });
  assert.deepEqual(getPresetRange("today", atMidnight), { startTime: Date.UTC(2026, 7, 14, 16), endTime: Date.UTC(2026, 7, 15, 16), label: "今天" });
  const week = getPresetRange("week", Date.UTC(2026, 7, 12, 4));
  assert.equal(new Date(week.startTime).toISOString(), "2026-08-09T16:00:00.000Z");
  assert.equal(new Date(week.endTime).toISOString(), "2026-08-16T16:00:00.000Z");
  const month = getPresetRange("month", Date.UTC(2026, 7, 14));
  assert.equal(new Date(month.startTime).toISOString(), "2026-07-31T16:00:00.000Z");
  assert.equal(new Date(month.endTime).toISOString(), "2026-08-31T16:00:00.000Z");
  const custom = getCustomRange("2026-08-01", "2026-08-02");
  assert.equal(custom.endTime - custom.startTime, 2 * 24 * 60 * 60 * 1000);
}

async function testStatistics() {
  const start = Date.UTC(2026, 7, 13, 16);
  const end = Date.UTC(2026, 7, 14, 16);
  const sdk = createFixture([
    sale("A", start, { quantity: 2, totalAmountCent: 1000, totalCostCent: 700, grossProfitCent: 300 }),
    sale("B", start + 1000, { totalAmountCent: 500, totalCostCent: 200, grossProfitCent: 300 }),
    sale("GIFT", end - 1, { unitPriceCent: 0, totalAmountCent: 0, totalCostCent: 500, grossProfitCent: -500 }),
    sale("LINE_ORDER_01", end - 3, { orderId: "SALE_MULTI_ORDER", orderCountContribution: 1, totalAmountCent: 0, totalCostCent: 0, grossProfitCent: 0 }),
    sale("LINE_ORDER_02", end - 2, { orderId: "SALE_MULTI_ORDER", orderCountContribution: 0, totalAmountCent: 0, totalCostCent: 0, grossProfitCent: 0 }),
    sale("END", end, { totalAmountCent: 9999, totalCostCent: 0, grossProfitCent: 9999 }),
    sale("CANCELLED", start + 2000, { status: "cancelled", totalAmountCent: 9999, totalCostCent: 0, grossProfitCent: 9999 }),
  ]);
  const getStatistics = loadCloudFunction("getBusinessStatistics", sdk);
  const result = await getStatistics({ startTime: start, endTime: end });
  assert.equal(result.success, true);
  assert.deepEqual(
    { revenue: result.data.revenueCent, cost: result.data.costCent, profit: result.data.grossProfitCent, quantity: result.data.quantity, count: result.data.saleCount },
    { revenue: 1500, cost: 1400, profit: 100, quantity: 6, count: 4 }
  );
  assert.equal(result.data.grossProfitCent, result.data.revenueCent - result.data.costCent);

  const empty = await getStatistics({ startTime: end + 1, endTime: end + 1000 });
  assert.deepEqual(
    { revenue: empty.data.revenueCent, cost: empty.data.costCent, profit: empty.data.grossProfitCent, quantity: empty.data.quantity, count: empty.data.saleCount },
    { revenue: 0, cost: 0, profit: 0, quantity: 0, count: 0 }
  );
}

async function testSalesPaginationAndSnapshot() {
  const start = Date.UTC(2026, 7, 13, 16);
  const end = start + 24 * 60 * 60 * 1000;
  const records = Array.from({ length: 25 }, (_, index) => sale(`SALE_${index}`, start + index * 1000, { productName: index === 3 ? "历史商品名" : "透明胶带", specification: index === 3 ? "历史规格" : "5cm", costPriceCent: index === 3 ? 350 : 200 }));
  records.push(sale("SALE_LINE_1", start + 60000, { orderId: "SALE_MULTI_DETAIL", lineNumber: 1, orderCountContribution: 1, productName: "女靴", specification: "39码", totalAmountCent: 15900, totalCostCent: 9000, grossProfitCent: 6900 }));
  records.push(sale("SALE_LINE_2", start + 60000, { orderId: "SALE_MULTI_DETAIL", lineNumber: 2, orderCountContribution: 0, productName: "鞋垫", specification: "", isGift: true, unitPriceCent: 0, totalAmountCent: 0, totalCostCent: 200, grossProfitCent: -200 }));
  records.push(sale("CANCELLED", start + 50000, { status: "cancelled" }));
  const sdk = createFixture(records);
  sdk.__state.sale_orders.set("SALE_MULTI_DETAIL", {
    _id: "SALE_MULTI_DETAIL", requestId: "SALE_MULTI_DETAIL", status: "normal", createdAt: new Date(start + 60000),
    itemCount: 2, totalQuantity: 2, totalAmountCent: 15900, totalCostCent: 9200, grossProfitCent: 6700, operatorName: "妈妈",
  });
  const getSales = loadCloudFunction("getSales", sdk);
  const page1 = await getSales({ startTime: start, endTime: end, page: 1, pageSize: 20 });
  const page2 = await getSales({ startTime: start, endTime: end, page: 2, pageSize: 20 });
  const cancelledPage = await getSales({ startTime: start, endTime: end, status: "cancelled", page: 1, pageSize: 20 });
  const allPage = await getSales({ startTime: start, endTime: end, status: "all", page: 1, pageSize: 30 });
  assert.equal(page1.data.list.length, 20);
  assert.equal(page1.data.hasMore, true);
  assert.equal(page2.data.list.length, 6);
  assert.equal(page2.data.hasMore, false);
  const ids = [...page1.data.list, ...page2.data.list].map((item) => item._id);
  assert.equal(new Set(ids).size, 26);
  assert.equal(ids.includes("CANCELLED"), false);
  assert.equal(cancelledPage.data.list.length, 1);
  assert.equal(cancelledPage.data.list[0].status, "cancelled");
  assert.equal(allPage.data.list.some((item) => item._id === "CANCELLED"), true);
  const grouped = [...page1.data.list, ...page2.data.list].find((item) => item._id === "SALE_MULTI_DETAIL");
  assert.equal(grouped.itemCount, 2);
  assert.equal(grouped.totalAmountCent, 15900);
  assert.equal(page1.data.list.every((item, index, list) => index === 0 || new Date(list[index - 1].createdAt) >= new Date(item.createdAt)), true);

  const getSale = loadCloudFunction("getSale", sdk);
  const detail = await getSale({ orderId: "SALE_3" });
  assert.equal(detail.data.order.legacy, true);
  assert.equal(detail.data.items[0].productName, "历史商品名");
  assert.equal(detail.data.items[0].specification, "历史规格");
  assert.equal(detail.data.items[0].costPriceCent, 350);

  const orderDetail = await getSale({ orderId: "SALE_MULTI_DETAIL" });
  assert.equal(orderDetail.data.order.legacy, undefined);
  assert.equal(orderDetail.data.items.length, 2);
  assert.equal(orderDetail.data.items[1].isGift, true);
}

function testMoneyDisplay() {
  assert.equal(formatSignedCent(128600, true), "1,286.00");
  assert.equal(formatSignedCent(-500, true), "-5.00");
}

async function run() {
  testBeijingRanges();
  testMoneyDisplay();
  await testStatistics();
  await testSalesPaginationAndSnapshot();
  console.log("Phase 6 tests passed: Beijing boundaries, week/month/custom ranges, aggregation, zero/negative sales, status filter, empty data, pagination, ordering, snapshot detail.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
