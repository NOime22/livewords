/**
 * sessionManager.js - 词汇生成和会话管理模块
 */

const { cloudCall } = require('../../../utils/cloudCall');
const { DEFAULT_DECK_ID, DECK_LIBRARY } = require("../../../utils/decks");
const { ensureWordShape, formatDate } = require("./helpers");
const { WORD_SELECTION_VERSION, getActiveDeck, fetchWordBatch } = require("./wordLoader");

const PREVIEW_SIZE = 2;

// 故事保存锁，防止并发保存
let _storySaveLock = false;

function isNetworkError(err) {
    const message = String(err && (err.message || err.errMsg || err)).toLowerCase();
    return message.includes('request:fail') ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('econnreset');
}


/**
 * 刷新词库信息
 */
function refreshDeckInfo(page, deckId) {
    const deck = DECK_LIBRARY.find((d) => d.id === (deckId || page.data.currentDeckId || DEFAULT_DECK_ID)) || DECK_LIBRARY[0];
    page.setData({
        currentDeckId: deck.id,
        currentDeckName: deck.name,
        currentDeckTags: deck.tags,
    });
}

/**
 * 重置完成状态
 */
function resetCompletionState(page, clearTimers, updateRing) {
    if (clearTimers) clearTimers();
    page.completionTriggered = false;
    page.setData({
        ringVisible: true,
        ringPulse: false,
        ringState: "idle",
        showCompletionPrompt: false,
        bounceActive: false,
        paragraphEnglishNodes: [],
        paragraphMixedNodes: [],
        progressLabel: "换一组",
        progressPercent: 0,
        showUnknownTag: false,
        aiFailed: false,
    });
    if (updateRing) updateRing(0);
}

/**
 * 核心生成逻辑
 */
async function handleGenerate(page, app, options = {}) {
    if (page.data.isGenerating) return;

    const { silent = false, targetWordCount } = options;

    let reviewMode = page.data.reviewMode;
    let wordCount = page.data.wordCount;

    if (typeof targetWordCount === 'number' && !Number.isNaN(targetWordCount)) {
        wordCount = targetWordCount;
        if (wordCount !== page.data.wordCount) {
            page.setData({ wordCount, todayGoal: wordCount });
        }
    }

    // 重置状态
    if (typeof page.resetCompletionState === 'function') {
        page.resetCompletionState();
    }

    if (!silent) {
        page.setData({
            uiState: "loading",
            isGenerating: true,
            generationError: "",
            aiFailed: false,
            cardOffsetX: 0,
            cardOffsetY: 0,
            cardRotation: 0,
            cardLeaving: "",
        });
    } else {
        page.setData({ isGenerating: true, aiFailed: false });
    }

    const startTime = Date.now();

    try {
        if (page.data.debug) console.log("[Generate] Start. WordCount:", wordCount, "ReviewMode:", reviewMode);

        if (page && typeof page.waitForPendingWordSyncs === 'function') {
            const syncReady = await page.waitForPendingWordSyncs();
            if (!syncReady) {
                throw new Error('词卡同步未完成，请稍后重试');
            }
        }

        let effectiveOrdering = {
            orderMode: page && page.data ? page.data.currentOrderMode : undefined,
            orderAlphaLetter: page && page.data ? page.data.currentOrderAlphaLetter : undefined,
        };
        if (page && typeof page.ensureProfileSettingsFresh === 'function') {
            const refreshedOrdering = await page.ensureProfileSettingsFresh();
            if (refreshedOrdering && typeof refreshedOrdering === 'object') {
                effectiveOrdering = {
                    orderMode: refreshedOrdering.orderMode,
                    orderAlphaLetter: refreshedOrdering.orderAlphaLetter,
                };
            }
        }

        if (page && page.data) {
            console.log('[Generate] Effective ordering:', {
                orderMode: effectiveOrdering.orderMode,
                orderAlphaLetter: effectiveOrdering.orderAlphaLetter
            });
        }

        const batchResult = await fetchWordBatch(page, app, {
            wordCount,
            orderMode: effectiveOrdering.orderMode,
            orderAlphaLetter: effectiveOrdering.orderAlphaLetter,
        });
        const targetWords = batchResult.words;
        const deck = batchResult.deck;
        const activeStory = page && page.data ? page.data.activeStory : null;

        // 📝 日志：记录生成的单词
        const wordList = targetWords.map(w => w.word).join(', ');
        console.log(`[Generate] Target Words: ${targetWords.length}`);
        console.log(`[Generate] 📋 生成单词: ${wordList}`);

        if (targetWords.length === 0) {
            throw new Error("初始化单词列表失败");
        }

        // ✅ 只要拿到本组单词 + vibe，就立刻发起故事生成（提前于进入词卡页）
        if (page && typeof page.startEpisodeDraftGeneration === 'function') {
            if (activeStory && activeStory.status === 'ongoing') {
                const draftKey = targetWords.map(w => (w && w.word) ? w.word : String(w || '')).join('|');
                if (page._episodeDraftStartedKey !== draftKey) {
                    page._episodeDraftStartedKey = draftKey;
                    page.startEpisodeDraftGeneration(targetWords, deck);
                }
            }
        }

        // Optimistic UI: Show words IMMEDIATELY with placeholder paragraph
        const initialSession = {
            storyId: activeStory && activeStory.id ? activeStory.id : '',
            words: targetWords,
            paragraph: { english: "Creating story...", mixed: "故事生成中..." },
            deck,
            wordCount: targetWords.length,
            wordSelectionVersion: WORD_SELECTION_VERSION,
            generatedAt: Date.now()
        };

        hydrateSession(page, app, initialSession);
        console.log("[Generate] Instant UI access. Starting background AI generation...");
        console.log(`[Generate] 📦 实发单词列表: ${targetWords.map(w => w.word).join(', ')}`);

        // 【Prefetch】清除未使用的预加载数据（因为走了实时查询）
        if (typeof page.invalidatePrefetch === 'function') {
            page.invalidatePrefetch();
        }

        // ✅ 已弃用“非故事模式”的段落生成：
        // Story Mode 的内容生成由 `cloudfunctions/storyData` 负责（草稿 + 重试队列）。

        // 记录日志（静默失败）
        if (app.globalData.userAuthorized) {
            cloudCall('userData', 'logGeneration', {
                mode: reviewMode ? 'review' : 'new',
                deckId: deck.id,
                targetCount: wordCount,
                generatedWords: targetWords.map(w => w.word),
                durationMs: Date.now() - startTime
            }, { silent: true }).catch(e => console.error(e));
        }

    } catch (err) {
        console.error("[Generate] Error:", err);
        const errorMessage = isNetworkError(err)
            ? "异常，请检查网络连接"
            : (err.message || "生成失败，请重试");
        page.setData({
            generationError: errorMessage,
            uiState: "error",
            isGenerating: false
        });
        wx.hideLoading();
        try {
            if (isNetworkError(err)) {
                wx.showToast({ title: "异常，请检查网络连接", icon: "none", duration: 2000 });
            }
        } catch (e) {
            console.warn('[Generate] network toast failed:', e);
        }
    } finally {
        page.setData({ isGenerating: false });
    }
}


/**
 * 异步生成段落（优化版：渐进式解析）
 */
async function generateParagraphAsync(page, app, words, deck, avoidWords = []) {
    console.log("[ParagraphAsync] Starting...");
    if (page && typeof page.setData === 'function') {
        page.setData({ aiFailed: false });
    }
    // 已弃用非故事模式段落生成：Story Mode 由 cloudfunctions/storyData 统一生成章节内容。
    // 保留该函数仅为兼容旧调用点（现在应当没有任何地方再调用）。
    return;
}


/**
 * 填充 Session 数据到页面
 */
function hydrateSession(page, app, sessionPayload, options = {}) {


    const preparedWords = ensureWordShape(sessionPayload.words || []);
    const totalCount = preparedWords.length;
    const knownCount = preparedWords.filter((w) => w.status === "known").length;
    const queue = preparedWords.filter((w) => w.status !== "known");
    const processed = preparedWords.filter((w) => w.status === "known");

    const session = {
        ...sessionPayload,
        words: preparedWords,
    };

    const deckId = options.preserveDeck && page.data.currentDeckId
        ? page.data.currentDeckId
        : (sessionPayload.deck ? sessionPayload.deck.id : undefined);
    const deckMeta = DECK_LIBRARY.find((d) => d.id === (deckId || DEFAULT_DECK_ID)) || DECK_LIBRARY[0];

    if (typeof page.clearCompletionTimers === 'function') {
        page.clearCompletionTimers();
    }
    if (typeof page.resetWordSyncBarrier === 'function') {
        page.resetWordSyncBarrier(preparedWords);
    }
    page.completionTriggered = false;
    app.globalData.lastSession = session;

    const percent = totalCount === 0 ? 0 : (knownCount / totalCount) * 100;

    // 第一阶段：优先渲染单词卡必需数据
    page.setData({
        session,
        currentDeckId: deckMeta.id,
        currentDeckName: deckMeta.name,
        currentDeckTags: deckMeta.tags,
        queue,
        processedCards: processed,
        totalCount,
        knownCount,
        todayCount: knownCount,
        currentCard: queue[0] || null,
        uiState: queue.length ? "ready" : "complete",
        generationError: "",
        aiFailed: false,
        cardOffsetX: 0,
        cardOffsetY: 0,
        cardRotation: 0,
        cardLeaving: "",
    }, () => {

        // 📝 日志：记录显示的单词卡
        const wordList = queue.map(card => card.word).join(', ');
        console.log(`[hydrateSession] 单词卡已渲染，共 ${queue.length} 个词:`);
        console.log(`[hydrateSession] 📋 单词列表: ${wordList}`);

        // 第二阶段：延迟填充预览卡片
        setTimeout(() => {
            page.setData({
                nextCards: queue.slice(1, 1 + PREVIEW_SIZE),
            });
        }, 0);

        // 第三阶段：延迟处理非关键数据
        loadSecondaryData(page, sessionPayload, preparedWords, percent, knownCount, totalCount, queue);
    });
}

/**
 * 延迟加载非关键数据
 */
function loadSecondaryData(page, sessionPayload, preparedWords, percent, knownCount, totalCount, queue) {
    setTimeout(() => {


        const generatedTextTime = formatDate(sessionPayload.generatedAt);

        page.setData({
            progressPercent: Math.round(percent),
            progressLabel: getProgressLabel(percent, knownCount),
            ringState: knownCount > 0 ? (knownCount === totalCount ? "complete" : "progress") : "idle",
            ringVisible: true,
            ringPulse: false,
            showCompletionPrompt: false,
            bounceActive: false,
            generatedTextTime,
            paragraphReady: false,
        }, () => {

        });

        if (typeof page.updateRing === 'function') {
            page.updateRing(percent);
        }

        if (!queue.length && totalCount > 0 && knownCount === totalCount) {
            if (typeof page.triggerCompletionSequence === 'function') {
                page.triggerCompletionSequence();
            }
        }
    }, 100);
}

/**
 * 获取进度标签
 */
function getProgressLabel(percentNumber, knownCount) {
    const pct = Math.round(percentNumber);
    if (!knownCount || pct <= 0) return "换一组";
    return `${pct}%`;
}

/**
 * 更新进度
 */
function updateProgress(page, knownCount, totalCount, queueLength) {
    const percent = totalCount === 0 ? 0 : (knownCount / totalCount) * 100;
    const ringState = knownCount > 0 && knownCount < totalCount ? "progress" : page.data.ringState;

    page.setData({
        knownCount,
        progressPercent: Math.round(percent),
        progressLabel: getProgressLabel(percent, knownCount),
        ringState,
        todayCount: knownCount,
    });

    if (typeof page.updateRing === 'function') {
        page.updateRing(percent);
    }

    if (knownCount === totalCount && totalCount > 0 && queueLength === 0) {
        if (typeof page.triggerCompletionSequence === 'function') {
            page.triggerCompletionSequence();
        }
    }
}

/**
 * 触发完成序列
 */
function triggerCompletionSequence(page) {
    if (page.completionTriggered) return;
    page.completionTriggered = true;

    if (typeof page.prepareParagraphIfNeeded === 'function') {
        page.prepareParagraphIfNeeded(page.data.currentParagraphMode || "en");
    }

    page.setData({
        ringState: "complete",
        ringPulse: false,
        uiState: "complete",
        progressLabel: "Done!",
        ringVisible: false,
        showCompletionPrompt: true,
        bounceActive: true,
    });

    // 【Point 4】动效显示的一瞬间，立刻预加载下一组单词
    if (typeof page.triggerPrefetch === 'function') {
        page.triggerPrefetch();
    }

    if (typeof page.updateRing === 'function') {
        page.updateRing(100);
    }

    // 异步获取实时今日掌握数（延迟确保最后一个单词状态已写入）
    setTimeout(() => {
        cloudCall('userData', 'getDailyMasteredCount', {}, { silent: true }).then(res => {
            console.log('[triggerCompletionSequence] getDailyMasteredCount result:', res);
            if (res && res.ok) {
                const { newWords, reviewWords, total, streak } = res;
                const masteredCount = typeof res.masteredCount === 'number' ? res.masteredCount : null;
                // 根据当前模式自动设置大号数字
                const dailyModeCount = page.data.reviewMode ? reviewWords : newWords;
                const updateData = {
                    dailyMasteredCount: total,
                    dailyModeCount,
                    dailyNewWords: newWords,
                    dailyReviewWords: reviewWords
                };

                // 如果后端返回了 streak，则更新本地显示
                if (typeof streak === 'number') {
                    updateData.streak = streak;
                }

                if (typeof masteredCount === 'number') {
                    updateData['metrics.masteredWords'] = Math.max(0, Math.floor(masteredCount));
                    if (typeof page.persistMasteredStatsCache === 'function') {
                        page.persistMasteredStatsCache(masteredCount);
                    }
                }

                page.setData(updateData);
            }
        }).catch(e => {
            console.error('[triggerCompletionSequence] getDailyMasteredCount failed:', e);
        });
    }, 500);

    const story = page.data.activeStory;
    // Guard: avoid triggering story episode flow when the page is not in an active session
    // (e.g. returning to dashboard and hydrating a completed session).
    if (page.data.isSessionStarted && story && story.status === 'ongoing' && typeof page.handleStoryEpisodeCompleted === 'function') {
        const storyDisplayEpisode = Math.max(1, Number(story.currentEpisode || 1));
        page.setData({ storyDisplayEpisode });
        page.handleStoryEpisodeCompleted();
    }
}

module.exports = {
    PREVIEW_SIZE,
    getActiveDeck,
    refreshDeckInfo,
    resetCompletionState,
    handleGenerate,
    hydrateSession,
    loadSecondaryData,
    getProgressLabel,
    updateProgress,
    triggerCompletionSequence,
};
