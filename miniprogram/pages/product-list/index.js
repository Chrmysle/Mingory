const productService = require("../../services/product");
const { withProductSummary } = require("../../utils/product-view");
const { scanProduct } = require("../../utils/scan-product");

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
      const result = await productService.searchProducts({ keyword: "", page: this.data.page, pageSize: 20 });
      this.setData({ list: this.data.list.concat(result.list.map(withProductSummary)), page: this.data.page + 1, hasMore: result.hasMore });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  open(e) { wx.navigateTo({ url: `/pages/product-detail/index?id=${e.currentTarget.dataset.id}` }); },
  create() { wx.navigateTo({ url: "/pages/product-create/index" }); },
  search() { wx.navigateTo({ url: "/pages/product-search/index" }); },
  scanProduct,
});
