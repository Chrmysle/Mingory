const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const ACTIONS = ["list", "inspect", "restore", "permanentDelete"];
const fail = (code, message, data) => ({ success: false, code, message, ...(data ? { data } : {}) });

async function getDocument(target, collection, id) {
  try { return (await target.collection(collection).doc(id).get()).data; }
  catch (error) {
    const message = String(error && (error.errMsg || error.message) || error);
    if (/document[^\n]*(not\s+(exist|found)|不存在)/i.test(message)) return null;
    throw error;
  }
}

async function readVariants(productId) {
  return (await db.collection("product_variants").where({ productId }).orderBy("variantCode", "asc").limit(100).get()).data;
}

async function hasReference(collection, productId, variantIds) {
  if ((await db.collection(collection).where({ productId }).limit(1).get()).data.length) return true;
  for (let index = 0; index < variantIds.length; index += 20) {
    const chunk = variantIds.slice(index, index + 20);
    if (chunk.length && (await db.collection(collection).where({ variantId: _.in(chunk) }).limit(1).get()).data.length) return true;
  }
  return false;
}

async function inspectReferences(productId, variants) {
  const variantIds = variants.map((item) => item._id);
  const hasSales = await hasReference("sales", productId, variantIds);
  const hasInventoryLogs = await hasReference("inventory_logs", productId, variantIds);
  let hasPendingSale = false;
  for (let skip = 0; !hasPendingSale; skip += 100) {
    const pending = (await db.collection("pending_sale_orders").where({ status: "pending" }).skip(skip).limit(100).get()).data;
    hasPendingSale = pending.some((record) => Array.isArray(record.items) && record.items.some((item) => item.productId === productId || variantIds.includes(item.variantId)));
    if (pending.length < 100) break;
  }
  const blockers = [];
  if (hasSales) blockers.push("已产生销售记录或销售订单");
  if (hasInventoryLogs) blockers.push("已产生库存流水");
  if (hasPendingSale) blockers.push("仍被云端挂单引用");
  return { canPermanentlyDelete: blockers.length === 0, blockers, hasSales, hasSaleOrders: hasSales, hasInventoryLogs, hasPendingSale };
}

function isArchived(product) {
  return product && (product.enabled === false || product.status === "archived");
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  const input = event || {};
  const unexpected = Object.keys(input).filter((key) => !["action", "productId", "page", "pageSize"].includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许提交的归档字段");
  const action = String(input.action || "").trim();
  if (!ACTIONS.includes(action)) return fail("INVALID_PARAMETER", "归档操作类型无效");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权管理归档商品");
    const user = users.data[0];

    if (action === "list") {
      const page = input.page == null ? 1 : Number(input.page);
      const pageSize = input.pageSize == null ? 20 : Number(input.pageSize);
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 30) return fail("INVALID_PARAMETER", "分页参数无效");
      const result = await db.collection("products").where({ enabled: false }).orderBy("updatedAt", "desc").skip((page - 1) * pageSize).limit(pageSize + 1).get();
      const list = result.data.slice(0, pageSize).map((product) => ({ ...product, status: "archived", archivedAt: product.archivedAt || product.updatedAt }));
      return { success: true, data: { list, page, pageSize, hasMore: result.data.length > pageSize }, message: "" };
    }

    const productId = String(input.productId || "").trim();
    if (!productId) return fail("INVALID_PARAMETER", "productId不能为空");
    const product = await getDocument(db, "products", productId);
    if (!product) return fail("PRODUCT_NOT_FOUND", "商品不存在");
    if (!isArchived(product)) return fail("PRODUCT_NOT_ARCHIVED", "该商品当前不在归档中");
    const variants = await readVariants(productId);
    if (!variants.length) return fail("VARIANT_NOT_FOUND", "商品缺少规格数据");

    if (action === "inspect") {
      const references = await inspectReferences(productId, variants);
      return { success: true, data: { product: { ...product, status: "archived", archivedAt: product.archivedAt || product.updatedAt }, variants, references }, message: "" };
    }

    if (action === "restore") {
      const firstVariantId = variants[0]._id;
      const hasEnabledVariant = variants.some((variant) => variant.enabled === true);
      const now = db.serverDate();
      const transactionResult = await db.runTransaction(async (transaction) => {
        const latest = await getDocument(transaction, "products", productId);
        if (!latest) throw new Error("__PRODUCT_NOT_FOUND__");
        if (!isArchived(latest)) return { productId, duplicate: true };
        await transaction.collection("products").doc(productId).update({ data: {
          enabled: true,
          status: "active",
          archivedAt: _.remove(),
          archivedBy: _.remove(),
          archivedByName: _.remove(),
          updatedAt: now,
          updatedBy: openid,
          updatedByName: user.name,
        } });
        if (!hasEnabledVariant) await transaction.collection("product_variants").doc(firstVariantId).update({ data: { enabled: true, updatedAt: now } });
        return { productId, duplicate: false, enabledFallbackVariant: hasEnabledVariant ? "" : firstVariantId };
      });
      return { success: true, data: transactionResult.result || transactionResult, message: "商品已恢复" };
    }

    const references = await inspectReferences(productId, variants);
    if (!references.canPermanentlyDelete) return fail("PRODUCT_REFERENCED", `无法永久删除：${references.blockers.join("；")}`, references);
    const transactionResult = await db.runTransaction(async (transaction) => {
      const latest = await getDocument(transaction, "products", productId);
      if (!latest) return { productId, duplicate: true };
      if (!isArchived(latest)) throw new Error("__PRODUCT_NOT_ARCHIVED__");
      for (const variant of variants) await transaction.collection("product_variants").doc(variant._id).remove();
      await transaction.collection("products").doc(productId).remove();
      return { productId, deletedVariantCount: variants.length, duplicate: false };
    });
    return { success: true, data: transactionResult.result || transactionResult, message: "商品已永久删除" };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("__PRODUCT_NOT_FOUND__")) return fail("PRODUCT_NOT_FOUND", "商品不存在");
    if (message.includes("__PRODUCT_NOT_ARCHIVED__")) return fail("PRODUCT_NOT_ARCHIVED", "该商品已恢复，不能永久删除");
    console.error("manageArchivedProducts failed", { action, error: message });
    return fail("DATABASE_ERROR", "归档商品操作失败，请稍后重试");
  }
};
