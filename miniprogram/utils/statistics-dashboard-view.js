const { formatCent } = require("./money");

const COMPOSITION_COLORS = ["#4da3ff", "#39c58a", "#f0a84b", "#a78bfa", "#ff7f72", "#626975"];

function dateParts(dateText) {
  const [, month, day] = String(dateText).split("-");
  return { short: `${Number(month)}-${Number(day)}`, full: `${Number(month)}月${Number(day)}日` };
}

function formatSummary(summary) {
  return {
    ...summary,
    revenueDisplay: formatCent(summary.revenueCent),
    costDisplay: formatCent(summary.costCent),
    grossProfitDisplay: formatCent(summary.grossProfitCent),
    grossMarginDisplay: summary.grossMarginPercent == null ? "--" : `${summary.grossMarginPercent.toFixed(1)}%`,
  };
}

function buildTrend(daily, field) {
  return daily
    .filter((item) => item[field] != null)
    .map((item) => {
      const labels = dateParts(item.date);
      return { label: labels.full, shortLabel: labels.short, value: item[field] };
    });
}

function buildDaily(daily) {
  return [...daily].reverse().map((item) => ({
    ...item,
    dateDisplay: dateParts(item.date).full,
    revenueDisplay: formatCent(item.revenueCent),
    costDisplay: formatCent(item.costCent),
    grossProfitDisplay: formatCent(item.grossProfitCent),
    grossMarginDisplay: item.grossMarginPercent == null ? "--" : `${item.grossMarginPercent.toFixed(1)}%`,
  }));
}

function buildRanking(rows, metric) {
  const field = metric === "quantity" ? "quantity" : (metric === "revenue" ? "revenueCent" : "grossProfitCent");
  const max = Math.max(0, ...rows.map((item) => item[field]));
  return rows.map((item, index) => ({
    ...item,
    key: item.variantId || item.productId,
    rank: index + 1,
    title: item.specification ? `${item.productName} · ${item.specification}` : item.productName,
    value: item[field],
    valueDisplay: metric === "quantity" ? `${item.quantity}${item.unit || ""}` : `¥${formatCent(item[field])}`,
    auxiliaryDisplay: metric === "quantity" ? `销售额 ¥${formatCent(item.revenueCent)}` : `${item.quantity}${item.unit || ""}`,
    barWidth: max > 0 ? Math.max(3, Math.round(Math.max(0, item[field]) * 100 / max)) : 0,
    negative: item[field] < 0,
  }));
}

function buildComposition(items) {
  return items.map((item, index) => ({
    ...item,
    key: item.productId || "__OTHER__",
    value: item.revenueCent,
    color: COMPOSITION_COLORS[index % COMPOSITION_COLORS.length],
    display: `¥${formatCent(item.revenueCent)}`,
    shareDisplay: `${item.sharePercent.toFixed(1)}%`,
  }));
}

function buildSupplierRanking(suppliers) {
  const rows = suppliers.filter((item) => item.restockSkuCount > 0).slice(0, 5);
  const max = Math.max(0, ...rows.map((item) => item.restockSkuCount));
  return rows.map((item, index) => ({ ...item, rank: index + 1, barWidth: max ? Math.max(6, Math.round(item.restockSkuCount * 100 / max)) : 0 }));
}

module.exports = { formatSummary, buildTrend, buildDaily, buildRanking, buildComposition, buildSupplierRanking };
