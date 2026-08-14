function assertCent(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("金额必须是大于或等于 0 的整数分");
  }
  return value;
}

function yuanToCent(value) {
  const normalized = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new TypeError("请输入最多两位小数的有效金额");
  }

  const [yuan, decimal = ""] = normalized.split(".");
  const cent = Number(yuan) * 100 + Number(decimal.padEnd(2, "0"));
  return assertCent(cent);
}

function formatCent(value) {
  return (assertCent(value) / 100).toFixed(2);
}

function formatSignedCent(value, thousands = false) {
  if (!Number.isSafeInteger(value)) throw new TypeError("金额必须是整数分");
  const sign = value < 0 ? "-" : "";
  const fixed = (Math.abs(value) / 100).toFixed(2);
  if (!thousands) return `${sign}${fixed}`;
  const [integer, decimal] = fixed.split(".");
  return `${sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimal}`;
}

module.exports = { assertCent, yuanToCent, formatCent, formatSignedCent };
