const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const fail = (code, message) => ({ success: false, code, message });

function isMissingIndexError(error) {
  const detail = String((error && (error.errMsg || error.message || error.errCode)) || error || "");
  return /(?:index|索引).*(?:required|not found|create|missing|不存在|缺少)|requires?\s+(?:an?\s+)?index/i.test(detail);
}

function parseRange(input) {
  const startMs = typeof input.startTime === "number" ? input.startTime : Date.parse(input.startTime);
  const endMs = typeof input.endTime === "number" ? input.endTime : Date.parse(input.endTime);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs || endMs - startMs > MAX_RANGE_MS) return null;
  return { startTime: new Date(startMs), endTime: new Date(endMs), startMs, endMs };
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  const unexpected = Object.keys(input).filter((key) => !["startTime", "endTime"].includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许提交的统计字段");
  const range = parseRange(input);
  if (!range) return fail("INVALID_PARAMETER", "统计时间范围无效，最长支持366天");
  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const result = await db.collection("sales").aggregate()
      .match({ status: "normal", createdAt: _.gte(range.startTime).and(_.lt(range.endTime)) })
      .project({
        totalAmountCent: 1,
        totalCostCent: 1,
        grossProfitCent: 1,
        quantity: 1,
        orderCountContribution: $.ifNull(["$orderCountContribution", 1]),
      })
      .group({
        _id: null,
        revenueCent: $.sum("$totalAmountCent"),
        costCent: $.sum("$totalCostCent"),
        grossProfitCent: $.sum("$grossProfitCent"),
        quantity: $.sum("$quantity"),
        saleCount: $.sum("$orderCountContribution"),
      })
      .end();
    // wx-server-sdk / CloudBase Node SDK 不同版本的聚合结果分别使用 list 或 data。
    // 当前云环境可能返回 list，因此不能照普通 get() 查询固定读取 data。
    const rows = Array.isArray(result.list) ? result.list : result.data;
    if (!Array.isArray(rows)) throw new Error("aggregate result shape is invalid");
    const row = rows[0] || { revenueCent: 0, costCent: 0, grossProfitCent: 0, quantity: 0, saleCount: 0 };
    const values = [row.revenueCent, row.costCent, row.grossProfitCent, row.quantity, row.saleCount];
    if (values.some((value) => !Number.isSafeInteger(value))) throw new Error("aggregated sales data is invalid");
    if (row.grossProfitCent !== row.revenueCent - row.costCent) throw new Error("aggregated gross profit is inconsistent");
    return {
      success: true,
      data: {
        revenueCent: row.revenueCent,
        costCent: row.costCent,
        grossProfitCent: row.grossProfitCent,
        quantity: row.quantity,
        saleCount: row.saleCount,
        startTime: range.startMs,
        endTime: range.endMs,
      },
      message: "",
    };
  } catch (error) {
    console.error("getBusinessStatistics failed", { startTime: range.startMs, endTime: range.endMs, error: String(error && error.message ? error.message : error) });
    if (isMissingIndexError(error)) {
      return fail("INDEX_REQUIRED", "经营数据需要 sales 的 status + createdAt 索引，请先完成数据库索引配置");
    }
    return fail("DATABASE_ERROR", "经营数据查询失败，请稍后重试");
  }
};
