const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const fail = (code, message) => ({ success: false, code, message });

function parseRange(input) {
  const startMs = typeof input.startTime === "number" ? input.startTime : Date.parse(input.startTime);
  const endMs = typeof input.endTime === "number" ? input.endTime : Date.parse(input.endTime);
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs || endMs - startMs > MAX_RANGE_MS) return null;
  return { startTime: new Date(startMs), endTime: new Date(endMs), startMs, endMs };
}

function aggregateRows(result) {
  const rows = Array.isArray(result && result.list) ? result.list : result && result.data;
  if (!Array.isArray(rows)) throw new Error("aggregate result shape is invalid");
  return rows;
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  if (Object.keys(input).some((key) => !["startTime", "endTime", "page", "pageSize"].includes(key) && !PLATFORM_FIELDS.includes(key))) return fail("INVALID_PARAMETER", "包含不允许查询的销售字段");
  const range = parseRange(input);
  const page = input.page == null ? 1 : Number(input.page);
  const pageSize = input.pageSize == null ? 20 : Number(input.pageSize);
  if (!range) return fail("INVALID_PARAMETER", "销售记录时间范围无效，最长支持366天");
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 30) return fail("INVALID_PARAMETER", "分页参数无效");
  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const match = { createdAt: _.gte(range.startTime).and(_.lt(range.endTime)) };
    const result = await db.collection("sales").aggregate()
      .match(match)
      .sort({ createdAt: -1 })
      .project({
        orderKey: $.ifNull(["$orderId", "$_id"]),
        totalAmountCent: 1,
        totalCostCent: 1,
        grossProfitCent: 1,
        quantity: 1,
        operatorName: 1,
        operatorOpenId: 1,
        createdAt: 1,
        productName: 1,
        specification: 1,
        isGift: 1,
      })
      .group({
        _id: "$orderKey",
        totalAmountCent: $.sum("$totalAmountCent"),
        totalCostCent: $.sum("$totalCostCent"),
        grossProfitCent: $.sum("$grossProfitCent"),
        totalQuantity: $.sum("$quantity"),
        itemCount: $.sum(1),
        operatorName: $.first("$operatorName"),
        operatorOpenId: $.first("$operatorOpenId"),
        createdAt: $.first("$createdAt"),
        firstProductName: $.first("$productName"),
        firstSpecification: $.first("$specification"),
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize + 1)
      .end();
    const rows = aggregateRows(result);
    return { success: true, data: { list: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize, startTime: range.startMs, endTime: range.endMs }, message: "" };
  } catch (error) {
    console.error("getSales failed", { page, startTime: range.startMs, endTime: range.endMs, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "销售订单查询失败，请稍后重试");
  }
};
