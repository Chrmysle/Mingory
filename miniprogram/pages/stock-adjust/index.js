const productService = require("../../services/product");
const inventoryService = require("../../services/inventory");
const { createInventoryRequestId } = require("../../utils/request-id");

Page({
  data: { product: null, variant: null, type: "MANUAL_ADD", quantity: "", actualStock: "", remark: "", afterStock: "--", loading: true, submitting: false, error: "", result: null },
  onLoad(options) {
    this.variantId = options.variantId || "";
    this.requestId = createInventoryRequestId("ADJUST");
    if (!this.variantId) return this.setData({ loading: false, error: "缺少商品规格 ID" });
    this.load();
  },
  async load() {
    try {
      const data = await productService.getProduct({ variantId: this.variantId });
      const variant = data.variants.find((item) => item._id === this.variantId);
      if (!variant) throw new Error("商品规格不存在");
      this.setData({ product: data.product, variant }, () => this.updateAfterStock());
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  chooseType(e) { this.requestId = createInventoryRequestId("ADJUST"); this.setData({ type: e.currentTarget.dataset.type, quantity: "", actualStock: "", result: null }, () => this.updateAfterStock()); },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }, () => this.updateAfterStock()); },
  updateAfterStock() {
    if (!this.data.variant) return;
    if (this.data.type === "STOCKTAKE") {
      if (!String(this.data.actualStock).trim()) return this.setData({ afterStock: "--" });
      const actual = Number(this.data.actualStock);
      return this.setData({ afterStock: Number.isSafeInteger(actual) && actual >= 0 ? actual : "--" });
    }
    const quantity = Number(this.data.quantity);
    const after = this.data.type === "MANUAL_ADD" ? this.data.variant.stock + quantity : this.data.variant.stock - quantity;
    this.setData({ afterStock: Number.isSafeInteger(quantity) && quantity > 0 && after >= 0 ? after : "--" });
  },
  async submit() {
    if (this.data.submitting || this.data.result) return;
    const remark = this.data.remark.trim();
    const input = { requestId: this.requestId, variantId: this.variantId, type: this.data.type, remark };
    if (this.data.type === "STOCKTAKE") {
      if (!String(this.data.actualStock).trim()) return wx.showToast({ title: "请输入实际库存", icon: "none" });
      const actualStock = Number(this.data.actualStock);
      if (!Number.isSafeInteger(actualStock) || actualStock < 0) return wx.showToast({ title: "实际库存必须是非负整数", icon: "none" });
      input.actualStock = actualStock;
    } else {
      const quantity = Number(this.data.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) return wx.showToast({ title: "调整数量必须是正整数", icon: "none" });
      if (!remark) return wx.showToast({ title: "请填写库存调整原因", icon: "none" });
      input.quantity = quantity;
    }
    this.setData({ submitting: true });
    try {
      const result = await inventoryService.adjustStock(input);
      this.setData({ result, "variant.stock": result.currentStock });
    } catch (error) {
      if (error.code === "INSUFFICIENT_STOCK" && error.data) this.setData({ "variant.stock": error.data.currentStock }, () => this.updateAfterStock());
      wx.showToast({ title: error.message, icon: "none" });
    } finally { this.setData({ submitting: false }); }
  },
  back() { wx.navigateBack(); },
});
