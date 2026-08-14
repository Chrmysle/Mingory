const { getSupplierRestock } = require("../../services/inventory");

Page({
  data: {
    supplier: "",
    displayName: "",
    missingSupplier: false,
    includeAll: false,
    groups: [],
    restockSkuCount: 0,
    totalSkuCount: 0,
    loading: true,
    error: "",
  },

  onLoad(options) {
    const missingSupplier = options.missingSupplier === "1";
    const supplier = missingSupplier ? "" : decodeURIComponent(options.supplier || "").trim();
    if (!missingSupplier && !supplier) {
      this.setData({ loading: false, error: "缺少供货商信息" });
      return;
    }
    this.setData({ supplier, missingSupplier, displayName: missingSupplier ? "未设置供货商" : supplier });
    this.loadItems();
  },

  onShow() {
    if (this.hasBeenHidden) this.loadItems();
    this.hasBeenHidden = false;
  },

  onHide() {
    this.hasBeenHidden = true;
  },

  onPullDownRefresh() {
    this.loadItems().finally(() => wx.stopPullDownRefresh());
  },

  async loadItems() {
    if (!this.data.missingSupplier && !this.data.supplier) return;
    this.setData({ loading: true, error: "" });
    try {
      const result = await getSupplierRestock({
        action: "items",
        supplier: this.data.supplier,
        missingSupplier: this.data.missingSupplier,
        includeAll: this.data.includeAll,
      });
      this.setData({
        displayName: result.displayName,
        groups: result.groups || [],
        restockSkuCount: result.restockSkuCount || 0,
        totalSkuCount: result.totalSkuCount || 0,
      });
    } catch (error) {
      this.setData({ error: error.message || "补货清单查询失败，请稍后重试" });
    } finally {
      this.setData({ loading: false });
    }
  },

  switchMode(event) {
    const includeAll = event.currentTarget.dataset.mode === "all";
    if (includeAll === this.data.includeAll) return;
    this.setData({ includeAll }, () => this.loadItems());
  },

  showAll() {
    if (this.data.includeAll) return;
    this.setData({ includeAll: true }, () => this.loadItems());
  },

  stockIn(event) {
    const variantId = event.currentTarget.dataset.variantId;
    if (!variantId) return;
    wx.navigateTo({ url: `/pages/stock-in/index?variantId=${encodeURIComponent(variantId)}&source=restock` });
  },
});
