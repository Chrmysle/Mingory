const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const REQUEST_ID_PATTERN = /^SALE_[A-Za-z0-9_-]{8,80}$/;
const PENDING_ID_PATTERN = /^PENDING_[A-Za-z0-9_-]{8,80}$/;
const MAX_ITEMS = 15;
const MAX_UNIT_PRICE_CENT = 99999999;
const fail = (code, message) => ({ success: false, code, message });

async function getDocument(collection, id) {
  try { return (await db.collection(collection).doc(id).get()).data; }
  catch (_) { return null; }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS) return null;
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (Object.keys(item).some((key) => !["variantId", "quantity", "unitPriceCent", "isGift"].includes(key))) return null;
    const variantId = String(item.variantId || "").trim();
    if (!variantId || seen.has(variantId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 9999) return null;
    if (!Number.isSafeInteger(item.unitPriceCent) || item.unitPriceCent < 0 || item.unitPriceCent > MAX_UNIT_PRICE_CENT || typeof item.isGift !== "boolean") return null;
    if (item.isGift && item.unitPriceCent !== 0) return null;
    seen.add(variantId);
    result.push({ variantId, quantity: item.quantity, unitPriceCent: item.unitPriceCent, isGift: item.isGift });
  }
  return result;
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  const allowed = ["action", "pendingId", "requestId", "items"];
  if (Object.keys(input).some((key) => !allowed.includes(key) && !PLATFORM_FIELDS.includes(key))) return fail("INVALID_PARAMETER", "包含不允许提交的挂单字段");
  const action = String(input.action || "").trim();
  if (!["list", "save", "remove"].includes(action)) return fail("INVALID_PARAMETER", "挂单操作类型无效");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const user = users.data[0];

    if (action === "list") {
      const result = await db.collection("pending_sale_orders").where({ status: "pending" }).orderBy("updatedAt", "desc").limit(20).get();
      return { success: true, data: { list: result.data }, message: "" };
    }

    const pendingId = String(input.pendingId || "").trim();
    if (!PENDING_ID_PATTERN.test(pendingId)) return fail("INVALID_PARAMETER", "pendingId格式无效");
    if (action === "remove") {
      const existing = await getDocument("pending_sale_orders", pendingId);
      if (existing) await db.collection("pending_sale_orders").doc(pendingId).remove();
      return { success: true, data: { pendingId }, message: "挂单已移除" };
    }

    const requestId = String(input.requestId || "").trim();
    const items = normalizeItems(input.items);
    if (!REQUEST_ID_PATTERN.test(requestId) || !items) return fail("INVALID_PARAMETER", `挂单必须包含1至${MAX_ITEMS}个有效商品规格`);
    const enriched = [];
    let totalQuantity = 0;
    let totalAmountCent = 0;
    for (const item of items) {
      const variant = await getDocument("product_variants", item.variantId);
      if (!variant || variant.enabled !== true) return fail("VARIANT_NOT_FOUND", "挂单中有商品规格不存在或已停用");
      const product = await getDocument("products", variant.productId);
      if (!product || product.enabled !== true) return fail("PRODUCT_NOT_FOUND", "挂单中有商品不存在或已停用");
      enriched.push({
        ...item,
        productId: product._id,
        productName: product.name,
        specification: variant.specification || "",
        unit: product.unit || "",
        defaultUnitPriceCent: variant.salePriceCent,
        stockSnapshot: variant.stock,
      });
      totalQuantity += item.quantity;
      totalAmountCent += item.quantity * item.unitPriceCent;
      if (!Number.isSafeInteger(totalQuantity) || !Number.isSafeInteger(totalAmountCent)) return fail("INVALID_PARAMETER", "挂单数量或金额过大");
    }
    const now = db.serverDate();
    const existing = await getDocument("pending_sale_orders", pendingId);
    const record = {
      requestId,
      label: existing && existing.label ? existing.label : "挂单",
      items: enriched,
      itemCount: enriched.length,
      totalQuantity,
      totalAmountCent,
      status: "pending",
      createdBy: existing && existing.createdBy ? existing.createdBy : openid,
      createdByName: existing && existing.createdByName ? existing.createdByName : user.name,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      updatedBy: openid,
      updatedByName: user.name,
      updatedAt: now,
    };
    await db.collection("pending_sale_orders").doc(pendingId).set({ data: record });
    return { success: true, data: { pending: { _id: pendingId, ...record } }, message: "挂单成功" };
  } catch (error) {
    console.error("managePendingSales failed", { action, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "挂单操作失败，请稍后重试");
  }
};
