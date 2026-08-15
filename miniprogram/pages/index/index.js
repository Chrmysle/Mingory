const { scanSale } = require("../../utils/scan-sale");
const { getBusinessStatistics, getSales } = require("../../services/statistics");
const { getSupplierRestock } = require("../../services/inventory");
const { getPresetRange } = require("../../utils/time-range");
const { withStatisticsDisplay, withSaleDisplay } = require("../../utils/sales-view");
const { withAuth } = require("../../utils/auth-page");

Page(withAuth({
  data: {
    today: null,
    recentSales: [],
    urgentItems: [],
    outOfStockCount: 0,
    lowStockCount: 0,
    statisticsLoading: false,
    statisticsError: "",
    dashboardError: "",
  },

  onLoad() { this.loadDashboard(); },
  onShow() {
    if (this.hasShown) this.loadDashboard();
    this.hasShown = true;
  },
  onPullDownRefresh() {
    Promise.resolve(this.loadDashboard()).finally(() => wx.stopPullDownRefresh());
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
  openMembers() { wx.navigateTo({ url: "/pages/member-management/index" }); },
  scanSale,
}));
