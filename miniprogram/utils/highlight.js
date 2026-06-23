// Shared rich-text escaping + highlighting for AI paragraphs.

const regexCache = new Map();

function escapeRichText(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n|\r|\n/g, "<br/>");
}

function highlightParagraph(words, paragraph, options = {}) {
  const { highlight = false } = options;
  if (!paragraph) return "";

  const safe = escapeRichText(paragraph);
  if (!highlight) return safe;

  if (!Array.isArray(words) || words.length === 0) return safe;
  const vocabulary = words
    .map((w) => (w && w.word ? w.word.toLowerCase() : ""))
    .filter(Boolean);
  if (vocabulary.length === 0) return safe;

  // 为每个单词生成可能的变形模式
  // 例如 "bore" -> "bore|bores|bored|boring|borer"
  const generateWordPattern = (word) => {
    const base = word.toLowerCase();
    const patterns = [base];

    // 常见后缀变形
    const suffixes = ['s', 'es', 'ed', 'ing', 'er', 'est', 'ly', 'ment', 'ness', 'tion', 'sion'];

    // 直接添加后缀
    suffixes.forEach(suffix => {
      patterns.push(base + suffix);
    });

    // 处理以 e 结尾的词 (bore -> boring, bored)
    if (base.endsWith('e')) {
      const stem = base.slice(0, -1);
      patterns.push(stem + 'ing');
      patterns.push(stem + 'ed');
      patterns.push(stem + 'er');
      patterns.push(stem + 'est');
    }

    // 处理辅音双写 (stop -> stopping, stopped)
    const lastChar = base.slice(-1);
    if (/[bcdfgklmnprstvz]/.test(lastChar) && base.length >= 3) {
      patterns.push(base + lastChar + 'ing');
      patterns.push(base + lastChar + 'ed');
      patterns.push(base + lastChar + 'er');
    }

    // 处理以 y 结尾的词 (carry -> carries, carried)
    if (base.endsWith('y') && base.length > 2) {
      const stem = base.slice(0, -1);
      patterns.push(stem + 'ies');
      patterns.push(stem + 'ied');
      patterns.push(stem + 'ier');
      patterns.push(stem + 'iest');
    }

    // 去重并按长度降序排列（优先匹配长的变形）
    return [...new Set(patterns)].sort((a, b) => b.length - a.length);
  };

  // 为所有单词生成变形模式
  const allPatterns = vocabulary.flatMap(generateWordPattern);
  // 去重并按长度降序（避免短词匹配到长词的一部分）
  const uniquePatterns = [...new Set(allPatterns)].sort((a, b) => b.length - a.length);

  const cacheKey = uniquePatterns.join("|");
  let regex = regexCache.get(cacheKey);
  if (!regex) {
    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = uniquePatterns.map((w) => escapeRegExp(w)).join("|");
    regex = new RegExp(`\\b(${pattern})\\b`, "gi");
    regexCache.set(cacheKey, regex);
    if (regexCache.size > 10) {
      const firstKey = regexCache.keys().next().value;
      regexCache.delete(firstKey);
    }
  }

  const { processHtml } = require("./hyphenator");

  // 1. Highlight keywords
  const processed = safe.replace(
    regex,
    (match) => `<span style="color: #4D96FF; font-weight: bold;">${match}</span>`
  );

  // 2. Inject soft hyphens into all words (keyword or not) to fix justify gaps
  const hyphenated = processHtml(processed);

  // Wrap in a container with lang="en" to enable proper hyphenation
  return `<div lang="en" style="hyphens: auto; -webkit-hyphens: auto;">${hyphenated}</div>`;
}

module.exports = {
  escapeRichText,
  highlightParagraph,
};

