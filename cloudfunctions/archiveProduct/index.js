const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const fail = (code, message) => ({ success: false, code, message });

async function getDocument(transaction, collection, id) {
  try { return (await transaction.collection(collection).doc(id).get()).data; }
  catch (_) { return null; }
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  if (Object.keys(input).some((key) => key !== "productId" && !PLATFORM_FIELDS.includes(key))) return fail("INVALID_PARAMETER", "包含不允许提交的商品字段");
  const productId = String(input.productId || "").trim();
  if (!productId) return fail("INVALID_PARAMETER", "productId不能为空");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权归档商品");
    const user = users.data[0];
    const result = await db.runTransaction(async (transaction) => {
      const product = await getDocument(transaction, "products", productId);
      if (!product) throw new Error("__PRODUCT_NOT_FOUND__");
      if (product.enabled === false || product.status === "archived") return { productId, duplicate: true };
      const now = db.serverDate();
      await transaction.collection("products").doc(productId).update({
        data: {
          enabled: false,
          status: "archived",
          archivedAt: now,
          archivedBy: openid,
          archivedByName: user.name,
          updatedAt: now,
          updatedBy: openid,
          updatedByName: user.name,
        },
      });
      return { productId, duplicate: false };
    });
    return { success: true, data: result.result || result, message: "商品已归档" };
  } catch (error) {
    if (String(error && error.message).includes("__PRODUCT_NOT_FOUND__")) return fail("PRODUCT_NOT_FOUND", "商品不存在");
    console.error("archiveProduct failed", { productId, error: String(error && error.message ? error.message : error) });
    return fail("DATABASE_ERROR", "归档商品失败，请稍后重试");
  }
};
