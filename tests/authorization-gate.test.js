const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { withAuth } = require(path.join(root, "miniprogram/utils/auth-page"));

function pageContext(definition) {
  return {
    ...definition,
    data:JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { this.data = { ...this.data, ...patch }; },
  };
}

async function testCheckingBlocksBusinessLoad() {
  let resolveAuthorization;
  let loadCount = 0;
  const authorization = new Promise((resolve) => { resolveAuthorization = resolve; });
  global.getApp = () => ({
    globalData:{ authStatus:"checking", authMessage:"正在验证访问权限…", currentUser:null },
    ensureAuthorized:() => authorization,
  });
  const definition = withAuth({ data:{ products:[{ name:"不应显示" }] }, onLoad() { loadCount += 1; } });
  const page = pageContext(definition);
  definition.onLoad.call(page, {});
  assert.equal(loadCount, 0, "checking 时不能执行页面业务 onLoad");
  assert.equal(page.data.authStatus, "checking");
  resolveAuthorization({ _id:"u1", name:"妈妈" });
  await page.authLoadTask;
  assert.equal(loadCount, 1);
  assert.equal(page.data.authStatus, "authorized");
}

async function testUnauthorizedBlocksAndClearsState() {
  let loadCount = 0;
  const error = Object.assign(new Error("未授权"), { code:"UNAUTHORIZED" });
  global.getApp = () => ({
    globalData:{ authStatus:"unauthorized", authMessage:"仅供授权人员使用", currentUser:null },
    ensureAuthorized:async () => { throw error; },
  });
  const definition = withAuth({ data:{ products:[], sales:[] }, onLoad() { loadCount += 1; } });
  const page = pageContext(definition);
  page.data.products = [{ name:"历史敏感商品" }];
  page.data.sales = [{ totalAmountCent:10000 }];
  definition.onLoad.call(page, {});
  await page.authLoadTask;
  assert.equal(loadCount, 0);
  assert.equal(page.data.authStatus, "unauthorized");
  assert.deepEqual(page.data.products, []);
  assert.deepEqual(page.data.sales, []);
}

async function testUnauthorizedServiceIsGlobal() {
  let handled = 0;
  global.getApp = () => ({ handleUnauthorized() { handled += 1; } });
  global.wx = { cloud:{ callFunction:async () => ({ result:{ success:false, code:"UNAUTHORIZED", message:"未授权" } }) } };
  const servicePath = path.join(root, "miniprogram/services/cloud.js");
  delete require.cache[require.resolve(servicePath)];
  await assert.rejects(() => require(servicePath).callFunction("getProduct"), { code:"UNAUTHORIZED" });
  assert.equal(handled, 1);
}

function testEveryPageUsesGate() {
  const pagesDirectory = path.join(root, "miniprogram/pages");
  for (const entry of fs.readdirSync(pagesDirectory, { withFileTypes:true })) {
    if (!entry.isDirectory()) continue;
    const js = read(`miniprogram/pages/${entry.name}/index.js`);
    const wxml = read(`miniprogram/pages/${entry.name}/index.wxml`);
    assert.match(js, /withAuth/, `${entry.name} 未接入共享生命周期鉴权`);
    assert.match(js, /Page\(withAuth\(\{/, `${entry.name} 未使用 withAuth`);
    assert.match(wxml, /<auth-gate/, `${entry.name} 未显示全局权限页`);
    assert.match(wxml, /wx:if="\{\{authStatus === 'authorized'\}\}"/, `${entry.name} 未阻止业务内容提前渲染`);
  }
}

function testNoClientDatabaseAccess() {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js")) files.push(file);
    }
  }
  walk(path.join(root, "miniprogram"));
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    assert.equal(/wx\.cloud\.database\s*\(/.test(source), false, `客户端禁止直接访问数据库：${path.relative(root, file)}`);
  }
}

function testEveryCloudFunctionChecksWhitelist() {
  const directory = path.join(root, "cloudfunctions");
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(directory, entry.name, "index.js");
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /getWXContext\s*\(/, `${entry.name} 未读取服务端微信身份`);
    assert.match(source, /collection\(["']users["']\)/, `${entry.name} 未查询 users 白名单`);
    assert.match(source, /UNAUTHORIZED/, `${entry.name} 未返回统一未授权错误`);
    assert.match(source, /enabled\s*:\s*true|user\.enabled\s*!==\s*true/, `${entry.name} 未检查 users.enabled`);
  }
}

async function testUnauthorizedCloudReadsStopBeforeBusinessData() {
  let sensitiveReadCount = 0;
  const aggregate = new Proxy({}, { get:() => (...args) => ({ __aggregate:args }) });
  const database = {
    command:new Proxy({ aggregate }, { get(target, key) { return key in target ? target[key] : (...args) => ({ [key]:args }); } }),
    RegExp(value) { return value; },
    collection(name) {
      if (name !== "users") {
        sensitiveReadCount += 1;
        throw new Error(`unauthorized code touched ${name}`);
      }
      return { where() { return { limit() { return { async get() { return { data:[] }; } }; } }; } };
    },
  };
  const sdk = {
    DYNAMIC_CURRENT_ENV:"dynamic",
    init() {},
    database() { return database; },
    getWXContext() { return { OPENID:"unauthorized-openid" }; },
  };
  const cases = [
    ["getProduct", { productId:"product-1" }],
    ["searchProducts", { keyword:"胶带", page:1, pageSize:20 }],
    ["getBusinessStatistics", { startTime:"2026-08-15T00:00:00.000Z", endTime:"2026-08-16T00:00:00.000Z" }],
    ["getSales", { startTime:"2026-08-15T00:00:00.000Z", endTime:"2026-08-16T00:00:00.000Z", page:1, pageSize:20 }],
    ["getStatisticsDashboard", { startTime:"2026-08-15T00:00:00.000Z", endTime:"2026-08-16T00:00:00.000Z" }],
    ["getInventoryLogs", { page:1, pageSize:20 }],
    ["getSupplierRestock", { action:"overview" }],
    ["managePendingSales", { action:"list" }],
  ];
  for (const [name, event] of cases) {
    const original = Module._load;
    Module._load = function mock(request, parent, main) {
      if (request === "wx-server-sdk") return sdk;
      return original.call(this, request, parent, main);
    };
    const file = path.join(root, "cloudfunctions", name, "index.js");
    delete require.cache[require.resolve(file)];
    let cloudFunction;
    try { cloudFunction = require(file).main; }
    finally { Module._load = original; }
    const result = await cloudFunction(event);
    assert.equal(result.success, false, `${name} 应拒绝未授权账户`);
    assert.equal(result.code, "UNAUTHORIZED", `${name} 应返回 UNAUTHORIZED`);
  }
  assert.equal(sensitiveReadCount, 0, "未授权请求不得读取任何业务集合");
}

async function run() {
  await testCheckingBlocksBusinessLoad();
  await testUnauthorizedBlocksAndClearsState();
  await testUnauthorizedServiceIsGlobal();
  testEveryPageUsesGate();
  testNoClientDatabaseAccess();
  testEveryCloudFunctionChecksWhitelist();
  await testUnauthorizedCloudReadsStopBeforeBusinessData();
  delete global.getApp;
  delete global.wx;
  console.log("Authorization tests passed: lifecycle gate, stale-data clearing, global UNAUTHORIZED handling, all pages/cloud functions and no client DB access.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
