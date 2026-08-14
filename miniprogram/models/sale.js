const SALE_FIELDS = Object.freeze([
  "_id", "requestId", "productId", "variantId", "productCode", "variantCode",
  "productName", "specification", "unit", "quantity", "unitPriceCent",
  "costPriceCent", "totalAmountCent", "totalCostCent", "grossProfitCent",
  "beforeStock", "afterStock", "operatorOpenId", "operatorName", "status",
  "createdAt",
]);

const INVENTORY_LOG_FIELDS = Object.freeze([
  "_id", "productId", "variantId", "productCode", "variantCode",
  "productName", "specification", "type", "beforeStock", "changeQuantity",
  "afterStock", "relatedId", "operatorOpenId", "operatorName", "remark",
  "createdAt", "requestId", "beforeCostPriceCent", "newCostPriceCent",
]);

const INVENTORY_LOG_TYPES = Object.freeze(["SALE", "STOCK_IN", "MANUAL_ADD", "MANUAL_SUBTRACT", "STOCKTAKE"]);

module.exports = { SALE_FIELDS, INVENTORY_LOG_FIELDS, INVENTORY_LOG_TYPES };
