const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const ACTIONS = ["list", "inspect", "restore", "permanentDelete"];
const MAX_TRANSACTION_WRITES = 90;
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

async function readReferences(collection, productId, variantIds) {
  const records = [];
  for (let skip = 0; ; skip += 100) {
    const page = (await db.collection(collection).where({ productId }).skip(skip).limit(100).get()).data;
    records.push(...page);
    if (page.length < 100) break;
  }
  for (let index = 0; index < variantIds.length; index += 20) {
    const chunk = variantIds.slice(index, index + 20);
    if (!chunk.length) continue;
    for (let skip = 0; ; skip += 100) {
      const page = (await db.collection(collection).where({ variantId: _.in(chunk) }).skip(skip).limit(100).get()).data;
      records.push(...page);
      if (page.length < 100) break;
    }
  }
  return [...new Map(records.map((item) => [item._id, item])).values()];
}

async function readPending(productId, variantIds) {
  const result = [];
  for (let skip = 0; ; skip += 100) {
    const page = (await db.collection("pending_sale_orders").where({ status: "pending" }).skip(skip).limit(100).get()).data;
    result.push(...page.filter((record) => Array.isArray(record.items) && record.items.some((item) => item.productId === productId || variantIds.includes(item.variantId))));
    if (page.length < 100) break;
  }
  return result;
}

async function buildPurgeContext(productId, variants) {
  const variantIds = variants.map((item) => item._id);
  const [sales, inventoryLogs, pendingOrders] = await Promise.all([
    readReferences("sales", productId, variantIds),
    readReferences("inventory_logs", productId, variantIds),
    readPending(productId, variantIds),
  ]);
  const orderIds = [...new Set(sales.map((sale) => sale.orderId).filter(Boolean))];
  const orderLines = new Map();
  for (const orderId of orderIds) {
    orderLines.set(orderId, (await db.collection("sales").where({ orderId }).orderBy("lineNumber", "asc").limit(20).get()).data);
  }
  const targetSaleIds = new Set(sales.map((sale) => sale._id));
  const remainingLines = [...orderLines.values()].flat().filter((line) => !targetSaleIds.has(line._id));
  const estimatedWrites = sales.length + inventoryLogs.length + pendingOrders.length + orderIds.length + remainingLines.length + variants.length + 1;
  return { productId, variantIds, sales, inventoryLogs, pendingOrders, orderIds, orderLines, targetSaleIds, estimatedWrites };
}

function summary(lines) {
  const totals = lines.reduce((result, line) => ({
    itemCount: result.itemCount + 1,
    totalQuantity: result.totalQuantity + line.quantity,
    totalAmountCent: result.totalAmountCent + line.totalAmountCent,
    totalCostCent: result.totalCostCent + line.totalCostCent,
  }), { itemCount: 0, totalQuantity: 0, totalAmountCent: 0, totalCostCent: 0 });
  return { ...totals, grossProfitCent: totals.totalAmountCent - totals.totalCostCent };
}

function fingerprint(lines) {
  return JSON.stringify(lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, unitPriceCent: line.unitPriceCent, isGift: line.isGift === true })));
}

function pendingSummary(items) {
  return items.reduce((result, item) => ({
    itemCount: result.itemCount + 1,
    totalQuantity: result.totalQuantity + item.quantity,
    totalAmountCent: result.totalAmountCent + item.quantity * item.unitPriceCent,
  }), { itemCount: 0, totalQuantity: 0, totalAmountCent: 0 });
}

function referenceSummary(context) {
  const affectedOrders = context.orderIds.length;
  const pendingItemCount = context.pendingOrders.reduce((count, order) => count + order.items.filter((item) => context.variantIds.includes(item.variantId) || item.productId === context.productId).length, 0);
  return {
    canPermanentlyDelete: context.estimatedWrites <= MAX_TRANSACTION_WRITES,
    hasHistoricalData: context.sales.length > 0 || context.inventoryLogs.length > 0 || pendingItemCount > 0,
    saleLineCount: context.sales.length,
    inventoryLogCount: context.inventoryLogs.length,
    affectedOrderCount: affectedOrders,
    pendingItemCount,
    estimatedWrites: context.estimatedWrites,
    blockers: context.estimatedWrites > MAX_TRANSACTION_WRITES ? ["关联数据过多，超出单次安全事务范围"] : [],
  };
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
      const context = await buildPurgeContext(productId, variants);
      return { success: true, data: { product: { ...product, status: "archived", archivedAt: product.archivedAt || product.updatedAt }, variants, references: referenceSummary(context) }, message: "" };
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
          enabled: true, status: "active",
          archivedAt: _.remove(), archivedBy: _.remove(), archivedByName: _.remove(),
          updatedAt: now, updatedBy: openid, updatedByName: user.name,
        } });
        if (!hasEnabledVariant) await transaction.collection("product_variants").doc(firstVariantId).update({ data: { enabled: true, updatedAt: now } });
        return { productId, duplicate: false, enabledFallbackVariant: hasEnabledVariant ? "" : firstVariantId };
      });
      return { success: true, data: transactionResult.result || transactionResult, message: "商品已恢复" };
    }

    const context = await buildPurgeContext(productId, variants);
    const references = referenceSummary(context);
    if (!references.canPermanentlyDelete) return fail("PURGE_TOO_LARGE", "关联数据过多，无法在单次安全事务中永久删除，请先使用维护脚本分批清理", references);
    const now = db.serverDate();
    const transactionResult = await db.runTransaction(async (transaction) => {
      const latest = await getDocument(transaction, "products", productId);
      if (!latest) return { productId, duplicate: true };
      if (!isArchived(latest)) throw new Error("__PRODUCT_NOT_ARCHIVED__");

      for (const sale of context.sales) await transaction.collection("sales").doc(sale._id).remove();
      for (const log of context.inventoryLogs) await transaction.collection("inventory_logs").doc(log._id).remove();

      for (const orderId of context.orderIds) {
        const remaining = (context.orderLines.get(orderId) || []).filter((line) => !context.targetSaleIds.has(line._id));
        if (!remaining.length) {
          if (await getDocument(transaction, "sale_orders", orderId)) await transaction.collection("sale_orders").doc(orderId).remove();
          continue;
        }
        await transaction.collection("sale_orders").doc(orderId).update({ data: { ...summary(remaining), itemsFingerprint: fingerprint(remaining), updatedAt: now } });
        for (let index = 0; index < remaining.length; index += 1) {
          const expected = index === 0 ? 1 : 0;
          if (remaining[index].orderCountContribution !== expected) {
            await transaction.collection("sales").doc(remaining[index]._id).update({ data: { orderCountContribution: expected } });
          }
        }
      }

      for (const pending of context.pendingOrders) {
        const items = pending.items.filter((item) => item.productId !== productId && !context.variantIds.includes(item.variantId));
        if (!items.length) await transaction.collection("pending_sale_orders").doc(pending._id).remove();
        else await transaction.collection("pending_sale_orders").doc(pending._id).update({ data: { items, ...pendingSummary(items), updatedBy: openid, updatedByName: user.name, updatedAt: now } });
      }

      for (const variant of variants) await transaction.collection("product_variants").doc(variant._id).remove();
      await transaction.collection("products").doc(productId).remove();
      return {
        productId,
        deletedVariantCount: variants.length,
        deletedSaleLineCount: context.sales.length,
        deletedInventoryLogCount: context.inventoryLogs.length,
        affectedOrderCount: context.orderIds.length,
        cleanedPendingOrderCount: context.pendingOrders.length,
        duplicate: false,
      };
    });
    return { success: true, data: transactionResult.result || transactionResult, message: "商品及相关经营数据已永久删除" };
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("__PRODUCT_NOT_FOUND__")) return fail("PRODUCT_NOT_FOUND", "商品不存在");
    if (message.includes("__PRODUCT_NOT_ARCHIVED__")) return fail("PRODUCT_NOT_ARCHIVED", "该商品已恢复，不能永久删除");
    console.error("manageArchivedProducts failed", { action, error: message });
    return fail("DATABASE_ERROR", "归档商品操作失败，请稍后重试");
  }
};
