const productService = require("../../services/product");
const { checkoutSale, managePendingSales } = require("../../services/sale");
const { getSales } = require("../../services/statistics");
const { withProductSummary } = require("../../utils/product-view");
const { withSaleDisplay } = require("../../utils/sales-view");
const { getPresetRange } = require("../../utils/time-range");
const { formatCent, yuanToCent } = require("../../utils/money");
const cart = require("../../utils/sale-cart");

Page({
  data: {
    user: null,
    keyword: "",
    results: [],
    searched: false,
    searching: false,
    cartItems: [],
    totalQuantity: 0,
    totalAmountDisplay: "0.00",
    pendingSales: [],
    recentSales: [],
    loadingRecent: true,
    loadingPending: false,
    submitting: false,
    savingPending: false,
    checkoutResult: null,
    error: "",
  },

  onLoad() {
    getApp().userReady.then((user) => this.setData({ user })).catch((error) => this.setData({ error: error.message }));
  },

  onShow() {
    this.refreshCart();
    this.loadRecentSales();
    this.loadPendingSales();
  },

  onPullDownRefresh() {
    Promise.all([this.loadRecentSales(), this.loadPendingSales()]).finally(() => wx.stopPullDownRefresh());
  },

  refreshCart() {
    const state = cart.getState();
    const cartItems = state.items.map((item) => ({
      ...item,
      title: item.specification ? `${item.productName} · ${item.specification}` : item.productName,
      unitPriceDisplay: formatCent(item.unitPriceCent),
      lineAmountDisplay: formatCent(item.quantity * item.unitPriceCent),
    }));
    const totalQuantity = state.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmountCent = state.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCent, 0);
    this.cartState = state;
    this.setData({ cartItems, totalQuantity, totalAmountDisplay: formatCent(totalAmountCent) });
  },

  onInput(event) {
    this.setData({ keyword: event.detail.value, results: [], searched: false });
  },

  async search() {
    if (this.data.searching) return;
    const keyword = this.data.keyword.trim();
    if (!keyword) return wx.showToast({ title: "请输入商品名称、规格、编号或条码", icon: "none" });
    this.setData({ searching: true, error: "" });
    try {
      const result = await productService.searchProducts({ keyword, page: 1, pageSize: 12 });
      this.setData({ results: result.list.map(withProductSummary), searched: true });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ searching: false }); }
  },

  async chooseProduct(event) {
    const productId = event.currentTarget.dataset.id;
    if (!productId) return;
    wx.showLoading({ title: "正在读取规格" });
    try {
      const data = await productService.getProduct({ productId });
      const variants = data.variants.filter((item) => item.enabled !== false);
      if (!data.product.enabled || !variants.length) throw new Error("该商品当前不可销售");
      if (variants.length === 1) this.addVariant(data.product, variants[0]);
      else wx.navigateTo({ url: `/pages/product-detail/index?id=${productId}&source=sell` });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { wx.hideLoading(); }
  },

  addVariant(product, variant) {
    try {
      cart.addProduct(product, variant);
      this.setData({ keyword: "", results: [], searched: false, checkoutResult: null });
      this.refreshCart();
      wx.showToast({ title: `已加入 ${variant.specification || product.name}`, icon: "none", duration: 700 });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
  },

  async scanSale() {
    let scanResult;
    try { scanResult = await wx.scanCode({ scanType: ["barCode"] }); }
    catch (error) {
      if (!String(error.errMsg || error.message).includes("cancel")) wx.showToast({ title: "扫码失败，请重试", icon: "none" });
      return;
    }
    const barcode = String(scanResult.result || "").trim();
    if (!barcode) return wx.showToast({ title: "未识别到有效条形码", icon: "none" });
    try {
      const data = await productService.getProduct({ barcode });
      const variant = data.variants.find((item) => item._id === data.matchedVariantId);
      if (!variant || variant.enabled === false || data.product.enabled === false) throw new Error("该商品当前不可销售");
      this.addVariant(data.product, variant);
    } catch (error) {
      if (error.code !== "PRODUCT_NOT_FOUND") return wx.showToast({ title: error.message, icon: "none" });
      const modal = await wx.showModal({ title: "商品尚未录入", content: "该商品尚未录入，是否新增商品？", confirmText: "新增商品" });
      if (modal.confirm) wx.navigateTo({ url: `/pages/product-create/index?barcode=${encodeURIComponent(barcode)}` });
    }
  },

  changeQuantity(event) {
    const variantId = event.currentTarget.dataset.id;
    const delta = Number(event.currentTarget.dataset.delta);
    const item = this.cartState.items.find((row) => row.variantId === variantId);
    if (!item || ![-1, 1].includes(delta)) return;
    cart.updateItem(variantId, { quantity: item.quantity + delta });
    this.refreshCart();
  },

  onPriceBlur(event) {
    const variantId = event.currentTarget.dataset.id;
    const item = this.cartState.items.find((row) => row.variantId === variantId);
    if (!item || item.isGift) return;
    try {
      const unitPriceCent = yuanToCent(event.detail.value);
      cart.updateItem(variantId, { unitPriceCent, regularUnitPriceCent: unitPriceCent });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    this.refreshCart();
  },

  toggleGift(event) {
    const variantId = event.currentTarget.dataset.id;
    const item = this.cartState.items.find((row) => row.variantId === variantId);
    if (!item) return;
    if (item.isGift) {
      cart.updateItem(variantId, { isGift: false, unitPriceCent: item.regularUnitPriceCent == null ? item.defaultUnitPriceCent : item.regularUnitPriceCent });
    } else {
      cart.updateItem(variantId, { isGift: true, regularUnitPriceCent: item.unitPriceCent, unitPriceCent: 0 });
    }
    this.refreshCart();
  },

  async clearCart() {
    if (!this.cartState.items.length) return;
    const modal = await wx.showModal({ title: "清空本次销售", content: "确定清空本次销售吗？", confirmText: "清空", confirmColor: "#ff6b67" });
    if (modal.confirm) { cart.clear(); this.setData({ checkoutResult: null }); this.refreshCart(); }
  },

  async savePending() {
    if (this.data.savingPending || !this.cartState.items.length) return;
    this.setData({ savingPending: true });
    try {
      const pendingId = this.cartState.pendingId || cart.createPendingId();
      await managePendingSales({ action: "save", pendingId, ...cart.checkoutPayload(this.cartState) });
      cart.clear();
      this.refreshCart();
      await this.loadPendingSales();
      wx.showToast({ title: "挂单成功", icon: "success" });
    } catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
    finally { this.setData({ savingPending: false }); }
  },

  async loadPendingSales() {
    if (this.data.loadingPending) return;
    this.setData({ loadingPending: true });
    try {
      const result = await managePendingSales({ action: "list" });
      const pendingSales = result.list.map((item, index) => ({
        ...item,
        displayLabel: `挂单 ${String(result.list.length - index).padStart(2, "0")}`,
        amountDisplay: formatCent(item.totalAmountCent),
      }));
      this.setData({ pendingSales });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loadingPending: false }); }
  },

  async restorePending(event) {
    const pending = this.data.pendingSales[event.currentTarget.dataset.index];
    if (!pending) return;
    if (this.cartState.items.length) {
      const modal = await wx.showModal({ title: "恢复挂单", content: "当前销售单已有商品，恢复后将替换当前内容。是否继续？", confirmText: "恢复" });
      if (!modal.confirm) return;
    }
    try { cart.restorePending(pending); this.setData({ checkoutResult: null }); this.refreshCart(); wx.pageScrollTo({ scrollTop: 0, duration: 0 }); }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
  },

  async removePending(event) {
    const pending = this.data.pendingSales[event.currentTarget.dataset.index];
    if (!pending) return;
    const modal = await wx.showModal({ title: "删除挂单", content: "挂单不会扣库存，确定删除这张挂单吗？", confirmText: "删除", confirmColor: "#ff6b67" });
    if (!modal.confirm) return;
    try { await managePendingSales({ action: "remove", pendingId: pending._id }); await this.loadPendingSales(); }
    catch (error) { wx.showToast({ title: error.message, icon: "none" }); }
  },

  async submitOrder() {
    if (this.data.submitting || !this.cartState.items.length) return;
    this.setData({ submitting: true });
    const state = this.cartState;
    try {
      const result = await checkoutSale(cart.checkoutPayload(state));
      let pendingCleanupFailed = false;
      if (state.pendingId) {
        try { await managePendingSales({ action: "remove", pendingId: state.pendingId }); }
        catch (_) { pendingCleanupFailed = true; }
      }
      cart.clear();
      this.setData({ checkoutResult: { ...result.order, amountDisplay: formatCent(result.order.totalAmountCent) } });
      this.refreshCart();
      await Promise.all([this.loadPendingSales(), this.loadRecentSales()]);
      if (pendingCleanupFailed) wx.showToast({ title: "销售成功，原挂单需手动删除", icon: "none" });
    } catch (error) {
      wx.showModal({ title: "整单销售未完成", content: error.message, showCancel: false });
    } finally { this.setData({ submitting: false }); }
  },

  newSale() { this.setData({ checkoutResult: null }); },

  async loadRecentSales() {
    if (this.data.loadingRecent && this.hasLoadedRecent) return;
    this.hasLoadedRecent = true;
    this.setData({ loadingRecent: true });
    try {
      const result = await getSales({ ...getPresetRange("today"), page: 1, pageSize: 5 });
      this.setData({ recentSales: result.list.map(withSaleDisplay) });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loadingRecent: false }); }
  },

  openOrder(event) { wx.navigateTo({ url: `/pages/sale-detail/index?id=${event.currentTarget.dataset.id}` }); },
  openSales() { wx.navigateTo({ url: "/pages/sales/index" }); },
});
