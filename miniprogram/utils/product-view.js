const { formatCent } = require("./money");

function suggestedPrice(costPriceCent, rate) {
  return formatCent(Math.round(costPriceCent * (100 + rate) / 100));
}

function withVariantDisplay(variant) {
  return {
    ...variant,
    costPriceDisplay:formatCent(variant.costPriceCent),
    salePriceDisplay:formatCent(variant.salePriceCent),
    suggestedPrice20Display:suggestedPrice(variant.costPriceCent, 20),
    suggestedPrice25Display:suggestedPrice(variant.costPriceCent, 25),
    suggestedPrice30Display:suggestedPrice(variant.costPriceCent, 30),
    warningStockDisplay:variant.warningStock == null ? "未设置" : variant.warningStock,
    lowStock:variant.warningStock != null && variant.stock <= variant.warningStock,
  };
}

function withProductSummary(product) {
  const min = formatCent(product.minSalePriceCent);
  const max = formatCent(product.maxSalePriceCent);
  return {
    ...product,
    priceDisplay:min === max ? `¥${min}` : `¥${min}～¥${max}`,
    stockDisplay:`库存 ${product.totalStock}${product.unit || ""}`,
    variantLabel:product.hasVariants ? `${product.variantCount}个规格` : "",
    matchedSpecificationsDisplay:(product.matchedSpecifications || []).join("、"),
  };
}

function withProductDetail(data) {
  return { ...data, variants:data.variants.map(withVariantDisplay) };
}

module.exports = { withVariantDisplay, withProductSummary, withProductDetail };
