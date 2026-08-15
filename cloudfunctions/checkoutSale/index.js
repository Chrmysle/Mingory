const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const REQUEST_ID_PATTERN = /^SALE_[A-Za-z0-9_-]{8,80}$/;
const MAX_ITEMS = 15;
const MAX_QUANTITY = 9999;
const MAX_UNIT_PRICE_CENT = 99999999;

const fail = (code, message, data) => ({ success: false, code, message, ...(data ? { data } : {}) });

function businessError(code, message, data) {
  const error = new Error(`__BUSINESS__${JSON.stringify({ code, message, data })}`);
  error.businessCode = code;
  error.businessData = data;
  error.userMessage = message;
  return error;
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

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return null;
  const seen = new Set();
  const normalized = [];
  for (const input of items) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const unexpected = Object.keys(input).filter((key) => !["variantId", "quantity", "unitPriceCent", "isGift"].includes(key));
    if (unexpected.length) return null;
    const variantId = String(input.variantId || "").trim();
    if (!variantId || seen.has(variantId)) return null;
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > MAX_QUANTITY) return null;
    if (!Number.isSafeInteger(input.unitPriceCent) || input.unitPriceCent < 0 || input.unitPriceCent > MAX_UNIT_PRICE_CENT) return null;
    if (typeof input.isGift !== "boolean") return null;
    if (input.isGift && input.unitPriceCent !== 0) return null;
    seen.add(variantId);
    normalized.push({ variantId, quantity: input.quantity, unitPriceCent: input.unitPriceCent, isGift: input.isGift });
  }
  return normalized;
}

function parseBusinessError(error) {
  if (error.businessCode) return fail(error.businessCode, error.userMessage || "销售失败", error.businessData);
  const raw = String(error && error.message ? error.message : error);
  const marker = raw.indexOf("__BUSINESS__");
  if (marker < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(marker + "__BUSINESS__".length));
    return fail(parsed.code, parsed.message, parsed.data);
  } catch (_) {
    return null;
  }
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  const unexpected = Object.keys(input).filter((key) => !["requestId", "items"].includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许提交的整单销售字段");
  const requestId = String(input.requestId || "").trim();
  const items = normalizeItems(input.items);
  if (!REQUEST_ID_PATTERN.test(requestId)) return fail("INVALID_PARAMETER", "requestId格式无效");
  if (!items) return fail("INVALID_PARAMETER", `销售明细必须为1至${MAX_ITEMS}个不同商品规格，数量、价格和赠品标记必须有效`);
  const fingerprint = JSON.stringify(items);

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const user = users.data[0];

    const transactionResult = await db.runTransaction(async (transaction) => {
      const existingOrder = await getDocument(transaction, "sale_orders", requestId);
      if (existingOrder) {
        if (existingOrder.requestId !== requestId || existingOrder.itemsFingerprint !== fingerprint || existingOrder.operatorOpenId !== openid) {
          throw businessError("DUPLICATE_REQUEST", "该整单请求编号已被其他内容使用，请重新提交");
        }
        return { order: { _id: requestId, ...existingOrder }, items: [], duplicate: true };
      }

      const prepared = [];
      let totalQuantity = 0;
      let totalAmountCent = 0;
      let totalCostCent = 0;

      for (const item of items) {
        const variant = await getDocument(transaction, "product_variants", item.variantId);
        if (!variant) throw businessError("VARIANT_NOT_FOUND", "购物车中有商品规格已不存在", { variantId: item.variantId });
        if (variant.enabled !== true) throw businessError("VARIANT_DISABLED", `${variant.specification || "商品规格"}已停用`, { variantId: item.variantId });
        const product = await getDocument(transaction, "products", variant.productId);
        if (!product) throw businessError("PRODUCT_NOT_FOUND", "购物车中有商品已不存在", { variantId: item.variantId });
        if (product.enabled !== true) throw businessError("PRODUCT_DISABLED", `${product.name || "商品"}已停用`, { variantId: item.variantId });
        const beforeStock = variant.stock;
        const displayName = `${product.name || "商品"}${variant.specification ? ` · ${variant.specification}` : ""}`;
        if (!Number.isSafeInteger(beforeStock) || beforeStock < item.quantity) {
          throw businessError("INSUFFICIENT_STOCK", `${displayName}库存不足，当前库存 ${Number.isSafeInteger(beforeStock) ? beforeStock : 0}`, {
            variantId: item.variantId,
            productName: product.name || "",
            specification: variant.specification || "",
            currentStock: Number.isSafeInteger(beforeStock) ? beforeStock : 0,
            requiredQuantity: item.quantity,
          });
        }
        if (!Number.isSafeInteger(variant.costPriceCent) || variant.costPriceCent < 0) {
          throw businessError("DATABASE_ERROR", `${displayName}成本数据异常`);
        }
        const totalLineAmountCent = item.quantity * item.unitPriceCent;
        const totalLineCostCent = item.quantity * variant.costPriceCent;
        if (!Number.isSafeInteger(totalLineAmountCent) || !Number.isSafeInteger(totalLineCostCent)) {
          throw businessError("INVALID_PARAMETER", `${displayName}金额超出安全范围`);
        }
        prepared.push({
          input: item,
          product,
          variant,
          beforeStock,
          afterStock: beforeStock - item.quantity,
          totalAmountCent: totalLineAmountCent,
          totalCostCent: totalLineCostCent,
          grossProfitCent: totalLineAmountCent - totalLineCostCent,
        });
        totalQuantity += item.quantity;
        totalAmountCent += totalLineAmountCent;
        totalCostCent += totalLineCostCent;
      }
      if (![totalQuantity, totalAmountCent, totalCostCent].every(Number.isSafeInteger)) throw businessError("INVALID_PARAMETER", "整单金额或数量超出安全范围");

      const now = db.serverDate();
      const order = {
        requestId,
        itemsFingerprint: fingerprint,
        itemCount: prepared.length,
        totalQuantity,
        totalAmountCent,
        totalCostCent,
        grossProfitCent: totalAmountCent - totalCostCent,
        operatorOpenId: openid,
        operatorName: user.name,
        createdAt: now,
        updatedAt: now,
      };

      for (let index = 0; index < prepared.length; index += 1) {
        const row = prepared[index];
        const lineNumber = String(index + 1).padStart(2, "0");
        const saleId = `LINE_${requestId}_${lineNumber}`;
        const logId = `LOG_${requestId}_${lineNumber}`;
        const sale = {
          orderId: requestId,
          lineNumber: index + 1,
          orderCountContribution: index === 0 ? 1 : 0,
          productId: row.product._id,
          variantId: row.variant._id,
          productCode: row.product.productCode,
          variantCode: row.variant.variantCode,
          productName: row.product.name,
          specification: row.variant.specification || "",
          unit: row.product.unit || "",
          quantity: row.input.quantity,
          unitPriceCent: row.input.unitPriceCent,
          costPriceCent: row.variant.costPriceCent,
          totalAmountCent: row.totalAmountCent,
          totalCostCent: row.totalCostCent,
          grossProfitCent: row.grossProfitCent,
          isGift: row.input.isGift,
          beforeStock: row.beforeStock,
          afterStock: row.afterStock,
          operatorOpenId: openid,
          operatorName: user.name,
          createdAt: now,
        };
        await transaction.collection("product_variants").doc(row.variant._id).update({ data: { stock: row.afterStock, updatedAt: now } });
        await transaction.collection("sales").doc(saleId).set({ data: sale });
        await transaction.collection("inventory_logs").doc(logId).set({
          data: {
            productId: row.product._id,
            variantId: row.variant._id,
            productCode: row.product.productCode,
            variantCode: row.variant.variantCode,
            productName: row.product.name,
            specification: row.variant.specification || "",
            type: "SALE",
            beforeStock: row.beforeStock,
            changeQuantity: -row.input.quantity,
            afterStock: row.afterStock,
            relatedId: requestId,
            relatedLineId: saleId,
            operatorOpenId: openid,
            operatorName: user.name,
            remark: row.input.isGift ? "赠品" : "",
            createdAt: now,
          },
        });
      }

      await transaction.collection("sale_orders").doc(requestId).set({ data: order });
      return {
        order: { _id: requestId, ...order },
        items: prepared.map((row, index) => ({
          saleId: `LINE_${requestId}_${String(index + 1).padStart(2, "0")}`,
          variantId: row.variant._id,
          productName: row.product.name,
          specification: row.variant.specification || "",
          quantity: row.input.quantity,
          remainingStock: row.afterStock,
          isGift: row.input.isGift,
        })),
        duplicate: false,
      };
    });

    return { success: true, data: transactionResult.result || transactionResult, message: "整单销售成功" };
  } catch (error) {
    const business = parseBusinessError(error);
    if (business) return business;
    console.error("checkoutSale failed", { requestId, itemCount: items.length, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "整单销售失败，请重试");
  }
};
