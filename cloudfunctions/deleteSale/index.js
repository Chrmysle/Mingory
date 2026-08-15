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

async function removeIfExists(transaction, collection, id) {
  if (id && await getDocument(transaction, collection, id)) await transaction.collection(collection).doc(id).remove();
}

function saleLogIds(sale, orderId) {
  if (!orderId) return [`LOG_${sale._id}`, `CANCEL_${sale._id}_01`];
  const suffix = String(sale.lineNumber || 1).padStart(2, "0");
  return [`LOG_${orderId}_${suffix}`, `CANCEL_${orderId}_${suffix}`];
}

function summarize(lines) {
  const summary = lines.reduce((result, line) => ({
    itemCount: result.itemCount + 1,
    totalQuantity: result.totalQuantity + line.quantity,
    totalAmountCent: result.totalAmountCent + line.totalAmountCent,
    totalCostCent: result.totalCostCent + line.totalCostCent,
  }), { itemCount: 0, totalQuantity: 0, totalAmountCent: 0, totalCostCent: 0 });
  if (![summary.totalQuantity, summary.totalAmountCent, summary.totalCostCent].every(Number.isSafeInteger)) {
    throw businessError("SALE_DATA_ERROR", "剩余销售明细汇总数据异常");
  }
  return { ...summary, grossProfitCent: summary.totalAmountCent - summary.totalCostCent };
}

function fingerprint(lines) {
  return JSON.stringify(lines.map((line) => ({
    variantId: line.variantId,
    quantity: line.quantity,
    unitPriceCent: line.unitPriceCent,
    isGift: line.isGift === true,
  })));
}

async function restoreAndRemoveLine(transaction, sale, orderId, now) {
  const variant = await getDocument(transaction, "product_variants", sale.variantId);
  if (!variant) throw businessError("VARIANT_NOT_FOUND", `${sale.productName || "商品"}的规格不存在，无法恢复库存`);
  if (!Number.isSafeInteger(variant.stock) || !Number.isSafeInteger(sale.quantity) || sale.quantity <= 0) {
    throw businessError("SALE_DATA_ERROR", `${sale.productName || "商品"}库存或销售数量异常`);
  }
  const stock = variant.stock + sale.quantity;
  if (!Number.isSafeInteger(stock)) throw businessError("SALE_DATA_ERROR", `${sale.productName || "商品"}库存超出安全范围`);
  await transaction.collection("product_variants").doc(sale.variantId).update({ data: { stock, updatedAt: now } });
  for (const logId of saleLogIds(sale, orderId)) await removeIfExists(transaction, "inventory_logs", logId);
  await transaction.collection("sales").doc(sale._id).remove();
  return sale.quantity;
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  const unexpected = Object.keys(input).filter((key) => !["orderId", "saleId"].includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许提交的删除字段");
  const orderId = String(input.orderId || "").trim();
  const saleId = String(input.saleId || "").trim();
  if (!orderId) return fail("INVALID_PARAMETER", "orderId不能为空");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权删除销售");
    const order = await getDocument(db, "sale_orders", orderId);
    let lines;
    if (order) {
      lines = (await db.collection("sales").where({ orderId }).orderBy("lineNumber", "asc").limit(20).get()).data;
      if (!lines.length) return fail("SALE_DATA_ERROR", "销售订单缺少明细");
      if (saleId && !lines.some((line) => line._id === saleId)) return fail("SALE_NOT_FOUND", "要删除的销售明细不存在");
    } else {
      const legacy = await getDocument(db, "sales", saleId || orderId);
      if (!legacy) return fail("SALE_NOT_FOUND", "销售记录不存在或已经删除");
      lines = [legacy];
    }

    const now = db.serverDate();
    const transactionResult = await db.runTransaction(async (transaction) => {
      if (!order) {
        const latest = await getDocument(transaction, "sales", lines[0]._id);
        if (!latest) throw businessError("SALE_NOT_FOUND", "销售记录不存在或已经删除");
        const restoredQuantity = await restoreAndRemoveLine(transaction, { _id: lines[0]._id, ...latest }, "", now);
        return { orderId, deletedItemCount: 1, restoredQuantity, orderDeleted: true };
      }

      const latestOrder = await getDocument(transaction, "sale_orders", orderId);
      if (!latestOrder) throw businessError("SALE_NOT_FOUND", "销售订单不存在或已经删除");
      const currentLines = [];
      for (const line of lines) {
        const latest = await getDocument(transaction, "sales", line._id);
        if (!latest || latest.orderId !== orderId) throw businessError("SALE_DATA_ERROR", "销售订单明细已发生变化，请刷新后重试");
        currentLines.push({ _id: line._id, ...latest });
      }
      const targets = saleId ? currentLines.filter((line) => line._id === saleId) : currentLines;
      let restoredQuantity = 0;
      for (const line of targets) restoredQuantity += await restoreAndRemoveLine(transaction, line, orderId, now);

      const targetIds = new Set(targets.map((line) => line._id));
      const remaining = currentLines.filter((line) => !targetIds.has(line._id));
      if (!remaining.length) {
        await transaction.collection("sale_orders").doc(orderId).remove();
        return { orderId, deletedItemCount: targets.length, restoredQuantity, orderDeleted: true };
      }

      const summary = summarize(remaining);
      await transaction.collection("sale_orders").doc(orderId).update({ data: {
        ...summary,
        itemsFingerprint: fingerprint(remaining),
        updatedAt: now,
      } });
      for (let index = 0; index < remaining.length; index += 1) {
        const expected = index === 0 ? 1 : 0;
        if (remaining[index].orderCountContribution !== expected) {
          await transaction.collection("sales").doc(remaining[index]._id).update({ data: { orderCountContribution: expected } });
        }
      }
      return { orderId, deletedItemCount: targets.length, restoredQuantity, orderDeleted: false, order: { _id: orderId, ...latestOrder, ...summary } };
    });
    return { success: true, data: transactionResult.result || transactionResult, message: "销售已永久删除，库存已恢复" };
  } catch (error) {
    const business = parseBusinessError(error);
    if (business) return business;
    console.error("deleteSale failed", { orderId, saleId, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "删除销售失败，请稍后重试");
  }
};
