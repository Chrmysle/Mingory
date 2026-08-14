const { callFunction } = require("./cloud");

const stockIn = (data) => callFunction("stockIn", data);
const adjustStock = (data) => callFunction("adjustStock", data);
const getInventoryLogs = (data) => callFunction("getInventoryLogs", data);
const getSupplierRestock = (data) => callFunction("getSupplierRestock", data);

module.exports = { stockIn, adjustStock, getInventoryLogs, getSupplierRestock };
