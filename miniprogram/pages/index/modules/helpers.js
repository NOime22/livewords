/**
 * helpers.js - 通用工具函数
 * 从 index.js 提取的纯函数，无副作用
 */

/**
 * 格式化时间戳为可读字符串
 */
function formatDate(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    const hours = `${date.getHours()}`.padStart(2, "0");
    const minutes = `${date.getMinutes()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * rpx 转 px
 */
function rpxToPx(rpx, windowWidth) {
    const ww = windowWidth || 375;
    return (ww / 750) * rpx;
}

/**
 * 校验单词是否为有效学习单词
 * 排除：单字母、带有特殊符号（·, .）的缩写、包含数字的项
 */
function isValidWord(word) {
    if (!word || typeof word !== 'string') return false;
    const w = word.trim();

    // 1. 长度过短（排除单字母，如 A, B, C）
    if (w.length < 2) return false;

    // 2. 包含非法符号（排除 B · C, B.C., & 等）
    // 允许连字符 - (如 CD-ROM) 和撇号 ' (如 don't)
    if (/[·\.&_]/.test(w)) return false;

    // 3. 包含数字
    if (/\d/.test(w)) return false;

    // 4. 纯大写缩写（可选，但目前保留 CD 等有效词，除非长度很长）
    // 如果想要更严格，可以增加对纯大写的限制

    return true;
}

/**
 * 获取下一个字母
 */
function nextLetter(letter) {
    if (!letter || typeof letter !== 'string') return 'a';
    const ch = letter.toLowerCase();
    if (ch < 'a' || ch > 'z') return 'a';
    return ch === 'z' ? 'a' : String.fromCharCode(ch.charCodeAt(0) + 1);
}

/**
 * 确保单词对象具有正确的数据结构
 */
function ensureWordShape(words) {
    const timestamp = Date.now();

    return words.map((word, index) => {
        let rawCn = Array.isArray(word && word.cnDefs)
            ? word.cnDefs
            : (Array.isArray(word && word.cn_defs) ? word.cn_defs : []);

        // 0. 特殊处理：如果 pos 字段看起来是柯林斯频率（如 v:100, n:20/v:80），且没有 cnDefs，则先清空它以免干扰
        // 实际上 ecdict 中 pos 字段常存频率。我们不能直接把它当做词性显示。

        let cnDefs = [];
        if (Array.isArray(rawCn)) {
            cnDefs = rawCn.map(d => ({ ...d })); // 浅拷贝
        }

        // 1. 清洗现有的 cnDefs
        // 规则：
        // - 移除包含数字、冒号、斜杠的 pos (频率信息)
        // - 移除内容为空的项
        cnDefs = cnDefs.map(def => {
            let pos = def.pos || '';
            // 过滤脏POS：仅过滤明确的频率格式 (如 23% 或 10:1)
            if (/^\d+%$/.test(pos) || /^\d+:\d+$/.test(pos)) {
                pos = '';
            }

            let meanings = def.meanings || [];
            if (typeof meanings === 'string') meanings = [meanings];
            if (!Array.isArray(meanings)) meanings = [];

            // 简单清洗 meaning
            meanings = meanings.map(m => m.trim()).filter(Boolean);

            return { pos, meanings };
        }).filter(def => def.meanings.length > 0 || def.pos);

        // 2. 也是最重要的：如果 cnDefs 为空，或者虽然有值但看起来很乱（meanings里包含词性标签），
        // 则尝试从 translation 重新解析。ECDICT 的 translation 字段往往质量很高。
        const trans = (word && word.translation && typeof word.translation === 'string') ? word.translation.trim() : "";

        // 检测 translation 是否包含结构化词性 (如 "n. xxx vt. xxx")
        const posPattern = /(?:^|\s)(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|int\.|num\.|art\.|aux\.|pl\.|abbr\.)\s*/g;
        const hasStructuredTrans = posPattern.test(trans);

        // 如果现有定义质量不高（没POS，或者POS被过滤了且trans有更好结构），则优先使用 trans 解析结果
        const isCnDefsPoor = cnDefs.length === 0 || cnDefs.every(d => !d.pos);

        if (trans && (isCnDefsPoor || hasStructuredTrans)) {
            const newDefs = [];
            // 重置正则索引
            posPattern.lastIndex = 0;

            if (hasStructuredTrans) {
                // 重新解析 translation
                // 逻辑：按词性分割。split 可能会包含捕获组。
                // split with capturing group: "A n. B vt. C" -> ["A ", "n.", " B ", "vt.", " C"]
                const parts = trans.split(/((?:^|\s)(?:n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|int\.|num\.|art\.|aux\.|pl\.|abbr\.)\s*)/);

                let currentPos = '';
                // 如果第一个部分不是词性，归为 ''

                for (let i = 0; i < parts.length; i++) {
                    let part = parts[i];
                    if (!part) continue;

                    // 检查这部分是否是词性标记
                    // 注意 split 出来的词性标记可能带前导空格，需 trim
                    const trimmed = part.trim();
                    if (/^(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|int\.|num\.|art\.|aux\.|pl\.|abbr\.)$/.test(trimmed)) {
                        currentPos = trimmed;
                    } else {
                        // 是内容
                        const txt = part.trim();
                        // 去除开头的标点（有时 split 会留下点 residual）
                        if (txt && !/^(n\.|v\.|vt\.|vi\.|adj\.|adv\.|prep\.|conj\.|pron\.|int\.|num\.|art\.|aux\.|pl\.|abbr\.)$/.test(txt)) {
                            // 再拆分分号
                            const ms = txt.split(/[；;]/).map(s => s.trim()).filter(s => s && s !== '；' && s !== ';');
                            if (ms.length > 0) {
                                newDefs.push({ pos: currentPos, meanings: ms });
                            }
                        }
                    }
                }
            } else if (cnDefs.length === 0) {
                // 没有词性标记的纯文本，且 cnDefs 为空，则整体作为一条
                const ms = trans.split(/[；;，,、]/).map(s => s.trim()).filter(Boolean);
                if (ms.length) {
                    newDefs.push({ pos: '', meanings: ms });
                }
            }

            // 如果解析出了更有价值的东西，覆盖旧的
            if (newDefs.length > 0) {
                // 只有当新解析的比旧的不仅仅是多一个空 pos 时覆盖
                // 或者旧的完全是空的
                cnDefs = newDefs;
            }
        }

        // 3. 最终格式化 & 过滤人名
        const finalDefs = cnDefs.map(def => ({
            pos: def.pos,
            meanings: def.meanings,
            meaningsText: def.meanings.join('；')
        })).filter(def => {
            // 过滤人名条目 (如 "(Blaze)人名")
            return !def.meaningsText.includes('人名');
        });

        // Calculate content density score for adaptive UI
        // Use existing logic
        const wordText = (word && word.word) || "";
        const phraseList = Array.isArray(word && word.phrases) ? word.phrases : [];
        const meaningsLen = finalDefs.reduce((acc, d) => acc + (d.meaningsText ? d.meaningsText.length : 0), 0);
        const score = (wordText.length * 1.5) + (finalDefs.length * 10) + (phraseList.length * 8) + (meaningsLen * 0.3);

        let densityClass = "density-normal";
        if (score < 25) densityClass = "density-loose";
        else if (score > 55) densityClass = "density-compact";

        return {
            ...word,
            cnDefs: finalDefs,
            densityClass,
            id: word && word.id ? word.id : `${timestamp}-${index}`,
            status: word && word.status ? word.status : "pending",
            reviewCount: typeof (word && word.reviewCount) === "number" ? word.reviewCount : 0,
        };
    });
}

/**
 * 从文本中提取 JSON
 */
function extractJson(s) {
    // 优先尝试提取 ```json ... ``` 代码块
    const fence = s.match(/```\s*json\s*([\{\[\s\S]*?)```/i) || s.match(/```\s*([\{\[\s\S]*?)```/);
    if (fence && fence[1]) {
        const inner = fence[1];
        const a = inner.indexOf("{");
        const b = inner.lastIndexOf("}");
        if (a !== -1 && b !== -1 && b > a) return inner.slice(a, b + 1);
        return inner;
    }

    // 如果没有代码块，寻找最外层的 {}
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    return s.slice(start, end + 1);
}

/**
 * 清洗 JSON 文本中的噪音字符
 */
function sanitizeJsonText(t) {
    if (!t) return t;
    let s = t;
    s = s.replace(/```/g, "");
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");
    s = s.replace(/[≡]/g, "");
    s = s.replace(/[""]/g, '"').replace(/['']/g, "'");
    s = s.replace(/\n\s*#.*$/gm, "");
    return s.trim();
}

/**
 * 尝试解析 AI 返回的 session JSON
 */
function tryParseSession(text, opts) {
    const silent = opts === true || (opts && opts.silent);
    if (!text || typeof text !== "string") return null;
    let json = extractJson(text);
    if (!json) return null;
    json = sanitizeJsonText(json);
    try {
        return JSON.parse(json);
    } catch (_) {
        const noTrailing = json.replace(/,\s*([}\]])/g, "$1");
        try {
            return JSON.parse(noTrailing);
        } catch (e2) {
            if (!silent) console.error("JSON parse error", e2);
            return null;
        }
    }
}

/**
 * 规范化 session 数据结构
 */
function normalizeSession(data, fallbackCount) {
    const count = typeof fallbackCount === "number" ? fallbackCount : 6;
    const words = Array.isArray(data.words) ? data.words : [];

    const normalizedWords = words.slice(0, count).map((w) => {
        let rawDefs = Array.isArray(w && w.cn_defs) ? w.cn_defs : (Array.isArray(w && w.cnDefs) ? w.cnDefs : []);
        const cnDefs = rawDefs.map((d) => {
            let pos = (d && d.pos) || (d && d.part) || (d && d.type) || "";
            if (pos && /^[A-Z]+:\d+$/i.test(pos)) pos = "";
            let meanings = (d && d.meanings) || (d && d.meaning) || (d && d.cn) || (d && d.def) || (d && d.definition) || [];
            if (typeof meanings === "string") {
                meanings = meanings.split(/[；;，,]/).map((s) => s.trim()).filter(Boolean);
            }
            if (!Array.isArray(meanings)) meanings = [];
            return { pos, meanings };
        });

        return {
            word: (w && w.word) || "",
            translation: (w && w.translation) || "",
            phonetic: (w && w.phonetic) || "",
            example: (w && w.example) || "",
            cnDefs: cnDefs,
            phrases: Array.isArray(w && w.phrases) ? w.phrases : [],
        };
    });

    const p = data.paragraph || {};
    return {
        words: normalizedWords,
        paragraph: {
            english: p.english || "",
            mixed: p.mixed || p.english || "",
        },
    };
}

/**
 * 构建 Mock Session（用于设计模式/测试）
 */
function buildMockSession(deck, wordCount) {
    const base = [
        {
            word: "analyze",
            translation: "分析；剖析",
            phonetic: "ˈænəlaɪz",
            cn_defs: [{ pos: "v.", meanings: ["分析", "分解研究", "剖析"] }],
            example: "The researcher will analyze the data to find patterns.",
        },
        {
            word: "access",
            translation: "进入；使用；通道",
            phonetic: "ˈækses",
            cn_defs: [
                { pos: "n.", meanings: ["进入权", "通道"] },
                { pos: "v.", meanings: ["访问", "获取"] },
            ],
            example: "Students have access to the library.",
        },
        {
            word: "benefit",
            translation: "益处；受益",
            phonetic: "ˈbenɪfɪt",
            cn_defs: [
                { pos: "n.", meanings: ["好处", "福利"] },
                { pos: "v.", meanings: ["受益", "使受益"] },
            ],
            example: "Exercise has many health benefits.",
        },
        {
            word: "complex",
            translation: "复杂的；复合体",
            phonetic: "ˈkɒmpleks",
            cn_defs: [
                { pos: "adj.", meanings: ["复杂的", "难解的"] },
                { pos: "n.", meanings: ["复合体", "综合设施"] },
            ],
            example: "This is a complex problem.",
        },
        {
            word: "derive",
            translation: "获得；源自",
            phonetic: "dɪˈraɪv",
            cn_defs: [{ pos: "v.", meanings: ["得到", "导出", "源自"] }],
            example: "We derive energy from food.",
        },
        {
            word: "emerge",
            translation: "出现；显现",
            phonetic: "ɪˈmɜːdʒ",
            cn_defs: [{ pos: "v.", meanings: ["出现", "兴起", "显露"] }],
            example: "New trends emerge every year.",
        },
    ];
    const words = base.slice(0, Math.max(1, wordCount));
    const englishParagraph = `In today's world, we must not abandon our goals. Having access to education brings many benefits. Complex problems emerge constantly, and we derive solutions through careful analysis. Each feature we highlight can generate positive impact, which helps justify our key decisions.`;
    const mixedParagraph = `在当今世界，我们不能 abandon 我们的目标。拥有 access 教育会带来很多 benefits。Complex 的问题不断 emerge，我们通过仔细分析 derive 解决方案。我们 highlight 的每个 feature 都能 generate 积极的 impact，这有助于 justify 我们的 key 决策。`;

    return {
        words,
        paragraph: { english: englishParagraph, mixed: mixedParagraph },
        deck,
        wordCount: words.length,
        generatedAt: Date.now(),
    };
}

module.exports = {
    formatDate,
    rpxToPx,
    nextLetter,
    isValidWord,
    ensureWordShape,
    extractJson,
    sanitizeJsonText,
    tryParseSession,
    normalizeSession,
    buildMockSession,
};
