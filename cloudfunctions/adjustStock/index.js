const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const TYPES = ["MANUAL_ADD", "MANUAL_SUBTRACT", "STOCKTAKE"];
const REQUEST_ID_PATTERN = /^ADJUST_[A-Za-z0-9_-]{8,80}$/;
const fail = (code, message, data) => ({ success: false, code, message, ...(data ? { data } : {}) });
const cleanText = (value) => String(value == null ? "" : value).trim();

function businessError(code, message, data) {
  const error = new Error(`__BUSINESS__${JSON.stringify({ code, message, data })}`);
  error.businessCode = code;
  error.userMessage = message;
  error.businessData = data;
  return error;
}

function parseBusinessError(error) {
  if (error.businessCode) return { code: error.businessCode, message: error.userMessage, data: error.businessData };
  const raw = String(error && error.message ? error.message : error);
  const marker = raw.indexOf("__BUSINESS__");
  if (marker < 0) return null;
  try { return JSON.parse(raw.slice(marker + "__BUSINESS__".length)); } catch (_) { return null; }
}

async function getDocument(transaction, collection, id) {
  try {
    const result = await transaction.collection(collection).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    const code = String(error && (error.code || error.errCode) || "");
    const message = String(error && (error.errMsg || error.message) || error);
    if (code === "DOCUMENT_NOT_FOUND" || /document[^\n]*(not\s+(exist|found)|不存在)/i.test(message)) return null;
    throw error;
  }
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  const unexpected = Object.keys(input).filter((key) => !["requestId", "variantId", "type", "quantity", "actualStock", "remark"].includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许提交的库存调整字段");
  const requestId = cleanText(input.requestId);
  const variantId = cleanText(input.variantId);
  const type = cleanText(input.type);
  const remark = cleanText(input.remark);
  if (!REQUEST_ID_PATTERN.test(requestId)) return fail("INVALID_PARAMETER", "requestId格式无效");
  if (!variantId) return fail("INVALID_PARAMETER", "variantId不能为空");
  if (!TYPES.includes(type)) return fail("INVALID_PARAMETER", "库存调整类型无效");
  if (type === "STOCKTAKE") {
    if (!Number.isSafeInteger(input.actualStock) || input.actualStock < 0) return fail("INVALID_QUANTITY", "实际库存必须是大于或等于0的整数");
    if (input.quantity != null) return fail("INVALID_PARAMETER", "盘点不能提交增减数量");
  } else {
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) return fail("INVALID_QUANTITY", "调整数量必须是正整数");
    if (input.actualStock != null) return fail("INVALID_PARAMETER", "人工增减不能提交实际库存");
    if (!remark) return fail("INVALID_PARAMETER", "请填写库存调整原因");
  }
  if (remark.length > 500) return fail("INVALID_PARAMETER", "备注不能超过500个字符");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const user = users.data[0];
    const logId = `LOG_${requestId}`;
    const transactionResult = await db.runTransaction(async (transaction) => {
      const existing = await getDocument(transaction, "inventory_logs", logId);
      if (existing) {
        const requestedChange = type === "STOCKTAKE" ? input.actualStock : input.quantity;
        const existingChange = type === "STOCKTAKE" ? existing.afterStock : Math.abs(existing.changeQuantity);
        if (existing.type !== type || existing.variantId !== variantId || existingChange !== requestedChange || existing.remark !== remark || existing.operatorOpenId !== openid) {
          throw businessError("DUPLICATE_REQUEST", "该库存调整请求编号已被使用，请重新提交");
        }
        return { log: { _id: logId, ...existing }, currentStock: existing.afterStock, duplicate: true };
      }

      const variant = await getDocument(transaction, "product_variants", variantId);
      if (!variant) throw businessError("VARIANT_NOT_FOUND", "商品规格不存在");
      if (variant.enabled !== true) throw businessError("VARIANT_DISABLED", "该商品规格已停用");
      const product = await getDocument(transaction, "products", variant.productId);
      if (!product) throw businessError("PRODUCT_NOT_FOUND", "商品不存在");
      if (product.enabled !== true) throw businessError("PRODUCT_DISABLED", "该商品已停用");
      if (!Number.isSafeInteger(variant.stock) || variant.stock < 0) throw businessError("DATABASE_ERROR", "商品库存数据异常");

      const beforeStock = variant.stock;
      let afterStock;
      if (type === "MANUAL_ADD") afterStock = beforeStock + input.quantity;
      else if (type === "MANUAL_SUBTRACT") afterStock = beforeStock - input.quantity;
      else afterStock = input.actualStock;
      if (!Number.isSafeInteger(afterStock)) throw businessError("INVALID_QUANTITY", "调整后库存超出安全范围");
      if (afterStock < 0) throw businessError("INSUFFICIENT_STOCK", `库存不足，当前库存只有 ${beforeStock}`, { currentStock: beforeStock });

      const now = db.serverDate();
      const log = {
        requestId,
        productId: product._id,
        variantId: variant._id,
        productCode: product.productCode,
        variantCode: variant.variantCode,
        productName: product.name,
        specification: variant.specification || "",
        type,
        beforeStock,
        changeQuantity: afterStock - beforeStock,
        afterStock,
        relatedId: "",
        operatorOpenId: openid,
        operatorName: user.name,
        remark,
        createdAt: now,
      };
      await transaction.collection("product_variants").doc(variantId).update({ data: { stock: afterStock, updatedAt: now } });
      await transaction.collection("inventory_logs").doc(logId).set({ data: log });
      return { log: { _id: logId, ...log }, currentStock: afterStock, duplicate: false };
    });
    return { success: true, data: transactionResult.result || transactionResult, message: type === "STOCKTAKE" ? "盘点完成" : "库存调整成功" };
  } catch (error) {
    const business = parseBusinessError(error);
    if (business) return fail(business.code, business.message || "库存调整失败", business.data);
    console.error("adjustStock failed", { requestId, variantId, type, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "库存调整失败，请重试");
  }
};
