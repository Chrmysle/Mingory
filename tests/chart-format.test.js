const assert = require("node:assert/strict");
const path = require("node:path");

let definition;
global.Component = (value) => { definition = value; };
require(path.resolve(__dirname, "../miniprogram/components/line-chart/index.js"));
delete global.Component;

const context = (valueType) => ({ properties: { valueType }, ...definition.methods });
const quantity = context("quantity");
assert.deepEqual(quantity.quantityScale([0, 7]), { min: 0, max: 8, ticks: [8, 6, 4, 2, 0] });
assert.equal(quantity.formatValue(10 / 3), "3");
assert.equal(quantity.formatValue(23), "23");

const money = context("money");
assert.equal(money.formatValue(1200), "¥12");
assert.equal(money.formatValue(1250), "¥12.5");
assert.equal(money.formatValue(1258), "¥12.58");
assert.equal(money.formatValue(1257.999999), "¥12.58");

const percent = context("percent");
assert.equal(percent.formatValue(23.6666), "23.7%");

console.log("Chart formatting tests passed: integer quantity ticks, trimmed cent display and one-decimal percentages.");
