const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_RANGE_MS = 366 * DAY_MS;
const MAX_SKU_GROUPS = 2000;
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

function isInteger(value) {
  return Number.isSafeInteger(value);
}

function validateMetrics(row) {
  const values = [row.revenueCent, row.costCent, row.grossProfitCent, row.quantity, row.saleCount];
  if (values.some((value) => !isInteger(value))) throw new Error("aggregated sales data is invalid");
  if (row.grossProfitCent !== row.revenueCent - row.costCent) throw new Error("aggregated gross profit is inconsistent");
}

function beijingDateKey(timestamp) {
  const date = new Date(timestamp + BEIJING_OFFSET_MS);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function fillDailyRows(rows, range) {
  const rowMap = new Map(rows.map((row) => [row._id, row]));
  const daily = [];
  for (let timestamp = range.startMs; timestamp < range.endMs; timestamp += DAY_MS) {
    const date = beijingDateKey(timestamp);
    const row = rowMap.get(date) || { revenueCent: 0, costCent: 0, grossProfitCent: 0, quantity: 0, saleCount: 0 };
    validateMetrics(row);
    daily.push({
      date,
      revenueCent: row.revenueCent,
      costCent: row.costCent,
      grossProfitCent: row.grossProfitCent,
      quantity: row.quantity,
      saleCount: row.saleCount,
      grossMarginPercent: row.revenueCent === 0 ? null : Number((row.grossProfitCent * 100 / row.revenueCent).toFixed(2)),
    });
  }
  return daily;
}

function summarize(daily) {
  const summary = daily.reduce((result, row) => ({
    revenueCent: result.revenueCent + row.revenueCent,
    costCent: result.costCent + row.costCent,
    grossProfitCent: result.grossProfitCent + row.grossProfitCent,
    quantity: result.quantity + row.quantity,
    saleCount: result.saleCount + row.saleCount,
  }), { revenueCent: 0, costCent: 0, grossProfitCent: 0, quantity: 0, saleCount: 0 });
  validateMetrics(summary);
  return { ...summary, grossMarginPercent: summary.revenueCent === 0 ? null : Number((summary.grossProfitCent * 100 / summary.revenueCent).toFixed(2)) };
}

function normalizeSkuRows(rows) {
  return rows.map((row) => {
    const item = {
      productId: String(row.productId || ""),
      variantId: String(row._id || ""),
      productName: String(row.productName || "").trim(),
      specification: String(row.specification || "").trim(),
      unit: String(row.unit || "").trim(),
      quantity: row.quantity,
      revenueCent: row.revenueCent,
      costCent: row.costCent,
      grossProfitCent: row.grossProfitCent,
      saleCount: row.saleCount,
    };
    if (!item.productId || !item.variantId || !item.productName) throw new Error("aggregated product snapshot is invalid");
    validateMetrics(item);
    return item;
  });
}

function buildProductRows(skuRows) {
  const map = new Map();
  for (const sku of skuRows) {
    const current = map.get(sku.productId) || {
      productId: sku.productId,
      variantId: "",
      productName: sku.productName,
      specification: "",
      unit: sku.unit,
      quantity: 0,
      revenueCent: 0,
      costCent: 0,
      grossProfitCent: 0,
      saleCount: 0,
    };
    current.quantity += sku.quantity;
    current.revenueCent += sku.revenueCent;
    current.costCent += sku.costCent;
    current.grossProfitCent += sku.grossProfitCent;
    current.saleCount += sku.saleCount;
    map.set(sku.productId, current);
  }
  return [...map.values()];
}

function rankingSet(rows) {
  const take = (field) => [...rows]
    .sort((left, right) => right[field] - left[field] || right.revenueCent - left.revenueCent || left.productName.localeCompare(right.productName, "zh-CN"))
    .slice(0, 10);
  return { quantity: take("quantity"), revenue: take("revenueCent"), grossProfit: take("grossProfitCent") };
}

function buildComposition(productRows, totalRevenueCent) {
  if (totalRevenueCent <= 0) return [];
  const positive = productRows.filter((item) => item.revenueCent > 0).sort((left, right) => right.revenueCent - left.revenueCent);
  const top = positive.slice(0, 5).map((item) => ({
    productId: item.productId,
    label: item.productName,
    revenueCent: item.revenueCent,
    sharePercent: Number((item.revenueCent * 100 / totalRevenueCent).toFixed(2)),
  }));
  const topRevenue = top.reduce((sum, item) => sum + item.revenueCent, 0);
  if (totalRevenueCent > topRevenue) top.push({ productId: "", label: "其他", revenueCent: totalRevenueCent - topRevenue, sharePercent: Number(((totalRevenueCent - topRevenue) * 100 / totalRevenueCent).toFixed(2)) });
  return top;
}

function isMissingIndexError(error) {
  return /(?:index|索引).*(?:required|not found|create|missing|不存在|缺少)|requires?\s+(?:an?\s+)?index/i.test(String((error && (error.errMsg || error.message || error.errCode)) || error || ""));
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
    const match = { createdAt: _.gte(range.startTime).and(_.lt(range.endTime)) };

    const [dailyResult, skuResult] = await Promise.all([
      db.collection("sales").aggregate()
        .match(match)
        .project({
          day: $.dateToString({ date: "$createdAt", format: "%Y-%m-%d", timezone: "Asia/Shanghai" }),
          totalAmountCent: 1,
          totalCostCent: 1,
          grossProfitCent: 1,
          quantity: 1,
          orderCountContribution: $.ifNull(["$orderCountContribution", 1]),
        })
        .group({
          _id: "$day",
          revenueCent: $.sum("$totalAmountCent"),
          costCent: $.sum("$totalCostCent"),
          grossProfitCent: $.sum("$grossProfitCent"),
          quantity: $.sum("$quantity"),
          saleCount: $.sum("$orderCountContribution"),
        })
        .sort({ _id: 1 })
        .limit(367)
        .end(),
      db.collection("sales").aggregate()
        .match(match)
        .sort({ createdAt: -1 })
        .group({
          _id: "$variantId",
          productId: $.first("$productId"),
          productName: $.first("$productName"),
          specification: $.first("$specification"),
          unit: $.first("$unit"),
          revenueCent: $.sum("$totalAmountCent"),
          costCent: $.sum("$totalCostCent"),
          grossProfitCent: $.sum("$grossProfitCent"),
          quantity: $.sum("$quantity"),
          saleCount: $.sum(1),
        })
        .limit(MAX_SKU_GROUPS + 1)
        .end(),
    ]);

    const dailyRows = aggregateRows(dailyResult);
    const skuRowsRaw = aggregateRows(skuResult);
    if (dailyRows.length > 366) throw new Error("daily aggregation exceeded safe limit");
    if (skuRowsRaw.length > MAX_SKU_GROUPS) throw new Error("SKU aggregation exceeded safe limit");
    const daily = fillDailyRows(dailyRows, range);
    const summary = summarize(daily);
    const skuRows = normalizeSkuRows(skuRowsRaw);
    const productRows = buildProductRows(skuRows);

    return {
      success: true,
      data: {
        summary,
        daily,
        rankings: { product: rankingSet(productRows), sku: rankingSet(skuRows) },
        composition: buildComposition(productRows, summary.revenueCent),
        startTime: range.startMs,
        endTime: range.endMs,
      },
      message: "",
    };
  } catch (error) {
    console.error("getStatisticsDashboard failed", { startTime: range.startMs, endTime: range.endMs, error: String(error && error.message ? error.message : error) });
    if (isMissingIndexError(error)) return fail("INDEX_REQUIRED", "统计 Dashboard 需要 sales 的 createdAt 索引");
    return fail("DATABASE_ERROR", "统计 Dashboard 查询失败，请稍后重试");
  }
};
