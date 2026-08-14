const { getSales } = require("../../services/statistics");
const { getPresetRange, getCustomRange, formatBeijingDate } = require("../../utils/time-range");
const { withSaleDisplay } = require("../../utils/sales-view");

Page({
  data: { type: "today", rangeLabel: "今天", startDate: "", endDate: "", list: [], page: 1, hasMore: true, loading: false, error: "" },
  onLoad(options = {}) {
    const today = formatBeijingDate();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(options.date || "") ? options.date : "";
    this.setData({ type: date ? "custom" : "today", startDate: date || today, endDate: date || today });
    this.setRange(date ? getCustomRange(date, date) : getPresetRange("today"));
  },
  onPullDownRefresh() { this.reload().finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { this.loadMore(); },
  choosePreset(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ type });
    if (type !== "custom") this.setRange(getPresetRange(type));
  },
  onDateChange(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  applyCustom() {
    try { this.setRange(getCustomRange(this.data.startDate, this.data.endDate)); }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
  },
  setRange(range) { this.range = range; this.setData({ rangeLabel: range.label }); this.reload(); },
  async reload() { this.setData({ list: [], page: 1, hasMore: true, error: "" }); return this.loadMore(); },
  async loadMore() {
    if (!this.range || this.data.loading || !this.data.hasMore) return;
    this.setData({ loading: true });
    try {
      const result = await getSales({ ...this.range, page: this.data.page, pageSize: 20 });
      this.setData({ list: this.data.list.concat(result.list.map(withSaleDisplay)), page: this.data.page + 1, hasMore: result.hasMore });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  open(e) { wx.navigateTo({ url: `/pages/sale-detail/index?id=${e.currentTarget.dataset.id}` }); },
});
