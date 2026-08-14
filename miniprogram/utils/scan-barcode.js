async function scanBarcode() {
  try {
    const result = await wx.scanCode({ scanType: ["barCode"] });
    const barcode = String(result.result || "").trim();
    if (!barcode) {
      wx.showToast({ title: "未识别到有效条形码", icon: "none" });
      return "";
    }
    return barcode;
  } catch (error) {
    if (!String(error.errMsg || error.message).includes("cancel")) {
      wx.showToast({ title: "条形码识别失败，请重试", icon: "none" });
    }
    return "";
  }
}

module.exports = { scanBarcode };
