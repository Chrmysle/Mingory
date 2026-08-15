const productService = require("../../services/product");
const { withProductSummary } = require("../../utils/product-view");
const { scanProduct } = require("../../utils/scan-product");
const { withAuth } = require("../../utils/auth-page");

Page(withAuth({
  data: { keyword: "", list: [], page: 1, hasMore: false, loading: false, searched: false, error: "" },
  onShow() { if (this.hidden && this.data.searched) this.search(true); this.hidden = false; },
  onHide() { this.hidden = true; },
  onInput(e) { this.setData({ keyword: e.detail.value }); },
  submit() { this.search(true); },
  onReachBottom() { if (this.data.searched) this.search(false); },
  async search(reset) {
    if (this.data.loading) return;
    const keyword = this.data.keyword.trim();
    if (!keyword) { wx.showToast({ title: "请输入商品名称、编号、条码或供货来源", icon: "none" }); return; }
    if (reset) this.setData({ list: [], page: 1, hasMore: true, searched: true, error: "" });
    if (!this.data.hasMore) return;
    this.setData({ loading: true });
    try {
      const result = await productService.searchProducts({ keyword, page: this.data.page, pageSize: 20 });
      this.setData({ list: this.data.list.concat(result.list.map(withProductSummary)), page: this.data.page + 1, hasMore: result.hasMore });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  open(e) { wx.navigateTo({ url: `/pages/product-detail/index?id=${e.currentTarget.dataset.id}` }); },
  scanProduct,
}));
