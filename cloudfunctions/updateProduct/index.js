const cloud = require("wx-server-sdk");
cloud.init({ env:cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const PRODUCT_FIELDS = ["name", "unit", "supplier", "imageFileID", "shelfLocation", "remark", "enabled"];
const PRODUCT_LIMITS = { name:100, unit:20, supplier:100, imageFileID:512, shelfLocation:100, remark:500 };
const VARIANT_FIELDS = ["_id", "specification", "costPriceCent", "salePriceCent", "warningStock", "barcode", "enabled"];
const fail = (code, message) => ({ success:false, code, message });
const cleanText = (value) => String(value == null ? "" : value).trim();

async function authorizedUser(openid) {
  const result = await db.collection("users").where({ openid, enabled:true }).limit(2).get();
  return result.data.length === 1 ? result.data[0] : null;
}

function normalizeProduct(input) {
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !PRODUCT_FIELDS.includes(key))) throw new Error("商品公共信息包含不允许修改的字段");
  const result = {};
  for (const key of Object.keys(input)) {
    if (key === "enabled") {
      if (typeof input.enabled !== "boolean") throw new Error("enabled必须是布尔值");
      result.enabled = input.enabled;
    } else {
      result[key] = cleanText(input[key]);
      if (result[key].length > PRODUCT_LIMITS[key]) throw new Error(`${key}长度不能超过${PRODUCT_LIMITS[key]}个字符`);
    }
  }
  if (!result.name) throw new Error("商品名称不能为空");
  return result;
}

function normalizeVariants(values, hasVariants) {
  if (!Array.isArray(values) || !values.length || values.length > 50) throw new Error("规格数量必须为1～50个");
  const result = values.map((input, index) => {
    if (!input || typeof input !== "object" || Object.keys(input).some((key) => !VARIANT_FIELDS.includes(key))) throw new Error(`第${index + 1}个规格包含不允许修改的字段`);
    if (!cleanText(input._id)) throw new Error(`第${index + 1}个规格缺少variantId`);
    const specification = cleanText(input.specification);
    const barcode = cleanText(input.barcode);
    if (hasVariants && !specification) throw new Error(`第${index + 1}个规格名称不能为空`);
    if (specification.length > 100 || barcode.length > 64) throw new Error(`第${index + 1}个规格文本过长`);
    if (!Number.isSafeInteger(input.costPriceCent) || input.costPriceCent < 0 || !Number.isSafeInteger(input.salePriceCent) || input.salePriceCent < 0) throw new Error(`第${index + 1}个规格价格必须是非负整数分`);
    if (input.warningStock != null && (!Number.isSafeInteger(input.warningStock) || input.warningStock < 0)) throw new Error(`第${index + 1}个库存预警必须是非负整数`);
    if (typeof input.enabled !== "boolean") throw new Error(`第${index + 1}个enabled必须是布尔值`);
    return { _id:cleanText(input._id), specification, costPriceCent:input.costPriceCent, salePriceCent:input.salePriceCent, warningStock:input.warningStock == null ? null : input.warningStock, barcode, enabled:input.enabled };
  });
  const barcodes = result.map((item) => item.barcode).filter(Boolean);
  if (new Set(barcodes).size !== barcodes.length) throw new Error("同一商品的规格条形码不能重复");
  return result;
}

exports.main = async (event) => {
  const { OPENID:openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  try {
    const user = await authorizedUser(openid);
    if (!user) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const input = event || {};
    const unexpected = Object.keys(input).filter((key) => !["productId", "product", "variants"].includes(key) && !PLATFORM_FIELDS.includes(key));
    if (unexpected.length) return fail("INVALID_PARAMETER", `包含不允许修改的字段：${unexpected.join("、")}`);
    const productId = cleanText(input.productId);
    if (!productId) return fail("INVALID_PARAMETER", "productId不能为空");
    let currentProduct;
    try { currentProduct = (await db.collection("products").doc(productId).get()).data; } catch (_) { currentProduct = null; }
    if (!currentProduct) return fail("PRODUCT_NOT_FOUND", "商品不存在");
    let productInput, variantsInput;
    try { productInput = normalizeProduct(input.product); variantsInput = normalizeVariants(input.variants, currentProduct.hasVariants === true); }
    catch (error) { return fail("INVALID_PARAMETER", error.message); }

    const currentVariants = await db.collection("product_variants").where({ productId }).limit(50).get();
    const currentIds = new Set(currentVariants.data.map((item) => item._id));
    if (variantsInput.length !== currentVariants.data.length || variantsInput.some((item) => !currentIds.has(item._id))) return fail("INVALID_PARAMETER", "不能通过普通编辑新增、删除或替换规格");
    for (const variant of variantsInput) {
      if (!variant.barcode) continue;
      const duplicates = await db.collection("product_variants").where({ barcode:variant.barcode }).limit(2).get();
      if (duplicates.data.some((item) => item._id !== variant._id)) return fail("BARCODE_EXISTS", `条形码 ${variant.barcode} 已被其他规格使用`);
    }

    const now = db.serverDate();
    await db.runTransaction(async (transaction) => {
      await transaction.collection("products").doc(productId).update({ data:{ ...productInput, updatedBy:openid, updatedByName:user.name, updatedAt:now } });
      for (const variant of variantsInput) {
        const { _id, barcode, ...updates } = variant;
        await transaction.collection("product_variants").doc(_id).update({ data:{ ...updates, barcode:barcode || _.remove(), updatedAt:now } });
      }
    });
    const product = (await db.collection("products").doc(productId).get()).data;
    const variants = (await db.collection("product_variants").where({ productId }).orderBy("variantCode", "asc").limit(50).get()).data;
    return { success:true, data:{ product, variants }, message:"商品更新成功" };
  } catch (error) {
    console.error("updateProduct failed", error);
    if (/duplicate|unique|E11000/i.test(String(error.message || error))) return fail("BARCODE_EXISTS", "条形码已被其他规格使用");
    return fail("DATABASE_ERROR", "商品更新失败，请稍后重试");
  }
};
