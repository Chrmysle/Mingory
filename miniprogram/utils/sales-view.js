const { formatSignedCent } = require("./money");
const { formatDateTime } = require("./date");

function withStatisticsDisplay(statistics) {
  return {
    ...statistics,
    revenueDisplay: formatSignedCent(statistics.revenueCent, true),
    costDisplay: formatSignedCent(statistics.costCent, true),
    grossProfitDisplay: formatSignedCent(statistics.grossProfitCent, true),
  };
}

function withSaleDisplay(sale) {
  return {
    ...sale,
    unitPriceDisplay: Number.isSafeInteger(sale.unitPriceCent) ? formatSignedCent(sale.unitPriceCent) : "",
    costPriceDisplay: Number.isSafeInteger(sale.costPriceCent) ? formatSignedCent(sale.costPriceCent) : "",
    totalAmountDisplay: formatSignedCent(sale.totalAmountCent),
    totalCostDisplay: formatSignedCent(sale.totalCostCent),
    grossProfitDisplay: formatSignedCent(sale.grossProfitCent),
    timeDisplay: formatDateTime(sale.createdAt),
    cancelledAtDisplay: sale.cancelledAt ? formatDateTime(sale.cancelledAt) : "",
  };
}

function withOrderDetail(data) {
  return { order: withSaleDisplay(data.order), items: data.items.map(withSaleDisplay) };
}

module.exports = { withStatisticsDisplay, withSaleDisplay, withOrderDetail };
