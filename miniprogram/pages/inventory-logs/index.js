const inventoryService = require("../../services/inventory");
const { formatDateTime } = require("../../utils/date");
const { formatCent } = require("../../utils/money");

const TYPE_LABELS = { SALE: "销售出库", SALE_CANCEL: "销售撤销", STOCK_IN: "商品入库", MANUAL_ADD: "人工增加", MANUAL_SUBTRACT: "人工减少", STOCKTAKE: "盘点调整" };
const withDisplay = (item) => ({
  ...item,
  typeLabel: TYPE_LABELS[item.type] || item.type,
  timeDisplay: formatDateTime(item.createdAt),
  changeDisplay: item.changeQuantity > 0 ? `+${item.changeQuantity}` : String(item.changeQuantity),
  newCostPriceDisplay: Number.isSafeInteger(item.newCostPriceCent) ? formatCent(item.newCostPriceCent) : "",
});

Page({
  data: { product: null, variant: null, list: [], page: 1, hasMore: true, loading: false, error: "", global: false, title: "库存记录", emptyText: "暂无库存记录" },
  onLoad(options) {
    this.variantId = options.variantId || "";
    this.type = options.type === "STOCK_IN" ? "STOCK_IN" : "";
    const global = !this.variantId;
    const title = this.type ? "进货记录" : (global ? "库存流水" : "库存记录");
    this.setData({ global, title, emptyText: this.type ? "暂无进货记录" : "暂无库存记录" });
    wx.setNavigationBarTitle({ title });
    this.reload();
  },
  onPullDownRefresh() { this.reload().finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { this.loadMore(); },
  async reload() { this.setData({ list: [], page: 1, hasMore: true, error: "" }); return this.loadMore(); },
  async loadMore() {
    if (this.data.loading || !this.data.hasMore) return;
    this.setData({ loading: true });
    try {
      const input = { page: this.data.page, pageSize: 20 };
      if (this.variantId) input.variantId = this.variantId;
      if (this.type) input.type = this.type;
      const result = await inventoryService.getInventoryLogs(input);
      this.setData({ product: result.product, variant: result.variant, list: this.data.list.concat(result.list.map(withDisplay)), page: this.data.page + 1, hasMore: result.hasMore });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
});
