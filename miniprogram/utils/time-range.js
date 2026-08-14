const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function beijingParts(timestamp = Date.now()) {
  const date = new Date(timestamp + BEIJING_OFFSET_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate(), weekday: date.getUTCDay() };
}

function beijingMidnight(year, month, day) {
  return Date.UTC(year, month, day) - BEIJING_OFFSET_MS;
}

function getPresetRange(type, timestamp = Date.now()) {
  const parts = beijingParts(timestamp);
  const todayStart = beijingMidnight(parts.year, parts.month, parts.day);
  if (type === "today") return { startTime: todayStart, endTime: todayStart + DAY_MS, label: "今天" };
  if (type === "yesterday") return { startTime: todayStart - DAY_MS, endTime: todayStart, label: "昨天" };
  if (type === "week") {
    const daysFromMonday = (parts.weekday + 6) % 7;
    const startTime = todayStart - daysFromMonday * DAY_MS;
    return { startTime, endTime: startTime + 7 * DAY_MS, label: "本周" };
  }
  if (type === "month") {
    return { startTime: beijingMidnight(parts.year, parts.month, 1), endTime: beijingMidnight(parts.year, parts.month + 1, 1), label: "本月" };
  }
  throw new TypeError("时间范围类型无效");
}

function parseDateText(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!match) throw new TypeError("日期格式无效");
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const timestamp = beijingMidnight(year, month, day);
  const verify = beijingParts(timestamp);
  if (verify.year !== year || verify.month !== month || verify.day !== day) throw new TypeError("日期无效");
  return timestamp;
}

function getCustomRange(startDate, endDate) {
  const startTime = parseDateText(startDate);
  const endTime = parseDateText(endDate) + DAY_MS;
  if (endTime <= startTime || endTime - startTime > 366 * DAY_MS) throw new TypeError("日期范围无效，最长支持366天");
  return { startTime, endTime, label: `${startDate} 至 ${endDate}` };
}

function formatBeijingDate(timestamp = Date.now()) {
  const { year, month, day } = beijingParts(timestamp);
  const pad = (value) => String(value).padStart(2, "0");
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

module.exports = { BEIJING_OFFSET_MS, DAY_MS, getPresetRange, getCustomRange, formatBeijingDate };
