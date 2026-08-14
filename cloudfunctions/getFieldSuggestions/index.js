const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
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

    // 公共字段来自 products；具体规格来自 product_variants。
    const collectionName = field === "specification" ? "product_variants" : "products";
    const records = await db.collection(collectionName)
      .orderBy("updatedAt", "desc")
      .limit(100)
      .field({ [field]: true })
      .get();

    const seen = new Set();
    const suggestions = [];
    for (const record of records.data) {
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
