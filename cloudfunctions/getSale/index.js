const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const fail = (code, message) => ({ success: false, code, message });

async function getDocument(collection, id) {
  try { return (await db.collection(collection).doc(id).get()).data; }
  catch (_) { return null; }
}

function legacyOrder(sale) {
  return {
    _id: sale._id,
    requestId: sale.requestId || sale._id,
    itemCount: 1,
    totalQuantity: sale.quantity,
    totalAmountCent: sale.totalAmountCent,
    totalCostCent: sale.totalCostCent,
    grossProfitCent: sale.grossProfitCent,
    operatorOpenId: sale.operatorOpenId,
    operatorName: sale.operatorName,
    status: sale.status,
    createdAt: sale.createdAt,
    legacy: true,
  };
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  if (Object.keys(input).some((key) => key !== "saleId" && key !== "orderId" && !PLATFORM_FIELDS.includes(key))) return fail("INVALID_PARAMETER", "包含不允许查询的字段");
  const orderId = String(input.orderId || input.saleId || "").trim();
  if (!orderId) return fail("INVALID_PARAMETER", "orderId不能为空");
  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const order = await getDocument("sale_orders", orderId);
    if (order) {
      const items = await db.collection("sales").where({ orderId }).orderBy("lineNumber", "asc").limit(20).get();
      if (!items.data.length) return fail("SALE_NOT_FOUND", "销售订单缺少明细");
      return { success: true, data: { order: { _id: orderId, ...order }, items: items.data }, message: "" };
    }
    const legacySale = await getDocument("sales", orderId);
    if (!legacySale) return fail("SALE_NOT_FOUND", "销售记录不存在");
    return { success: true, data: { order: legacyOrder({ _id: orderId, ...legacySale }), items: [{ _id: orderId, ...legacySale, isGift: legacySale.isGift === true }] }, message: "" };
  } catch (error) {
    console.error("getSale failed", { orderId, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "销售订单详情查询失败，请稍后重试");
  }
};
