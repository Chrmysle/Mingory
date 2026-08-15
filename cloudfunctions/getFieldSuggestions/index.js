const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const ALLOWED_FIELDS = ["supplier", "unit", "shelfLocation", "specification"];
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const fail = (code, message) => ({ success: false, code, message });

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");

    const input = event || {};
    const unexpected = Object.keys(input).filter(
      (key) => !["field", "keyword", "limit"].includes(key) && !PLATFORM_FIELDS.includes(key)
    );
    if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许查询的参数");

    const field = String(input.field || "").trim();
    if (!ALLOWED_FIELDS.includes(field)) return fail("INVALID_PARAMETER", "不允许查询该字段");
    const keyword = String(input.keyword || "").trim().toLocaleLowerCase();
    const limit = Math.min(Math.max(Number(input.limit) || 6, 1), 10);

    // 公共字段来自启用中的 Product；规格只从启用 Product 所属的 Variant 提取。
    // Product 与 Variant 分批组合，避免逐个 Product 查询造成 N+1。
    let source = [];
    if (field !== "specification") {
      const records = await db.collection("products")
        .where({ enabled: true })
        .orderBy("updatedAt", "desc")
        .limit(100)
        .field({ [field]: true, updatedAt: true })
        .get();
      source = records.data;
    } else {
      const products = await db.collection("products")
        .where({ enabled: true })
        .orderBy("updatedAt", "desc")
        .limit(100)
        .field({ _id: true })
        .get();
      const productIds = products.data.map((item) => item._id);
      const batches = [];
      for (let index = 0; index < productIds.length; index += 20) {
        batches.push(db.collection("product_variants")
          .where({ productId: _.in(productIds.slice(index, index + 20)) })
          .limit(100)
          .field({ specification: true, updatedAt: true })
          .get());
      }
      const results = await Promise.all(batches);
      source = results.flatMap((result) => result.data)
        .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())
        .slice(0, 100);
    }

    const seen = new Set();
    const suggestions = [];
    for (const record of source) {
      const value = typeof record[field] === "string" ? record[field].trim() : "";
      const normalized = value.toLocaleLowerCase();
      if (!value || seen.has(normalized) || (keyword && !normalized.includes(keyword))) continue;
      seen.add(normalized);
      suggestions.push(value);
      if (suggestions.length >= limit) break;
    }

    return { success: true, data: suggestions, message: "" };
  } catch (error) {
    console.error("getFieldSuggestions failed", error);
    return fail("DATABASE_ERROR", "快捷建议查询失败，请稍后重试");
  }
};
