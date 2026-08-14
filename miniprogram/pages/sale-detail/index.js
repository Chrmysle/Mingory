const { getSale } = require("../../services/statistics");
const { withOrderDetail } = require("../../utils/sales-view");

Page({
  data: { order: null, items: [], loading: true, error: "" },
  onLoad(options) { this.saleId = options.id || ""; if (!this.saleId) return this.setData({ loading: false, error: "缺少销售记录 ID" }); this.load(); },
  async load() {
    try { this.setData(withOrderDetail(await getSale({ orderId: this.saleId }))); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
});
