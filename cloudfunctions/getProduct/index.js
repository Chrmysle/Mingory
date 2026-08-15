const cloud = require("wx-server-sdk");
cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const fail = (code, message) => ({ success:false, code, message });

exports.main = async (event) => {
  const { OPENID:openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  try {
    const users = await db.collection("users").where({ openid, enabled:true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const input = event || {};
    const conditions = ["productId", "productCode", "barcode", "variantId"].filter((key) => String(input[key] || "").trim());
    if (conditions.length !== 1) return fail("INVALID_PARAMETER", "请提供一种商品查询条件");
    const key = conditions[0];
    let productId = "";
    let matchedVariantId = "";
    if (key === "barcode" || key === "variantId") {
      let variant;
      if (key === "variantId") {
        try { variant = (await db.collection("product_variants").doc(String(input.variantId).trim()).get()).data; } catch (_) { variant = null; }
      } else {
        const result = await db.collection("product_variants").where({ barcode:String(input.barcode).trim() }).limit(1).get();
        variant = result.data[0];
      }
      if (!variant || variant.enabled !== true) return fail("PRODUCT_NOT_FOUND", "商品规格不存在或已停用");
      productId = variant.productId;
      matchedVariantId = variant._id;
    } else if (key === "productCode") {
      const result = await db.collection("products").where({ productCode:String(input.productCode).trim() }).limit(1).get();
      if (!result.data.length) return fail("PRODUCT_NOT_FOUND", "商品不存在");
      productId = result.data[0]._id;
    } else productId = String(input.productId).trim();

    let product;
    try { product = (await db.collection("products").doc(productId).get()).data; } catch (_) { product = null; }
    if (!product) return fail("PRODUCT_NOT_FOUND", "商品不存在");
    if (key !== "productId" && product.enabled !== true) return fail("PRODUCT_NOT_FOUND", "商品不存在或已停用");
    const variants = await db.collection("product_variants").where({ productId }).orderBy("variantCode", "asc").limit(50).get();
    if (!variants.data.length) return fail("PRODUCT_NOT_FOUND", "商品缺少可用规格数据");
    return { success:true, data:{ product, variants:variants.data, matchedVariantId }, message:"" };
  } catch (error) {
    console.error("getProduct failed", error);
    return fail("DATABASE_ERROR", "商品查询失败，请稍后重试");
  }
};
