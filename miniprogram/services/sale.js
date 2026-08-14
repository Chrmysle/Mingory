const { callFunction } = require("./cloud");

function saleProduct(data) {
  return callFunction("saleProduct", data);
}

function checkoutSale(data) {
  return callFunction("checkoutSale", data);
}

function managePendingSales(data) {
  return callFunction("managePendingSales", data);
}

module.exports = { saleProduct, checkoutSale, managePendingSales };
