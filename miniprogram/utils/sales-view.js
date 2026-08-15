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
  const itemCount = Number.isSafeInteger(sale.itemCount) ? sale.itemCount : 1;
  const totalQuantity = Number.isSafeInteger(sale.totalQuantity) ? sale.totalQuantity : sale.quantity;
  const productTitle = sale.firstProductName || sale.productName || "商品";
  const specification = sale.firstSpecification || sale.specification || "";
  const firstItemTitle = specification ? `${productTitle} · ${specification}` : productTitle;
  const fullTimeDisplay = formatDateTime(sale.createdAt);
  return {
    ...sale,
    unitPriceDisplay: Number.isSafeInteger(sale.unitPriceCent) ? formatSignedCent(sale.unitPriceCent) : "",
    costPriceDisplay: Number.isSafeInteger(sale.costPriceCent) ? formatSignedCent(sale.costPriceCent) : "",
    totalAmountDisplay: formatSignedCent(sale.totalAmountCent),
    totalCostDisplay: formatSignedCent(sale.totalCostCent),
    grossProfitDisplay: formatSignedCent(sale.grossProfitCent),
    timeDisplay: fullTimeDisplay,
    shortTimeDisplay: fullTimeDisplay.includes(" ") ? fullTimeDisplay.split(" ").pop() : fullTimeDisplay,
    recentTitle: itemCount > 1 ? `${firstItemTitle}等${itemCount}种` : firstItemTitle,
    recentQuantity: itemCount > 1 ? `共${totalQuantity}件` : `×${totalQuantity}`,
  };
}

function withOrderDetail(data) {
  return { order: withSaleDisplay(data.order), items: data.items.map(withSaleDisplay) };
}

module.exports = { withStatisticsDisplay, withSaleDisplay, withOrderDetail };
