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
assert.equal(app.window.navigationBarTextStyle, "white");
assert.equal(app.window.backgroundColor, "#111317");
assert.equal(app.window.backgroundColorTop, "#111317");
assert.equal(app.window.backgroundColorBottom, "#111317");

for (const item of app.tabBar.list) {
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    assert.equal(fs.existsSync(path.join(root, "miniprogram", `${item.pagePath}.${extension}`)), true, `${item.pagePath}.${extension} missing`);
  }
  assert.equal(fs.existsSync(path.join(root, "miniprogram", item.iconPath)), true, `${item.iconPath} missing`);
  assert.equal(fs.existsSync(path.join(root, "miniprogram", item.selectedIconPath)), true, `${item.selectedIconPath} missing`);
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

console.log("UI restructure tests passed: native five-tab architecture, icons, page files, navigation rules, dark tokens and progressive variant actions.");
