const productService = require("../../services/product");
const { formatDateTime } = require("../../utils/date");

Page({
  data: { list: [], page: 1, hasMore: true, loading: false, error: "" },
  onLoad() { this.reload(); this.loaded = true; },
  onShow() { if (this.loaded && this.hidden) this.reload(); this.hidden = false; },
  onHide() { this.hidden = true; },
  onPullDownRefresh() { this.reload().finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { this.loadMore(); },
  async reload() { this.setData({ list: [], page: 1, hasMore: true, error: "" }); return this.loadMore(); },
  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    this.setData({ loading: true });
    try {
      const result = await productService.manageArchivedProducts({ action: "list", page: this.data.page, pageSize: 20 });
      const list = result.list.map((item) => ({ ...item, archivedAtDisplay: formatDateTime(item.archivedAt) }));
      this.setData({ list: this.data.list.concat(list), page: this.data.page + 1, hasMore: result.hasMore });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  open(event) { wx.navigateTo({ url: `/pages/product-detail/index?id=${event.currentTarget.dataset.id}&archive=1` }); },
});
