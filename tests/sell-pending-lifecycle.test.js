const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function buildPage(pendingResponses) {
  let definition;
  global.Page = (value) => { definition = value; };
  const user = { name:"妈妈" };
  global.getApp = () => ({
    globalData:{ authStatus:"authorized", authMessage:"", currentUser:user },
    ensureAuthorized:async () => user,
  });
  global.wx = {
    pageScrollTo() {},
    showToast() {},
  };
  const original = Module._load;
  Module._load = function mock(request, parent, main) {
    if (request === "../../services/product") return {};
    if (request === "../../services/sale") return { checkoutSale: async () => ({}), managePendingSales: () => pendingResponses.shift().promise };
    if (request === "../../services/statistics") return { getSales: async () => ({ list: [] }) };
    if (request === "../../utils/product-view") return { withProductSummary: (value) => value };
    if (request === "../../utils/sales-view") return { withSaleDisplay: (value) => value };
    if (request === "../../utils/time-range") return { getPresetRange: () => ({ startTime: 1, endTime: 2 }) };
    if (request === "../../utils/money") return { formatCent: (value) => String(value), yuanToCent: Number };
    if (request === "../../utils/sale-cart") return { getState: () => ({ requestId: "SALE_TEST_0001", pendingId: "", items: [] }) };
    return original.call(this, request, parent, main);
  };
  const file = path.join(root, "miniprogram/pages/sell/index.js");
  delete require.cache[require.resolve(file)];
  try { require(file); } finally { Module._load = original; }
  const page = { ...definition, data: structuredClone(definition.data) };
  page.setData = function setData(patch) { Object.assign(this.data, patch); };
  return page;
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

async function testHiddenRequestCannotOverwriteNewShow() {
  const oldRequest = deferred();
  const newRequest = deferred();
  const page = buildPage([oldRequest, newRequest]);
  page.onLoad();
  await page.authLoadTask;
  await page.onShow();
  page.onHide();
  await page.onShow();

  newRequest.resolve({ list: [{ _id: "PENDING_B", totalAmountCent: 2000 }] });
  await settle();
  assert.deepEqual(page.data.pendingSales.map((item) => item._id), ["PENDING_B"]);
  assert.equal(page.data.pendingState, "loaded");

  oldRequest.resolve({ list: [] });
  await settle();
  assert.deepEqual(page.data.pendingSales.map((item) => item._id), ["PENDING_B"]);
  assert.equal(page.data.loadingPending, false);
}

function testStateOwnershipAndRendering() {
  const source = fs.readFileSync(path.join(root, "miniprogram/pages/sell/index.js"), "utf8");
  const wxml = fs.readFileSync(path.join(root, "miniprogram/pages/sell/index.wxml"), "utf8");
  assert.equal((source.match(/pendingSales:\s*\[\]/g) || []).length, 1, "Only initial page data may initialize pendingSales to []");
  assert.match(source, /version !== this\.pendingLoadVersion/);
  assert.match(source, /onHide\(\)[\s\S]*pendingLoadVersion \+= 1/);
  assert.match(wxml, /pendingState==='loaded'/);
  assert.match(wxml, /暂无云端挂单/);
}

function testRemovingOnePendingKeepsTheOthers() {
  const page = buildPage([]);
  page.data.pendingSales = [{ _id: "PENDING_A" }, { _id: "PENDING_B" }];
  page.removePendingFromView("PENDING_A");
  assert.deepEqual(page.data.pendingSales.map((item) => item._id), ["PENDING_B"]);
}

async function run() {
  await testHiddenRequestCannotOverwriteNewShow();
  testStateOwnershipAndRendering();
  testRemovingOnePendingKeepsTheOthers();
  console.log("Sell pending lifecycle tests passed: hidden requests are stale, latest onShow wins, and loading/loaded/error states are explicit.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
