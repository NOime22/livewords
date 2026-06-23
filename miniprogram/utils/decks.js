const DEFAULT_DECK_ID = "book_a2";

const DECK_LIBRARY = [
  {
    id: "book_a1",
    name: "Level A1 (入门级)",
    description: "Oxford 3000™ A1 基础词汇，适合英语初学者",
    focus: "Survival English, basic daily interactions",
    tags: "入门 · 基础 · 必会"
  },
  {
    id: "book_a2",
    name: "Level A2 (初级)",
    description: "Oxford 3000™ A2 进阶词汇，满足日常简单交流",
    focus: "Routine communication, simple descriptions",
    tags: "初级 · 日常 · 巩固"
  },
  {
    id: "book_b1",
    name: "Level B1 (中级)",
    description: "Oxford 3000™ B1 核心词汇，应对大部分旅游/生活场景",
    focus: "Work, school, leisure, travel contexts",
    tags: "中级 · 进阶 · 职场"
  },
  {
    id: "book_b2",
    name: "Level B2 (中高级)",
    description: "Oxford 3000™/5000™ B2 高阶词汇，流畅讨论复杂话题",
    focus: "Technical discussions, abstract topics, fluency",
    tags: "中高 · 流利 · 专业"
  },
  {
    id: "book_c1",
    name: "Level C1 (高级)",
    description: "Oxford 5000™ C1 + 雅思/托福高分词汇，学术专业必备",
    focus: "Academic, professional, implicit meanings",
    tags: "高级 · 学术 · 雅思"
  },
  {
    id: "book_c2",
    name: "Level C2 (精通级)",
    description: "GRE/专八挑战词汇，母语者级别的精准表达",
    focus: "Literary, archaic, complex, nuanced",
    tags: "精通 · GRE · 挑战"
  }
];

function getDeckInfo(deckId) {
  const target = deckId || DEFAULT_DECK_ID;
  return DECK_LIBRARY.find((d) => d.id === target) || DECK_LIBRARY[0];
}

/**
 * Returns the CEFR level for paragraph generation.
 * This is one level BELOW the deck's level to ensure non-target words are simpler.
 * A1 deck stays at A1 (can't go lower).
 */
function getParagraphCefr(deckId) {
  const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const target = deckId || DEFAULT_DECK_ID;
  // Extract level from deck id (e.g., "book_b1" -> "B1")
  const match = target.match(/([abc])([12])/i);
  if (!match) return 'A1';
  const deckLevel = (match[1] + match[2]).toUpperCase();
  const idx = CEFR_ORDER.indexOf(deckLevel);
  // Go one level lower, but not below A1
  const paragraphIdx = Math.max(0, idx - 1);
  return CEFR_ORDER[paragraphIdx];
}

module.exports = {
  DEFAULT_DECK_ID,
  DECK_LIBRARY,
  getDeckInfo,
  getParagraphCefr,
};
