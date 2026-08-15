const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const CONFIRM_TEXT = "DELETE_CANCELLED_SALES_V1";
const fail = (code, message) => ({ success: false, code, message });

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

function logIds(line, orderId) {
  if (!orderId) return [`LOG_${line._id}`, `CANCEL_${line._id}_01`];
  const suffix = String(line.lineNumber || 1).padStart(2, "0");
  return [`LOG_${orderId}_${suffix}`, `CANCEL_${orderId}_${suffix}`];
}

function summarize(lines) {
  const value = lines.reduce((result, line) => ({
    itemCount: result.itemCount + 1,
    totalQuantity: result.totalQuantity + line.quantity,
    totalAmountCent: result.totalAmountCent + line.totalAmountCent,
    totalCostCent: result.totalCostCent + line.totalCostCent,
  }), { itemCount: 0, totalQuantity: 0, totalAmountCent: 0, totalCostCent: 0 });
  return { ...value, grossProfitCent: value.totalAmountCent - value.totalCostCent };
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  if (Object.keys(input).some((key) => key !== "confirm" && !PLATFORM_FIELDS.includes(key))) return fail("INVALID_PARAMETER", "包含不允许提交的迁移字段");
  if (input.confirm !== CONFIRM_TEXT) return fail("CONFIRM_REQUIRED", `必须提交 confirm = ${CONFIRM_TEXT}`);

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行数据迁移");
    const candidateResult = await db.collection("sales").where({ status: "cancelled" }).orderBy("createdAt", "asc").limit(1).get();
    const candidate = candidateResult.data[0];
    if (!candidate) return { success: true, data: { completed: true, migratedSaleCount: 0, restoredStock: false }, message: "旧撤销销售已经清理完成" };

    const orderId = candidate.orderId || "";
    const orderLines = orderId ? (await db.collection("sales").where({ orderId }).orderBy("lineNumber", "asc").limit(20).get()).data : [candidate];
    const cancelledLines = orderLines.filter((line) => line.status === "cancelled");
    const remaining = orderLines.filter((line) => line.status !== "cancelled");
    const now = db.serverDate();
    const transactionResult = await db.runTransaction(async (transaction) => {
      for (const line of cancelledLines) {
        const latest = await getDocument(transaction, "sales", line._id);
        if (!latest || latest.status !== "cancelled") throw new Error("__MIGRATION_STATE_CHANGED__");
        for (const logId of logIds({ _id: line._id, ...latest }, orderId)) await removeIfExists(transaction, "inventory_logs", logId);
        await transaction.collection("sales").doc(line._id).remove();
      }
      if (orderId && await getDocument(transaction, "sale_orders", orderId)) {
        if (!remaining.length) await transaction.collection("sale_orders").doc(orderId).remove();
        else {
          await transaction.collection("sale_orders").doc(orderId).update({ data: {
            ...summarize(remaining),
            itemsFingerprint: JSON.stringify(remaining.map((line) => ({ variantId: line.variantId, quantity: line.quantity, unitPriceCent: line.unitPriceCent, isGift: line.isGift === true }))),
            status: _.remove(), cancelReason: _.remove(), cancelledBy: _.remove(), cancelledByName: _.remove(), cancelledAt: _.remove(), updatedAt: now,
          } });
          for (let index = 0; index < remaining.length; index += 1) {
            await transaction.collection("sales").doc(remaining[index]._id).update({ data: {
              orderCountContribution: index === 0 ? 1 : 0,
              status: _.remove(), cancelReason: _.remove(), cancelledBy: _.remove(), cancelledByName: _.remove(), cancelledAt: _.remove(), updatedAt: now,
            } });
          }
        }
      }
      return { completed: false, migratedSaleCount: cancelledLines.length, affectedOrderId: orderId, restoredStock: false };
    });
    return { success: true, data: transactionResult.result || transactionResult, message: "已清理一组旧撤销销售，请继续调用直到 completed = true" };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("__MIGRATION_STATE_CHANGED__")) return fail("MIGRATION_STATE_CHANGED", "迁移期间销售数据发生变化，请重新执行");
    console.error("migrateCancelledSales failed", { error: message });
    return fail("DATABASE_ERROR", "旧撤销销售迁移失败，请稍后重试");
  }
};
