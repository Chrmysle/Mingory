const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const REQUESTS = "access_requests";

function ok(data, message = "操作成功") {
  return { success:true, data, message };
}

function fail(code, message) {
  return { success:false, code, message };
}

function cleanName(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

async function findUser(openid) {
  const result = await db.collection("users").where({ openid }).limit(2).get();
  if (result.data.length > 1) throw Object.assign(new Error("用户身份配置重复"), { code:"DATABASE_ERROR" });
  return result.data[0] || null;
}

async function requireAuthorized(openid) {
  const user = await findUser(openid);
  if (!user || user.enabled !== true) throw Object.assign(new Error("当前账户未获得访问权限"), { code:"UNAUTHORIZED" });
  return user;
}

async function submit(openid, event) {
  const requestedName = cleanName(event.name);
  if (!requestedName) return fail("INVALID_NAME", "请输入你的姓名");
  if (requestedName.length > 20) return fail("INVALID_NAME", "姓名不能超过20个字符");

  const user = await findUser(openid);
  if (user && user.enabled === true) return ok({ status:"authorized" }, "当前账户已经获得访问权限");

  const existing = await db.collection(REQUESTS).where({ openid }).limit(10).get();
  const current = existing.data.find((item) => item.status === "pending") || existing.data[0];
  const now = db.serverDate();
  if (current) {
    await db.collection(REQUESTS).doc(current._id).update({ data:{ requestedName, status:"pending", updatedAt:now } });
    return ok({ status:"pending" }, "访问申请已提交，请等待店内成员批准");
  }

  await db.collection(REQUESTS).add({ data:{ openid, requestedName, status:"pending", createdAt:now, updatedAt:now } });
  return ok({ status:"pending" }, "访问申请已提交，请等待店内成员批准");
}

async function list(openid) {
  await requireAuthorized(openid);
  const [requestResult, userResult] = await Promise.all([
    db.collection(REQUESTS).where({ status:"pending" }).limit(100).get(),
    db.collection("users").where({ enabled:true }).limit(100).get(),
  ]);
  const pending = requestResult.data
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0))
    .map((item) => ({ requestId:item._id, requestedName:item.requestedName || "未填写姓名", createdAt:item.createdAt }));
  const members = userResult.data
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-CN"))
    .map((item) => ({ userId:item._id, name:item.name || "未命名成员" }));
  return ok({ pending, members });
}

async function approve(openid, event) {
  const operator = await requireAuthorized(openid);
  const requestId = typeof event.requestId === "string" ? event.requestId.trim() : "";
  const name = cleanName(event.name);
  if (!requestId) return fail("INVALID_REQUEST", "缺少访问申请ID");
  if (!name || name.length > 20) return fail("INVALID_NAME", "请输入不超过20个字符的成员姓名");

  const requestResult = await db.collection(REQUESTS).doc(requestId).get().catch(() => null);
  const request = requestResult && requestResult.data;
  if (!request) return fail("NOT_FOUND", "访问申请不存在或已被处理");
  if (request.status !== "pending") return fail("ALREADY_REVIEWED", "该访问申请已经处理");
  const existingUser = await findUser(request.openid);
  const now = db.serverDate();

  await db.runTransaction(async (transaction) => {
    const latest = (await transaction.collection(REQUESTS).doc(requestId).get()).data;
    if (!latest || latest.status !== "pending") throw Object.assign(new Error("该访问申请已经处理"), { code:"ALREADY_REVIEWED" });
    if (existingUser) {
      await transaction.collection("users").doc(existingUser._id).update({ data:{ name, enabled:true, updatedAt:now } });
    } else {
      await transaction.collection("users").add({ data:{ openid:latest.openid, name, enabled:true, createdAt:now, updatedAt:now } });
    }
    await transaction.collection(REQUESTS).doc(requestId).update({ data:{ status:"approved", reviewedAt:now, reviewedBy:openid, reviewedByName:operator.name || "店内成员", updatedAt:now } });
  });
  return ok({ requestId, name }, "成员已加入白名单");
}

async function reject(openid, event) {
  const operator = await requireAuthorized(openid);
  const requestId = typeof event.requestId === "string" ? event.requestId.trim() : "";
  if (!requestId) return fail("INVALID_REQUEST", "缺少访问申请ID");
  const result = await db.collection(REQUESTS).doc(requestId).get().catch(() => null);
  const request = result && result.data;
  if (!request) return fail("NOT_FOUND", "访问申请不存在或已被处理");
  if (request.status !== "pending") return fail("ALREADY_REVIEWED", "该访问申请已经处理");
  const now = db.serverDate();
  await db.collection(REQUESTS).doc(requestId).update({ data:{ status:"rejected", reviewedAt:now, reviewedBy:openid, reviewedByName:operator.name || "店内成员", updatedAt:now } });
  return ok({ requestId }, "访问申请已拒绝");
}

exports.main = async (event = {}) => {
  const { OPENID:openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  try {
    if (event.action === "submit") return await submit(openid, event);
    if (event.action === "list") return await list(openid);
    if (event.action === "approve") return await approve(openid, event);
    if (event.action === "reject") return await reject(openid, event);
    return fail("INVALID_ACTION", "不支持的成员管理操作");
  } catch (error) {
    if (error.code === "UNAUTHORIZED" || error.code === "ALREADY_REVIEWED" || error.code === "DATABASE_ERROR") return fail(error.code, error.message);
    console.error("manageAccess failed", error);
    return fail("DATABASE_ERROR", "成员管理操作失败，请稍后重试");
  }
};
