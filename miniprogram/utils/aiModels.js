// [2026-05-13 模型迁移] 切到 CloudBase 内置 hunyuan-v3 / hy3-preview（走腾讯内网，小程序成长计划内置额度）
// 之前的 deepseek-v4-flash 是一个 DeepSeek 官方和 CloudBase builtin 都不存在的虚拟型号，
// 走 custom 公网 provider 导致极不稳定（单集可卡 30 分钟）。后端 STORY_MODEL_CATALOG 已把所有老名字
// 全部别名到 hy3-preview，前端这里也统一显示新的推荐型号。
const MODEL_OPTIONS = Object.freeze([
  { value: "hy3-preview", label: "腾讯混元 3.0（推荐）" },
  // 以下老条目保留仅为兼容历史存档。settings 页面只渲染 modelOptions[0]，
  // 且 DEFAULT_AI_MODEL 切换后会把用户旧设置自动归一化到 hy3-preview。
  { value: "deepseek-v4-flash", label: "DeepSeek V4 Flash（已下线，自动回退）" },
  { value: "hunyuan-2.0-instruct-20251111", label: "混元 2.0 Instruct（已下线，自动回退）" },
  { value: "hunyuan-turbos-latest", label: "混元 Turbos（已下线，自动回退）" },
  { value: "hunyuan-t1-latest", label: "混元 T1（已下线，自动回退）" },
  { value: "hunyuan-2.0-thinking-20251109", label: "混元 2.0 Thinking（已下线，自动回退）" },
]);

const DEFAULT_AI_MODEL = "hy3-preview";

function getModelIndex(modelName) {
  const list = MODEL_OPTIONS || [];
  const idx = list.findIndex((item) => item && item.value === modelName);
  return idx >= 0 ? idx : 0;
}

module.exports = {
  MODEL_OPTIONS,
  DEFAULT_AI_MODEL,
  getModelIndex,
};
