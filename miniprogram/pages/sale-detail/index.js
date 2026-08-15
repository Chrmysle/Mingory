const { getSale, cancelSale: cancelSaleOrder } = require("../../services/statistics");
const { withOrderDetail } = require("../../utils/sales-view");

Page({
  data: { order: null, items: [], loading: true, cancelling: false, error: "" },
  onLoad(options) { this.saleId = options.id || ""; if (!this.saleId) return this.setData({ loading: false, error: "缺少销售记录 ID" }); this.load(); },
  async load() {
    try { this.setData(withOrderDetail(await getSale({ orderId: this.saleId }))); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  async cancelSale() {
    if (this.data.cancelling || !this.data.order || this.data.order.status !== "normal") return;
    const reasons = ["录错商品", "重复录入", "顾客没要", "数量录错", "其他原因"];
    let selected;
    try { selected = await wx.showActionSheet({ itemList: reasons }); }
    catch (_) { return; }
    let reason = reasons[selected.tapIndex] || "";
    if (reason === "其他原因") {
      const custom = await wx.showModal({ title: "填写撤销原因", editable: true, placeholderText: "请输入原因", confirmText: "下一步" });
      if (!custom.confirm) return;
      reason = String(custom.content || "").trim();
      if (!reason) return wx.showToast({ title: "请填写撤销原因", icon: "none" });
    }
    const modal = await wx.showModal({
      title: "撤销销售",
      content: `撤销原因：${reason}\n撤销后将恢复整单库存，并从经营统计中排除。原销售和库存流水仍会保留。`,
      confirmText: "确认撤销",
      confirmColor: "#ff6b67",
    });
    if (!modal.confirm) return;
    this.setData({ cancelling: true });
    try {
      await cancelSaleOrder({ orderId: this.saleId, reason });
      wx.showToast({ title: "销售已撤销", icon: "success" });
      this.setData({ loading: true, error: "" });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ cancelling: false }); }
  },
});
