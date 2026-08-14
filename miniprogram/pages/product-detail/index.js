const productService = require("../../services/product");
const { withProductDetail } = require("../../utils/product-view");
const cart = require("../../utils/sale-cart");

Page({
  data: { product: null, variants: [], matchedVariantId: "", expandedVariantId: "", source: "", loading: true, error: "" },
  onLoad(options) {
    this.productId = options.id;
    this.matchedVariantId = options.variantId || "";
    this.setData({ source: options.source || "" });
    if (!this.productId) return this.setData({ loading: false, error: "缺少商品 ID" });
    this.load();
  },
  onShow() { if (this.loadedOnce) this.load(); this.loadedOnce = true; },
  async load() {
    this.setData({ loading: true, error: "" });
    try {
      const data = withProductDetail(await productService.getProduct({ productId: this.productId }));
      const matchedVariantId = this.matchedVariantId || data.matchedVariantId || "";
      const expandedVariantId = matchedVariantId || (data.variants.length === 1 ? data.variants[0]._id : this.data.expandedVariantId);
      this.setData({ product: data.product, variants: data.variants, matchedVariantId, expandedVariantId });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  toggleVariant(event) {
    if (!this.data.product.hasVariants) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ expandedVariantId: this.data.expandedVariantId === id ? "" : id });
  },
  sell(event) {
    const variantId = event.currentTarget.dataset.id;
    const variant = this.data.variants.find((item) => item._id === variantId);
    if (!variant) return;
    try {
      cart.addProduct(this.data.product, variant);
      wx.showToast({ title: `已加入 ${variant.specification || this.data.product.name}`, icon: "none", duration: 700 });
      wx.switchTab({ url: "/pages/sell/index" });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
  },
  stockIn(event) { this.openVariantPage("stock-in", event); },
  adjustStock(event) { this.openVariantPage("stock-adjust", event); },
  inventoryLogs(event) { this.openVariantPage("inventory-logs", event); },
  openVariantPage(page, event) {
    wx.navigateTo({ url: `/pages/${page}/index?variantId=${event.currentTarget.dataset.id}` });
  },
  edit() { wx.navigateTo({ url: `/pages/product-edit/index?id=${this.productId}` }); },
});
