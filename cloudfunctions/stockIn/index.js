const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const REQUEST_ID_PATTERN = /^STOCKIN_[A-Za-z0-9_-]{8,80}$/;

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
  const unexpected = Object.keys(input).filter((key) => !["requestId", "variantId", "quantity", "newCostPriceCent", "remark"].includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许提交的入库字段");

  const requestId = cleanText(input.requestId);
  const variantId = cleanText(input.variantId);
  const remark = cleanText(input.remark);
  const hasNewCost = input.newCostPriceCent != null;
  if (!REQUEST_ID_PATTERN.test(requestId)) return fail("INVALID_PARAMETER", "requestId格式无效");
  if (!variantId) return fail("INVALID_PARAMETER", "variantId不能为空");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) return fail("INVALID_QUANTITY", "入库数量必须是正整数");
  if (hasNewCost && (!Number.isSafeInteger(input.newCostPriceCent) || input.newCostPriceCent < 0)) return fail("INVALID_PARAMETER", "新进货价必须是大于或等于0的整数分");
  if (remark.length > 500) return fail("INVALID_PARAMETER", "备注不能超过500个字符");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const user = users.data[0];
    const logId = `LOG_${requestId}`;
    const transactionResult = await db.runTransaction(async (transaction) => {
      const existing = await getDocument(transaction, "inventory_logs", logId);
      if (existing) {
        const sameCost = (existing.newCostPriceCent == null && !hasNewCost) || existing.newCostPriceCent === input.newCostPriceCent;
        if (existing.type !== "STOCK_IN" || existing.variantId !== variantId || existing.changeQuantity !== input.quantity || !sameCost || existing.remark !== remark || existing.operatorOpenId !== openid) {
          throw businessError("DUPLICATE_REQUEST", "该入库请求编号已被使用，请重新提交");
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
      if (!Number.isSafeInteger(variant.costPriceCent) || variant.costPriceCent < 0) throw businessError("DATABASE_ERROR", "商品成本数据异常");

      const beforeStock = variant.stock;
      const afterStock = beforeStock + input.quantity;
      if (!Number.isSafeInteger(afterStock)) throw businessError("INVALID_QUANTITY", "入库后库存超出安全范围");
      const now = db.serverDate();
      const updateData = { stock: afterStock, updatedAt: now };
      if (hasNewCost) updateData.costPriceCent = input.newCostPriceCent;
      const log = {
        requestId,
        productId: product._id,
        variantId: variant._id,
        productCode: product.productCode,
        variantCode: variant.variantCode,
        productName: product.name,
        specification: variant.specification || "",
        type: "STOCK_IN",
        beforeStock,
        changeQuantity: input.quantity,
        afterStock,
        relatedId: "",
        beforeCostPriceCent: variant.costPriceCent,
        newCostPriceCent: hasNewCost ? input.newCostPriceCent : null,
        operatorOpenId: openid,
        operatorName: user.name,
        remark,
        createdAt: now,
      };
      await transaction.collection("product_variants").doc(variantId).update({ data: updateData });
      await transaction.collection("inventory_logs").doc(logId).set({ data: log });
      return { log: { _id: logId, ...log }, currentStock: afterStock, duplicate: false };
    });
    return { success: true, data: transactionResult.result || transactionResult, message: "入库成功" };
  } catch (error) {
    const business = parseBusinessError(error);
    if (business) return fail(business.code, business.message || "入库失败", business.data);
    console.error("stockIn failed", { requestId, variantId, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "入库失败，请重试");
  }
};
