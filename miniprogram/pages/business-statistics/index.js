const { getStatisticsDashboard } = require("../../services/statistics");
const { getSupplierRestock } = require("../../services/inventory");
const { getPresetRange, getCustomRange, formatBeijingDate } = require("../../utils/time-range");
const { formatCent } = require("../../utils/money");
const { formatSummary, buildTrend, buildDaily, buildRanking, buildComposition, buildSupplierRanking } = require("../../utils/statistics-dashboard-view");

Page({
  data: {
    type: "month",
    rangeLabel: "本月",
    startDate: "",
    endDate: "",
    summary: null,
    daily: [],
    trendMetric: "revenue",
    trendSeries: [],
    quantitySeries: [],
    marginSeries: [],
    rankingLevel: "sku",
    rankingMetric: "quantity",
    rankingRows: [],
    composition: [],
    inventoryHealth: null,
    supplierRanking: [],
    loading: false,
    error: "",
    liveError: "",
  },

  onLoad() {
    const today = formatBeijingDate();
    this.setData({ startDate: today, endDate: today });
    this.setRange(getPresetRange("month"));
    this.loadLiveStatistics();
    this.loaded = true;
  },
  onShow() { if (this.loaded && this.hidden) { this.load(); this.loadLiveStatistics(); } this.hidden = false; },
  onHide() { this.hidden = true; },
  onPullDownRefresh() { Promise.all([this.load(), this.loadLiveStatistics()]).finally(() => wx.stopPullDownRefresh()); },
  choosePreset(event) { const type = event.currentTarget.dataset.type; this.setData({ type }); if (type !== "custom") this.setRange(getPresetRange(type)); },
  onDateChange(event) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  applyCustom() { try { this.setRange(getCustomRange(this.data.startDate, this.data.endDate)); } catch (error) { wx.showToast({ title: error.message, icon: "none" }); } },
  setRange(range) { this.range = range; this.setData({ rangeLabel: range.label }); this.load(); },

  async load() {
    if (!this.range || this.data.loading) return;
    this.setData({ loading: true, error: "" });
    try { this.applyDashboard(await getStatisticsDashboard(this.range)); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },

  async loadLiveStatistics() {
    this.setData({ liveError: "" });
    try { this.applyLiveStatistics(await getSupplierRestock({ action: "overview" })); }
    catch (error) { this.setData({ liveError: error.message }); }
  },

  applyDashboard(dashboard) {
    this.dashboard = dashboard;
    this.setData({
      summary: formatSummary(dashboard.summary),
      daily: buildDaily(dashboard.daily),
      trendSeries: buildTrend(dashboard.daily, this.data.trendMetric === "revenue" ? "revenueCent" : "grossProfitCent"),
      quantitySeries: buildTrend(dashboard.daily, "quantity"),
      marginSeries: buildTrend(dashboard.daily, "grossMarginPercent"),
      rankingRows: this.currentRanking(dashboard),
      composition: buildComposition(dashboard.composition),
    });
  },

  applyLiveStatistics(result) {
    const normal = result.normalStockCount || 0;
    const low = result.lowStockCount || 0;
    const out = result.outOfStockCount || 0;
    const unset = result.warningUnsetCount || 0;
    const configuredTotal = normal + low + out;
    this.setData({
      inventoryHealth: {
        normal, low, out, unset,
        normalWidth: configuredTotal ? Math.round(normal * 100 / configuredTotal) : 0,
        lowWidth: configuredTotal ? Math.round(low * 100 / configuredTotal) : 0,
        outWidth: configuredTotal ? Math.round(out * 100 / configuredTotal) : 0,
      },
      supplierRanking: buildSupplierRanking(result.suppliers || []),
    });
  },

  currentRanking(dashboard = this.dashboard) {
    if (!dashboard) return [];
    const rows = dashboard.rankings[this.data.rankingLevel][this.data.rankingMetric] || [];
    return buildRanking(rows, this.data.rankingMetric);
  },
  chooseTrend(event) {
    const trendMetric = event.currentTarget.dataset.metric;
    if (!this.dashboard || trendMetric === this.data.trendMetric) return;
    this.setData({ trendMetric, trendSeries: buildTrend(this.dashboard.daily, trendMetric === "revenue" ? "revenueCent" : "grossProfitCent") });
  },
  chooseRankingLevel(event) {
    const rankingLevel = event.currentTarget.dataset.level;
    if (rankingLevel === this.data.rankingLevel) return;
    this.setData({ rankingLevel }, () => this.setData({ rankingRows: this.currentRanking() }));
  },
  chooseRankingMetric(event) {
    const rankingMetric = event.currentTarget.dataset.metric;
    if (rankingMetric === this.data.rankingMetric) return;
    this.setData({ rankingMetric }, () => this.setData({ rankingRows: this.currentRanking() }));
  },
  openRankingItem(event) {
    const productId = event.currentTarget.dataset.productId;
    const variantId = event.currentTarget.dataset.variantId;
    if (!productId) return;
    const variant = variantId ? `&variantId=${encodeURIComponent(variantId)}` : "";
    wx.navigateTo({ url: `/pages/product-detail/index?id=${encodeURIComponent(productId)}${variant}` });
  },
  openSupplier(event) {
    const item = this.data.supplierRanking[event.currentTarget.dataset.index];
    if (!item) return;
    const query = item.missingSupplier ? "missingSupplier=1" : `supplier=${encodeURIComponent(item.supplier)}`;
    wx.navigateTo({ url: `/pages/restock-items/index?${query}` });
  },
  openInventory() { wx.switchTab({ url: "/pages/inventory/index" }); },
  openDay(event) { const date = event.currentTarget.dataset.date; if (date) wx.navigateTo({ url: `/pages/sales/index?date=${encodeURIComponent(date)}` }); },
});
