const { scanSale } = require("../../utils/scan-sale");
const { getBusinessStatistics, getSales } = require("../../services/statistics");
const { getSupplierRestock } = require("../../services/inventory");
const { getPresetRange } = require("../../utils/time-range");
const { withStatisticsDisplay, withSaleDisplay } = require("../../utils/sales-view");

Page({
  data: {
    status: "loading",
    user: null,
    openid: "",
    message: "正在验证身份…",
    today: null,
    recentSales: [],
    urgentItems: [],
    outOfStockCount: 0,
    lowStockCount: 0,
    statisticsLoading: false,
    statisticsError: "",
    dashboardError: "",
  },

  onLoad() { this.loadUser(); },
  onShow() {
    if (this.hasShown && this.data.status === "ready") this.loadDashboard();
    this.hasShown = true;
  },
  onPullDownRefresh() {
    const task = this.data.status === "ready" ? this.loadDashboard() : this.loadUser();
    Promise.resolve(task).finally(() => wx.stopPullDownRefresh());
  },

  async loadUser() {
    this.setData({ status: "loading", message: "正在验证身份…" });
    try {
      const user = await getApp().userReady;
      this.setData({ status: "ready", user, message: "" });
      await this.loadDashboard();
    } catch (error) {
      const unauthorized = error.code === "UNAUTHORIZED";
      this.setData({
        status: unauthorized ? "unauthorized" : "error",
        openid: error.data && error.data.openid ? error.data.openid : "",
        message: error.message || "初始化失败，请稍后重试",
      });
    }
  },

  async loadDashboard() {
    if (this.data.statisticsLoading) return;
    this.setData({ statisticsLoading: true, statisticsError: "", dashboardError: "" });
    const range = getPresetRange("today");
    const settle = (promise) => promise.then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));
    const [statisticsResult, salesResult, restockResult] = await Promise.all([
      settle(getBusinessStatistics(range)),
      settle(getSales({ ...range, page: 1, pageSize: 5 })),
      settle(getSupplierRestock({ action: "overview" })),
    ]);
    const updates = { statisticsLoading: false };
    if (statisticsResult.status === "fulfilled") updates.today = withStatisticsDisplay(statisticsResult.value);
    else updates.statisticsError = statisticsResult.reason.message;
    if (salesResult.status === "fulfilled") updates.recentSales = salesResult.value.list.map(withSaleDisplay);
    else updates.dashboardError = salesResult.reason.message;
    if (restockResult.status === "fulfilled") {
      updates.urgentItems = restockResult.value.urgentItems || [];
      updates.outOfStockCount = restockResult.value.outOfStockCount || 0;
      updates.lowStockCount = restockResult.value.lowStockCount || 0;
    } else if (!updates.dashboardError) updates.dashboardError = restockResult.reason.message;
    this.setData(updates);
  },

  openSearch() { wx.navigateTo({ url: "/pages/product-search/index" }); },
  createProduct() { wx.navigateTo({ url: "/pages/product-create/index" }); },
  openRestock() { wx.navigateTo({ url: "/pages/restock-suppliers/index" }); },
  openSales() { wx.navigateTo({ url: "/pages/sales/index" }); },
  openOrder(event) { wx.navigateTo({ url: `/pages/sale-detail/index?id=${event.currentTarget.dataset.id}` }); },
  openStatistics() { wx.switchTab({ url: "/pages/business-statistics/index" }); },
  openInventory() { wx.switchTab({ url: "/pages/inventory/index" }); },
  copyOpenId() { if (this.data.openid) wx.setClipboardData({ data: this.data.openid }); },
  scanSale,
});
