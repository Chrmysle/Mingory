const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const PRODUCT_FIELDS = ["name", "unit", "supplier", "imageFileID", "shelfLocation", "remark"];
const PRODUCT_LIMITS = { name:100, unit:20, supplier:100, imageFileID:512, shelfLocation:100, remark:500 };
const VARIANT_FIELDS = ["specification", "costPriceCent", "salePriceCent", "stock", "warningStock", "barcode"];
const fail = (code, message) => ({ success:false, code, message });
const cleanText = (value) => String(value == null ? "" : value).trim();

async function authorizedUser(openid) {
  const result = await db.collection("users").where({ openid, enabled:true }).limit(2).get();
  return result.data.length === 1 ? result.data[0] : null;
}

function normalizeProduct(value) {
  const input = value && typeof value === "object" ? value : {};
  if (Object.keys(input).some((key) => !PRODUCT_FIELDS.includes(key))) throw new Error("商品公共信息包含不允许创建的字段");
  const output = {};
  for (const field of PRODUCT_FIELDS) {
    output[field] = cleanText(input[field]);
    if (output[field].length > PRODUCT_LIMITS[field]) throw new Error(`${field}长度不能超过${PRODUCT_LIMITS[field]}个字符`);
  }
  if (!output.name) throw new Error("商品名称不能为空");
  return output;
}

function nonNegativeInteger(value, field, nullable=false) {
  if (nullable && (value === "" || value == null)) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field}必须是大于或等于0的整数`);
  return value;
}

function normalizeVariants(values, hasVariants) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 50) throw new Error("规格数量必须为1～50个");
  if (!hasVariants && values.length !== 1) throw new Error("普通商品只能包含一个默认规格");
  const variants = values.map((input, index) => {
    if (!input || typeof input !== "object" || Object.keys(input).some((key) => !VARIANT_FIELDS.includes(key))) {
      throw new Error(`第${index + 1}个规格包含不允许创建的字段`);
    }
    const variant = {
      specification: cleanText(input.specification),
      costPriceCent: nonNegativeInteger(input.costPriceCent, "costPriceCent"),
      salePriceCent: nonNegativeInteger(input.salePriceCent, "salePriceCent"),
      stock: nonNegativeInteger(input.stock, "stock"),
      warningStock: nonNegativeInteger(input.warningStock, "warningStock", true),
      barcode: cleanText(input.barcode),
    };
    if (variant.specification.length > 100) throw new Error("规格长度不能超过100个字符");
    if (variant.barcode.length > 64) throw new Error("条形码长度不能超过64个字符");
    if (hasVariants && !variant.specification) throw new Error(`第${index + 1}个规格名称不能为空`);
    return variant;
  });
  const barcodes = variants.map((item) => item.barcode).filter(Boolean);
  if (new Set(barcodes).size !== barcodes.length) throw new Error("同一商品的规格条形码不能重复");
  return variants;
}

const formatProductCode = (sequence) => {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999) throw new Error("商品编号已达到上限");
  return `SP${String(sequence).padStart(6, "0")}`;
};

exports.main = async (event) => {
  const { OPENID:openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");
  try {
    const user = await authorizedUser(openid);
    if (!user) return fail("UNAUTHORIZED", "当前用户无权执行此操作");
    const input = event || {};
    const unexpected = Object.keys(input).filter((key) => !["product", "variants", "hasVariants"].includes(key) && !PLATFORM_FIELDS.includes(key));
    if (unexpected.length) return fail("INVALID_PARAMETER", `包含不允许创建的字段：${unexpected.join("、")}`);
    if (typeof input.hasVariants !== "boolean") return fail("INVALID_PARAMETER", "hasVariants必须是布尔值");
    let productInput, variantsInput;
    try { productInput = normalizeProduct(input.product); variantsInput = normalizeVariants(input.variants, input.hasVariants); }
    catch (error) { return fail("INVALID_PARAMETER", error.message); }

    const barcodes = variantsInput.map((item) => item.barcode).filter(Boolean);
    for (const barcode of barcodes) {
      const existing = await db.collection("product_variants").where({ barcode }).limit(1).get();
      if (existing.data.length) return fail("BARCODE_EXISTS", `条形码 ${barcode} 已被其他规格使用`);
    }

    const now = db.serverDate();
    const transactionResult = await db.runTransaction(async (transaction) => {
      const counterRef = transaction.collection("settings").doc("productCode");
      const counter = await counterRef.get();
      const sequence = (counter.data && Number.isSafeInteger(counter.data.value) ? counter.data.value : 0) + 1;
      const productCode = formatProductCode(sequence);
      await counterRef.set({ data:{ value:sequence, updatedAt:now } });
      const product = { productCode, ...productInput, enabled:true, hasVariants:input.hasVariants, createdBy:openid, createdByName:user.name, updatedBy:openid, updatedByName:user.name, createdAt:now, updatedAt:now };
      const productResult = await transaction.collection("products").add({ data:product });
      const variants = [];
      for (let index = 0; index < variantsInput.length; index += 1) {
        const variant = { productId:productResult._id, variantCode:`${productCode}-${String(index + 1).padStart(2, "0")}`, ...variantsInput[index], enabled:true, createdAt:now, updatedAt:now };
        if (!variant.barcode) delete variant.barcode;
        const result = await transaction.collection("product_variants").add({ data:variant });
        variants.push({ _id:result._id, ...variant });
      }
      return { product:{ _id:productResult._id, ...product }, variants };
    });
    return { success:true, data:transactionResult.result || transactionResult, message:"商品创建成功" };
  } catch (error) {
    console.error("createProduct failed", error);
    if (/duplicate|unique|E11000/i.test(String(error.message || error))) return fail("BARCODE_EXISTS", "商品编号或条形码重复，请重试");
    return fail("DATABASE_ERROR", "商品创建失败，请稍后重试");
  }
};
