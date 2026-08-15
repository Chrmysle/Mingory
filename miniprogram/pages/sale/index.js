const productService = require("../../services/product");
const { saleProduct } = require("../../services/sale");
const { yuanToCent, formatCent } = require("../../utils/money");
const { withAuth } = require("../../utils/auth-page");
const { createSaleRequestId } = require("../../utils/request-id");

Page(withAuth({
  data: {
    product: null,
    variant: null,
    quantity: 1,
    unitPrice: "",
    defaultSalePriceDisplay: "0.00",
    totalAmountDisplay: "0.00",
    loading: true,
    submitting: false,
    error: "",
    result: null,
    source: "",
  },
  onLoad(options) {
    this.variantId = options.variantId || "";
    this.setData({ source: options.source || "" });
    this.requestId = createSaleRequestId();
    if (!this.variantId) {
      this.setData({ loading: false, error: "缺少商品规格 ID" });
      return;
    }
    this.loadVariant();
  },
  async loadVariant() {
    this.setData({ loading: true, error: "" });
    try {
      const data = await productService.getProduct({ variantId: this.variantId });
      const variant = data.variants.find((item) => item._id === this.variantId);
      if (!variant) throw new Error("商品规格不存在");
      const unitPrice = formatCent(variant.salePriceCent);
      this.setData({ product: data.product, variant, unitPrice, defaultSalePriceDisplay: unitPrice }, () => this.updateTotal());
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ loading: false });
    }
  },
  decrease() {
    if (this.data.quantity <= 1) return;
    this.setData({ quantity: this.data.quantity - 1 }, () => this.updateTotal());
  },
  increase() {
    this.setData({ quantity: this.data.quantity + 1 }, () => this.updateTotal());
  },
  onQuantityInput(e) {
    this.setData({ quantity: e.detail.value }, () => this.updateTotal());
  },
  onPriceInput(e) {
    this.setData({ unitPrice: e.detail.value }, () => this.updateTotal());
  },
  updateTotal() {
    try {
      const quantity = Number(this.data.quantity);
      const price = yuanToCent(this.data.unitPrice);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error();
      this.setData({ totalAmountDisplay: formatCent(quantity * price) });
    } catch (_) {
      this.setData({ totalAmountDisplay: "--" });
    }
  },
  async submit() {
    if (this.data.submitting || this.data.result) return;
    const quantity = Number(this.data.quantity);
    let unitPriceCent;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      wx.showToast({ title: "销售数量必须是正整数", icon: "none" });
      return;
    }
    try {
      unitPriceCent = yuanToCent(this.data.unitPrice);
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      const result = await saleProduct({ requestId: this.requestId, variantId: this.variantId, quantity, unitPriceCent });
      this.setData({
        result: {
          ...result,
          amountDisplay: formatCent(result.sale.totalAmountCent),
        },
        "variant.stock": result.remainingStock,
      });
    } catch (error) {
      if (error.code === "INSUFFICIENT_STOCK" && error.data) {
        this.setData({ "variant.stock": error.data.currentStock });
      }
      wx.showToast({ title: error.message, icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
  continueSale() {
    this.requestId = createSaleRequestId();
    const unitPrice = formatCent(this.data.variant.salePriceCent);
    this.setData({ result: null, quantity: 1, unitPrice }, () => this.updateTotal());
  },
  backToProduct() {
    wx.redirectTo({ url: `/pages/product-detail/index?id=${this.data.product._id}&variantId=${this.variantId}` });
  },
  backToSell() { wx.switchTab({ url: "/pages/sell/index" }); },
}));
