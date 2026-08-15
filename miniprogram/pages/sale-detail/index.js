const { getSale, deleteSale } = require("../../services/statistics");
const { withOrderDetail } = require("../../utils/sales-view");
const { withAuth } = require("../../utils/auth-page");

Page(withAuth({
  data: { order: null, items: [], loading: true, deleting: "", error: "" },
  onLoad(options) { this.saleId = options.id || ""; if (!this.saleId) return this.setData({ loading: false, error: "缺少销售记录 ID" }); this.load(); },
  async load() {
    try { this.setData(withOrderDetail(await getSale({ orderId: this.saleId }))); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  deleteLine(event) {
    const saleId = event.currentTarget.dataset.saleId;
    const item = this.data.items.find((line) => line._id === saleId);
    if (item) this.confirmDelete({ saleId, label: item.specification ? `${item.productName} · ${item.specification}` : item.productName });
  },
  deleteOrder() { this.confirmDelete({ saleId: "", label: "整笔销售" }); },
  async confirmDelete({ saleId, label }) {
    if (this.data.deleting || !this.data.order) return;
    const modal = await wx.showModal({
      title: saleId ? "删除此商品" : "删除这笔销售",
      content: `确定永久删除${label ? `“${label}”` : "这笔销售"}吗？\n\n删除后：\n• 商品库存将恢复\n• 对应销售和库存记录将永久移除\n• 经营统计将自动变化\n\n此操作无法恢复。`,
      confirmText: "永久删除",
      confirmColor: "#ff6b67",
    });
    if (!modal.confirm) return;
    this.setData({ deleting: saleId || "__ORDER__" });
    try {
      const result = await deleteSale({ orderId: this.saleId, ...(saleId ? { saleId } : {}) });
      wx.showToast({ title: "销售已删除", icon: "success" });
      if (result.orderDeleted) return wx.navigateBack();
      this.setData({ loading: true, error: "" }); await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ deleting: "" }); }
  },
}));
