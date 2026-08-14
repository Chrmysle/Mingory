const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const REQUEST_ID_PATTERN = /^SALE_[A-Za-z0-9_-]{8,80}$/;

function fail(code, message, data) {
  return { success: false, code, message, ...(data ? { data } : {}) };
}

function businessError(code, message, data) {
  const error = new Error(`__BUSINESS__${JSON.stringify({ code, message, data })}`);
  error.businessCode = code;
  error.businessData = data;
  error.userMessage = message;
  return error;
}

async function getAuthorizedUser(openid) {
  const result = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
  return result.data.length === 1 ? result.data[0] : null;
}

async function getDocument(transaction, collection, id) {
  try {
    const result = await transaction.collection(collection).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    const code = String(error && (error.code || error.errCode) || "");
    const message = String(error && (error.errMsg || error.message) || error);
    const notFound = code === "DOCUMENT_NOT_FOUND"
      || /document[^\n]*(not\s+(exist|found)|不存在)/i.test(message);
    if (notFound) return null;
    throw error;
  }
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");

  const input = event || {};
  const unexpected = Object.keys(input).filter(
    (key) => !["requestId", "variantId", "quantity", "unitPriceCent"].includes(key)
      && !PLATFORM_FIELDS.includes(key)
  );
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许提交的销售字段");

  const requestId = String(input.requestId || "").trim();
  const variantId = String(input.variantId || "").trim();
  if (!REQUEST_ID_PATTERN.test(requestId)) return fail("INVALID_PARAMETER", "requestId格式无效");
  if (!variantId) return fail("INVALID_PARAMETER", "variantId不能为空");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    return fail("INVALID_QUANTITY", "销售数量必须是正整数");
  }
  if (!Number.isSafeInteger(input.unitPriceCent) || input.unitPriceCent < 0) {
    return fail("INVALID_PARAMETER", "实际单价必须是大于或等于0的整数分");
  }

  try {
    const user = await getAuthorizedUser(openid);
    if (!user) return fail("UNAUTHORIZED", "当前用户无权执行此操作");

    const transactionResult = await db.runTransaction(async (transaction) => {
      const existingSale = await getDocument(transaction, "sales", requestId);
      if (existingSale) {
        if (
          existingSale.variantId !== variantId
          || existingSale.quantity !== input.quantity
          || existingSale.unitPriceCent !== input.unitPriceCent
          || existingSale.operatorOpenId !== openid
        ) {
          throw businessError("DUPLICATE_REQUEST", "该销售请求编号已被使用，请重新提交");
        }
        return {
          sale: { _id: requestId, ...existingSale },
          remainingStock: existingSale.afterStock,
          duplicate: true,
        };
      }

      const variant = await getDocument(transaction, "product_variants", variantId);
      if (!variant) throw businessError("VARIANT_NOT_FOUND", "商品规格不存在");
      if (variant.enabled !== true) throw businessError("VARIANT_DISABLED", "该商品规格已停用");

      const product = await getDocument(transaction, "products", variant.productId);
      if (!product) throw businessError("PRODUCT_NOT_FOUND", "商品不存在");
      if (product.enabled !== true) throw businessError("PRODUCT_DISABLED", "该商品已停用");

      const beforeStock = variant.stock;
      if (!Number.isSafeInteger(beforeStock) || beforeStock < input.quantity) {
        throw businessError("INSUFFICIENT_STOCK", `库存不足，当前库存只有 ${beforeStock || 0}`, {
          currentStock: Number.isSafeInteger(beforeStock) ? beforeStock : 0,
        });
      }

      const afterStock = beforeStock - input.quantity;
      const costPriceCent = variant.costPriceCent;
      if (!Number.isSafeInteger(costPriceCent) || costPriceCent < 0) {
        throw businessError("DATABASE_ERROR", "商品成本数据异常");
      }
      const totalAmountCent = input.quantity * input.unitPriceCent;
      const totalCostCent = input.quantity * costPriceCent;
      if (!Number.isSafeInteger(totalAmountCent) || !Number.isSafeInteger(totalCostCent)) {
        throw businessError("INVALID_PARAMETER", "销售金额超出安全范围");
      }
      const grossProfitCent = totalAmountCent - totalCostCent;
      const now = db.serverDate();

      const sale = {
        requestId,
        productId: product._id,
        variantId: variant._id,
        productCode: product.productCode,
        variantCode: variant.variantCode,
        productName: product.name,
        specification: variant.specification || "",
        unit: product.unit || "",
        quantity: input.quantity,
        unitPriceCent: input.unitPriceCent,
        costPriceCent,
        totalAmountCent,
        totalCostCent,
        grossProfitCent,
        beforeStock,
        afterStock,
        operatorOpenId: openid,
        operatorName: user.name,
        status: "normal",
        createdAt: now,
      };

      await transaction.collection("product_variants").doc(variantId).update({
        data: { stock: afterStock, updatedAt: now },
      });
      await transaction.collection("sales").doc(requestId).set({ data: sale });
      await transaction.collection("inventory_logs").doc(`LOG_${requestId}`).set({
        data: {
          productId: product._id,
          variantId: variant._id,
          productCode: product.productCode,
          variantCode: variant.variantCode,
          productName: product.name,
          specification: variant.specification || "",
          type: "SALE",
          beforeStock,
          changeQuantity: -input.quantity,
          afterStock,
          relatedId: requestId,
          operatorOpenId: openid,
          operatorName: user.name,
          remark: "",
          createdAt: now,
        },
      });

      return { sale: { _id: requestId, ...sale }, remainingStock: afterStock, duplicate: false };
    });

    return {
      success: true,
      data: transactionResult.result || transactionResult,
      message: "销售成功",
    };
  } catch (error) {
    if (error.businessCode) {
      return fail(error.businessCode, error.userMessage || "销售失败", error.businessData);
    }
    const rawMessage = String(error && error.message ? error.message : error);
    const markerIndex = rawMessage.indexOf("__BUSINESS__");
    if (markerIndex >= 0) {
      try {
        const business = JSON.parse(rawMessage.slice(markerIndex + "__BUSINESS__".length));
        return fail(business.code, business.message, business.data);
      } catch (_) {
        // 解析失败时继续按数据库异常处理，避免向前端暴露事务细节。
      }
    }
    console.error("saleProduct failed", {
      requestId,
      variantId,
      error: rawMessage,
    });
    return fail("DATABASE_ERROR", "销售失败，请重试");
  }
};
