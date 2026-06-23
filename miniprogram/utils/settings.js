const WORD_COUNT_MIN = 5;
const WORD_COUNT_MAX = 50;
const WORD_COUNT_DEFAULT = 5;
const WORD_COUNT_STEP = 5;

function clampWordCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return WORD_COUNT_DEFAULT;

  // 🆕 特殊处理：测试模式下的 1 不进行截断
  if (num === 1) return 1;

  // 限制到正确的阶梯值
  const clamped = Math.max(WORD_COUNT_MIN, Math.min(WORD_COUNT_MAX, num));
  return Math.round(clamped / WORD_COUNT_STEP) * WORD_COUNT_STEP;
}

module.exports = {
  WORD_COUNT_MIN,
  WORD_COUNT_MAX,
  WORD_COUNT_DEFAULT,
  WORD_COUNT_STEP,
  clampWordCount,
};
