const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const fail = (code, message) => ({ success: false, code, message });
const isMissingIndexError = (error) => /(?:index|索引).*(?:required|not found|create|missing|不存在|缺少)|requires?\s+(?:an?\s+)?index/i.test(String((error && (error.errMsg || error.message || error.errCode)) || error || ""));

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  const unexpected = Object.keys(input).filter((key) => !["variantId", "type", "page", "pageSize"].includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许查询的字段");
  const variantId = String(input.variantId || "").trim();
  const type = String(input.type || "").trim();
  const page = input.page == null ? 1 : Number(input.page);
  const pageSize = input.pageSize == null ? 20 : Number(input.pageSize);
  if (type && type !== "STOCK_IN") return fail("INVALID_PARAMETER", "库存流水类型无效");
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 30) return fail("INVALID_PARAMETER", "分页参数无效");
  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    let variant = null;
    let product = null;
    if (variantId) {
      try { variant = (await db.collection("product_variants").doc(variantId).get()).data; } catch (_) { variant = null; }
      if (!variant) return fail("VARIANT_NOT_FOUND", "商品规格不存在");
      try { product = (await db.collection("products").doc(variant.productId).get()).data; } catch (_) { product = null; }
      if (!product) return fail("PRODUCT_NOT_FOUND", "商品不存在");
    }
    const where = variantId ? { variantId } : (type ? { type } : {});
    const result = await db.collection("inventory_logs").where(where).orderBy("createdAt", "desc").skip((page - 1) * pageSize).limit(pageSize + 1).get();
    return {
      success: true,
      data: { product, variant, list: result.data.slice(0, pageSize), page, pageSize, hasMore: result.data.length > pageSize },
      message: "",
    };
  } catch (error) {
    console.error("getInventoryLogs failed", { variantId, type, page, error: String(error && error.message ? error.message : error) });
    if (isMissingIndexError(error)) return fail("INDEX_REQUIRED", type ? "进货记录需要 inventory_logs 的 type + createdAt 索引" : "库存流水索引尚未配置");
    return fail("DATABASE_ERROR", "库存记录查询失败，请稍后重试");
  }
};
