const cloud = require("wx-server-sdk");
cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const fail = (code, message) => ({ success:false, code, message });
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function summarize(product, variants, matchedSpecifications=[]) {
  const active = variants.filter((item) => item.enabled !== false);
  const available = active.length ? active : variants;
  const prices = available.map((item) => item.salePriceCent);
  return {
    ...product,
    variantCount:variants.length,
    totalStock:available.reduce((sum, item) => sum + item.stock, 0),
    minSalePriceCent:Math.min(...prices),
    maxSalePriceCent:Math.max(...prices),
    matchedSpecifications,
  };
}

exports.main = async (event) => {
  const { OPENID:openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  try {
    const users = await db.collection("users").where({ openid, enabled:true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const keyword = String((event && event.keyword) || "").trim();
    const page = Number(event && event.page) || 1;
    const pageSize = Math.min(Number(event && event.pageSize) || 20, 30);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) return fail("INVALID_PARAMETER", "分页参数无效");

    if (keyword && /^\d{6,64}$/.test(keyword)) {
      const result = await db.collection("product_variants").where({ barcode:keyword, enabled:true }).limit(1).get();
      if (result.data.length) {
        const variant = result.data[0];
        const product = (await db.collection("products").doc(variant.productId).get()).data;
        if (!product || product.enabled !== true) return { success:true, data:{ list:[], page, pageSize, hasMore:false }, message:"" };
        const variants = (await db.collection("product_variants").where({ productId:variant.productId }).orderBy("variantCode", "asc").limit(50).get()).data;
        return { success:true, data:{ list:[summarize(product, variants, variant.specification ? [variant.specification] : [])], page, pageSize, hasMore:false }, message:"" };
      }
    }

    let variantMatches = [];
    if (keyword) {
      variantMatches = (await db.collection("product_variants").where({ specification:db.RegExp({ regexp:escapeRegex(keyword), options:"i" }), enabled:true }).limit(100).get()).data;
    }
    const variantProductIds = [...new Set(variantMatches.map((item) => item.productId))];
    let productWhere = { enabled:true };
    if (keyword) {
      const safe = escapeRegex(keyword);
      const conditions = [
        { productCode:db.RegExp({ regexp:`^${safe}`, options:"i" }) },
        { name:db.RegExp({ regexp:safe, options:"i" }) },
        { supplier:db.RegExp({ regexp:safe, options:"i" }) },
      ];
      if (variantProductIds.length) conditions.push({ _id:_.in(variantProductIds) });
      productWhere = _.and([{ enabled:true }, _.or(conditions)]);
    }
    const products = await db.collection("products").where(productWhere).orderBy("createdAt", "desc").skip((page - 1) * pageSize).limit(pageSize + 1).get();
    const hasMore = products.data.length > pageSize;
    const pageProducts = products.data.slice(0, pageSize);
    const list = [];
    for (const product of pageProducts) {
      const ownVariants = (await db.collection("product_variants").where({ productId:product._id }).orderBy("variantCode", "asc").limit(50).get()).data;
      if (!ownVariants.length) continue;
      const matched = variantMatches.filter((item) => item.productId === product._id).map((item) => item.specification).filter(Boolean).slice(0, 3);
      list.push(summarize(product, ownVariants, matched));
    }
    return { success:true, data:{ list, page, pageSize, hasMore }, message:"" };
  } catch (error) {
    console.error("searchProducts failed", error);
    return fail("DATABASE_ERROR", "商品搜索失败，请稍后重试");
  }
};
