const { getProduct } = require("../services/product");

async function scanProduct() {
  let scanResult;
  try {
    scanResult = await wx.scanCode({ scanType: ["barCode"] });
  } catch (error) {
    if (String(error.errMsg || error.message).includes("cancel")) return;
    wx.showToast({ title: "扫码失败，请重试", icon: "none" });
    return;
  }

  const barcode = String(scanResult.result || "").trim();
  if (!barcode) {
    wx.showToast({ title: "未识别到有效条形码", icon: "none" });
    return;
  }

  try {
    const data = await getProduct({ barcode });
    wx.navigateTo({ url: `/pages/product-detail/index?id=${data.product._id}&variantId=${data.matchedVariantId}` });
  } catch (error) {
    if (error.code !== "PRODUCT_NOT_FOUND") {
      wx.showToast({ title: error.message, icon: "none" });
      return;
    }
    const modal = await wx.showModal({
      title: "商品尚未录入",
      content: "该商品尚未录入，是否新增商品？",
      confirmText: "新增商品",
    });
    if (modal.confirm) {
      wx.navigateTo({ url: `/pages/product-create/index?barcode=${encodeURIComponent(barcode)}` });
    }
  }
}

module.exports = { scanProduct };
