const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const state = {
  users:new Map([["u1", { _id:"u1", openid:"openid-1", name:"店主", enabled:true, createdAt:new Date("2026-08-01") }]]),
  requests:new Map(),
};
let currentOpenid = "openid-2";
let requestSequence = 0;
let userSequence = 1;

function records(name) {
  return name === "users" ? state.users : state.requests;
}

function collection(name) {
  const source = records(name);
  return {
    where(condition) {
      let limit = Infinity;
      return {
        limit(value) { limit = value; return this; },
        async get() {
          return { data:[...source.values()].filter((item) => Object.entries(condition).every(([key, value]) => item[key] === value)).slice(0, limit) };
        },
      };
    },
    doc(id) {
      return {
        async get() {
          if (!source.has(id)) throw new Error("not found");
          return { data:{ ...source.get(id) } };
        },
        async update({ data }) {
          if (!source.has(id)) throw new Error("not found");
          source.set(id, { ...source.get(id), ...data });
          return { updated:1 };
        },
      };
    },
    async add({ data }) {
      const id = name === "users" ? `u${++userSequence}` : `r${++requestSequence}`;
      source.set(id, { _id:id, ...data });
      return { _id:id };
    },
  };
}

const database = {
  collection,
  serverDate() { return new Date("2026-08-16T01:00:00Z"); },
  async runTransaction(handler) { return handler({ collection }); },
};
const sdk = {
  DYNAMIC_CURRENT_ENV:"dynamic",
  init() {},
  database() { return database; },
  getWXContext() { return { OPENID:currentOpenid }; },
};

const originalLoad = Module._load;
Module._load = function mock(request, parent, main) {
  if (request === "wx-server-sdk") return sdk;
  return originalLoad.call(this, request, parent, main);
};
const functionPath = path.resolve(__dirname, "../cloudfunctions/manageAccess/index.js");
delete require.cache[require.resolve(functionPath)];
const manageAccess = require(functionPath).main;
Module._load = originalLoad;

async function run() {
  const submitted = await manageAccess({ action:"submit", name:"同学" });
  assert.equal(submitted.success, true);
  assert.equal(submitted.data.status, "pending");
  assert.equal(JSON.stringify(submitted).includes("openid-2"), false, "客户端响应不能泄露 OpenID");
  assert.equal([...state.users.values()].some((item) => item.openid === "openid-2"), false, "提交申请不能直接获得权限");

  const unauthorizedList = await manageAccess({ action:"list" });
  assert.equal(unauthorizedList.code, "UNAUTHORIZED");

  currentOpenid = "openid-1";
  const overview = await manageAccess({ action:"list" });
  assert.equal(overview.success, true);
  assert.equal(overview.data.pending.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(overview.data.pending[0], "openid"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(overview.data.members[0], "openid"), false);

  const requestId = overview.data.pending[0].requestId;
  const approved = await manageAccess({ action:"approve", requestId, name:"开发同学" });
  assert.equal(approved.success, true);
  const newUser = [...state.users.values()].find((item) => item.openid === "openid-2");
  assert.equal(newUser.enabled, true);
  assert.equal(newUser.name, "开发同学");
  assert.equal(state.requests.get(requestId).status, "approved");

  const repeated = await manageAccess({ action:"approve", requestId, name:"开发同学" });
  assert.equal(repeated.code, "ALREADY_REVIEWED");

  currentOpenid = "openid-2";
  const newlyAuthorized = await manageAccess({ action:"list" });
  assert.equal(newlyAuthorized.success, true, "批准后新成员应立即通过白名单校验");
  console.log("Access-management tests passed: safe public request, whitelist-only review, no OpenID leakage, approval and idempotency.");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
