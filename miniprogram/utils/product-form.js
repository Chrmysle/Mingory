const { yuanToCent } = require("./money");

function nonNegativeInteger(value, label, optional=false) {
  const text = String(value == null ? "" : value).trim();
  if (optional && !text) return null;
  if (!/^\d+$/.test(text)) throw new TypeError(`${label}必须是大于或等于0的整数`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new TypeError(`${label}数值过大`);
  return number;
}

function toProductPayload(productForm, variantForms, hasVariants, includeStock=true) {
  const name = String(productForm.name || "").trim();
  if (!name) throw new TypeError("请输入商品名称");
  if (!Array.isArray(variantForms) || !variantForms.length) throw new TypeError("至少需要一个规格");
  const product = {
    name,
    unit:String(productForm.unit || "").trim(),
    supplier:String(productForm.supplier || "").trim(),
    imageFileID:String(productForm.imageFileID || "").trim(),
    shelfLocation:String(productForm.shelfLocation || "").trim(),
    remark:String(productForm.remark || "").trim(),
  };
  const variants = variantForms.map((form, index) => {
    const specification = String(form.specification || "").trim();
    if (hasVariants && !specification) throw new TypeError(`请输入规格${index + 1}的名称`);
    const variant = {
      specification,
      costPriceCent:yuanToCent(form.costPrice),
      salePriceCent:yuanToCent(form.salePrice),
      warningStock:nonNegativeInteger(form.warningStock, `规格${index + 1}库存预警`, true),
      barcode:String(form.barcode || "").trim(),
    };
    if (includeStock) variant.stock = nonNegativeInteger(form.stock, `规格${index + 1}初始库存`);
    if (form._id) variant._id = form._id;
    if (typeof form.enabled === "boolean") variant.enabled = form.enabled;
    return variant;
  });
  return { product, variants, hasVariants };
}

module.exports = { toProductPayload };
