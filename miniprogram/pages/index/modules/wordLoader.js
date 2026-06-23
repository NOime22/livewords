/**
 * wordLoader.js - 词汇加载公共模块
 * 为 sessionManager 和 prefetch 提供统一的词汇获取逻辑（步骤1–5）
 */

const { DECK_LIBRARY, DEFAULT_DECK_ID } = require("../../../utils/decks");
const { cloudCall } = require("../../../utils/cloudCall");
const { WORD_COUNT_DEFAULT } = require("../../../utils/settings");
const { isValidWord } = require("./helpers");

const WORD_SELECTION_VERSION = '2026-04-08-strict-letter-window-v2';
const MINI_PROGRAM_DB_PAGE_LIMIT = 20;

function buildOrderedLetterSequence(anchorLetter) {
    const normalizedAnchor = String(anchorLetter || '').trim().toLowerCase();
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const startIdx = letters.indexOf(normalizedAnchor);
    if (startIdx < 0) return letters.split('');

    const orderedLetters = [];
    for (let i = 0; i < 26; i += 1) {
        orderedLetters.push(letters[(startIdx + i) % 26]);
    }
    return orderedLetters;
}

function applyLetterWindowOrder(items, anchorLetter, getWord) {
    const list = Array.isArray(items) ? items.slice() : [];
    const orderedLetters = buildOrderedLetterSequence(anchorLetter);
    const buckets = new Map();
    const fallback = [];

    list.forEach((item) => {
        const rawWord = typeof getWord === 'function' ? getWord(item) : item;
        const normalized = String(rawWord || '').trim().toLowerCase();
        const lead = normalized.match(/[a-z]/);
        if (!lead) {
            fallback.push(item);
            return;
        }
        const letter = lead[0];
        if (!buckets.has(letter)) buckets.set(letter, []);
        buckets.get(letter).push(item);
    });

    const ordered = [];
    orderedLetters.forEach((letter) => {
        const group = buckets.get(letter);
        if (group && group.length) {
            ordered.push(...group);
            buckets.delete(letter);
        }
    });

    for (const group of buckets.values()) {
        ordered.push(...group);
    }

    ordered.push(...fallback);
    return ordered;
}

function getLetterRangeEnd(letter) {
    const normalizedLetter = String(letter || '').trim().toLowerCase();
    if (!normalizedLetter || normalizedLetter < 'a' || normalizedLetter > 'z') {
        return '{';
    }
    return normalizedLetter === 'z'
        ? '{'
        : String.fromCharCode(normalizedLetter.charCodeAt(0) + 1);
}

async function fetchOrderedCandidatesByLetterWindow(db, deckId, orderedLetters, desiredCount, avoidSet, onLetterStats) {
    const filtered = [];
    const existingWords = new Set();
    const command = db.command;

    for (const letter of orderedLetters) {
        if (filtered.length >= desiredCount) break;
        const remaining = desiredCount - filtered.length;
        const pageSize = Math.min(Math.max(remaining * 20, 100), 500);
        const queryLimit = Math.min(pageSize, MINI_PROGRAM_DB_PAGE_LIMIT);
        let offset = 0;
        const rangeEnd = getLetterRangeEnd(letter);
        const letterStats = {
            letter,
            requestedCount: remaining,
            queryLimit,
            pages: 0,
            dbRows: 0,
            accepted: 0,
            skippedAvoid: 0,
            skippedInvalid: 0,
            skippedDuplicate: 0
        };

        while (filtered.length < desiredCount) {
            const letterRes = await db.collection('dictionary')
                .where({
                    bookId: deckId,
                    word: command.gte(letter).and(command.lt(rangeEnd))
                })
                .orderBy('word', 'asc')
                .skip(offset)
                .limit(queryLimit)
                .get();
            const rows = letterRes.data || [];
            letterStats.pages += 1;
            letterStats.dbRows += rows.length;
            if (!rows.length) break;

            rows.forEach((item) => {
                const word = String(item && item.word || '').trim();
                const normalized = word.toLowerCase();
                if (!word || filtered.length >= desiredCount) {
                    return;
                }
                if (!isValidWord(word)) {
                    letterStats.skippedInvalid += 1;
                    return;
                }
                if (avoidSet.has(normalized)) {
                    letterStats.skippedAvoid += 1;
                    return;
                }
                if (existingWords.has(normalized)) {
                    letterStats.skippedDuplicate += 1;
                    return;
                }
                filtered.push(item);
                existingWords.add(normalized);
                letterStats.accepted += 1;
            });

            if (rows.length < queryLimit) break;
            offset += rows.length;
        }

        if (typeof onLetterStats === 'function') {
            onLetterStats({ ...letterStats });
        }
    }

    return filtered;
}

/**
 * 获取激活的词库
 * 优先级：userProfile.settings > page.data > DEFAULT
 */
function getActiveDeck(page, app) {
    let targetId = DEFAULT_DECK_ID;

    if (app && app.globalData && app.globalData.userProfile &&
        app.globalData.userProfile.settings &&
        app.globalData.userProfile.settings.defaultDeckId) {
        targetId = app.globalData.userProfile.settings.defaultDeckId;
    } else if (page && page.data && page.data.currentDeckId) {
        targetId = page.data.currentDeckId;
    }

    return DECK_LIBRARY.find((d) => d.id === targetId) || DECK_LIBRARY[0];
}

/**
 * 获取一批单词（步骤1–5：复习池 → 分配 → 新词 → 补足 → 排序）
 * @param {object} page - 页面实例
 * @param {object} app  - 应用实例
 * @param {object} options - { wordCount?: number } 可选覆盖
 * @returns {Promise<{ words, deck, wordCount, newCount, reviewCount, avoidSet, timestamp }>}
 * @throws 获取失败时 throw，由调用方决定如何处理
 */
async function fetchWordBatch(page, app, options = {}) {
    const deck = getActiveDeck(page, app);
    const wordCount = (typeof options.wordCount === 'number' && !Number.isNaN(options.wordCount))
        ? options.wordCount
        : (page.data.wordCount || WORD_COUNT_DEFAULT);

    const orderMode = options.orderMode ||
        (page && page.data && page.data.currentOrderMode) ||
        'alphabet';
    const orderAlphaLetter = String(
        options.orderAlphaLetter ||
        (page && page.data && page.data.currentOrderAlphaLetter) ||
        'a'
    ).toLowerCase();

    const db = wx.cloud.database();

    // === 1. 获取复习词池 ===
    const reviewRes = await cloudCall('userData', 'getReviewSet', {
        limit: wordCount,
        orderMode,
        orderAlphaLetter,
    }, { silent: true });

    let reviewPool = [];
    let totalReviewableCount = 0;
    if (reviewRes && reviewRes.ok && reviewRes.words && reviewRes.words.length > 0) {
        totalReviewableCount = reviewRes.totalCount || 0;
        // 防御性解包：兼容 { words } 和 { result: { words } } 两种响应格式
        const rawWords = reviewRes.result ? reviewRes.result.words : reviewRes.words;
        reviewPool = (rawWords || []).map((w, idx) => ({
            id: `review-${Date.now()}-${idx}`,
            word: w.word,
            phonetic: w.phonetic || '',
            translation: w.translation || w.definition || '',
            cnDefs: w.pos && !/^[A-Z]+:\d+$/i.test(w.pos)
                ? [{ pos: w.pos, meanings: [w.translation || w.definition || ''] }]
                : [],
            status: 'pending',
            reviewCount: w.reviewCount || 0,
            familiarity: w.familiarity || 0,
            isReview: true
        }));
    }

    // === 2. 确定分配数量 ===
    // 如果总待复习词量 < 30，则不启用混合模式，100% 学习新词
    const reviewLimit = totalReviewableCount < 30 ? 0 : Math.floor(wordCount * 0.3);
    const desiredReviewCount = Math.min(reviewLimit, reviewPool.length);
    const desiredNewCount = wordCount - desiredReviewCount;

    // === 3. 获取新词 ===
    let newWords = [];
    let avoidSet = new Set();
    const letterWindowStats = [];
    const seenWordsCacheCount = app && app.globalData && app.globalData.seenWordsCache instanceof Set
        ? app.globalData.seenWordsCache.size
        : 0;
    const prefetchReservationCount = app && app.globalData && app.globalData.prefetchReservationSet instanceof Set
        ? app.globalData.prefetchReservationSet.size
        : 0;

    if (desiredNewCount > 0) {
        if (typeof app.getSeenWords === 'function') {
            try {
                // 默认优先使用本地 seenWords 缓存；词卡右滑会实时写入缓存
                avoidSet = await app.getSeenWords(false);
            } catch (e) {
                console.error('[WordLoader] getSeenWords failed:', e);
                avoidSet = app.globalData.seenWordsCache || new Set();
            }
        } else {
            avoidSet = app.globalData.seenWordsCache || new Set();
        }

        // 排除本次已选的复习词
        const avoidSetBeforeReview = avoidSet.size;
        reviewPool.forEach(w => avoidSet.add(w.word.toLowerCase()));
        const reviewExcludedCount = Math.max(0, avoidSet.size - avoidSetBeforeReview);

        let filtered = [];
        if (orderMode === 'shuffle' || !orderAlphaLetter) {
            const sampleSize = Math.max(desiredNewCount * 3, 30);
            const dbRes = await db.collection('dictionary')
                .aggregate()
                .match({ bookId: deck.id })
                .sample({ size: sampleSize })
                .end();

            filtered = (dbRes.list || []).filter(item => {
                const w = item.word;
                return isValidWord(w) && !avoidSet.has(w.toLowerCase());
            });
        } else {
            const orderedLetters = buildOrderedLetterSequence(orderAlphaLetter);
            filtered = await fetchOrderedCandidatesByLetterWindow(db, deck.id, orderedLetters, desiredNewCount, avoidSet, (stats) => {
                letterWindowStats.push(stats);
            });
        }

        const orderedNewWords = applyLetterWindowOrder(filtered, orderAlphaLetter, item => item && item.word);
        newWords = orderedNewWords.slice(0, desiredNewCount).map((item, idx) => ({
            id: `new-${Date.now()}-${idx}`,
            word: item.word,
            phonetic: item.phonetic || '',
            translation: item.translation,
            cnDefs: item.pos && !/^[A-Z]+:\d+$/i.test(item.pos)
                ? [{ pos: item.pos, meanings: [item.translation] }]
                : [],
            phrases: [],
            example: '',
            status: 'pending',
            reviewCount: 0,
            familiarity: 0,
            isReview: false
        }));

        console.log('[WordLoader] Avoid set summary:', {
            deckId: deck.id,
            orderMode,
            orderAlphaLetter,
            seenWordsCacheCount,
            prefetchReservationCount,
            reviewExcludedCount,
            avoidSetTotal: avoidSet.size,
            avoidSetSample: Array.from(avoidSet).slice(0, 10)
        });
        if (letterWindowStats.length) {
            console.log('[WordLoader] Letter window stats:', letterWindowStats);
        }
        if (app && typeof app.addDebugTrace === 'function') {
            const story = page && page.data ? page.data.activeStory : null;
            app.addDebugTrace('word-batch-built', {
                storyId: story && story.id ? story.id : '',
                storyEpisode: story && story.currentEpisode ? Number(story.currentEpisode || 0) : 0,
                deckId: deck.id,
                orderMode,
                orderAlphaLetter,
                desiredNewCount,
                desiredReviewCount,
                seenWordsCacheCount,
                prefetchReservationCount,
                reviewExcludedCount,
                avoidSetTotal: avoidSet.size,
                avoidSetSample: Array.from(avoidSet).slice(0, 10),
                letterWindowStats
            });
        }
    }

    // === 4. 混合与二次补足 ===
    let chosenReviewList = reviewPool.slice(0, desiredReviewCount);
    const currentTotal = chosenReviewList.length + newWords.length;
    if (currentTotal < wordCount && reviewPool.length > desiredReviewCount) {
        const extraNeeded = wordCount - currentTotal;
        const extraReviews = reviewPool.slice(desiredReviewCount, desiredReviewCount + extraNeeded);
        chosenReviewList = [...chosenReviewList, ...extraReviews];
    }

    let targetWords = [...newWords, ...chosenReviewList];

    // === 5. 应用排序模式 ===
    if (orderMode === 'alphabet') {
        targetWords.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));
    } else if (orderMode === 'similar') {
        const getDynamicPrefix = (word) => {
            const w = word.toLowerCase();
            const len = w.length;
            const prefixLen = len <= 4 ? 2 : (len <= 6 ? 3 : (len <= 8 ? 4 : 5));
            return w.slice(0, Math.min(prefixLen, len));
        };
        targetWords.sort((a, b) => {
            const prefixA = getDynamicPrefix(a.word);
            const prefixB = getDynamicPrefix(b.word);
            if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
            return a.word.length - b.word.length;
        });
    } else {
        // shuffle
        for (let i = targetWords.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [targetWords[i], targetWords[j]] = [targetWords[j], targetWords[i]];
        }
    }

    if (targetWords.length === 0) {
        throw new Error(`【${deck.name}】词库暂无可用单词！`);
    }

    return {
        words: targetWords,
        deck,
        wordCount: targetWords.length,
        newCount: newWords.length,
        reviewCount: chosenReviewList.length,
        reviewCandidateCount: reviewPool.length,
        selectionVersion: WORD_SELECTION_VERSION,
        avoidSet: Array.from(avoidSet),
        timestamp: Date.now()
    };
}

module.exports = {
    WORD_SELECTION_VERSION,
    getActiveDeck,
    fetchWordBatch,
    buildOrderedLetterSequence,
    applyLetterWindowOrder,
    getLetterRangeEnd,
    fetchOrderedCandidatesByLetterWindow
};
