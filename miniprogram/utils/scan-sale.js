const { getProduct } = require("../services/product");
const cart = require("./sale-cart");

async function scanSale(options = {}) {
  let scanResult;
  try {
    scanResult = await wx.scanCode({ scanType: ["barCode"] });
  } catch (error) {
    if (!String(error.errMsg || error.message).includes("cancel")) {
      wx.showToast({ title: "扫码失败，请重试", icon: "none" });
    }
    return;
  }
  const barcode = String(scanResult.result || "").trim();
  if (!barcode) {
    wx.showToast({ title: "未识别到有效条形码", icon: "none" });
    return;
  }
  try {
    const data = await getProduct({ barcode });
    const variant = data.variants.find((item) => item._id === data.matchedVariantId);
    if (!variant || variant.enabled === false || data.product.enabled === false) throw new Error("该商品当前不可销售");
    cart.addProduct(data.product, variant);
    wx.showToast({ title: `已加入 ${variant.specification || data.product.name}`, icon: "none", duration: 700 });
    if (typeof options.onAdded === "function") options.onAdded({ product: data.product, variant });
    else wx.switchTab({ url: "/pages/sell/index" });
  } catch (error) {
    if (error.code !== "PRODUCT_NOT_FOUND") {
      wx.showToast({ title: error.message, icon: "none" });
      return;
    }
    const modal = await wx.showModal({ title: "商品尚未录入", content: "该商品尚未录入，是否新增商品？", confirmText: "新增商品" });
    if (modal.confirm) wx.navigateTo({ url: `/pages/product-create/index?barcode=${encodeURIComponent(barcode)}` });
  }
}

module.exports = { scanSale };
