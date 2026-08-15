const { getSupplierRestock } = require("../../services/inventory");
const { withAuth } = require("../../utils/auth-page");

Page(withAuth({
  data: {
    suppliers: [],
    totalRestockSkuCount: 0,
    loading: true,
    error: "",
  },

  onLoad() {
    this.loadOverview();
  },

  onShow() {
    if (this.hasBeenHidden) this.loadOverview();
    this.hasBeenHidden = false;
  },

  onHide() {
    this.hasBeenHidden = true;
  },

  onPullDownRefresh() {
    this.loadOverview().finally(() => wx.stopPullDownRefresh());
  },

  async loadOverview() {
    if (this.data.loading && this.hasLoaded) return;
    this.hasLoaded = true;
    this.setData({ loading: true, error: "" });
    try {
      const result = await getSupplierRestock({ action: "overview" });
      this.setData({
        suppliers: result.suppliers || [],
        totalRestockSkuCount: result.totalRestockSkuCount || 0,
      });
    } catch (error) {
      this.setData({ error: error.message || "补货信息查询失败，请稍后重试" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openSupplier(event) {
    const item = this.data.suppliers[event.currentTarget.dataset.index];
    if (!item) return;
    const query = item.missingSupplier
      ? "missingSupplier=1"
      : `supplier=${encodeURIComponent(item.supplier)}`;
    wx.navigateTo({ url: `/pages/restock-items/index?${query}` });
  },
}));
