const { callFunction } = require("./cloud");

const getBusinessStatistics = ({ startTime, endTime }) => callFunction("getBusinessStatistics", { startTime, endTime });
const getStatisticsDashboard = ({ startTime, endTime }) => callFunction("getStatisticsDashboard", { startTime, endTime });
const getSales = ({ startTime, endTime, page, pageSize }) => callFunction("getSales", { startTime, endTime, page, pageSize });
const getSale = (data) => callFunction("getSale", data);
const deleteSale = (data) => callFunction("deleteSale", data);

module.exports = { getBusinessStatistics, getStatisticsDashboard, getSales, getSale, deleteSale };
