const productService = require("../../services/product");
const inventoryService = require("../../services/inventory");
const { formatCent, yuanToCent } = require("../../utils/money");
const { withAuth } = require("../../utils/auth-page");
const { createInventoryRequestId } = require("../../utils/request-id");

Page(withAuth({
  data: { product: null, variant: null, quantity: "", newCostPrice: "", remark: "", afterStock: "--", loading: true, submitting: false, error: "", result: null, returnLabel: "返回商品" },
  onLoad(options) {
    this.variantId = options.variantId || "";
    if (options.source === "restock") this.setData({ returnLabel: "返回补货清单" });
    if (options.source === "inventory") this.setData({ returnLabel: "返回库存" });
    this.requestId = createInventoryRequestId("STOCKIN");
    if (!this.variantId) return this.setData({ loading: false, error: "缺少商品规格 ID" });
    this.load();
  },
  async load() {
    try {
      const data = await productService.getProduct({ variantId: this.variantId });
      const variant = data.variants.find((item) => item._id === this.variantId);
      if (!variant) throw new Error("商品规格不存在");
      this.setData({ product: data.product, variant: { ...variant, costPriceDisplay: formatCent(variant.costPriceCent) } }, () => this.updateAfterStock());
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  onInput(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }, () => this.updateAfterStock()); },
  updateAfterStock() {
    const quantity = Number(this.data.quantity);
    this.setData({ afterStock: Number.isSafeInteger(quantity) && quantity > 0 ? this.data.variant.stock + quantity : "--" });
  },
  async submit() {
    if (this.data.submitting || this.data.result) return;
    const quantity = Number(this.data.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return wx.showToast({ title: "入库数量必须是正整数", icon: "none" });
    const input = { requestId: this.requestId, variantId: this.variantId, quantity, remark: this.data.remark.trim() };
    if (this.data.newCostPrice.trim()) {
      try { input.newCostPriceCent = yuanToCent(this.data.newCostPrice); }
      catch (error) { return wx.showToast({ title: error.message, icon: "none" }); }
    }
    this.setData({ submitting: true });
    try {
      const result = await inventoryService.stockIn(input);
      this.setData({ result, "variant.stock": result.currentStock });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ submitting: false }); }
  },
  back() { wx.navigateBack(); },
}));
