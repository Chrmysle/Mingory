const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const PLATFORM_FIELDS = ["userInfo", "tcbContext"];
const ALLOWED_FIELDS = ["action", "supplier", "missingSupplier", "includeAll"];
const PAGE_SIZE = 100;
const PRODUCT_ID_BATCH_SIZE = 20;
const MAX_PRODUCTS = 5000;
const MAX_VARIANTS = 10000;
const fail = (code, message) => ({ success: false, code, message });
const cleanText = (value) => String(value == null ? "" : value).trim();

function isRestockItem(variant) {
  return Number.isSafeInteger(variant.stock)
    && variant.stock >= 0
    && Number.isSafeInteger(variant.warningStock)
    && variant.warningStock >= 0
    && variant.stock <= variant.warningStock;
}

function severity(variant) {
  if (variant.stock === 0) return 0;
  if (isRestockItem(variant)) return 1;
  return 2;
}

function compareVariants(left, right) {
  return severity(left) - severity(right)
    || left.stock - right.stock
    || cleanText(left.specification).localeCompare(cleanText(right.specification), "zh-CN");
}

async function readAllProducts() {
  const records = [];
  for (let offset = 0; offset < MAX_PRODUCTS; offset += PAGE_SIZE) {
    const result = await db.collection("products")
      .where({})
      .skip(offset)
      .limit(PAGE_SIZE)
      .field({ _id: true, name: true, unit: true, supplier: true, hasVariants: true, enabled: true })
      .get();
    records.push(...result.data);
    if (result.data.length < PAGE_SIZE) return records;
  }
  throw new Error("product query exceeded safe limit");
}

async function readVariantsByProductIds(productIds) {
  const records = [];
  for (let start = 0; start < productIds.length; start += PRODUCT_ID_BATCH_SIZE) {
    const ids = productIds.slice(start, start + PRODUCT_ID_BATCH_SIZE);
    for (let offset = 0; offset < MAX_VARIANTS; offset += PAGE_SIZE) {
      const result = await db.collection("product_variants")
        .where({ productId: _.in(ids) })
        .skip(offset)
        .limit(PAGE_SIZE)
        .field({
          _id: true,
          productId: true,
          variantCode: true,
          specification: true,
          stock: true,
          warningStock: true,
          enabled: true,
        })
        .get();
      records.push(...result.data);
      if (result.data.length < PAGE_SIZE) break;
      if (offset + PAGE_SIZE >= MAX_VARIANTS) throw new Error("variant query exceeded safe limit");
    }
  }
  return records;
}

function buildGroups(products, variants, includeAll) {
  const variantsByProduct = new Map();
  for (const variant of variants) {
    if (variant.enabled !== true || !Number.isSafeInteger(variant.stock) || variant.stock < 0) continue;
    const list = variantsByProduct.get(variant.productId) || [];
    list.push(variant);
    variantsByProduct.set(variant.productId, list);
  }

  const groups = [];
  for (const product of products) {
    const ownVariants = (variantsByProduct.get(product._id) || [])
      .filter((variant) => includeAll || isRestockItem(variant))
      .sort(compareVariants)
      .map((variant) => {
        const restock = isRestockItem(variant);
        const warningConfigured = Number.isSafeInteger(variant.warningStock) && variant.warningStock >= 0;
        const status = variant.stock === 0 && restock
          ? "OUT_OF_STOCK"
          : (restock ? "LOW_STOCK" : (warningConfigured ? "NORMAL" : "WARNING_UNSET"));
        return {
          variantId: variant._id,
          variantCode: variant.variantCode,
          specification: cleanText(variant.specification),
          stock: variant.stock,
          warningStock: Number.isSafeInteger(variant.warningStock) && variant.warningStock >= 0 ? variant.warningStock : null,
          needsRestock: restock,
          status,
          statusClass: status === "OUT_OF_STOCK" ? "out" : (status === "LOW_STOCK" ? "low" : (status === "NORMAL" ? "normal" : "unset")),
          statusLabel: status === "OUT_OF_STOCK" ? "缺货" : (status === "LOW_STOCK" ? "库存不足" : (status === "NORMAL" ? "库存正常" : "未设置预警")),
        };
      });
    if (!ownVariants.length) continue;
    groups.push({
      productId: product._id,
      name: cleanText(product.name),
      unit: cleanText(product.unit),
      hasVariants: product.hasVariants === true,
      variants: ownVariants,
      restockSkuCount: ownVariants.filter((item) => item.needsRestock).length,
      severity: Math.min(...ownVariants.map((item) => item.status === "OUT_OF_STOCK" ? 0 : (item.needsRestock ? 1 : 2))),
      lowestStock: Math.min(...ownVariants.map((item) => item.stock)),
    });
  }
  groups.sort((left, right) => left.severity - right.severity || left.lowestStock - right.lowestStock || left.name.localeCompare(right.name, "zh-CN"));
  return groups.map(({ severity: _severity, lowestStock: _lowestStock, ...group }) => group);
}

exports.main = async (event) => {
  const { OPENID: openid } = cloud.getWXContext();
  if (!openid) return fail("UNAUTHORIZED", "无法识别当前微信用户");

  const input = event || {};
  const unexpected = Object.keys(input).filter((key) => !ALLOWED_FIELDS.includes(key) && !PLATFORM_FIELDS.includes(key));
  if (unexpected.length) return fail("INVALID_PARAMETER", "包含不允许查询的补货字段");
  const action = cleanText(input.action);
  if (!["overview", "items"].includes(action)) return fail("INVALID_PARAMETER", "补货查询类型无效");
  if (input.missingSupplier != null && typeof input.missingSupplier !== "boolean") return fail("INVALID_PARAMETER", "missingSupplier必须是布尔值");
  if (input.includeAll != null && typeof input.includeAll !== "boolean") return fail("INVALID_PARAMETER", "includeAll必须是布尔值");
  const supplier = cleanText(input.supplier);
  const missingSupplier = input.missingSupplier === true;
  if (supplier.length > 100) return fail("INVALID_PARAMETER", "供货商名称不能超过100个字符");
  if (action === "items" && !missingSupplier && !supplier) return fail("INVALID_PARAMETER", "请选择供货商");

  try {
    const users = await db.collection("users").where({ openid, enabled: true }).limit(2).get();
    if (users.data.length !== 1) return fail("UNAUTHORIZED", "当前用户无权执行此操作");

    const allProducts = (await readAllProducts()).filter((product) => product.enabled === true);

    if (action === "overview") {
      const activeVariants = (await readVariantsByProductIds(allProducts.map((product) => product._id)))
        .filter((variant) => variant.enabled === true);
      const productById = new Map(allProducts.map((product) => [product._id, product]));
      const summaryMap = new Map();
      for (const product of allProducts) {
        const name = cleanText(product.supplier);
        const key = name || "__MISSING__";
        if (!summaryMap.has(key)) summaryMap.set(key, { supplier: name, missingSupplier: !name, productCount: 0, restockSkuCount: 0 });
        summaryMap.get(key).productCount += 1;
      }
      for (const variant of activeVariants) {
        if (!isRestockItem(variant)) continue;
        const product = productById.get(variant.productId);
        if (!product) continue;
        const name = cleanText(product.supplier);
        const key = name || "__MISSING__";
        if (summaryMap.has(key)) summaryMap.get(key).restockSkuCount += 1;
      }
      const urgentItems = activeVariants
        .filter(isRestockItem)
        .map((variant) => {
          const product = productById.get(variant.productId);
          if (!product) return null;
          return {
            productId: product._id,
            variantId: variant._id,
            productName: cleanText(product.name),
            specification: cleanText(variant.specification),
            unit: cleanText(product.unit),
            supplier: cleanText(product.supplier),
            stock: variant.stock,
            warningStock: variant.warningStock,
            status: variant.stock === 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
            statusClass: variant.stock === 0 ? "out" : "low",
            statusLabel: variant.stock === 0 ? "缺货" : "库存不足",
          };
        })
        .filter(Boolean)
        .sort(compareVariants)
        .slice(0, 5);
      const suppliers = [...summaryMap.values()]
        .map((item) => ({ ...item, displayName: item.missingSupplier ? "未设置供货商" : item.supplier }))
        .sort((left, right) => right.restockSkuCount - left.restockSkuCount || Number(left.missingSupplier) - Number(right.missingSupplier) || left.displayName.localeCompare(right.displayName, "zh-CN"));
      return {
        success: true,
        data: {
          suppliers,
          totalRestockSkuCount: suppliers.reduce((sum, item) => sum + item.restockSkuCount, 0),
          outOfStockCount: activeVariants.filter((item) => isRestockItem(item) && item.stock === 0).length,
          lowStockCount: activeVariants.filter((item) => isRestockItem(item) && item.stock > 0).length,
          normalStockCount: activeVariants.filter((item) => Number.isSafeInteger(item.warningStock) && item.warningStock >= 0 && item.stock > item.warningStock).length,
          warningUnsetCount: activeVariants.filter((item) => !Number.isSafeInteger(item.warningStock) || item.warningStock < 0).length,
          totalActiveSkuCount: activeVariants.length,
          urgentItems,
        },
        message: "",
      };
    }

    const selectedProducts = allProducts.filter((product) => {
      const ownSupplier = cleanText(product.supplier);
      return missingSupplier ? !ownSupplier : ownSupplier === supplier;
    });
    const selectedVariants = (await readVariantsByProductIds(selectedProducts.map((product) => product._id)))
      .filter((variant) => variant.enabled === true);
    const restockSkuCount = selectedVariants.filter(isRestockItem).length;
    return {
      success: true,
      data: {
        supplier,
        missingSupplier,
        displayName: missingSupplier ? "未设置供货商" : supplier,
        includeAll: input.includeAll === true,
        restockSkuCount,
        totalSkuCount: selectedVariants.length,
        groups: buildGroups(selectedProducts, selectedVariants, input.includeAll === true),
      },
      message: "",
    };
  } catch (error) {
    console.error("getSupplierRestock failed", {
      action,
      supplier,
      missingSupplier,
      error: String(error && error.message ? error.message : error),
    });
    return fail("DATABASE_ERROR", "补货清单查询失败，请稍后重试");
  }
};
