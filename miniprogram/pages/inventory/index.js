const { getSupplierRestock } = require("../../services/inventory");
const { withAuth } = require("../../utils/auth-page");

Page(withAuth({
  data: { outOfStockCount: 0, lowStockCount: 0, urgentItems: [], loading: true, error: "" },

  onLoad() { this.load(); this.loaded = true; },
  onShow() { if (this.loaded && this.hidden) this.load(); this.hidden = false; },
  onHide() { this.hidden = true; },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },

  async load() {
    if (this.data.loading && this.hasLoaded) return;
    this.hasLoaded = true;
    this.setData({ loading: true, error: "" });
    try {
      const result = await getSupplierRestock({ action: "overview" });
      this.setData({
        outOfStockCount: result.outOfStockCount || 0,
        lowStockCount: result.lowStockCount || 0,
        urgentItems: result.urgentItems || [],
      });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },

  openRestock() { wx.navigateTo({ url: "/pages/restock-suppliers/index" }); },
  stockIn(event) {
    const variantId = event.currentTarget.dataset.variantId;
    if (variantId) wx.navigateTo({ url: `/pages/stock-in/index?variantId=${encodeURIComponent(variantId)}&source=inventory` });
  },
}));
