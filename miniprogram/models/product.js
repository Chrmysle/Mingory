const PRODUCT_FIELDS = Object.freeze([
  "_id", "productCode", "name", "unit", "supplier", "imageFileID",
  "shelfLocation", "remark", "enabled", "hasVariants", "createdBy",
  "createdByName", "updatedBy", "updatedByName", "createdAt", "updatedAt",
]);

const PRODUCT_VARIANT_FIELDS = Object.freeze([
  "_id", "productId", "variantCode", "specification", "costPriceCent",
  "salePriceCent", "stock", "warningStock", "barcode", "enabled",
  "createdAt", "updatedAt",
]);

module.exports = { PRODUCT_FIELDS, PRODUCT_VARIANT_FIELDS };
