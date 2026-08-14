const { createSaleRequestId } = require("./request-id");

const STORAGE_KEY = "MINGORY_SALE_CART_V1";
const MAX_ITEMS = 15;
const MAX_UNIT_PRICE_CENT = 99999999;
const REQUEST_ID_PATTERN = /^SALE_[A-Za-z0-9_-]{8,80}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return { requestId: createSaleRequestId(), pendingId: "", items: [] };
}

function validItem(item) {
  return item
    && typeof item.variantId === "string"
    && item.variantId
    && Number.isSafeInteger(item.quantity)
    && item.quantity > 0
    && Number.isSafeInteger(item.unitPriceCent)
    && item.unitPriceCent >= 0
    && item.unitPriceCent <= MAX_UNIT_PRICE_CENT
    && (!item.isGift || item.unitPriceCent === 0)
    && typeof item.isGift === "boolean";
}

function getState() {
  try {
    const state = wx.getStorageSync(STORAGE_KEY);
    if (!state || !REQUEST_ID_PATTERN.test(state.requestId) || !Array.isArray(state.items) || !state.items.every(validItem)) return emptyState();
    return clone({ requestId: state.requestId, pendingId: String(state.pendingId || ""), items: state.items.slice(0, MAX_ITEMS) });
  } catch (_) {
    return emptyState();
  }
}

function saveState(state) {
  const safe = clone(state);
  wx.setStorageSync(STORAGE_KEY, safe);
  return safe;
}

function clear() {
  return saveState(emptyState());
}

function addProduct(product, variant) {
  const state = getState();
  const index = state.items.findIndex((item) => item.variantId === variant._id);
  if (index >= 0) {
    state.items[index].quantity += 1;
    return saveState(state);
  }
  if (state.items.length >= MAX_ITEMS) throw new Error(`一张销售单最多包含${MAX_ITEMS}个不同商品规格`);
  state.items.push({
    variantId: variant._id,
    productId: product._id,
    productName: product.name,
    specification: variant.specification || "",
    unit: product.unit || "",
    quantity: 1,
    unitPriceCent: variant.salePriceCent,
    defaultUnitPriceCent: variant.salePriceCent,
    isGift: false,
    stockSnapshot: variant.stock,
  });
  return saveState(state);
}

function updateItem(variantId, patch) {
  const state = getState();
  const index = state.items.findIndex((item) => item.variantId === variantId);
  if (index < 0) return state;
  state.items[index] = { ...state.items[index], ...patch };
  if (!Number.isSafeInteger(state.items[index].quantity) || state.items[index].quantity <= 0) state.items.splice(index, 1);
  return saveState(state);
}

function restorePending(pending) {
  if (!pending || !REQUEST_ID_PATTERN.test(String(pending.requestId || ""))) throw new Error("该挂单的销售编号无效");
  const items = Array.isArray(pending.items) ? pending.items.filter(validItem).slice(0, MAX_ITEMS) : [];
  if (!items.length) throw new Error("该挂单没有可恢复的商品");
  return saveState({ requestId: pending.requestId, pendingId: pending._id, items });
}

function checkoutPayload(state = getState()) {
  return {
    requestId: state.requestId,
    items: state.items.map(({ variantId, quantity, unitPriceCent, isGift }) => ({ variantId, quantity, unitPriceCent, isGift })),
  };
}

function createPendingId() {
  return `PENDING_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

module.exports = { STORAGE_KEY, MAX_ITEMS, getState, clear, addProduct, updateItem, restorePending, checkoutPayload, createPendingId };
