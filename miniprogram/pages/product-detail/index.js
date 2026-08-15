const productService = require("../../services/product");
const { withProductDetail } = require("../../utils/product-view");
const cart = require("../../utils/sale-cart");
const { withAuth } = require("../../utils/auth-page");
const { formatDateTime } = require("../../utils/date");

Page(withAuth({
  data: { product: null, variants: [], matchedVariantId: "", expandedVariantId: "", source: "", loading: true, archiving: false, restoring: false, permanentlyDeleting: false, archiveInfo: {}, error: "" },
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
      if (data.product.enabled === false || data.product.status === "archived") await this.loadArchiveInfo();
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
  openVariantPage(page, event) {
    wx.navigateTo({ url: `/pages/${page}/index?variantId=${event.currentTarget.dataset.id}` });
  },
  edit() { wx.navigateTo({ url: `/pages/product-edit/index?id=${this.productId}` }); },
  async loadArchiveInfo() {
    const result = await productService.manageArchivedProducts({ action: "inspect", productId: this.productId });
    this.setData({ archiveInfo: { ...result.references, blockerText: result.references.blockers.join("；"), archivedAtDisplay: formatDateTime(result.product.archivedAt) } });
  },
  async archiveProduct() {
    if (this.data.archiving || !this.data.product || this.data.product.enabled === false) return;
    const modal = await wx.showModal({
      title: "归档商品",
      content: `归档后，“${this.data.product.name}”不会出现在正常商品列表、搜索和销售页面中。历史销售和库存记录不受影响，之后可以在归档中恢复。`,
      confirmText: "确认归档",
    });
    if (!modal.confirm) return;
    this.setData({ archiving: true });
    try {
      await productService.archiveProduct({ productId: this.productId });
      wx.showToast({ title: "商品已归档", icon: "success" });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/product-list/index" }) }), 500);
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
      this.setData({ archiving: false });
    }
  },
  async restoreProduct() {
    if (this.data.restoring) return;
    const modal = await wx.showModal({ title: "恢复商品", content: "恢复后，商品会重新出现在商品列表、搜索、扫码和销售页面中。", confirmText: "恢复" });
    if (!modal.confirm) return;
    this.setData({ restoring: true });
    try {
      await productService.manageArchivedProducts({ action: "restore", productId: this.productId });
      wx.showToast({ title: "商品已恢复", icon: "success" });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/product-list/index" }) }), 500);
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); this.setData({ restoring: false }); }
  },
  async permanentlyDeleteProduct() {
    if (this.data.permanentlyDeleting || !this.data.archiveInfo || !this.data.archiveInfo.canPermanentlyDelete) return;
    const history = this.data.archiveInfo.hasHistoricalData;
    const first = await wx.showModal({
      title: "永久删除商品",
      content: history
        ? `该商品存在历史经营数据。永久删除后：\n• 商品和所有规格将被删除\n• ${this.data.archiveInfo.saleLineCount} 条销售明细将被删除\n• ${this.data.archiveInfo.inventoryLogCount} 条库存记录将被删除\n• 历史营业额、成本、毛利润和销量可能变化\n\n此操作无法恢复。`
        : "永久删除后，商品和所属全部规格将从数据库中移除，且无法恢复。",
      confirmText: "继续",
      confirmColor: "#ff6b67",
    });
    if (!first.confirm) return;
    const second = await wx.showModal({ title: "再次确认", content: `确定永久删除“${this.data.product.name}”吗？此操作无法撤销。`, confirmText: "永久删除", confirmColor: "#ff6b67" });
    if (!second.confirm) return;
    this.setData({ permanentlyDeleting: true });
    try {
      await productService.manageArchivedProducts({ action: "permanentDelete", productId: this.productId });
      wx.showToast({ title: "已永久删除", icon: "success" });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/product-list/index" }) }), 500);
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); this.setData({ permanentlyDeleting: false }); }
  },
}));
