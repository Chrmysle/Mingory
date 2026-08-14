function createSaleRequestId() {
  const random = Math.random().toString(36).slice(2, 12);
  return `SALE_${Date.now()}_${random}`;
}

function createInventoryRequestId(type) {
  if (!["STOCKIN", "ADJUST"].includes(type)) throw new TypeError("库存请求类型无效");
  const random = Math.random().toString(36).slice(2, 12);
  return `${type}_${Date.now()}_${random}`;
}

module.exports = { createSaleRequestId, createInventoryRequestId };
