const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("miniprogram/app.json"));
const expectedTabs = [
  "pages/index/index",
  "pages/sell/index",
  "pages/product-list/index",
  "pages/inventory/index",
  "pages/business-statistics/index",
];

assert.deepEqual(app.tabBar.list.map((item) => item.pagePath), expectedTabs);
assert.equal(app.window.navigationBarTextStyle, "black");
assert.equal(app.window.backgroundColor, "#FFFFFF");
assert.equal(app.window.backgroundColorTop, "#FFFFFF");
assert.equal(app.window.backgroundColorBottom, "#FFFFFF");

for (const item of app.tabBar.list) {
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    assert.equal(fs.existsSync(path.join(root, "miniprogram", `${item.pagePath}.${extension}`)), true, `${item.pagePath}.${extension} missing`);
  }
  assert.equal(fs.existsSync(path.join(root, "miniprogram", item.iconPath)), true, `${item.iconPath} missing`);
  assert.equal(fs.existsSync(path.join(root, "miniprogram", item.selectedIconPath)), true, `${item.selectedIconPath} missing`);
  const pageConfig = JSON.parse(read(`miniprogram/${item.pagePath}.json`));
  assert.equal(pageConfig.backgroundColor, "#FFFFFF", `${item.pagePath} must match the native white first frame`);
  assert.equal(pageConfig.backgroundColorTop, "#FFFFFF", `${item.pagePath} top background must stay white`);
  assert.equal(pageConfig.backgroundColorBottom, "#FFFFFF", `${item.pagePath} bottom background must stay white`);
}

const allPageCode = fs.readdirSync(path.join(root, "miniprogram/pages"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => read(`miniprogram/pages/${entry.name}/index.js`))
  .join("\n");
for (const tab of expectedTabs) {
  assert.equal(new RegExp(`navigateTo\\s*\\(\\s*\\{[^}]*${tab.replaceAll("/", "\\/")}`).test(allPageCode), false, `navigateTo used for tab ${tab}`);
}

const tokens = read("miniprogram/app.wxss");
for (const token of ["--color-bg", "--color-surface", "--color-text-secondary", "--color-text-tertiary", "--color-primary", "--color-success", "--color-warning", "--color-danger"]) {
  assert.equal(tokens.includes(token), true, `${token} missing`);
}
assert.equal(tokens.includes("transition: all"), false);
assert.equal(tokens.includes("overflow-x: hidden"), true);
assert.equal(tokens.includes("max-width: 100%"), true);
assert.match(tokens, /page\s*\{[\s\S]*height:\s*100%;[\s\S]*min-height:\s*100vh;/);
for (const rootClass of [".page-shell", ".home-page", ".form-page", ".page"]) assert.equal(tokens.includes(rootClass), true, `${rootClass} first-frame backing missing`);
for (const pageStyle of ["pages/index/index.wxss", "pages/inventory/index.wxss", "pages/product-list/index.wxss", "pages/business-statistics/index.wxss"]) {
  assert.equal(read(`miniprogram/${pageStyle}`).includes("minmax(0, 1fr)"), true, `${pageStyle} must use shrinkable grid tracks`);
}
assert.equal(read("miniprogram/pages/product-detail/index.wxml").includes("expandedVariantId"), true);
const statisticsPage = read("miniprogram/pages/business-statistics/index.wxml");
for (const marker of ["营业趋势", "销量趋势", "毛利率趋势", "热销排行", "销售额构成", "库存健康", "待补货供货商", "每日经营"]) {
  assert.equal(statisticsPage.includes(marker), true, `statistics section ${marker} missing`);
}
assert.equal(statisticsPage.includes("line-chart"), true);
assert.equal(statisticsPage.includes("donut-chart"), true);
assert.equal(fs.existsSync(path.join(root, "miniprogram/components/line-chart/index.js")), true);
assert.equal(fs.existsSync(path.join(root, "miniprogram/components/donut-chart/index.js")), true);
assert.equal(fs.existsSync(path.join(root, "plans/navigation-ui-restructure.md")), true);
const donutMarkup = read("miniprogram/components/donut-chart/index.wxml");
const donutCode = read("miniprogram/components/donut-chart/index.js");
assert.equal(donutMarkup.includes("<canvas"), false, "donut chart must stay in the normal scroll layer on real devices");
assert.equal(donutMarkup.includes("donut-ring"), true);
assert.equal(donutCode.includes("conic-gradient"), true);

const inventoryPage = read("miniprogram/pages/inventory/index.wxml");
for (const removedEntry of ["进货记录", "库存流水", "库存盘点"]) assert.equal(inventoryPage.includes(removedEntry), false, `${removedEntry} should not remain a standalone inventory entry`);
assert.equal(inventoryPage.includes("进货助手"), true, "进货助手 should remain in inventory hub");
assert.equal(inventoryPage.includes("商品库存"), false, "商品库存 duplicates the product tab and should be removed");
assert.equal(app.pages.includes("pages/inventory-logs/index"), false);
const productDetailPage = read("miniprogram/pages/product-detail/index.wxml");
assert.equal(productDetailPage.includes("调整 / 盘点"), true);
assert.equal(productDetailPage.includes('bindtap="inventoryLogs"'), false);

const homePage = read("miniprogram/pages/index/index.wxml");
for (const marker of ["recentTitle", "recentQuantity", "operatorName", "shortTimeDisplay", "grossProfitDisplay"]) assert.equal(homePage.includes(marker), true, `home recent sale marker ${marker} missing`);
const lineChart = read("miniprogram/components/line-chart/index.js");
assert.equal(lineChart.includes("quantityScale(values)"), true);
assert.equal(lineChart.includes("Math.round(value)"), true);
assert.equal(lineChart.includes("max - range * ratio"), false, "axis labels must use normalized ticks instead of raw repeating decimals");

console.log("UI restructure tests passed: native five-tab architecture, icons, page files, navigation rules, light tokens and progressive variant actions.");
