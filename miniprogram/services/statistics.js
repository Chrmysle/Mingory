const { callFunction } = require("./cloud");

const getBusinessStatistics = ({ startTime, endTime }) => callFunction("getBusinessStatistics", { startTime, endTime });
const getStatisticsDashboard = ({ startTime, endTime }) => callFunction("getStatisticsDashboard", { startTime, endTime });
const getSales = ({ startTime, endTime, page, pageSize, status }) => callFunction("getSales", { startTime, endTime, page, pageSize, ...(status ? { status } : {}) });
const getSale = (data) => callFunction("getSale", data);
const cancelSale = (data) => callFunction("cancelSale", data);

module.exports = { getBusinessStatistics, getStatisticsDashboard, getSales, getSale, cancelSale };
