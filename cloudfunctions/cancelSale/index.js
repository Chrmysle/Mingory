const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const fail = (code, message, data) => ({ success: false, code, message, ...(data ? { data } : {}) });

function businessError(code, message, data) {
  const error = new Error(`__BUSINESS__${JSON.stringify({ code, message, data })}`);
  error.businessCode = code;
  error.businessData = data;
  error.userMessage = message;
  return error;
}

function parseBusinessError(error) {
  if (error.businessCode) return fail(error.businessCode, error.userMessage, error.businessData);
  const raw = String(error && error.message ? error.message : error);
  const marker = raw.indexOf("__BUSINESS__");
  if (marker < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(marker + "__BUSINESS__".length));
    return fail(parsed.code, parsed.message, parsed.data);
  } catch (_) { return null; }
}

async function getDocument(target, collection, id) {
  try { return (await target.collection(collection).doc(id).get()).data; }
  catch (error) {
    const message = String(error && (error.errMsg || error.message) || error);
    if (/document[^\n]*(not\s+(exist|found)|不存在)/i.test(message)) return null;
    throw error;
  }
}

function cancellationData({ openid, user, reason, now }) {
  return {
    status: "cancelled",
    cancelReason: reason,
    cancelledBy: openid,
    cancelledByName: user.name,
    cancelledAt: now,
    updatedAt: now,
  };
}

function restoredStock(currentStock, quantity, displayName) {
  if (!Number.isSafeInteger(currentStock) || currentStock < 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
    throw businessError("DATABASE_ERROR", `${displayName}库存或销售数量异常`);
  }
  const afterStock = currentStock + quantity;
  if (!Number.isSafeInteger(afterStock)) throw businessError("DATABASE_ERROR", `${displayName}库存超出安全范围`);
  return afterStock;
}

async function restoreLine(transaction, saleId, expectedOrderId, index, context) {
  const sale = await getDocument(transaction, "sales", saleId);
  if (!sale || (expectedOrderId && sale.orderId !== expectedOrderId)) throw businessError("SALE_DATA_ERROR", "销售订单明细不完整，无法撤销");
  if (sale.status !== "normal") throw businessError("SALE_ALREADY_CHANGED", "销售明细状态已经发生变化，请刷新后重试");
  const variant = await getDocument(transaction, "product_variants", sale.variantId);
  if (!variant) throw businessError("VARIANT_NOT_FOUND", `${sale.productName || "商品"}的库存规格不存在，无法自动恢复库存`);
  const displayName = `${sale.productName || "商品"}${sale.specification ? ` · ${sale.specification}` : ""}`;
  const beforeStock = variant.stock;
  const afterStock = restoredStock(beforeStock, sale.quantity, displayName);
  await transaction.collection("product_variants").doc(sale.variantId).update({ data: { stock: afterStock, updatedAt: context.now } });
  await transaction.collection("sales").doc(saleId).update({ data: cancellationData(context) });
  const suffix = String(index + 1).padStart(2, "0");
  await transaction.collection("inventory_logs").doc(`CANCEL_${context.orderId}_${suffix}`).set({
    data: {
      productId: sale.productId,
      variantId: sale.variantId,
      productCode: sale.productCode,
      variantCode: sale.variantCode,
      productName: sale.productName,
      specification: sale.specification || "",
      type: "SALE_CANCEL",
      beforeStock,
      changeQuantity: sale.quantity,
      afterStock,
      relatedId: context.orderId,
      relatedLineId: saleId,
      operatorOpenId: context.openid,
      operatorName: context.user.name,
      remark: context.reason,
      createdAt: context.now,
    },
  });
  return sale.quantity;
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  if (Object.keys(input).some((key) => !["orderId", "reason"].includes(key) && !PLATFORM_FIELDS.includes(key))) return fail("INVALID_PARAMETER", "包含不允许提交的撤销字段");
  const orderId = String(input.orderId || "").trim();
  const reason = String(input.reason || "").trim() || "撤销销售";
  if (!orderId) return fail("INVALID_PARAMETER", "orderId不能为空");
  if (reason.length > 200) return fail("INVALID_PARAMETER", "撤销原因不能超过200个字符");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权撤销销售");
    const user = users.data[0];
    const order = await getDocument(db, "sale_orders", orderId);
    let candidates = [];
    if (order) {
      const lines = await db.collection("sales").where({ orderId }).orderBy("lineNumber", "asc").limit(20).get();
      candidates = lines.data;
      if (!candidates.length || candidates.length !== order.itemCount) return fail("SALE_DATA_ERROR", "销售订单明细不完整，无法撤销");
    } else {
      const legacySale = await getDocument(db, "sales", orderId);
      if (!legacySale) return fail("SALE_NOT_FOUND", "销售记录不存在");
      candidates = [legacySale];
    }

    const now = db.serverDate();
    const context = { orderId, openid, user, reason, now };
    const transactionResult = await db.runTransaction(async (transaction) => {
      if (order) {
        const latestOrder = await getDocument(transaction, "sale_orders", orderId);
        if (!latestOrder) throw businessError("SALE_NOT_FOUND", "销售订单不存在");
        if (latestOrder.status === "cancelled") return { orderId, restoredQuantity: latestOrder.totalQuantity, duplicate: true };
        if (latestOrder.status !== "normal") throw businessError("SALE_ALREADY_CHANGED", "该销售订单当前不能撤销");
        let restoredQuantity = 0;
        for (let index = 0; index < candidates.length; index += 1) {
          restoredQuantity += await restoreLine(transaction, candidates[index]._id, orderId, index, context);
        }
        await transaction.collection("sale_orders").doc(orderId).update({ data: cancellationData(context) });
        return { orderId, restoredQuantity, duplicate: false };
      }

      const latestSale = await getDocument(transaction, "sales", orderId);
      if (!latestSale) throw businessError("SALE_NOT_FOUND", "销售记录不存在");
      if (latestSale.status === "cancelled") return { orderId, restoredQuantity: latestSale.quantity, duplicate: true };
      if (latestSale.status !== "normal") throw businessError("SALE_ALREADY_CHANGED", "该销售记录当前不能撤销");
      const restoredQuantity = await restoreLine(transaction, orderId, "", 0, context);
      return { orderId, restoredQuantity, duplicate: false };
    });
    return { success: true, data: transactionResult.result || transactionResult, message: "销售已撤销，库存已恢复" };
  } catch (error) {
    const business = parseBusinessError(error);
    if (business) return business;
    console.error("cancelSale failed", { orderId, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "撤销销售失败，请稍后重试");
  }
};
