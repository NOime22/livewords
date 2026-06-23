/**
 * index.js - 主页面（已模块化重构）
 * 
 * 模块结构：
 * - modules/helpers.js      - 通用工具函数
 * - modules/progressRing.js - Canvas 进度环绘制
 * - modules/cardSwipe.js    - 卡片触摸/滑动交互
 * - modules/sessionManager.js - 词汇生成和会话管理
 */

const app = getApp();
const { clampWordCount, WORD_COUNT_DEFAULT } = require("../../utils/settings");
const { DEFAULT_DECK_ID, DECK_LIBRARY, getParagraphCefr } = require("../../utils/decks");
const { highlightParagraph } = require("../../utils/highlight");
const { getWindowMetrics } = require("../../utils/windowInfo");
const { callStoryData } = require("../../utils/cloudCall");
const syncQueue = require("../../utils/syncQueue");

// 导入模块
const { rpxToPx } = require("./modules/helpers");
const { initCanvas, drawProgressRing, updateRing, stopRingAnimation, clearCompletionTimers } = require("./modules/progressRing");
const { createSwipeHandlers, getProgressLabel, SWIPE_THRESHOLD, PREVIEW_SIZE } = require("./modules/cardSwipe");
const sessionManager = require("./modules/sessionManager");
const { prefetchNextBatch } = require("./modules/prefetch");
const { WORD_SELECTION_VERSION } = require("./modules/wordLoader");
const evalWorkbench = require("./modules/evalWorkbench");
const { groupStoryHistory, calculateStoryDrawerHeight, shouldReloadStoryHistory } = require("./modules/storyHistory");
const {
  STORY_STATS_CACHE_KEY,
  normalizeStoryStatsCache,
  buildStoryStatsCachePayload,
  sanitizeCreatedStories,
} = require("./modules/storyStatsCache");
const {
  MASTERED_STATS_CACHE_KEY,
  normalizeMasteredStatsCache,
  buildMasteredStatsCachePayload,
  sanitizeMasteredWords,
} = require("./modules/masteredStatsCache");
const {
  startStoryGenerationTiming,
  markDraftReadyTiming,
  markStoryRenderReadyTiming,
  buildStoryTimingPayload,
} = require("./modules/storyGenerationTiming");

const PERSISTED_SESSION_KEY = 'persisted_Session';
const PERSISTED_PREFETCH_KEY = 'persisted_PrefetchBatch';
const PREFETCH_TTL_MS = 2 * 60 * 60 * 1000;
const LEGACY_THEME_ID_MAP = Object.freeze({
  Suspense: 'Mystery',
  'Sci-Fi': 'SciFi',
  Adventure: 'Fantasy',
  Romance: 'Romance',
  Horror: 'Horror',
  Comedy: 'Comedy',
});

function normalizeThemeId(themeId) {
  const raw = String(themeId || '').trim();
  if (!raw) return 'Fantasy';
  return LEGACY_THEME_ID_MAP[raw] || raw;
}

Page({
  data: {
    // UI State
    isSessionStarted: false,
    uiState: "idle",

    // Dashboard Data
    greeting: "Hello, Friend",
    todayGoal: WORD_COUNT_DEFAULT,
    todayCount: 0,
    dailyModeCount: 0, // 今日累计（学习模式：新词数，复习模式：复习数）
    dailyNewWords: 0,  // 今日新学单词数
    dailyReviewWords: 0, // 今日复习单词数
    dailyMasteredCount: 0, // 今日已掌握（去重总计）
    streak: 0,
    masteredCount: 0, // 完全掌握单词数（familiarity >= 5）

    // Session Data
    designMode: false,
    isGenerating: false,
    generationError: "",
    session: null,
    queue: [],
    processedCards: [],
    currentCard: null,
    nextCards: [],
    knownCount: 0,
    totalCount: 0,
    progressPercent: 0,
    ringState: "idle",

    // Ring
    ringVisible: true,
    ringPulse: false,
    ringDisplaySize: 320,
    ringCanvasPhysicalSize: 320,
    ringStrokeWidth: 28,
    pixelRatio: 1,
    showCompletionPrompt: false,
    bounceActive: false,

    // Card
    cardOffsetX: 0,
    cardOffsetY: 0,
    cardRotation: 0,
    cardLeaving: "",
    isDragging: false,

    // Deck
    currentDeckId: DEFAULT_DECK_ID,
    currentDeckName: DECK_LIBRARY.find(d => d.id === DEFAULT_DECK_ID)?.name || "Level A2 (初级)",
    currentDeckTags: DECK_LIBRARY.find(d => d.id === DEFAULT_DECK_ID)?.tags || "基础 · 日常",
    cefrLevel: "A2",
    wordCount: WORD_COUNT_DEFAULT,

    // UI Flags
    debug: true,
    showUnknownTag: false,
    guideOpacity: 1,
    guideOffsetY: 0,
    sessionVisible: false,
    sessionTranslateY: 100,
    sessionTransitioning: false,
    currentParagraphMode: "en",
    paragraphEnglishNodes: "",
    paragraphMixedNodes: "",
    paragraphReady: false,
    ringActionLock: false,
    reviewMode: false,
    userKnownCount: 0,
    showAuthPrompt: false,
    authLoading: false,
    authFailed: false,
    canIUseGetUserProfile: false,

    // Prefetch State
    prefetchedBatch: null,  // 预加载的批次数据
    prefetchValid: false,   // 预加载是否有效
    prefetchSettings: null, // 预加载时的设置快照

    // Modal State
    showDeckSelectModal: false,
    deckList: DECK_LIBRARY,

    // Story Mode State
    showVibeModal: false,
    selectedVibe: null,
    selectedVibeLabel: '',
    startStoryLoading: false,
    activeStory: null, // 当前故事状态
    storyExpired: false,
    storyReviveEligible: false,
    storyReviveBusy: false,
    storyReviveErrorCode: '',
    vibeChangeMode: false,
    aiFailed: false,
    aiRetrying: false,
    episodeDraft: null,
    episodeDraftStatus: '',
    episodeDraftEpisode: null,
    episodeDraftRetryAt: null,
    episodeDraftRetryDisabled: false,
    episodeDraftRetryLabel: '再试一次',
    episodeDraftLoading: false,
    episodeDraftMock: false,
    episodeDraftPolling: false,
    branchChoiceBusy: false,
    branchChoiceErrorCode: '',
    vibeOptions: [
      {
        id: 'Mystery',
        name: '悬疑',
        icon: '🕵️',
        stamp: 'CLUE',
        blurb: '线索比人先开口',
        mood: '高压追踪',
        accent: '#FFD93D',
        wash: '#FFE872'
      },
      {
        id: 'SciFi',
        name: '科幻',
        icon: '🛸',
        stamp: 'NEXT',
        blurb: '明天已经提前抵达',
        mood: '冷感想象',
        accent: '#4D96FF',
        wash: '#A9CBFF'
      },
      {
        id: 'Fantasy',
        name: '玄幻',
        icon: '🤠',
        stamp: 'QUEST',
        blurb: '门一打开就有地图',
        mood: '热血闯关',
        accent: '#FF9F1C',
        wash: '#FFC85A'
      },
      {
        id: 'Romance',
        name: '爱情',
        icon: '🌇',
        stamp: 'HEART',
        blurb: '人群里藏着心跳声',
        mood: '都会暧昧',
        accent: '#FF6B6B',
        wash: '#FFB7C6'
      },
      {
        id: 'Horror',
        name: '恐怖',
        icon: '👻',
        stamp: 'NIGHT',
        blurb: '安静才是最响的声',
        mood: '夜色逼近',
        accent: '#8E7CFF',
        wash: '#C8BCFF'
      },
      {
        id: 'Comedy',
        name: '喜剧',
        icon: '🤡',
        stamp: 'FUN',
        blurb: '离谱总比无聊强',
        mood: '轻快出梗',
        accent: '#19C37D',
        wash: '#9EEFD0'
      }
    ],

    // Story History Drawer
    showStoryHistoryDrawer: false,
    storyHistoryList: [],
    storyHistoryGroups: [],
    storyHistoryLoading: false,
    storyHistoryDrawerHeight: 320,
    windowHeight: 0,
    safeAreaBottom: 0,
    actionButtonText: '开始瞎编',
    metrics: {
      createdStories: 0,
      masteredWords: 0
    },
    storyDisplayEpisode: 1,
    heroTips: [
      "认识右滑，不认识左滑",
      "学习7组可以获得一篇完整故事",
      "每7天是一个周期"
    ],
    heroTipIndex: 0,
    currentOrderMode: 'alphabet',
    currentOrderAlphaLetter: 'a',

    // Story Eval Workbench
    ...evalWorkbench.getInitialData(),
  },

  // ==================== 生命周期 ====================

  async onLoad() {
    console.log("[onLoad] START - 页面加载开始");
    this.initSystemInfo();
    this.resetWordSyncBarrier();
    try {
      await app.ensureAuthSession();
    } catch (e) {
      console.error('[onLoad] ensureAuthSession failed', e);
    }
    this.refreshAuthPrompt();
    this.maybePromptProfileCompletion();
    this.hydrateStoryStatsFromCache();
    this.hydrateMasteredStatsFromCache();

    if (this.shouldRedirectToAuth()) {
      wx.reLaunch({ url: '/pages/welcome/index' });
      return;
    }

    this.syncUserState();
    this.syncEvalModeState();
    if (this.data.evalModeEnabled) {
      this.loadEvalWorkbenchState();
      await this.restoreEvalRunState();
      return;
    }
    this.refreshDeckInfo();
    // 🆕 同步全局状态（包括测试模式）
    this.setData({
      isAuthorized: !!app.globalData.userAuthorized,
      reviewMode: app.globalData.reviewMode,
      testMode: !!app.globalData.testMode
    });
    const resumed = this.checkResumeSession(false);
    if (!resumed) {
      this.restorePrefetchedBatch();
    }

    console.log("[onLoad] 准备调用 preloadSession");
    this.preloadSession();

    // Load persisted settings
    const cachedMode = wx.getStorageSync('paragraphMode');
    if (cachedMode) {
      const normalizedMode = cachedMode === 'english' ? 'en' : cachedMode;
      this.setData({ currentParagraphMode: normalizedMode });
    }

    if (app.globalData.userAuthorized && typeof app.fetchUserProfile === 'function') {
      app.fetchUserProfile()
        .then(() => this.syncUserState())
        .catch((err) => console.error('[onLoad] refresh profile error:', err));
    }
  },

  onReady() {
    const metrics = getWindowMetrics();
    const pixelRatio = Math.min(3, metrics.pixelRatio || 1);
    const physical = Math.round(this.data.ringDisplaySize * pixelRatio);
    this.setData({ pixelRatio, ringCanvasPhysicalSize: physical });

    // 初始化 Canvas
    initCanvas(this, (ctx) => {
      this.drawProgressRing(this.pendingRingPercent || 0);
    });
  },

  async onShow() {
    try {
      await app.ensureAuthSession();
    } catch (e) {
      console.error('[onShow] ensureAuthSession failed', e);
    }
    this.syncUserState();
    this.syncEvalModeState();
    if (this.data.evalModeEnabled) {
      this.loadEvalWorkbenchState();
      await this.restoreEvalRunState();
      return;
    }
    this.refreshDeckInfo();
    this.refreshAuthPrompt();
    this.maybePromptProfileCompletion();

    if (this.shouldRedirectToAuth()) {
      wx.reLaunch({ url: '/pages/welcome/index' });
      return;
    }

    if (!this.data.ringVisible) {
      this.setData({ ringVisible: true });
    }

    if (!this.canvasReady) {
      this.canvasReady = true;
      this.updateRing(this.data.progressPercent || 0);
    }

    // 如果有设置变更待处理
    if (app.globalData.pendingRegenerate) {
      if (this.data.isSessionStarted) {
        if (!this._pendingSettingsNotified) {
          this._pendingSettingsNotified = true;
          wx.showToast({ title: '设置已保存，将在本轮结束后生效', icon: 'none', duration: 2000 });
        }
      } else {
        this.applyPendingSettings(app.globalData.pendingRegenerate);
        console.log('[onShow] 设置已应用，立刻触发后台预加载...');
        // 此处不 return，让流程继续走到下方的 triggerPrefetch
      }
    }

    if (!this.data.session && app.globalData.lastSession) {
      this.initFromSession();
    }

    if (this.data.prefetchValid && !this.isPrefetchValid()) {
      this.invalidatePrefetch();
    }
    if (!this.data.isSessionStarted && !this.data.prefetchValid) {
      this.restorePrefetchedBatch();
    }

    // 【Prefetch】后台预加载下一批单词（延迟以确保用户档案已加载）
    if (!this.data.isSessionStarted && !this.data.isGenerating) {
      // 延迟 1s，确保 syncUserState/fetchDailyModeCounts 完成
      setTimeout(() => {
        this.triggerPrefetch();
      }, 1000);
    }

    // 【优化】异步获取今日学习/复习数量（同时获取完全掌握数）
    this.fetchDailyModeCounts();

    // 🏷️ 刷新按钮文案
    this.refreshActionButtonText();

    // 🎠 启动引导轮播 (反向滚动)
    this.startHeroCarousel();
  },

  onHide() {
    this.scheduleEpisodeDraftRetryIfNeeded('onHide');
    this.stopEpisodeDraftPolling();
    this.stopHeroCarousel();
  },

  onUnload() {
    this.clearCompletionTimers();
    this.stopEpisodeDraftPolling();
    this.stopHeroCarousel();
    if (this._episodeDraftCooldownTimer) {
      clearInterval(this._episodeDraftCooldownTimer);
      this._episodeDraftCooldownTimer = null;
    }
  },

  // ==================== 初始化方法 ====================

  initSystemInfo() {
    try {
      const metrics = getWindowMetrics();
      const ww = metrics.windowWidth || 375;
      const sizePx = rpxToPx(520, ww);
      const strokePx = Math.max(2, rpxToPx(80, ww));
      this.setData({
        ringDisplaySize: Math.round(sizePx),
        ringStrokeWidth: Math.round(strokePx),
        statusBarHeight: metrics.statusBarHeight || 20,
        windowHeight: metrics.windowHeight || 0,
        safeAreaBottom: metrics.safeAreaBottom || 0,
        greeting: this.getGreetingTime()
      });
    } catch (e) { console.warn('[Index] initSystemInfo error:', e); }
  },

  getGreetingTime() {
    const hr = new Date().getHours();
    if (hr < 12) return "早安，挑战者";
    if (hr < 18) return "午安，挑战者";
    return "晚安，挑战者";
  },

  preloadSession() {
    console.log("[preloadSession] 尝试触发全局预生成");
    if (typeof app.preloadAISession === 'function') {
      setTimeout(() => {
        app.preloadAISession();
      }, 200);
    } else {
      console.warn("[preloadSession] app.preloadAISession 不存在，跳过");
    }
  },

  getValidPersistedSession() {
    const persisted = wx.getStorageSync(PERSISTED_SESSION_KEY);
    if (!persisted || !persisted.session || !Array.isArray(persisted.queue) || persisted.queue.length === 0) {
      return null;
    }

    const timestamp = Number(persisted.timestamp || 0);
    if (!timestamp) {
      return null;
    }

    const now = Date.now();
    if (now - timestamp > PREFETCH_TTL_MS) {
      console.log('[Resume] Persisted session too old, ignoring');
      try { wx.removeStorageSync(PERSISTED_SESSION_KEY); } catch (e) { console.warn('[Resume] removeStorageSync error:', e); }
      return null;
    }

    if (!this.isSessionCompatibleWithActiveStory(persisted.session)) {
      console.log('[Resume] Persisted session story mismatch, ignoring');
      try { wx.removeStorageSync(PERSISTED_SESSION_KEY); } catch (e) { console.warn('[Resume] removeStorageSync error:', e); }
      return null;
    }

    if ((persisted.session.wordSelectionVersion || '') !== WORD_SELECTION_VERSION) {
      console.log('[Resume] Persisted session word-selection version mismatch, ignoring');
      try { wx.removeStorageSync(PERSISTED_SESSION_KEY); } catch (e) { console.warn('[Resume] removeStorageSync error:', e); }
      return null;
    }

    return persisted;
  },

  getValidPrefetchedBatch() {
    const persisted = wx.getStorageSync(PERSISTED_PREFETCH_KEY);
    if (!persisted || !persisted.batch || !Array.isArray(persisted.batch.words) || persisted.batch.words.length === 0) {
      return null;
    }

    const timestamp = Number(persisted.timestamp || 0);
    if (!timestamp) {
      this.clearPersistedPrefetchBatch();
      return null;
    }

    if (Date.now() - timestamp > PREFETCH_TTL_MS) {
      console.log('[Prefetch] Persisted batch expired, ignoring');
      this.traceLearningFlow('prefetch-invalidated', {
        reason: 'expired',
        batchId: persisted.settings && persisted.settings.batchId ? persisted.settings.batchId : '',
        ageMs: Date.now() - timestamp
      });
      this.clearPersistedPrefetchBatch();
      return null;
    }

    const mismatchReason = this.getPrefetchMismatchReason(persisted.settings);
    if (mismatchReason) {
      console.log('[Prefetch] Persisted batch settings mismatch, ignoring', { mismatchReason });
      this.traceLearningFlow('prefetch-invalidated', {
        reason: mismatchReason,
        batchId: persisted.settings && persisted.settings.batchId ? persisted.settings.batchId : '',
        cached: persisted.settings || null
      });
      this.clearPersistedPrefetchBatch();
      return null;
    }

    return persisted;
  },

  persistPrefetchedBatch(batch, settings) {
    if (!batch || !Array.isArray(batch.words) || batch.words.length === 0) return;
    try {
      wx.setStorageSync(PERSISTED_PREFETCH_KEY, {
        batch,
        settings,
        timestamp: Date.now(),
      });
      this.traceLearningFlow('prefetch-persisted', {
        batchId: settings && settings.batchId ? settings.batchId : '',
        storyId: settings && settings.storyId ? settings.storyId : '',
        storyEpisode: settings && settings.storyEpisode ? settings.storyEpisode : 0,
        firstWords: this.summarizeWords(batch.words, 3)
      });
    } catch (e) {
      console.warn('[Prefetch] persist storage failed:', e);
    }
  },

  clearPersistedPrefetchBatch() {
    try {
      wx.removeStorageSync(PERSISTED_PREFETCH_KEY);
    } catch (e) {
      console.warn('[Prefetch] clear storage failed:', e);
    }
  },

  restorePrefetchedBatch() {
    if (this.data.prefetchValid || this.data.prefetchedBatch) {
      return false;
    }

    const persisted = this.getValidPrefetchedBatch();
    if (!persisted) {
      return false;
    }

    this.attachPrefetchDebugMeta(persisted.batch, persisted.settings, { source: 'persisted-restore' });

    this.setData({
      prefetchedBatch: persisted.batch,
      prefetchValid: true,
      prefetchSettings: persisted.settings,
    });
    if (app && typeof app.setPrefetchReservationWords === 'function') {
      app.setPrefetchReservationWords(persisted.batch.words);
    }
    this.traceLearningFlow('prefetch-restored', {
      batchId: persisted.settings && persisted.settings.batchId ? persisted.settings.batchId : '',
      storyId: persisted.settings && persisted.settings.storyId ? persisted.settings.storyId : '',
      storyEpisode: persisted.settings && persisted.settings.storyEpisode ? persisted.settings.storyEpisode : 0,
      firstWords: this.summarizeWords(persisted.batch.words, 3)
    });
    console.log('[Prefetch] Restored persisted batch:', persisted.batch.words.map((w) => w.word).join(', '));
    return true;
  },

  checkResumeSession(autoStart = false) {
    const persisted = this.getValidPersistedSession();
    if (!persisted) {
      return false;
    }

    console.log('[Resume] Found valid persisted session, resuming...');
    console.log('[Resume] 📦 恢复的单词队列:', persisted.queue.map(w => w.word).join(', '));
    this.invalidatePrefetch();

    this.setData({
      isSessionStarted: autoStart,
      session: persisted.session,
      queue: persisted.queue,
      processedCards: persisted.processedCards || [],
      knownCount: persisted.knownCount || 0,
      totalCount: persisted.session.wordCount || WORD_COUNT_DEFAULT,
      currentCard: persisted.queue[0],
      nextCards: persisted.queue.slice(1, 1 + PREVIEW_SIZE),
      uiState: 'ready',
      ringVisible: true
    });

    app.globalData.lastSession = persisted.session;
    this.updateProgress(persisted.knownCount, persisted.session.wordCount, persisted.queue.length);
    this.refreshActionButtonText();
    if (autoStart && this.isStoryOngoing(this.data.activeStory) && typeof this.startEpisodeDraftGeneration === 'function') {
      const words = Array.isArray(persisted.session.words) ? persisted.session.words : [];
      if (words.length > 0) {
        const deck = persisted.session.deck || this.getActiveDeck();
        this.startEpisodeDraftGeneration(words, deck);
      }
    }
    return true;
  },

  /**
   * 🏷️ 刷新首页操作按钮文案
   */
  refreshActionButtonText() {
    const { session, activeStory, isSessionStarted } = this.data;
    const lastSession = app.globalData.lastSession;
    const persisted = this.getValidPersistedSession();

    let text = "开始瞎编";

    // 1. 如果当前就在会话中
    if (session && isSessionStarted) {
      text = "继续瞎编";
    }
    else if (persisted) {
      text = "恢复瞎编";
    }
    else if (lastSession && Array.isArray(lastSession.words)) {
      const unfinishedWords = lastSession.words.filter(w => w.status !== 'known');
      if (unfinishedWords.length > 0) {
        text = "恢复瞎编";
      } else {
        const draftText = this.getEpisodeDraftActionText();
        if (draftText) {
          text = draftText;
        } else if (this.isStoryOngoing(activeStory)) {
          text = "继续瞎编";
        }
      }
    }
    // 3. 如果有故事在进行
    else if (this.getEpisodeDraftActionText()) {
      text = this.getEpisodeDraftActionText();
    } else if (this.isStoryOngoing(activeStory)) {
      text = "继续瞎编";
    }

    if (this.data.actionButtonText !== text) {
      this.setData({ actionButtonText: text });
    }
  },

  getEpisodeDraftActionText() {
    const draft = this.data.episodeDraft;
    const story = this.data.activeStory;
    if (!draft || !story || story.status !== 'ongoing') return null;
    if (draft.storyId && story.id && draft.storyId !== story.id) return null;
    const episodeIndex = draft.episodeIndex || this.data.episodeDraftEpisode || story.currentEpisode;
    if (!episodeIndex) return null;
    if (draft.status === 'ready') {
      return `查看第${episodeIndex}节故事`;
    }
    if (draft.status === 'failed' || draft.status === 'generating' || draft.status === 'pending') {
      return `继续生成第${episodeIndex}节故事`;
    }
    return null;
  },

  hasPendingEpisodeDraft() {
    return !!this.getEpisodeDraftActionText();
  },

  isStoryOngoing(story) {
    if (!story || story.status !== 'ongoing') return false;
    const totalEpisodes = Number(story.totalEpisodes || 7);
    const historyLength = Array.isArray(story.history) ? story.history.length : 0;
    const currentEpisode = Number(story.currentEpisode || 1);
    if (historyLength >= totalEpisodes) return false;
    if (currentEpisode > totalEpisodes) return false;
    return true;
  },

  normalizeStoryEpisode(value) {
    const episode = Number(value || 0);
    return Number.isFinite(episode) && episode > 0 ? episode : 0;
  },

  getPrefetchTargetStoryEpisode(options = {}) {
    const explicitEpisode = this.normalizeStoryEpisode(options.targetStoryEpisode);
    if (explicitEpisode) {
      return explicitEpisode;
    }

    const story = this.data.activeStory;
    if (!this.isStoryOngoing(story)) {
      return 0;
    }

    return this.normalizeStoryEpisode(story.currentEpisode || 1);
  },

  applyPendingSettings(pending) {
    if (!pending) return;
    if (pending.deckId && pending.deckId !== this.data.currentDeckId) {
      this.setData({ currentDeckId: pending.deckId });
      this.refreshDeckInfo(pending.deckId);
    }
    if (pending.wordCount && pending.wordCount !== this.data.wordCount) {
      this.setData({ wordCount: pending.wordCount, todayGoal: pending.wordCount });
    }
    if (typeof pending.testMode === 'boolean') {
      this.setData({ testMode: pending.testMode });
      app.globalData.testMode = pending.testMode;
    }
    if (pending.orderMode && pending.orderMode !== this.data.currentOrderMode) {
      this.setData({ currentOrderMode: pending.orderMode });
    }
    if (pending.orderAlphaLetter) {
      const nextLetter = String(pending.orderAlphaLetter).toLowerCase();
      if (nextLetter !== this.data.currentOrderAlphaLetter) {
        this.setData({ currentOrderAlphaLetter: nextLetter });
      }
    }
    this.invalidatePrefetch();
    app.globalData.pendingRegenerate = null;
    app.globalData.lastSession = null;
    this.setData({ session: null, aiFailed: false });
    this._pendingSettingsNotified = false;
  },

  syncEvalModeState() { return evalWorkbench.syncEvalModeState(this, app); },

  loadEvalWorkbenchState() { return evalWorkbench.loadEvalWorkbenchState(this, app); },

  handleEvalModeChange(enabled) { return evalWorkbench.handleEvalModeChange(this, app, enabled); },

  applyEvalRunState(run, episodeOverride) { return evalWorkbench.applyEvalRunState(this, app, run, episodeOverride); },

  async recoverEvalRunAfterTimeout(runId, previousRun) { return evalWorkbench.recoverEvalRunAfterTimeout(this, app, runId, previousRun); },

  async restoreEvalRunState() { return evalWorkbench.restoreEvalRunState(this, app); },

  onEvalChainChange(e) { return evalWorkbench.onEvalChainChange(this, app, e); },

  async handleStartEval() { return evalWorkbench.handleStartEval(this, app); },

  isStoryTimeoutError(error) {
    const message = String(
      (error && (error.errMsg || error.message || error.toString && error.toString())) || ""
    );
    return /ESOCKETTIMEDOUT|resource server timeout|cloud\.callFunction:fail/i.test(message);
  },

  async recoverEpisodeDraftAfterTimeout(storyId, episodeIndex) {
    if (!storyId || !episodeIndex) return null;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const retryDelays = [0, 1500, 3000, 5000, 8000];

    for (let i = 0; i < retryDelays.length; i += 1) {
      if (retryDelays[i] > 0) {
        await wait(retryDelays[i]);
      }
      const recovered = await callStoryData("getEpisodeDraft", { storyId, episodeIndex }, { silent: true });
      if (!recovered || recovered.ok === false || !recovered.draft) {
        continue;
      }
      const draft = recovered.draft;
      if (draft.status === "ready" || draft.status === "generating" || draft.status === "pending") {
        this.applyEpisodeDraftToSession(draft);
        return draft;
      }
    }

    return null;
  },

  syncUserState() {
    const reviewMode = app.globalData.reviewMode || false;
    const userProfile = app.globalData.userProfile;
    const userKnownCount = userProfile && userProfile.counters ? userProfile.counters.known : 0;
    const streak = userProfile && userProfile.counters ? (userProfile.counters.streak || 0) : 0;
    const settings = userProfile && userProfile.settings ? userProfile.settings : {};
    const isTestMode = !!settings.testMode || !!app.globalData.testMode;
    const rawDailyNew = settings && typeof settings.dailyNewCount === 'number' ? settings.dailyNewCount : null;
    let cached = null;
    try { cached = wx.getStorageSync('userProfileCache') || {}; } catch (e) { cached = null; }
    const cachedNormal = cached && typeof cached.normalWordCount === 'number'
      ? clampWordCount(cached.normalWordCount)
      : (cached && typeof cached.testModeWordCount === 'number' ? clampWordCount(cached.testModeWordCount) : null);
    let dailyNew = typeof settings.dailyNewCount === 'number' ? clampWordCount(settings.dailyNewCount) : null;
    // 修复异常：非测试模式下不允许 dailyNew=1/空值，优先使用缓存的正常值
    if (!isTestMode) {
      if (dailyNew === 1 || dailyNew == null) {
        dailyNew = cachedNormal || dailyNew || WORD_COUNT_DEFAULT;
      }
    }
    const effectiveWordCount = isTestMode ? 1 : dailyNew;
    const defaultDeckId = settings.defaultDeckId;
    const cefrLevel = settings.cefrLevel;

    const nextData = {
      reviewMode,
      userKnownCount,
      streak,
      todayCount: this.data.todayCount,
      testMode: isTestMode, // 🆕 同步测试模式状态
      currentOrderMode: settings.orderMode || 'alphabet',
      currentOrderAlphaLetter: (settings.orderAlphaLetter || 'a').toLowerCase(),
    };
    app.globalData.testMode = isTestMode;

    if (effectiveWordCount && effectiveWordCount > 0 && effectiveWordCount !== this.data.wordCount) {
      nextData.wordCount = effectiveWordCount;
      nextData.todayGoal = effectiveWordCount;
      nextData.todayCount = Math.min(nextData.todayCount || 0, effectiveWordCount);
    }
    if (defaultDeckId && defaultDeckId !== this.data.currentDeckId) {
      nextData.currentDeckId = defaultDeckId;
      nextData.currentDeckName = (DECK_LIBRARY.find(d => d.id === defaultDeckId) || {}).name || this.data.currentDeckName;
      nextData.currentDeckTags = (DECK_LIBRARY.find(d => d.id === defaultDeckId) || {}).tags || this.data.currentDeckTags;
    }
    if (cefrLevel && cefrLevel.toUpperCase() !== this.data.cefrLevel) {
      nextData.cefrLevel = cefrLevel.toUpperCase();
    }

    this.setData(nextData);

    // 修复云端异常：测试模式关闭但 dailyNewCount 为 1
    if (!isTestMode && rawDailyNew === 1 && app.globalData.userAuthorized && dailyNew && dailyNew !== 1) {
      try {
        wx.cloud.callFunction({
          name: 'userData',
          data: { action: 'updateSettings', settings: { dailyNewCount: dailyNew } }
        }).catch((err) => {
          console.warn('[Index] updateSettings sync failed:', err);
        });
      } catch (e) {
        console.warn('[Index] updateSettings call failed:', e);
      }
    }
  },

  async ensureProfileSettingsFresh() {
    const previousOrderMode = this.data.currentOrderMode || 'alphabet';
    const previousOrderAlphaLetter = (this.data.currentOrderAlphaLetter || 'a').toLowerCase();
    if (!(app.globalData.userAuthorized && typeof app.fetchUserProfile === 'function')) {
      this.syncUserState();
      return {
        orderMode: previousOrderMode,
        orderAlphaLetter: previousOrderAlphaLetter
      };
    }
    try {
      await app.fetchUserProfile();
      this.syncUserState();
      return this.getAuthoritativeOrderingSettings();
    } catch (err) {
      console.error('[Index] ensureProfileSettingsFresh failed:', err);
      this.setData({ currentOrderMode: previousOrderMode, currentOrderAlphaLetter: previousOrderAlphaLetter });
      return {
        orderMode: previousOrderMode,
        orderAlphaLetter: previousOrderAlphaLetter
      };
    }
  },

  getAuthoritativeOrderingSettings() {
    const profileSettings = app.globalData.userProfile && app.globalData.userProfile.settings
      ? app.globalData.userProfile.settings
      : null;
    const pageOrderMode = this.data.currentOrderMode || 'alphabet';
    const pageOrderAlphaLetter = (this.data.currentOrderAlphaLetter || 'a').toLowerCase();
    const rawMode = profileSettings && typeof profileSettings.orderMode === 'string'
      ? profileSettings.orderMode
      : pageOrderMode;
    const orderMode = rawMode === 'similar' || rawMode === 'shuffle' ? rawMode : 'alphabet';
    const rawLetter = profileSettings && typeof profileSettings.orderAlphaLetter === 'string'
      ? profileSettings.orderAlphaLetter
      : pageOrderAlphaLetter;
    const normalizedLetter = String(rawLetter || '').trim().toLowerCase();
    const orderAlphaLetter = /^[a-z]$/.test(normalizedLetter) ? normalizedLetter : 'a';
    return { orderMode, orderAlphaLetter };
  },

  initFromSession() {
    const existing = app.globalData.lastSession;
    if (!existing || !Array.isArray(existing.words) || existing.words.length === 0) {
      this.handleGenerate({ reason: "initial" });
      return;
    }
    if (!this.isSessionCompatibleWithActiveStory(existing)) {
      console.log('[Resume] lastSession story mismatch, dropping memory session');
      app.globalData.lastSession = null;
      return;
    }
    // Don't resurrect a fully-completed session on the dashboard. It can accidentally
    // trigger "completion" side-effects (prefetch / story episode hooks) after story return.
    const unfinished = existing.words.filter(w => w && w.status !== 'known');
    if (unfinished.length === 0) {
      app.globalData.lastSession = null;
      return;
    }
    sessionManager.hydrateSession(this, app, existing, { preserveDeck: true });
  },

  // ==================== 词库方法 ====================

  getActiveDeck() {
    return sessionManager.getActiveDeck(this);
  },

  refreshDeckInfo(deckId) {
    sessionManager.refreshDeckInfo(this, deckId);
  },

  // ==================== 会话控制 ====================

  startSession() {
    console.log("[startSession] 开始执行");

    // 🔧 修复：检查是否有未完成的会话
    let existingSession = app.globalData.lastSession;

    // 🔧 如果没有，尝试从 localStorage 恢复（双重保险）
    if (!existingSession) {
      try {
        const persisted = wx.getStorageSync(PERSISTED_SESSION_KEY);
        if (persisted && persisted.session && persisted.timestamp) {
          // 检查是否过期（24小时）
          const age = Date.now() - persisted.timestamp;
          if (age < 24 * 60 * 60 * 1000) {
            existingSession = persisted.session;
            console.log("[startSession] 从 localStorage 恢复会话");
          }
        }
      } catch (e) {
        console.error("[startSession] localStorage 恢复失败:", e);
      }
    }

    if (existingSession && !this.isSessionCompatibleWithActiveStory(existingSession)) {
      console.log('[startSession] Ignore stale session from another story');
      existingSession = null;
      app.globalData.lastSession = null;
      try { wx.removeStorageSync(PERSISTED_SESSION_KEY); } catch (e) { console.warn('[startSession] removeStorageSync error:', e); }
    }

    const persisted = this.getValidPersistedSession();
    if (persisted && persisted.session && Array.isArray(persisted.queue) && persisted.queue.length > 0) {
      console.log("[startSession] 使用持久化 queue 精确恢复未完成 session");
      this.checkResumeSession(true);
      return;
    }

    if (existingSession && Array.isArray(existingSession.words)) {
      const unfinishedWords = existingSession.words.filter(w => w.status !== 'known');

      if (unfinishedWords.length > 0) {
        console.log(`[startSession] 检测到未完成的会话，剩余 ${unfinishedWords.length} 个单词`);
        // 恢复未完成的会话，而不是清空
        this.setData({ isSessionStarted: true });
        sessionManager.hydrateSession(this, app, existingSession, { preserveDeck: true });
        if (this.isStoryOngoing(this.data.activeStory) && typeof this.startEpisodeDraftGeneration === 'function') {
          const deck = existingSession.deck || this.getActiveDeck();
          this.startEpisodeDraftGeneration(existingSession.words, deck);
        }
        return; // 🔧 关键：直接返回，不继续执行下面的逻辑
      }
    }

    // 只有当没有未完成的会话时，才清空并生成新的
    app.globalData.lastSession = null;
    app.globalData.pendingRegenerate = null;

    this.setData({
      isSessionStarted: true,
      session: null
    });

    console.log("[startSession] 使用 Fixed Dictionary 模式");

    //【Prefetch】优先使用预加载数据
    if (this.isPrefetchValid()) {
      console.log("[start Session] 使用预加载数据 ✅");
      this.usePreloadedBatch();
    } else {
      console.log("[startSession] 预加载无效，实时查询");
      this.handleGenerate({ reason: "start" });
    }
    this.refreshActionButtonText();
  },

  exitSession() {
    console.log("[exitSession] 退出 session，保留状态以便恢复");

    // 🔧 不再清空 lastSession，保留当前会话状态供下次恢复
    // app.globalData.lastSession = null;

    // 只清空页面显示状态
    this.setData({
      isSessionStarted: false,
      session: null,
      queue: [],
      currentCard: null,
      nextCards: [],
      uiState: "idle"
    });
    this.refreshActionButtonText();
    if (app.globalData.pendingRegenerate) {
      this.applyPendingSettings(app.globalData.pendingRegenerate);
    }
  },

  resetSessionForNewCycle() {
    try { wx.removeStorageSync(PERSISTED_SESSION_KEY); } catch (e) { console.warn('[Reset] removeStorage error:', e); }
    app.globalData.lastSession = null;
    this._aiGenerationPromise = null;
    this.clearEpisodeDraftState();
    if (typeof this.clearCompletionTimers === 'function') {
      this.clearCompletionTimers();
    }
    this.invalidatePrefetch();
    this.setData({
      isSessionStarted: false,
      session: null,
      queue: [],
      processedCards: [],
      currentCard: null,
      nextCards: [],
      uiState: "idle",
      ringState: "idle",
      ringVisible: true,
      ringPulse: false,
      showCompletionPrompt: false,
      bounceActive: false,
      paragraphReady: false,
      generationError: "",
      aiFailed: false,
      sessionVisible: false,
      sessionTranslateY: 100,
      sessionTransitioning: false,
      sessionScrollTop: 0
    });
    this.refreshActionButtonText();
  },

  handleContinueSession() {
    console.log("[handleContinueSession] 继续学习/复习");

    if (app.globalData.pendingRegenerate) {
      this.applyPendingSettings(app.globalData.pendingRegenerate);
    }

    const story = this.data.activeStory;

    // 原有逻辑：重置状态为加载中，显示 Loading Spinner
    this.setData({
      uiState: 'loading',
      session: null,
      queue: [],
      currentCard: null,
      nextCards: []
    });
    const persisted = this.getValidPersistedSession();
    const unfinishedSession = persisted && persisted.session && Array.isArray(persisted.queue) && persisted.queue.length > 0
      ? persisted
      : null;

    if (unfinishedSession) {
      console.log("[handleContinueSession] 优先恢复未完成 session ✅");
      console.log("[handleContinueSession] 📦 恢复剩余单词:", unfinishedSession.queue.map(w => w.word).join(', '));
      this.traceLearningFlow('continue-source-selected', {
        source: 'unfinished-session',
        storyId: unfinishedSession.session && unfinishedSession.session.storyId ? unfinishedSession.session.storyId : '',
        firstWords: this.summarizeWords(unfinishedSession.queue, 3)
      });
      this.checkResumeSession(true);
      return;
    }

    const hasPrefetchedBatch = !!(
      this.data.prefetchedBatch &&
      Array.isArray(this.data.prefetchedBatch.words) &&
      this.data.prefetchedBatch.words.length > 0
    );

    if (hasPrefetchedBatch && this.isPrefetchValid()) {
      console.log("[handleContinueSession] 强制使用预加载数据 ✅");
      console.log("[handleContinueSession] 📦 继续学习命中预加载词:", this.data.prefetchedBatch.words.map(w => w.word).join(', '));
      this.traceLearningFlow('continue-source-selected', {
        source: 'prefetched-batch',
        batchId: this.data.prefetchSettings && this.data.prefetchSettings.batchId ? this.data.prefetchSettings.batchId : '',
        storyId: this.data.prefetchSettings && this.data.prefetchSettings.storyId ? this.data.prefetchSettings.storyId : '',
        storyEpisode: this.data.prefetchSettings && this.data.prefetchSettings.storyEpisode ? this.data.prefetchSettings.storyEpisode : 0,
        firstWords: this.summarizeWords(this.data.prefetchedBatch.words, 3)
      });
      this.usePreloadedBatch();
      return;
    }

    if (hasPrefetchedBatch) {
      console.log('[handleContinueSession] Discard stale prefetch before continuing');
      this.traceLearningFlow('continue-source-selected', {
        source: 'stale-prefetch-discarded',
        batchId: this.data.prefetchSettings && this.data.prefetchSettings.batchId ? this.data.prefetchSettings.batchId : '',
        reason: this.getPrefetchMismatchReason(this.data.prefetchSettings) || 'unknown'
      });
      this.invalidatePrefetch();
    }

    console.log("[handleContinueSession] 无预加载批次，实时查询");
    this.traceLearningFlow('continue-source-selected', {
      source: 'realtime-fetch',
      storyId: this.data.activeStory && this.data.activeStory.id ? this.data.activeStory.id : '',
      storyEpisode: this.getPrefetchTargetStoryEpisode()
    });
    this.handleGenerate({ reason: "continue" });
  },

  /**
   * 🎉 显示故事周期完成庆祝弹窗
   */
  showCycleCompleteCelebration() {
    wx.showModal({
      title: '🎉 周期完成！',
      content: '恭喜你完成了本轮7节故事！新的故事周期将在首页等你开启。',
      showCancel: false,
      confirmText: '回到首页',
      success: () => {
        // 完成整轮故事后，彻底清理旧 session / prefetch，避免落回旧 completion 壳页面
        this.resetSessionForNewCycle();
        this.updateActiveStoryState(null);
        this.fetchDailyModeCounts(); // 刷新统计数据
        this.setData({ selectedVibe: null, selectedVibeLabel: '', vibeChangeMode: false });
      }
    });
  },

  async handleFinishStoryCycle() {
    await this.commitEpisodeDraftIfReady({ silent: true });
    this.resetSessionForNewCycle();
    this.updateActiveStoryState(null);
    this.fetchDailyModeCounts();
    this.setData({ selectedVibe: null, selectedVibeLabel: '', vibeChangeMode: false });
  },

  handleParagraphModeChange(e) {
    const rawMode = e.detail && e.detail.mode;
    const mode = rawMode === 'english' ? 'en' : rawMode;
    if (mode !== 'en' && mode !== 'mixed') return;
    console.log('[Index] Persisting paragraph mode:', mode);
    this.setData({ currentParagraphMode: mode });
    wx.setStorageSync('paragraphMode', mode);
  },

  goToSettings() {
    wx.navigateTo({ url: '/pages/settings/index' });
  },

  openMasteredWords() {
    wx.navigateTo({ url: '/pages/masteredWords/index' });
  },

  handleStartNew() {
    // 立即更新显示为学习模式的累计数
    this.setData({
      reviewMode: false,
      dailyModeCount: this.data.dailyNewWords || 0
    });
    app.globalData.reviewMode = false;

    // Story Mode Logic:
    // 如果有正在进行的故事 (activeStory && ongoing)，则直接进入 Session
    // 否则 (无故事，或已结束/过期)，弹出 Vibe 选择器
    const story = this.data.activeStory;
    const isOngoing = this.isStoryOngoing(story);
    const lastSession = app.globalData.lastSession;
    const unfinishedWords = lastSession && Array.isArray(lastSession.words)
      ? lastSession.words.filter(w => w.status !== 'known')
      : [];

    const persisted = this.getValidPersistedSession();
    if (persisted) {
      console.log('[handleStartNew] 从本地持久化恢复学习进度');
      this.checkResumeSession(true);
      return;
    }

    if (unfinishedWords.length > 0) {
      this.startSession();
      return;
    }

    if (this.getEpisodeDraftActionText()) {
      this.openEpisodeDraftStoryView();
      return;
    }

    if (isOngoing) {
      console.log('[Story] Continuing existing story:', story.theme);
      this.handleContinueSession();
    } else {
      console.log('[Story] No ongoing story, opening Vibe Selector');
      this.setData({ showVibeModal: true, vibeChangeMode: false, selectedVibe: null, selectedVibeLabel: '' });
    }

    if (app.globalData.userAuthorized) {
      wx.cloud.callFunction({ name: 'userData', data: { action: 'updateSettings', settings: { reviewModeDefault: false } } }).catch(console.error);
    }
  },

  handleStartReview() {
    // 立即更新显示为复习模式的累计数
    this.setData({
      reviewMode: true,
      dailyModeCount: this.data.dailyReviewWords || 0
    });
    app.globalData.reviewMode = true;
    this.startSession();
    if (app.globalData.userAuthorized) {
      wx.cloud.callFunction({ name: 'userData', data: { action: 'updateSettings', settings: { reviewModeDefault: true } } }).catch(console.error);
    }
  },

  // ==================== 生成逻辑（委托给模块）====================

  handleGenerate(options = {}) {
    sessionManager.handleGenerate(this, app, options);
  },

  handleRetryAi() {
    const story = this.data.activeStory;
    if (this.isStoryOngoing(story)) {
      const draft = this.data.episodeDraft;
      if (!draft) {
        wx.showToast({ title: '暂无可重试内容', icon: 'none', duration: 1500 });
        return;
      }
      if (this.data.episodeDraftRetryDisabled) {
        wx.showToast({ title: '冷却中，请稍后再试', icon: 'none', duration: 1500 });
        return;
      }
      this.startOrResumeEpisodeDraft(story.id, draft.episodeIndex || story.currentEpisode, { isRetry: true });
      return;
    }
    wx.showToast({ title: '当前仅支持故事模式生成', icon: 'none', duration: 1500 });
  },

  resetCompletionState() {
    sessionManager.resetCompletionState(this, () => this.clearCompletionTimers(), (p) => this.updateRing(p));
  },

  // ==================== 进度环（委托给模块）====================

  drawProgressRing(percent) {
    drawProgressRing(this, percent);
  },

  updateRing(percent) {
    updateRing(this, percent);
  },

  stopRingAnimation() {
    stopRingAnimation(this);
  },

  clearCompletionTimers() {
    clearCompletionTimers(this);
  },

  updateProgress(knownCount, totalCount, queueLength) {
    sessionManager.updateProgress(this, knownCount, totalCount, queueLength);
  },

  triggerCompletionSequence() {
    sessionManager.triggerCompletionSequence(this);
  },

  // ==================== 卡片交互（委托给模块）====================

  onCardTouchStart(e) {
    if (!this._swipeHandlers) {
      this._swipeHandlers = createSwipeHandlers(this, {
        onSwipeComplete: (direction) => this.advanceQueue(direction),
        onPronunciationTap: () => this.playPronunciation(),
      });
    }
    this._swipeHandlers.onCardTouchStart(e);
  },

  // ==================== Dashboard Hero Carousel ====================

  startHeroCarousel() {
    this.stopHeroCarousel();
    // Use interval to manually control index for reverse (downward) scroll effect
    this._heroCarouselTimer = setInterval(() => {
      const { heroTipIndex, heroTips } = this.data;
      const len = heroTips.length;
      // Scroll "Down": Index goes 0 -> 2 -> 1 -> 0
      // Logic: (index - 1 + len) % len
      const nextIndex = (heroTipIndex - 1 + len) % len;
      this.setData({ heroTipIndex: nextIndex });
    }, 5000);
  },

  stopHeroCarousel() {
    if (this._heroCarouselTimer) {
      clearInterval(this._heroCarouselTimer);
      this._heroCarouselTimer = null;
    }
  },

  onCardTouchMove(e) {
    if (this._swipeHandlers) {
      this._swipeHandlers.onCardTouchMove(e);
    }
  },

  onCardTouchEnd(e) {
    if (this._swipeHandlers) {
      this._swipeHandlers.onCardTouchEnd(e);
    }
  },

  // ==================== 队列推进 ====================

  async advanceQueue(direction) {
    console.log("[advanceQueue] START - direction:", direction);

    const queue = this.data.queue.slice();
    if (!queue.length) {
      console.log("[advanceQueue] Queue is empty, returning early");
      return;
    }

    const current = queue.shift();
    const totalCount = this.data.totalCount;
    let knownCount = this.data.knownCount;
    const processed = this.data.processedCards.slice();

    if (direction === "right") {
      current.status = "known";
      current.completedAt = Date.now();
      current.lastMarked = "known";
      knownCount += 1;
      processed.push(current);
      // Optimistic local update for daily counts
      const isReview = this.data.reviewMode;
      const newDailyMastered = (this.data.dailyMasteredCount || 0) + 1;
      const newDailyModeCount = (this.data.dailyModeCount || 0) + 1;

      const updateData = {
        dailyMasteredCount: newDailyMastered,
        dailyModeCount: newDailyModeCount
      };

      if (isReview) {
        updateData.dailyReviewWords = (this.data.dailyReviewWords || 0) + 1;
      } else {
        updateData.dailyNewWords = (this.data.dailyNewWords || 0) + 1;
      }

      this.setData(updateData);
    } else {
      current.reviewCount = (current.reviewCount || 0) + 1;
      current.status = "pending";
      current.lastMarked = "unknown";
      queue.push(current);
    }

    const sessionWords = this.data.session && this.data.session.words ? this.data.session.words : [];
    const updatedWords = sessionWords.map((w) => (w.id === current.id ? { ...current } : w));
    const updatedSession = {
      ...this.data.session,
      wordSelectionVersion: this.data.session && this.data.session.wordSelectionVersion
        ? this.data.session.wordSelectionVersion
        : WORD_SELECTION_VERSION,
      words: updatedWords,
    };
    app.globalData.lastSession = updatedSession;

    this.setData({
      session: updatedSession,
      queue,
      processedCards: processed,
      currentCard: queue[0] || null,
      nextCards: queue.slice(1, 1 + PREVIEW_SIZE),
      cardOffsetX: 0,
      cardOffsetY: 0,
      cardRotation: 0,
      cardLeaving: "",
      showUnknownTag: false,
      ringVisible: queue.length !== 0,
    });

    // 【Point 3】持久化当前学习进度，以便意外退出后恢复
    if (queue.length > 0) {
      wx.setStorage({
        key: PERSISTED_SESSION_KEY,
        data: {
          session: updatedSession,
          queue: queue,
          processedCards: processed,
          knownCount: knownCount,
          timestamp: Date.now()
        }
      });
    } else {
      // 如果队列已空，清除持久化
      wx.removeStorage({ key: PERSISTED_SESSION_KEY });
    }

    // 更新段落高亮
    if (this.data.currentParagraphMode === "en") {
      this.setData({
        paragraphEnglishNodes: highlightParagraph(updatedSession.words, (updatedSession.paragraph && updatedSession.paragraph.english) || "", { highlight: true }),
      });
    } else {
      this.setData({
        paragraphMixedNodes: highlightParagraph(updatedSession.words, (updatedSession.paragraph && updatedSession.paragraph.mixed) || (updatedSession.paragraph && updatedSession.paragraph.english) || "", { highlight: false }),
      });
    }

    this.updateProgress(knownCount, totalCount, queue.length);

    // 同步到云端
    if (app.globalData.userAuthorized) {
      const deck = this.data.session && this.data.session.deck ? this.data.session.deck : this.getActiveDeck();
      const cnDef = Array.isArray(current.cnDefs) && current.cnDefs.length > 0 ? current.cnDefs[0] : null;
      const operationId = `upsert_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const upsertPayload = {
        word: current.word,
        status: direction === 'right' ? 'known' : 'unknown',
        operationId,
        reviewMode: current.isReview || this.data.reviewMode,
        meta: {
          lang: 'en',
          pos: cnDef ? cnDef.pos : '',
          phonetic: current.phonetic || '',
          translation: current.translation || '',
          definition: current.translation || '',
          topic: deck ? deck.id : ''
        },
        exposuresDelta: 1,
        familiarityDelta: direction === 'right' ? 1 : -1
      };

      const syncPromise = wx.cloud.callFunction({
        name: 'userData',
        data: {
          action: 'upsertWordStatus',
          ...upsertPayload
        }
      }).then((res) => {
        const result = res && res.result;
        if (result && result.ok === false) {
          throw new Error(result.error || result.msg || 'word sync failed');
        }
        this.trackSeenWord(current.word);
        return { ok: true };
      }).catch((e) => {
        const error = e instanceof Error ? e : new Error(String(e || 'word sync failed'));
        console.error('[Sync] word status error:', error);
        // 【重试队列】同步失败时加入队列
        syncQueue.enqueue('upsertWordStatus', upsertPayload);
        this._currentBatchWordSyncFailed = true;
        this._currentBatchWordSyncError = error.message || '单词同步失败';
        return { ok: false, error: this._currentBatchWordSyncError };
      });
      this.registerWordSyncPromise(syncPromise);

      if (direction === 'right') {
        const userKnownCount = this.data.userKnownCount + 1;
        this.setData({
          userKnownCount,
          showReviewTip: !this.data.reviewMode && userKnownCount >= 10
        });
      }
    }
    this.refreshActionButtonText();
  },

  // ==================== 发音 ====================

  playPronunciation() {
    console.log('[Audio] playPronunciation triggered');
    const word = this.data.currentCard && this.data.currentCard.word;
    if (!word) return;

    if (this._audioPlaying) return;
    this._audioPlaying = true;

    const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
    const audioCtx = wx.createInnerAudioContext();
    audioCtx.obeyMuteSwitch = false;
    audioCtx.src = audioUrl;

    audioCtx.onCanplay(() => audioCtx.play());
    audioCtx.onEnded(() => {
      this._audioPlaying = false;
      audioCtx.destroy();
    });
    audioCtx.onError((err) => {
      console.error('[Audio] 播放失败:', err);
      this._audioPlaying = false;
      audioCtx.destroy();
      wx.showToast({ title: '发音加载失败', icon: 'none', duration: 1500 });
    });
  },

  // ==================== 认证相关 ====================

  refreshAuthPrompt() {
    const cached = wx.getStorageSync('userProfileCache') || {};
    const profile = app.globalData.userProfile || {};
    const hasProfile = !!(profile.nickName || profile.avatarUrl || cached.nickName || cached.avatarUrl);
    const dismissed = !!wx.getStorageSync('authPromptDismissed');
    const show = !!app.globalData.userAuthorized && !hasProfile && !dismissed;
    this.setData({
      showAuthPrompt: show,
      canIUseGetUserProfile: !!wx.getUserProfile
    });
  },

  maybePromptProfileCompletion() {
    if (!this.data.showAuthPrompt) return;
    if (this._profilePromptShown) return;
    this._profilePromptShown = true;

    wx.showModal({
      title: '完善头像昵称',
      content: '为了同步学习数据并更好展示内容，建议补全头像与昵称（也可稍后在设置页完成）。',
      confirmText: '去设置',
      cancelText: '稍后',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/settings/index' });
        } else {
          try {
            wx.setStorageSync('authPromptDismissed', true);
          } catch (e) {
            console.warn('[Index] setStorage authPromptDismissed failed:', e);
          }
        }
        this.setData({ showAuthPrompt: false });
      }
    });
  },

  shouldRedirectToAuth() {
    if (app.globalData.authBootstrapping) {
      return false;
    }
    return !app.globalData.userAuthorized;
  },

  handleAuth() {
    if (this.data.authLoading) return;
    if (!wx.getUserProfile) {
      wx.showToast({ title: '当前版本不支持授权', icon: 'none' });
      return;
    }
    this.setData({ authLoading: true, authFailed: false });
    wx.getUserProfile({
      desc: '用于展示头像昵称并同步学习数据',
      success: (res) => this.loginWithProfile(res.userInfo),
      fail: (err) => {
        console.error('[Index] Auth denied', err);
        this.setData({ authLoading: false, authFailed: true });
      }
    });
  },

  loginWithProfile(userInfo) {
    app.syncWeChatProfile(userInfo).then(() => {
      this.setData({ showAuthPrompt: false, authLoading: false, authFailed: false });
      this.syncUserState();
    }).catch((err) => {
      console.error('[Index] sync profile failed', err);
      this.setData({ authLoading: false, authFailed: true });
    });
  },

  dismissAuthPrompt() {
    wx.setStorageSync('authPromptDismissed', true);
    this.setData({ showAuthPrompt: false });
  },

  // ==================== 进度环交互 ====================

  onRegenerateTap() {
    if (this.data.ringActionLock) return;
    console.log('[Ring] tap -> generate');
    this.handleGenerate({ reason: "manual" });
  },

  onRingLongPress() {
    console.log('[Ring] long-press detected');
    if (this.data.ringActionLock) return;

    this.clearCompletionTimers();
    this.stopRingAnimation();

    this.setData({
      ringActionLock: true,
      ringVisible: false,
      ringPulse: false,
      ringState: "idle"
    });

    wx.navigateTo({
      url: '/pages/settings/index',
      success: () => console.log('[Ring] navigated to settings'),
      fail: (err) => {
        console.error('[Ring] navigate failed', err);
        this.setData({ ringActionLock: false, ringVisible: true });
      },
      complete: () => setTimeout(() => this.setData({ ringActionLock: false }), 200)
    });
  },

  // ==================== 完成页交互 ====================

  onCompletionGuideTouchStart(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    this.guideDragState = { startY: touch.pageY, startTime: Date.now() };
  },

  onCompletionGuideTouchMove(e) {
    if (!this.guideDragState) return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaY = this.guideDragState.startY - touch.pageY;
    if (deltaY > 0) {
      const opacity = Math.max(0.3, 1 - deltaY / 200);
      const percent = Math.max(0, Math.min(100, 100 - deltaY / 6));
      this.setData({
        guideOpacity: opacity,
        guideOffsetY: -deltaY * 0.5,
        sessionVisible: true,
        sessionTranslateY: percent,
      });
    }
  },

  onCompletionGuideTouchEnd(e) {
    if (!this.guideDragState) return;
    const touch = e.changedTouches && e.changedTouches[0];
    const deltaY = this.guideDragState.startY - ((touch && touch.pageY) || this.guideDragState.startY);
    const duration = Date.now() - this.guideDragState.startTime;
    this.guideDragState = null;

    if (deltaY > 60 || (deltaY > 30 && duration < 300)) {
      this.setData({
        sessionTranslateY: 0,
        sessionTransitioning: true,
        guideOpacity: 0,
        guideOffsetY: -100,
        bounceActive: false,
        sessionScrollTop: 0,
      });
    } else {
      this.setData({
        guideOpacity: 1,
        guideOffsetY: 0,
        sessionVisible: false,
        sessionTranslateY: 100,
      });
    }
  },

  onSessionScroll(e) {
    const scrollTop = (e.detail && typeof e.detail.scrollTop === 'number') ? e.detail.scrollTop : 0;
    this.setData({ sessionScrollTop: scrollTop });
  },



  // ==================== 故事模式 (Story Mode) ====================

  handleChangeVibe() {
    const story = this.data.activeStory;
    if (this.isStoryOngoing(story)) {
      if (story.vibeChangeUsed) {
        wx.showToast({ title: '本周期仅可更换题材一次', icon: 'none', duration: 2000 });
        return;
      }
      wx.showModal({
        title: '更换题材',
        content: '更换题材会结束当前进度并从第1节重新开始。本周期仅一次机会，确定更换吗？',
        confirmText: '确定更换',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            this.setData({ showVibeModal: true, vibeChangeMode: true, selectedVibe: null, selectedVibeLabel: '' });
          }
        }
      });
      return;
    }
    this.setData({ showVibeModal: true, vibeChangeMode: false, selectedVibe: null, selectedVibeLabel: '' });
  },

  selectVibe(e) {
    if (this.data.startStoryLoading) return;
    const vibeId = e.currentTarget.dataset.id;
    const selected = this.data.vibeOptions.find((vibe) => vibe.id === vibeId);
    this.setData({
      selectedVibe: vibeId,
      selectedVibeLabel: selected ? selected.name : ''
    });
    // 可以添加震动反馈
    wx.vibrateShort({ type: 'light' });
  },

  hideVibeSelector() {
    this.setData({ showVibeModal: false, vibeChangeMode: false, selectedVibeLabel: '' });
  },

  noop() {},

  // 确认开启新故事
  async confirmStartStory() {
    if (this.data.startStoryLoading || !this.data.selectedVibe) return;

    this.setData({ startStoryLoading: true });

    try {
      const selected = this.data.vibeOptions.find(v => v.id === this.data.selectedVibe);
      const theme = selected ? selected.id : 'Fantasy';
      const changeMode = this.data.vibeChangeMode;
      const res = await wx.cloud.callFunction({
        name: 'storyData',
        data: {
          action: changeMode ? 'restartStoryCycle' : 'startStoryCycle',
          theme,
          changeType: changeMode ? 'vibe' : undefined
        }
      });

      if (res.result && res.result.ok) {
        console.log('[Story] Start success:', res.result.story);
        this._storyStatusRequestId = 0;
        this.resetSessionForNewCycle();
        this.updateActiveStoryState(res.result.story, () => {
          this.clearEpisodeDraftState();
          this.setData({ showVibeModal: false, vibeChangeMode: false, selectedVibeLabel: '' });
          this.invalidatePrefetch();
          this.ensureProfileSettingsFresh()
            .then((ordering) => {
              console.log('[Story] Authoritative ordering before first batch:', ordering);
            })
            .catch((error) => {
              console.warn('[Story] ensureProfileSettingsFresh before first batch failed:', error);
            })
            .finally(() => {
              // 成功开启后，直接进入 Session（确保 activeStory 已就绪）
              this.startSession();
            });
        });
      } else if (res.result && res.result.code === 'CHANGE_USED') {
        wx.showToast({ title: '本周期仅可更换题材一次', icon: 'none', duration: 2000 });
      } else {
        wx.showToast({ title: '开启失败，请重试', icon: 'none' });
      }
    } catch (error) {
      console.error('[Story] Start failed:', error);
      wx.showToast({ title: '异常，请检查网络连接', icon: 'none' });
    } finally {
      this.setData({ startStoryLoading: false, vibeChangeMode: false });
    }
  },

  createStoryOperationId(prefix) {
    const seed = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix || 'story'}_${seed}`;
  },

  getMidWeekChoiceInfo(story) {
    if (!story || story.status !== 'ongoing') return null;
    const cfg = (story.midWeekChoice && typeof story.midWeekChoice === 'object') ? story.midWeekChoice : null;
    if (!cfg) return null;
    const boundaryEpisode = Number(cfg.boundaryEpisode || 3);
    const selectedBranch = String(cfg.selectedBranch || '').trim().toUpperCase();
    const history = Array.isArray(story.history) ? story.history : [];
    const reachedBoundary = history.some(item => Number(item && item.episode) === boundaryEpisode)
      || Number(story.currentEpisode || 1) > boundaryEpisode;
    if (!reachedBoundary || selectedBranch) return null;
    return {
      boundaryEpisode,
      options: ['A', 'B']
    };
  },

  pickMidWeekChoice(choiceInfo) {
    return new Promise((resolve) => {
      const boundaryEpisode = choiceInfo && choiceInfo.boundaryEpisode ? choiceInfo.boundaryEpisode : 3;
      wx.showActionSheet({
        alertText: `第${boundaryEpisode}节后剧情分支：请选择命运走向`,
        itemList: ['A线：正面追查', 'B线：秘密潜入'],
        success: (res) => {
          if (!res || typeof res.tapIndex !== 'number') {
            resolve(null);
            return;
          }
          resolve(res.tapIndex === 0 ? 'A' : 'B');
        },
        fail: () => resolve(null)
      });
    });
  },

  async submitMidWeekChoice(story, choice) {
    if (!story || !story.id || !choice) return { ok: false };

    this.setData({ branchChoiceBusy: true, branchChoiceErrorCode: '' });
    try {
      const operationId = this.createStoryOperationId('branch');
      const res = await wx.cloud.callFunction({
        name: 'storyData',
        data: {
          action: 'submitMidWeekChoice',
          storyId: story.id,
          choice,
          expectedRev: Number(story.rev || 0),
          operationId
        }
      });

      if (res && res.result && res.result.ok) {
        if (res.result.story) {
          this.updateActiveStoryState(res.result.story);
        }
        return { ok: true, result: res.result };
      }

      const errorCode = String((res && res.result && res.result.code) || 'BRANCH_SUBMIT_FAILED');
      this.setData({ branchChoiceErrorCode: errorCode });
      return { ok: false, code: errorCode, result: res ? res.result : null };
    } catch (error) {
      console.error('[Story] submitMidWeekChoice failed:', error);
      this.setData({ branchChoiceErrorCode: 'BRANCH_SUBMIT_FAILED' });
      return { ok: false, code: 'BRANCH_SUBMIT_FAILED', error };
    } finally {
      this.setData({ branchChoiceBusy: false });
    }
  },

  clearEpisodeDraftState() {
    this.stopEpisodeDraftPolling();
    if (this._episodeDraftCooldownTimer) {
      clearInterval(this._episodeDraftCooldownTimer);
      this._episodeDraftCooldownTimer = null;
    }
    this.setData({
      episodeDraft: null,
      episodeDraftStatus: '',
      episodeDraftEpisode: null,
      episodeDraftRetryAt: null,
      episodeDraftRetryDisabled: false,
      episodeDraftRetryLabel: '再试一次',
      episodeDraftLoading: false,
      episodeDraftMock: false,
      episodeDraftPolling: false
    });
    this._autoCommitFinalDraftKey = '';
    this._autoCommitFinalDraftPromise = null;
    this.refreshActionButtonText();
  },

  setEpisodeDraftCooldown(nextRetryAt) {
    if (this._episodeDraftCooldownTimer) {
      clearInterval(this._episodeDraftCooldownTimer);
      this._episodeDraftCooldownTimer = null;
    }
    if (!nextRetryAt) {
      this.setData({
        episodeDraftRetryAt: null,
        episodeDraftRetryDisabled: false,
        episodeDraftRetryLabel: '再试一次'
      });
      return;
    }

    const retryAtMs = new Date(nextRetryAt).getTime();
    if (!retryAtMs || Number.isNaN(retryAtMs)) {
      this.setData({
        episodeDraftRetryAt: null,
        episodeDraftRetryDisabled: false,
        episodeDraftRetryLabel: '再试一次'
      });
      return;
    }

    const updateLabel = () => {
      const remainingMs = retryAtMs - Date.now();
      if (remainingMs <= 0) {
        if (this._episodeDraftCooldownTimer) {
          clearInterval(this._episodeDraftCooldownTimer);
          this._episodeDraftCooldownTimer = null;
        }
        this.setData({
          episodeDraftRetryDisabled: false,
          episodeDraftRetryLabel: '再试一次'
        });
        return;
      }
      const seconds = Math.ceil(remainingMs / 1000);
      this.setData({
        episodeDraftRetryDisabled: true,
        episodeDraftRetryLabel: `冷却 ${seconds}s`
      });
    };

    this.setData({ episodeDraftRetryAt: new Date(retryAtMs) });
    updateLabel();
    if (retryAtMs > Date.now()) {
      this._episodeDraftCooldownTimer = setInterval(updateLabel, 1000);
    }
  },

  getDraftDeck(draft) {
    const deckId = draft && draft.deckId ? draft.deckId : this.data.currentDeckId;
    return DECK_LIBRARY.find(d => d.id === deckId) || this.getActiveDeck();
  },

  buildSessionFromDraft(draft) {
    const rawWords = Array.isArray(draft.wordsSnapshot) ? draft.wordsSnapshot : [];
    const words = rawWords.map((item, idx) => {
      if (typeof item === 'string') {
        return {
          id: `draft-${draft.episodeIndex}-${idx}`,
          word: item,
          translation: item,
          status: 'known',
          reviewCount: 0,
          familiarity: 0,
          isReview: false
        };
      }
      const next = { ...item };
      if (!next.id) {
        next.id = `draft-${draft.episodeIndex}-${idx}`;
      }
      if (!next.word && typeof item.word === 'string') {
        next.word = item.word;
      }
      next.status = 'known';
      next.reviewCount = typeof next.reviewCount === 'number' ? next.reviewCount : 0;
      next.familiarity = typeof next.familiarity === 'number' ? next.familiarity : 0;
      return next;
    }).filter(item => item && item.word);

    const paragraphReady = draft.status === 'ready' && (draft.contentEn || draft.contentMixed);
    const paragraph = paragraphReady
      ? { english: draft.contentEn || '', mixed: draft.contentMixed || draft.contentEn || '' }
      : { english: 'Creating story...', mixed: '故事生成中...' };

    return {
      storyId: draft.storyId || this.getActiveStoryId(),
      words,
      paragraph,
      deck: this.getDraftDeck(draft),
      wordCount: words.length,
      wordSelectionVersion: WORD_SELECTION_VERSION,
      generatedAt: Date.now()
    };
  },

  applyEpisodeDraftToSession(draft, options = {}) {
    if (!draft) return;
    const story = this.data.activeStory;
    if (!story || (draft.storyId && story.id && draft.storyId !== story.id)) return;
    const currentDraft = this.data.episodeDraft;
    const sameEpisode = !!(
      currentDraft &&
      (!currentDraft.storyId || !draft.storyId || currentDraft.storyId === draft.storyId) &&
      Number(currentDraft.episodeIndex || 0) === Number(draft.episodeIndex || 0)
    );
    const currentReady = currentDraft && currentDraft.status === 'ready';
    const incomingStatus = String(draft.status || '').trim();
    const incomingPendingLike = incomingStatus === 'pending' || incomingStatus === 'generating';
    if (sameEpisode && currentReady && incomingPendingLike) {
      console.log('[Story] Ignore stale draft downgrade after ready', {
        storyId: draft.storyId || this.getActiveStoryId(),
        episodeIndex: draft.episodeIndex || 0,
        incomingStatus
      });
      return;
    }

    // Debug: 仅在 testMode 下打印后端生成流程校验信息（promptMeta）
    try {
      if (app.globalData && app.globalData.testMode && draft.promptMeta) {
        console.log('[Story] draft.promptMeta', draft.promptMeta);
      }
    } catch (e) {
      console.warn('[Story] read promptMeta failed:', e);
    }

    const isReady = draft.status === 'ready' && (draft.contentEn || draft.contentMixed);
    const paragraph = isReady
      ? { english: draft.contentEn || '', mixed: draft.contentMixed || draft.contentEn || '' }
      : { english: 'Creating story...', mixed: '故事生成中...' };

    let session = this.data.session;
    if (!session || !Array.isArray(session.words) || session.words.length === 0) {
      session = this.buildSessionFromDraft(draft);
    } else {
      session = { ...session, paragraph };
    }

    app.globalData.lastSession = session;

    if (isReady) {
      this._storyGenerationTiming = markDraftReadyTiming(this._storyGenerationTiming, draft);
    }

    this.setData({
      session,
      episodeDraft: draft,
      episodeDraftStatus: draft.status || '',
      episodeDraftEpisode: draft.episodeIndex || this.data.storyDisplayEpisode,
      aiFailed: draft.status === 'failed',
      storyDisplayEpisode: draft.episodeIndex || this.data.storyDisplayEpisode,
      episodeDraftMock: !!options.isMock
    }, () => {
      if (isReady && this.data.uiState === 'complete') {
        this.markStoryGenerationRenderReady(draft.storyId, draft.episodeIndex);
        this.autoCommitFinalEpisodeIfReady('apply-ready').catch(error => {
          console.error('[Story] auto commit final draft failed:', error);
        });
      }
    });

    if (isReady) {
      this.stopEpisodeDraftPolling();
    } else {
      this.startEpisodeDraftPolling();
    }
    this.setEpisodeDraftCooldown(draft.nextRetryAt);
    this.refreshActionButtonText();
  },

  async startOrResumeEpisodeDraft(storyId, episodeIndex, options = {}) {
    if (!storyId || !episodeIndex) return;
    const startKey = `${storyId}:${episodeIndex}`;
    if (this._episodeDraftStartInFlightKey === startKey && this._episodeDraftStartInFlightPromise) {
      return this._episodeDraftStartInFlightPromise;
    }
    const shouldRetry = !!options.isRetry;
    const isBackground = !!options.background;
    const existingDraft = this.data.episodeDraft;
    const fallbackWords = (existingDraft && Array.isArray(existingDraft.wordsSnapshot) && existingDraft.wordsSnapshot.length > 0)
      ? existingDraft.wordsSnapshot
      : (this.data.session && Array.isArray(this.data.session.words) ? this.data.session.words : []);
    if (!existingDraft || existingDraft.storyId !== storyId || existingDraft.episodeIndex !== episodeIndex) {
      this.applyEpisodeDraftToSession({
        storyId,
        episodeIndex,
        wordsSnapshot: fallbackWords,
        status: (existingDraft && existingDraft.status) ? existingDraft.status : 'pending'
      });
    }
    if (shouldRetry) {
      this.setData({ aiRetrying: true });
    }
    if (!isBackground) {
      this.setData({ episodeDraftLoading: true });
    }
    const requestPromise = (async () => {
      try {
      let res = await wx.cloud.callFunction({
        name: 'storyData',
        data: { action: 'startOrResumeEpisodeDraft', storyId, episodeIndex }
      });

      const isOkDraft = !!(res && res.result && res.result.ok && res.result.draft);
      if (isOkDraft) {
        this.applyEpisodeDraftToSession(res.result.draft);
        return;
      }

      const errCode = res && res.result && res.result.error ? res.result.error.errCode : null;
      const errMsg = String(res && res.result && res.result.error && res.result.error.errMsg
        ? res.result.error.errMsg
        : (res && res.result && res.result.msg ? res.result.msg : ''));

      const canEnsure = !options._ensured &&
        Array.isArray(fallbackWords) &&
        fallbackWords.length > 0 &&
        (errCode === -502005 ||
          /collection not exists/i.test(errMsg) ||
          /document does not exist/i.test(errMsg) ||
          /draft not found/i.test(errMsg));

      if (canEnsure) {
        const deckInfo = this.getDraftDeck(existingDraft);
        const cefrLevel = getParagraphCefr(deckInfo?.id);
        try {
          const ensureRes = await wx.cloud.callFunction({
            name: 'storyData',
            data: {
              action: 'ensureEpisodeDraft',
              storyId,
              episodeIndex,
              wordsSnapshot: fallbackWords,
              deckId: deckInfo?.id || this.data.currentDeckId,
              deckName: deckInfo?.name || this.data.currentDeckName,
              deckFocus: deckInfo?.focus || '',
              cefrLevel
            }
          });
          if (ensureRes && ensureRes.result && ensureRes.result.ok && ensureRes.result.draft) {
            this.applyEpisodeDraftToSession(ensureRes.result.draft);
          }
        } catch (e) {
          console.warn('[Story] ensureEpisodeDraft (fallback) failed:', e);
        }

        res = await wx.cloud.callFunction({
          name: 'storyData',
          data: { action: 'startOrResumeEpisodeDraft', storyId, episodeIndex }
        });

        if (res && res.result && res.result.ok && res.result.draft) {
          this.applyEpisodeDraftToSession(res.result.draft);
          return;
        }
      }

      if (!options.silent) {
        wx.showToast({ title: '生成失败，请重试', icon: 'none' });
      }
      this.applyEpisodeDraftToSession({
        storyId,
        episodeIndex,
        wordsSnapshot: fallbackWords,
        status: 'failed'
      });
      } catch (error) {
        if (this.isStoryTimeoutError(error)) {
          console.warn('[Story] startOrResumeEpisodeDraft timed out:', error);
          try {
            const recoveredDraft = await this.recoverEpisodeDraftAfterTimeout(storyId, episodeIndex);
            if (recoveredDraft) {
              if (!options.silent) {
                wx.showToast({ title: '生成较慢，后台继续处理中', icon: 'none' });
              }
              return;
            }
          } catch (recoverError) {
            console.warn('[Story] recoverEpisodeDraftAfterTimeout failed:', recoverError);
          }
          if (!options.silent) {
            wx.showToast({ title: '生成较慢，后台继续处理中', icon: 'none' });
          }
          this.startEpisodeDraftPolling();
          this.applyEpisodeDraftToSession({
            storyId,
            episodeIndex,
            wordsSnapshot: fallbackWords,
            status: 'generating'
          });
          return;
        }
        console.error('[Story] startOrResumeEpisodeDraft failed:', error);
        if (!options.silent) {
          wx.showToast({ title: '异常，请检查网络连接', icon: 'none' });
        }
        this.applyEpisodeDraftToSession({
          storyId,
          episodeIndex,
          wordsSnapshot: fallbackWords,
          status: 'failed'
        });
      } finally {
        if (!isBackground) {
          this.setData({ episodeDraftLoading: false, aiRetrying: false });
        } else if (shouldRetry) {
          this.setData({ aiRetrying: false });
        }
        if (this._episodeDraftStartInFlightKey === startKey) {
          this._episodeDraftStartInFlightKey = '';
          this._episodeDraftStartInFlightPromise = null;
        }
      }
    })();
    this._episodeDraftStartInFlightKey = startKey;
    this._episodeDraftStartInFlightPromise = requestPromise;
    return requestPromise;
  },

  async startEpisodeDraftGeneration(words, deck) {
    const story = this.data.activeStory;
    if (!this.isStoryOngoing(story)) return;
    if (!Array.isArray(words) || words.length === 0) return;
    const episodeIndex = Number(story.currentEpisode || 1);
    const normalizedWordKey = words
      .map((item) => String((item && item.word) || item || '').trim().toLowerCase())
      .filter(Boolean)
      .join('|');
    const existingDraft = this.data.episodeDraft;
    const existingDraftKey = existingDraft && Array.isArray(existingDraft.wordsSnapshot)
      ? existingDraft.wordsSnapshot
        .map((item) => String((item && item.word) || item || '').trim().toLowerCase())
        .filter(Boolean)
        .join('|')
      : '';
    const draftMatchesCurrentEpisode = !!(
      existingDraft &&
      existingDraft.storyId === story.id &&
      Number(existingDraft.episodeIndex || 0) === episodeIndex &&
      existingDraftKey &&
      existingDraftKey === normalizedWordKey
    );

    // 标记本组已触发（避免重复触发）
    try {
      const draftKey = words.map(w => (w && w.word) ? w.word : String(w || '')).join('|');
      this._episodeDraftStartedKey = draftKey;
    } catch (e) {
      // ignore
    }

    if (app.globalData.testMode) {
      const currentEp = Number(story.currentEpisode || 1);
      const targetWord = words[0]?.word || 'TEST_WORD';
      const mockParagraph = {
        english: `This is a TEST STORY (Ep.${currentEp}). Target word: **${targetWord}**. In TEST MODE, AI generation is bypassed.`,
        mixed: `这是一个测试故事 (第 ${currentEp} 节)。目标单词: **${targetWord}**。在测试模式下，AI 生成已被跳过。`
      };
      const draft = {
        storyId: story.id,
        episodeIndex: currentEp,
        wordsSnapshot: words,
        contentEn: mockParagraph.english,
        contentMixed: mockParagraph.mixed,
        status: 'ready',
        nextRetryAt: null
      };
      this.applyEpisodeDraftToSession(draft, { isMock: true });
      return;
    }

    const deckInfo = deck || this.getActiveDeck();
    const cefrLevel = getParagraphCefr(deckInfo?.id);

    if (draftMatchesCurrentEpisode && ['pending', 'generating', 'ready'].includes(existingDraft.status)) {
      this.applyEpisodeDraftToSession(existingDraft);
      this.startEpisodeDraftPolling();
      if (existingDraft.status !== 'ready') {
        this.startOrResumeEpisodeDraft(story.id, episodeIndex, { background: true, silent: true }).catch(error => {
          console.error('[Story] background startOrResumeEpisodeDraft failed:', error);
        });
      }
      return;
    }

    // 先写入本地草稿状态，保证按钮文案与重试入口可见
    this.applyEpisodeDraftToSession({
      storyId: story.id,
      episodeIndex,
      wordsSnapshot: words,
      status: 'pending'
    });

    this.setData({ episodeDraftLoading: true });
    this.startEpisodeDraftPolling();
    try {
      const ensureRes = await wx.cloud.callFunction({
        name: 'storyData',
        data: {
          action: 'ensureEpisodeDraft',
          storyId: story.id,
          episodeIndex,
          wordsSnapshot: words,
          deckId: deckInfo?.id || this.data.currentDeckId,
          deckName: deckInfo?.name || this.data.currentDeckName,
          deckFocus: deckInfo?.focus || '',
          cefrLevel
        }
      });
      if (ensureRes.result && ensureRes.result.ok && ensureRes.result.draft) {
        this.applyEpisodeDraftToSession(ensureRes.result.draft);
      } else {
        this.applyEpisodeDraftToSession({
          storyId: story.id,
          episodeIndex,
          wordsSnapshot: words,
          status: 'failed'
        });
      }
    } catch (error) {
      console.error('[Story] ensureEpisodeDraft failed:', error);
      this.applyEpisodeDraftToSession({
        storyId: story.id,
        episodeIndex,
        wordsSnapshot: words,
        status: 'failed'
      });
    } finally {
      this.setData({ episodeDraftLoading: false });
    }

    this.startOrResumeEpisodeDraft(story.id, episodeIndex, { background: true, silent: true }).catch(error => {
      console.error('[Story] background startOrResumeEpisodeDraft failed:', error);
    });
  },

  async refreshEpisodeDraftStatus(options = {}) {
    const story = this.data.activeStory;
    if (!this.isStoryOngoing(story)) {
      this.clearEpisodeDraftState();
      return;
    }

    const episodeIndex = Number(story.currentEpisode || 1);
    try {
      const res = await wx.cloud.callFunction({
        name: 'storyData',
        data: {
          action: 'getEpisodeDraft',
          storyId: story.id,
          episodeIndex
        }
      });
      if (res.result && res.result.ok && res.result.empty) {
        const localDraft = this.data.episodeDraft;
        const localEpisode = localDraft && localDraft.episodeIndex ? localDraft.episodeIndex : episodeIndex;
        if (localDraft && (!localDraft.storyId || localDraft.storyId === story.id) && localEpisode === episodeIndex) {
          this.setEpisodeDraftCooldown(localDraft.nextRetryAt);
          return;
        }
        this.clearEpisodeDraftState();
        return;
      }
      if (res.result && res.result.ok && res.result.draft) {
        this.applyEpisodeDraftToSession(res.result.draft);
        const localDraft = this.data.episodeDraft;
        const localPending = localDraft && (localDraft.status === 'pending' || localDraft.status === 'generating');
        if (options.autoStart && res.result.draft.status !== 'ready' && !localPending) {
          await this.startOrResumeEpisodeDraft(story.id, episodeIndex, { silent: true });
        }
        if (options.scheduleRetry && res.result.draft.status !== 'ready') {
          this.scheduleEpisodeDraftRetryIfNeeded('onShow');
        }
      }
    } catch (error) {
      if (!options.silent) {
        console.error('[Story] getEpisodeDraft failed:', error);
      }
    }
  },

  scheduleEpisodeDraftRetryIfNeeded(source) {
    const story = this.data.activeStory;
    const draft = this.data.episodeDraft;
    if (!this.isStoryOngoing(story) || !draft || draft.status === 'ready') return;
    const storyId = draft.storyId || story.id;
    const episodeIndex = draft.episodeIndex || story.currentEpisode;
    if (!storyId || !episodeIndex) return;
    wx.cloud.callFunction({
      name: 'storyData',
      data: {
        action: 'scheduleEpisodeDraftRetry',
        storyId,
        episodeIndex
      }
    }).catch(err => {
      console.error('[Story] scheduleEpisodeDraftRetry failed:', source, err);
    });
  },

  async commitEpisodeDraftIfReady(options = {}) {
    const draft = this.data.episodeDraft;
    const story = this.data.activeStory;
    if (!draft || draft.status !== 'ready' || !story) return { committed: false };
    if (draft.storyId && story.id && draft.storyId !== story.id) return { committed: false };

    this.setData({ episodeDraftLoading: true });
    try {
      let res;
      if (this.data.episodeDraftMock) {
        res = await wx.cloud.callFunction({
          name: 'storyData',
          data: {
            action: 'saveStoryEpisode',
            contentEn: draft.contentEn,
            contentMixed: draft.contentMixed,
            words: draft.wordsSnapshot || [],
            state: draft.state || null,
            episodeIndex: draft.episodeIndex
          }
        });
      } else {
        const operationId = this.createStoryOperationId('commit');
        const clientTiming = buildStoryTimingPayload(this._storyGenerationTiming);
        res = await wx.cloud.callFunction({
          name: 'storyData',
          data: {
            action: 'commitEpisodeDraft',
            storyId: story.id,
            episodeIndex: draft.episodeIndex,
            expectedRev: Number(story.rev || 0),
            operationId,
            clientTiming
          }
        });
      }

      if (res.result && res.result.ok) {
        if (res.result.status === 'completed' || res.result.archived) {
          const completedStory = {
            ...(story || {}),
            status: 'completed',
            currentEpisode: draft.episodeIndex || (story && story.currentEpisode) || 7,
            rev: Number(res.result.nextRev || (story && story.rev) || 0),
            archivedAt: res.result.archivedAt || new Date().toISOString()
          };
          // 自动归档后保留在 reader，直到用户主动退出，避免第 7 节刚加载就跳回首页。
          this.updateActiveStoryState(completedStory);
          if (app && typeof app.clearPrefetchReservationWords === 'function') {
            app.clearPrefetchReservationWords();
          }
          this.invalidatePrefetch();
          this.clearEpisodeDraftState();
          // 立刻乐观更新“近30天AI已瞎编”，再异步校准
          const nextStories = (this.data.metrics && typeof this.data.metrics.createdStories === 'number')
            ? this.data.metrics.createdStories + 1
            : 1;
          this.setData({
            'metrics.createdStories': nextStories,
            storyHistoryList: [],
            storyHistoryGroups: [],
          });
          this.persistStoryStatsCache(nextStories);
          this.refreshStoryStats();
          if (!options.silent) {
            this.fetchDailyModeCounts();
          }
        } else {
          const updatedStory = res.result.story || {
            ...story,
            history: Array.isArray(story.history) ? story.history.concat([{
              episode: draft.episodeIndex,
              contentEn: draft.contentEn || '',
              contentMixed: draft.contentMixed || draft.contentEn || '',
              words: draft.wordsSnapshot || [],
              savedAt: new Date()
            }]) : [{
              episode: draft.episodeIndex,
              contentEn: draft.contentEn || '',
              contentMixed: draft.contentMixed || draft.contentEn || '',
              words: draft.wordsSnapshot || [],
              savedAt: new Date()
            }],
            currentEpisode: res.result.nextEpisode || (draft.episodeIndex + 1),
            status: res.result.status || 'ongoing'
          };
          this.updateActiveStoryState(updatedStory);
          this.clearEpisodeDraftState();
        }
        this._storyGenerationTiming = null;
        return { committed: true, result: res.result };
      }
      if (!options.silent) {
        wx.showToast({ title: '提交失败，请重试', icon: 'none' });
      }
      return { committed: false };
    } catch (error) {
      console.error('[Story] commitEpisodeDraft failed:', error);
      if (!options.silent) {
        wx.showToast({ title: '异常，请检查网络连接', icon: 'none' });
      }
      return { committed: false };
    } finally {
      this.setData({ episodeDraftLoading: false });
    }
  },

  async handleStoryReturnHome() {
    const story = this.data.activeStory;
    this.exitSession();
    await this.commitEpisodeDraftIfReady();
    if (story && story.status === 'completed') {
      this.updateActiveStoryState(null);
      this.fetchDailyModeCounts();
      this.setData({ selectedVibe: null, selectedVibeLabel: '', vibeChangeMode: false });
      return;
    }
    this.refreshEpisodeDraftStatus({ autoStart: false, scheduleRetry: true, silent: true });
  },

  async handleStoryProceed(e) {
    if (e && e.detail && e.detail.isFinal) {
      return;
    }
    const commitRes = await this.commitEpisodeDraftIfReady();
    if (commitRes.committed) {
      this.handleContinueSession();
    }
  },

  async handleStoryEpisodeCompleted() {
    const session = this.data.session;
    if (!session || !Array.isArray(session.words) || session.words.length === 0) return;
    const deck = session.deck || this.getActiveDeck();
    const story = this.data.activeStory;
    if (this.isStoryOngoing(story)) {
      this._storyGenerationTiming = startStoryGenerationTiming({
        storyId: story.id,
        episodeIndex: Number(story.currentEpisode || 1),
        startedAt: Date.now()
      });
    }
    await this.startEpisodeDraftGeneration(session.words, deck);
    // ✅ 进入故事页前，提前预加载下一组单词（允许在故事页阶段触发）
    const totalEpisodes = Number(story.totalEpisodes || 7);
    if (Number(story.currentEpisode || 1) < totalEpisodes) {
      setTimeout(() => {
        this.triggerPrefetch({
          allowActiveSession: true,
          reason: 'story-complete',
          targetStoryEpisode: Number(story.currentEpisode || 1) + 1
        });
      }, 300);
    }
  },

  async openEpisodeDraftStoryView() {
    const story = this.data.activeStory;
    if (!this.isStoryOngoing(story)) return;

    let draft = this.data.episodeDraft;
    if (!draft) {
      await this.refreshEpisodeDraftStatus({ autoStart: true, silent: true });
      draft = this.data.episodeDraft;
    }
    if (!draft) {
      return;
    }

    const session = this.data.session && Array.isArray(this.data.session.words) && this.data.session.words.length > 0
      ? { ...this.data.session }
      : this.buildSessionFromDraft(draft);
    app.globalData.lastSession = session;

    this.setData({
      isSessionStarted: true,
      session,
      queue: [],
      processedCards: session.words || [],
      knownCount: (session.words || []).length,
      totalCount: (session.words || []).length,
      currentCard: null,
      nextCards: [],
      uiState: 'complete',
      ringVisible: false,
      sessionVisible: false,
      sessionTranslateY: 100
    }, () => {
      if (draft.status === 'ready') {
        this.markStoryGenerationRenderReady(draft.storyId, draft.episodeIndex);
        this.autoCommitFinalEpisodeIfReady('open-story-view').catch(error => {
          console.error('[Story] auto commit final draft on open failed:', error);
        });
      }
    });

    // ✅ 故事页打开即预加载下一组（保证“继续瞎编/继续第*节”秒出词卡）
    const totalEpisodes = Number(story.totalEpisodes || 7);
    if (Number(story.currentEpisode || 1) < totalEpisodes) {
      setTimeout(() => {
        this.triggerPrefetch({
          allowActiveSession: true,
          reason: 'story-view',
          targetStoryEpisode: Number(story.currentEpisode || 1) + 1
        });
      }, 300);
    }

    if (draft.status !== 'ready') {
      this.startOrResumeEpisodeDraft(story.id, draft.episodeIndex || story.currentEpisode, {
        background: true,
        silent: true
      }).catch(error => {
        console.error('[Story] background openEpisodeDraftStoryView start failed:', error);
      });
    }
  },

  markStoryGenerationRenderReady(storyId, episodeIndex) {
    this._storyGenerationTiming = markStoryRenderReadyTiming(
      this._storyGenerationTiming,
      { storyId, episodeIndex },
      Date.now()
    );
  },

  isFinalEpisodeDraftReady(draft = this.data.episodeDraft, story = this.data.activeStory) {
    if (!draft || draft.status !== 'ready' || !story || !this.isStoryOngoing(story)) return false;
    if (draft.storyId && story.id && draft.storyId !== story.id) return false;
    const totalEpisodes = Number(story.totalEpisodes || 7);
    const episodeIndex = Number(draft.episodeIndex || 0);
    return episodeIndex >= totalEpisodes;
  },

  async autoCommitFinalEpisodeIfReady(source = '') {
    const draft = this.data.episodeDraft;
    const story = this.data.activeStory;
    if (!this.isFinalEpisodeDraftReady(draft, story)) {
      return { committed: false, skipped: true };
    }

    const autoCommitKey = `${story.id}:${draft.episodeIndex}`;
    if (this._autoCommitFinalDraftKey === autoCommitKey && this._autoCommitFinalDraftPromise) {
      return this._autoCommitFinalDraftPromise;
    }

    const commitPromise = (async () => {
      try {
        return await this.commitEpisodeDraftIfReady({ silent: true, source });
      } finally {
        if (this._autoCommitFinalDraftKey === autoCommitKey) {
          this._autoCommitFinalDraftKey = '';
          this._autoCommitFinalDraftPromise = null;
        }
      }
    })();

    this._autoCommitFinalDraftKey = autoCommitKey;
    this._autoCommitFinalDraftPromise = commitPromise;
    return commitPromise;
  },

  startEpisodeDraftPolling() {
    if (this._episodeDraftPollingTimer) return;
    this.setData({ episodeDraftPolling: true });
    this._episodeDraftPollingTimer = setInterval(async () => {
      const story = this.data.activeStory;
      const draft = this.data.episodeDraft;
      if (!this.isStoryOngoing(story) || !draft) {
        this.stopEpisodeDraftPolling();
        return;
      }
      if (draft.status === 'ready') {
        this.stopEpisodeDraftPolling();
        return;
      }
      await this.refreshEpisodeDraftStatus({ autoStart: false, silent: true });
    }, 1500);
  },

  stopEpisodeDraftPolling() {
    if (this._episodeDraftPollingTimer) {
      clearInterval(this._episodeDraftPollingTimer);
      this._episodeDraftPollingTimer = null;
    }
    if (this.data.episodeDraftPolling) {
      this.setData({ episodeDraftPolling: false });
    }
  },

  // 获取模式统计 + 故事状态/统计
  fetchDailyModeCounts() {
    console.log('[fetchDailyModeCounts] calling cloud function...');
    const storyStatusRequestId = Date.now() + Math.random();
    this._storyStatusRequestId = storyStatusRequestId;
    const p1 = wx.cloud.callFunction({
      name: 'userData',
      data: { action: 'getDailyMasteredCount' }
    });

    const p2 = wx.cloud.callFunction({
      name: 'storyData',
      data: { action: 'getStoryStatus' }
    });
    this.refreshStoryStats({ silent: true });

    return Promise.all([p1, p2]).then(([resUser, resStory]) => {
      // 1) 学习/复习统计
      if (resUser.result && resUser.result.ok) {
        const { newWords, reviewWords, total, streak, masteredCount } = resUser.result;
        const dailyModeCount = this.data.reviewMode ? reviewWords : newWords;
        const safeMasteredCount = sanitizeMasteredWords(masteredCount);
        this.setData({
          dailyModeCount,
          dailyNewWords: newWords,
          dailyReviewWords: reviewWords,
          dailyMasteredCount: total,
          streak: typeof streak === 'number' ? streak : this.data.streak,
          'metrics.masteredWords': safeMasteredCount
        });
        this.persistMasteredStatsCache(safeMasteredCount);
      }

      // 2) 故事状态
      if (resStory.result && resStory.result.ok) {
        if (this._storyStatusRequestId !== storyStatusRequestId) {
          console.log('[fetchDailyModeCounts] Ignore stale story status response');
          return;
        }
        const isExpired = !!resStory.result.expired;
        const canRevive = !!resStory.result.reviveEligible;
        if (resStory.result.expired || resStory.result.empty) {
          this.setData({
            storyExpired: isExpired,
            storyReviveEligible: canRevive
          });
          this.updateActiveStoryState(null);
        } else {
          this.setData({
            storyExpired: false,
            storyReviveEligible: false,
            storyReviveErrorCode: ''
          });
          this.updateActiveStoryState(resStory.result.story);
          this.refreshEpisodeDraftStatus({ autoStart: true, scheduleRetry: true, silent: true });
        }
      }
    }).catch(err => {
      console.error('[fetchDailyModeCounts] Error:', err);
    });
  },

  hydrateStoryStatsFromCache() {
    try {
      const cached = normalizeStoryStatsCache(wx.getStorageSync(STORY_STATS_CACHE_KEY));
      if (!cached) return;
      this.setData({
        'metrics.createdStories': cached.createdStories,
      });
    } catch (error) {
      console.warn('[hydrateStoryStatsFromCache] failed:', error);
    }
  },

  persistStoryStatsCache(createdStories) {
    try {
      wx.setStorageSync(
        STORY_STATS_CACHE_KEY,
        buildStoryStatsCachePayload(createdStories)
      );
    } catch (error) {
      console.warn('[persistStoryStatsCache] failed:', error);
    }
  },

  hydrateMasteredStatsFromCache() {
    try {
      const cached = normalizeMasteredStatsCache(wx.getStorageSync(MASTERED_STATS_CACHE_KEY));
      if (!cached) return;
      this.setData({
        'metrics.masteredWords': cached.masteredWords,
      });
    } catch (error) {
      console.warn('[hydrateMasteredStatsFromCache] failed:', error);
    }
  },

  persistMasteredStatsCache(masteredWords) {
    try {
      wx.setStorageSync(
        MASTERED_STATS_CACHE_KEY,
        buildMasteredStatsCachePayload(masteredWords)
      );
    } catch (error) {
      console.warn('[persistMasteredStatsCache] failed:', error);
    }
  },

  async handleReviveStory() {
    if (this.data.storyReviveBusy) return;

    const errorMessages = {
      REVIVE_NOT_ELIGIBLE: '当前故事不满足续写条件',
      REVIVE_LIMIT_REACHED: '本轮故事续写次数已用完',
      REVIVE_NOT_EXPIRED: '故事未断更，无需续写',
      REVIVE_STORY_MISSING: '未找到可续写的故事'
    };

    this.setData({
      storyReviveBusy: true,
      storyReviveErrorCode: ''
    });

    try {
      const res = await wx.cloud.callFunction({
        name: 'storyData',
        data: { action: 'reviveStoryCycle' }
      });

      if (res && res.result && res.result.ok) {
        this.setData({ storyReviveErrorCode: '' });
        await this.fetchDailyModeCounts();
        wx.showToast({ title: '故事已续写，继续瞎编吧', icon: 'success', duration: 1800 });
        return;
      }

      const errorCode = String((res && res.result && res.result.code) || 'REVIVE_NOT_ELIGIBLE');
      this.setData({ storyReviveErrorCode: errorCode });
      wx.showToast({ title: errorMessages[errorCode] || '续写失败，请稍后重试', icon: 'none', duration: 2000 });
    } catch (error) {
      console.error('[Story] Revive failed:', error);
      this.setData({ storyReviveErrorCode: 'REVIVE_NOT_ELIGIBLE' });
      wx.showToast({ title: '续写失败，请检查网络后重试', icon: 'none', duration: 2000 });
    } finally {
      this.setData({ storyReviveBusy: false });
    }
  },

  // 仅刷新故事统计（避免全量 fetchDailyModeCounts 的三次云函数）
  refreshStoryStats(options = {}) {
    const { silent = false } = options;
    return wx.cloud.callFunction({
      name: 'storyData',
      data: { action: 'getStats' }
    }).then((res) => {
      if (res && res.result && res.result.ok) {
        const totalStories = sanitizeCreatedStories(res.result.totalStories);
        this.setData({
          'metrics.createdStories': totalStories
        });
        this.persistStoryStatsCache(totalStories);
      }
    }).catch((err) => {
      if (!silent) {
        console.error('[refreshStoryStats] Error:', err);
      }
    });
  },

  onSessionHeaderTouchStart(e) {
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    this.sessionDragState = { startY: touch.pageY };
  },

  onSessionHeaderTouchMove(e) {
    if (!this.sessionDragState) return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaY = touch.pageY - this.sessionDragState.startY;
    if (deltaY > 0) {
      const percent = Math.min(100, deltaY / 6);
      this.setData({ sessionTranslateY: percent, sessionTransitioning: false });
    }
  },

  onSessionHeaderTouchEnd(e) {
    if (!this.sessionDragState) return;
    const touch = e.changedTouches && e.changedTouches[0];
    const deltaY = ((touch && touch.pageY) || this.sessionDragState.startY) - this.sessionDragState.startY;
    this.sessionDragState = null;

    if (deltaY > 100) {
      this.closeSessionOverlay();
    } else {
      this.setData({ sessionTranslateY: 0, sessionTransitioning: true });
    }
  },

  onSessionContentTouchStart(e) {
    if (this.data.sessionScrollTop > 5) return;
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    this.sessionContentDragState = { startY: touch.pageY };
  },

  onSessionContentTouchMove(e) {
    if (!this.sessionContentDragState) return;
    if (this.data.sessionScrollTop > 5) {
      this.sessionContentDragState = null;
      return;
    }
    const touch = e.changedTouches && e.changedTouches[0];
    if (!touch) return;
    const deltaY = touch.pageY - this.sessionContentDragState.startY;
    if (deltaY > 0) {
      const percent = Math.min(100, deltaY / 6);
      this.setData({ sessionTranslateY: percent, sessionTransitioning: false });
    }
  },

  onSessionContentTouchEnd(e) {
    if (!this.sessionContentDragState) return;
    const touch = e.changedTouches && e.changedTouches[0];
    const deltaY = ((touch && touch.pageY) || this.sessionContentDragState.startY) - this.sessionContentDragState.startY;
    this.sessionContentDragState = null;

    if (deltaY > 100) {
      this.closeSessionOverlay();
    } else {
      this.setData({ sessionTranslateY: 0, sessionTransitioning: true });
    }
  },

  closeSessionOverlay() {
    this.setData({
      sessionVisible: false,
      sessionTranslateY: 100,
      sessionTransitioning: true,
      bounceActive: true,
      guideOpacity: 1,
      guideOffsetY: 0,
      sessionScrollTop: 0,
      currentParagraphMode: "en",
    });
    setTimeout(() => this.setData({ sessionTransitioning: false }), 300);
  },

  // ==================== 段落模式切换 ====================

  prepareParagraphIfNeeded(mode) {
    const session = this.data.session;
    if (!session || !session.paragraph) return {};
    if (this.data.paragraphReady && this.data.paragraphEnglishNodes && this.data.paragraphMixedNodes) {
      return {
        englishNodes: this.data.paragraphEnglishNodes,
        mixedNodes: this.data.paragraphMixedNodes,
      };
    }
    const englishText = (session.paragraph && session.paragraph.english) || "";
    const mixedText = (session.paragraph && (session.paragraph.mixed || session.paragraph.english)) || "";
    const englishNodes = highlightParagraph(session.words, englishText, { highlight: true });
    const mixedNodes = highlightParagraph(session.words, mixedText, { highlight: false });
    this.setData({
      paragraphEnglishNodes: englishNodes,
      paragraphMixedNodes: mixedNodes,
      paragraphReady: true,
    });
    return { englishNodes, mixedNodes };
  },

  switchParagraphMode(e) {
    const rawMode = e.currentTarget.dataset.mode;
    const mode = rawMode === 'english' ? 'en' : rawMode;
    if (mode !== 'en' && mode !== 'mixed') return;
    if (!mode || mode === this.data.currentParagraphMode) return;
    this.prepareParagraphIfNeeded(mode);
    if (!this.data.session || !this.data.session.paragraph) {
      this.setData({ currentParagraphMode: mode });
      return;
    }
    if (mode === "en") {
      this.setData({ currentParagraphMode: mode, paragraphEnglishNodes: this.data.paragraphEnglishNodes });
    } else {
      this.setData({ currentParagraphMode: mode, paragraphMixedNodes: this.data.paragraphMixedNodes });
    }
  },

  toggleParagraphMode() {
    const newMode = this.data.currentParagraphMode === 'en' ? 'mixed' : 'en';
    console.log('[Paragraph] Toggle mode:', this.data.currentParagraphMode, '->', newMode);
    this.prepareParagraphIfNeeded(newMode);
    this.setData({ currentParagraphMode: newMode });
  },

  copyParagraph() {
    const { session, currentParagraphMode } = this.data;
    if (!session || !session.paragraph) return;
    const targetText = currentParagraphMode === "mixed"
      ? (session.paragraph && session.paragraph.mixed)
      : (session.paragraph && session.paragraph.english);
    if (!targetText) return;
    wx.setClipboardData({
      data: targetText,
      success: () => wx.showToast({ title: "已复制", icon: "success" }),
    });
  },

  // ==================== 继续学习 ====================

  onContinueStudy() {
    this.setData({ sessionVisible: false, sessionTranslateY: 100 });
    if (this.data.reviewMode) {
      this.setData({ reviewMode: false });
      app.globalData.reviewMode = false;
    }

    this.handleGenerate({ reason: "continue" });
  },

  onStartReview() {
    this.setData({ sessionVisible: false, sessionTranslateY: 100 });
    if (!this.data.reviewMode) {
      this.setData({ reviewMode: true });
      app.globalData.reviewMode = true;
    }
    this.handleGenerate({ reason: "review" });
  },

  // ==================== 轮询等待 session ====================

  waitForSessionReady() {
    const self = this;
    let attempts = 0;
    const maxAttempts = 150;

    const check = function () {
      attempts++;
      console.log("[waitForSessionReady] 检查 #" + attempts);

      if (app.globalData.lastSession) {
        console.log("[waitForSessionReady] Session 已就绪，开始渲染");
        self.setData({ isGenerating: false });
        sessionManager.hydrateSession(self, app, app.globalData.lastSession);
        return;
      }

      if (self.data.generationError) {
        console.log("[waitForSessionReady] 检测到生成错误，停止等待");
        self.setData({ uiState: "idle", isGenerating: false });
        return;
      }

      if (attempts >= maxAttempts) {
        console.log("[waitForSessionReady] 等待超时，尝试重新生成");
        self.setData({ isGenerating: false });
        self.handleGenerate({ reason: "timeout-retry" });
        return;
      }
      setTimeout(check, 100);
    };
    check();
  },

  // ==================== 词库选择 (Deck Modal) ====================
  showDeckSelector() {
    this.setData({ showDeckSelectModal: true });
  },

  hideDeckSelector() {
    this.setData({ showDeckSelectModal: false });
  },

  async selectDeck(e) {
    const deckId = e.currentTarget.dataset.id;
    if (!deckId || deckId === this.data.currentDeckId) {
      this.hideDeckSelector();
      return;
    }

    const deck = this.data.deckList.find(d => d.id === deckId);
    if (!deck) return;

    const isSessionActive = this.data.isSessionStarted;
    const prevDeckId = this.data.currentDeckId;
    const prevDeckName = this.data.currentDeckName;
    const prevDeckTags = this.data.currentDeckTags;

    // 显示加载提示
    wx.showLoading({ title: '切换中...', mask: true });

    try {
      // 先更新本地状态
      this.setData({
        currentDeckId: deck.id,
        currentDeckName: deck.name,
        currentDeckTags: deck.tags
      });

      // 等待云端保存完成
      if (app.globalData.userAuthorized) {
        await wx.cloud.callFunction({
          name: 'userData',
          data: {
            action: 'updateSettings',
            settings: { defaultDeckId: deck.id }
          }
        });

        // 更新全局状态
        if (app.globalData.userProfile) {
          if (!app.globalData.userProfile.settings) app.globalData.userProfile.settings = {};
          app.globalData.userProfile.settings.defaultDeckId = deck.id;
        }
      }

      // 切换词库后失效预加载（不打断当前会话，只影响下一组出词）
      this.invalidatePrefetch();
      this.hideDeckSelector();
      wx.hideLoading();
      wx.showToast({
        title: isSessionActive ? '词库已切换，下次出词生效' : '词库已切换',
        icon: 'success',
        duration: 1500
      });
    } catch (err) {
      console.error('[Deck] Save failed:', err);
      wx.hideLoading();
      const errMsg = String(err && (err.message || err.errMsg || err)).toLowerCase();
      const isNetworkError = errMsg.includes('request:fail') || errMsg.includes('network') || errMsg.includes('timeout');
      wx.showToast({
        title: isNetworkError ? '异常，请检查网络连接' : '切换失败，请重试',
        icon: 'none',
        duration: 2000
      });

      // 保存失败，恢复原词库
      this.setData({
        currentDeckId: prevDeckId,
        currentDeckName: prevDeckName,
        currentDeckTags: prevDeckTags
      });
      this.invalidatePrefetch();
    }
  },

  // ==================== 往期故事抽屉 (Story History Drawer) ====================
  showStoryHistory() {
    if (this.data.storyHistoryLoading) {
      this.setData({
        showStoryHistoryDrawer: true,
        storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ loading: true }),
      });
      return;
    }

    const shouldReload = shouldReloadStoryHistory(
      this.data.storyHistoryList,
      this.data.metrics && this.data.metrics.createdStories
    );

    if ((this.data.storyHistoryList.length === 0 || shouldReload) && !this.data.storyHistoryLoading) {
      this.setData({
        showStoryHistoryDrawer: true,
        storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ loading: true }),
      });
      this.loadStoryArchiveList();
      return;
    }

    const groups = this.buildStoryHistoryGroups(this.data.storyHistoryList);
    this.setData({
      showStoryHistoryDrawer: true,
      storyHistoryGroups: groups,
      storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ groups }),
    });
  },

  closeStoryHistory() {
    this.setData({ showStoryHistoryDrawer: false });
  },

  async loadStoryArchiveList() {
    this.setData({
      storyHistoryLoading: true,
      storyHistoryGroups: [],
      storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ loading: true }),
    });
    try {
      const res = await wx.cloud.callFunction({
        name: 'storyData',
        data: { action: 'getStoryArchiveList' }
      });
      if (res.result && res.result.ok && Array.isArray(res.result.list)) {
        const list = res.result.list.map(item => ({
          ...item,
          formattedDate: this._formatArchiveDate(item.archivedAt)
        }));
        const groups = this.buildStoryHistoryGroups(list);
        this.setData({
          storyHistoryList: list,
          storyHistoryGroups: groups,
          storyHistoryLoading: false,
          storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ groups, empty: groups.length === 0 }),
        });
      } else {
        this.setData({
          storyHistoryList: [],
          storyHistoryGroups: [],
          storyHistoryLoading: false,
          storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ empty: true }),
        });
      }
    } catch (err) {
      console.error('[StoryHistory] Load failed:', err);
      this.setData({
        storyHistoryList: [],
        storyHistoryGroups: [],
        storyHistoryLoading: false,
        storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ empty: true }),
      });
    }
  },

  buildStoryHistoryGroups(list) {
    return groupStoryHistory(list);
  },

  computeStoryHistoryDrawerHeight(options = {}) {
    const groups = Array.isArray(options.groups) ? options.groups : this.data.storyHistoryGroups;
    const expandedStoryCount = groups.reduce((count, group) => {
      if (!group || !group.expanded || !Array.isArray(group.stories)) return count;
      return count + group.stories.length;
    }, 0);

    return calculateStoryDrawerHeight({
      groupCount: groups.length,
      expandedStoryCount,
      windowHeight: this.data.windowHeight,
      safeAreaBottom: this.data.safeAreaBottom,
      loading: !!options.loading,
      empty: !!options.empty,
    });
  },

  toggleStoryHistoryGroup(e) {
    const { theme } = e.currentTarget.dataset;
    if (!theme) return;

    const groups = this.data.storyHistoryGroups.map((group) => {
      if (!group || group.theme !== theme) {
        return {
          ...group,
          expanded: false,
        };
      }
      return {
        ...group,
        expanded: !group.expanded,
      };
    });

    this.setData({
      storyHistoryGroups: groups,
      storyHistoryDrawerHeight: this.computeStoryHistoryDrawerHeight({ groups }),
    });
  },

  _formatArchiveDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },

  openStoryArchive(e) {
    const { storyid } = e.currentTarget.dataset;
    if (!storyid) return;
    this.setData({ showStoryHistoryDrawer: false }, () => {
      wx.navigateTo({ url: `/pages/storyArchive/index?storyId=${storyid}` });
    });
  },

  trackSeenWord(word) {
    const normalized = String(word || '').trim().toLowerCase();
    if (!normalized) return;
    const currentUserId = String(
      app.globalData.currentOpenid ||
      (app.globalData.userProfile && app.globalData.userProfile._id) ||
      ''
    ).trim();
    if (!(app.globalData.seenWordsCache instanceof Set)) {
      app.globalData.seenWordsCache = new Set();
    }
    if (currentUserId && app.globalData.seenWordsCacheOwnerId && app.globalData.seenWordsCacheOwnerId !== currentUserId) {
      app.globalData.seenWordsCache = new Set();
    }
    if (currentUserId) {
      app.globalData.seenWordsCacheOwnerId = currentUserId;
    }
    app.globalData.seenWordsCache.add(normalized);
    app.globalData.seenWordsCacheTime = Date.now();
  },

  resetWordSyncBarrier() {
    this._pendingWordSyncs = new Set();
    this._currentBatchWordSyncFailed = false;
    this._currentBatchWordSyncError = '';
  },

  registerWordSyncPromise(promise) {
    if (!promise || typeof promise.then !== 'function') {
      return promise;
    }
    if (!this._pendingWordSyncs) {
      this._pendingWordSyncs = new Set();
    }
    this._pendingWordSyncs.add(promise);
    promise.finally(() => {
      if (this._pendingWordSyncs) {
        this._pendingWordSyncs.delete(promise);
      }
    });
    return promise;
  },

  async waitForPendingWordSyncs() {
    const pending = Array.from(this._pendingWordSyncs || []);
    if (pending.length > 0) {
      const results = await Promise.all(pending);
      const hasFailure = results.some((item) => !item || item.ok === false);
      if (hasFailure) {
        this._currentBatchWordSyncFailed = true;
      }
    }

    if (this._currentBatchWordSyncFailed) {
      try {
        const retryResult = await syncQueue.processQueue();
        if (!retryResult.remaining) {
          this._currentBatchWordSyncFailed = false;
          this._currentBatchWordSyncError = '';
          if (typeof app.getSeenWords === 'function') {
            await app.getSeenWords(true);
          }
          return true;
        }
      } catch (e) {
        console.warn('[SyncBarrier] retry queue processing failed:', e);
      }
      const message = this._currentBatchWordSyncError || '单词同步失败，请检查网络后重试';
      try {
        wx.showToast({ title: message, icon: 'none', duration: 2000 });
      } catch (e) {
        console.warn('[SyncBarrier] toast failed:', e);
      }
      return false;
    }

    return true;
  },

  // ==================== Prefetch Logic ====================

  /**
   * 触发预加载
   */
  async triggerPrefetch(options = {}) {
    const { allowActiveSession = false, reason = 'default', targetStoryEpisode } = options;
    const batchId = this.createPrefetchBatchId(reason);
    // 【保护】如果用户已经开始学习，默认跳过预加载（避免覆盖当前状态）
    if (this.data.isSessionStarted && !allowActiveSession) {
      console.log('[Prefetch] Skipped: session already started');
      return;
    }
    if (this.isPrefetchValid()) {
      console.log('[Prefetch] Skipped: already has prefetched batch', { reason });
      return;
    }
    if (this.data.prefetchedBatch || this.data.prefetchValid) {
      console.log('[Prefetch] Drop stale in-memory batch before starting new prefetch', { reason });
      this.invalidatePrefetch();
    }

    const prefetchRequestId = Date.now() + Math.random();
    this._prefetchRequestId = prefetchRequestId;

    try {
      const syncReady = await this.waitForPendingWordSyncs();
      if (!syncReady) {
        console.warn('[Prefetch] Skipped: pending word syncs failed', { reason });
        return;
      }

      const ordering = await this.ensureProfileSettingsFresh();
      const settings = this.getCurrentSettingsSnapshot({ targetStoryEpisode, batchId });
      this.traceLearningFlow('prefetch-triggered', {
        batchId,
        reason,
        storyId: settings.storyId,
        storyEpisode: settings.storyEpisode,
        orderMode: settings.orderMode,
        orderAlphaLetter: settings.orderAlphaLetter,
        reviewMode: settings.reviewMode
      });
      console.log('[Prefetch] Effective ordering:', {
        orderMode: ordering.orderMode,
        orderAlphaLetter: ordering.orderAlphaLetter
      });
      console.log('[Prefetch] Triggering background prefetch...', { reason });

      const batch = await prefetchNextBatch(this, app, {
        reviewMode: this.data.reviewMode,
        orderMode: ordering.orderMode,
        orderAlphaLetter: ordering.orderAlphaLetter,
      });

      if (this._prefetchRequestId !== prefetchRequestId) {
        console.log('[Prefetch] Discard stale prefetch response', { reason });
        return;
      }

      // 【二次检查】预加载完成后，再次确认用户没有开始学习
      if (this.data.isSessionStarted && !allowActiveSession) {
        console.log('[Prefetch] Discarded: session started during prefetch');
        return;
      }

      this.attachPrefetchDebugMeta(batch, settings, { reason, source: 'fresh-prefetch' });
      this.setData({
        prefetchedBatch: batch,
        prefetchValid: true,
        prefetchSettings: settings
      });
      this.persistPrefetchedBatch(batch, settings);
      if (app && typeof app.setPrefetchReservationWords === 'function') {
        app.setPrefetchReservationWords(batch.words);
      }
      this.traceLearningFlow('prefetch-ready', {
        batchId,
        reason,
        storyId: settings.storyId,
        storyEpisode: settings.storyEpisode,
        firstWords: this.summarizeWords(batch.words, 3),
        lastWords: this.summarizeWords(batch.words.slice(-3), 3)
      });

      console.log('[Prefetch] Success! Batch ready:', batch.words.length, 'words');
      console.log('[Prefetch] 📦 预加载单词列表:', batch.words.map(w => w.word).join(', '));
    } catch (e) {
      console.error('[Prefetch] Failed:', e);
      // 预加载失败不影响主流程
    }
  },

  /**
   * 检查预加载是否有效
   */
  isPrefetchValid() {
    if (!this.data.prefetchValid || !this.data.prefetchedBatch) {
      return false;
    }

    const prefetchSettings = this.data.prefetchSettings;

    if (!prefetchSettings) return false;
    const isValid = this.isSettingsCompatible(prefetchSettings);

    if (!isValid) {
      const mismatchReason = this.getPrefetchMismatchReason(prefetchSettings) || 'unknown';
      console.log('[Prefetch] Validation failed:', {
        current: this.getCurrentSettingsSnapshot(),
        cached: prefetchSettings,
        mismatchReason
      });
      this.traceLearningFlow('prefetch-invalidated', {
        reason: mismatchReason,
        batchId: prefetchSettings.batchId || '',
        cached: prefetchSettings
      });
    }

    return isValid;
  },

  summarizeWords(words, limit = 3) {
    if (!Array.isArray(words)) return [];
    return words.slice(0, limit).map((item) => {
      if (typeof item === 'string') return item;
      return item && item.word ? item.word : '';
    }).filter(Boolean);
  },

  traceLearningFlow(event, payload = {}) {
    if (app && typeof app.addDebugTrace === 'function') {
      app.addDebugTrace(event, payload);
    }
  },

  createPrefetchBatchId(reason = 'default') {
    return `prefetch-${reason}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  },

  attachPrefetchDebugMeta(batch, settings, context = {}) {
    if (!batch || !settings) return batch;
    batch.debugMeta = {
      ...(batch.debugMeta || {}),
      batchId: settings.batchId || '',
      reason: context.reason || '',
      source: context.source || '',
      storyId: settings.storyId || '',
      storyEpisode: settings.storyEpisode || 0,
      selectionVersion: settings.wordSelectionVersion || '',
      createdAt: Date.now(),
      wordCount: Array.isArray(batch.words) ? batch.words.length : 0,
      firstWords: this.summarizeWords(batch.words, 3),
      lastWords: this.summarizeWords(Array.isArray(batch.words) ? batch.words.slice(-3) : [], 3)
    };
    return batch;
  },

  /**
   * 获取当前设置快照
   */
  getCurrentSettingsSnapshot(options = {}) {
    const story = this.data.activeStory;
    const ordering = this.getAuthoritativeOrderingSettings();
    return {
      deckId: this.data.currentDeckId,
      wordCount: this.data.wordCount,
      reviewMode: this.data.reviewMode,
      orderMode: ordering.orderMode,
      orderAlphaLetter: ordering.orderAlphaLetter,
      storyId: story && story.id ? story.id : '',
      batchId: options.batchId || '',
      storyEpisode: this.getPrefetchTargetStoryEpisode(options),
      wordSelectionVersion: WORD_SELECTION_VERSION,
      timestamp: Date.now()
    };
  },

  getPrefetchMismatchReason(prefetchSettings) {
    if (!prefetchSettings) return 'missing-settings';
    const currentSettings = this.getCurrentSettingsSnapshot();
    if (currentSettings.deckId !== prefetchSettings.deckId) return 'deck-id-mismatch';
    if (currentSettings.wordCount !== prefetchSettings.wordCount) return 'word-count-mismatch';
    if (currentSettings.reviewMode !== prefetchSettings.reviewMode) return 'review-mode-mismatch';
    if (currentSettings.orderMode !== prefetchSettings.orderMode) return 'order-mode-mismatch';
    if (currentSettings.orderAlphaLetter !== prefetchSettings.orderAlphaLetter) return 'alpha-letter-mismatch';
    if (currentSettings.storyId !== (prefetchSettings.storyId || '')) return 'story-id-mismatch';
    if (currentSettings.storyEpisode !== this.normalizeStoryEpisode(prefetchSettings.storyEpisode)) return 'story-episode-mismatch';
    if (currentSettings.wordSelectionVersion !== (prefetchSettings.wordSelectionVersion || '')) return 'selection-version-mismatch';
    return '';
  },

  isSettingsCompatible(prefetchSettings) {
    return !this.getPrefetchMismatchReason(prefetchSettings);
  },

  /**
   * 使用预加载的批次
   */
  usePreloadedBatch() {
    console.log('[Prefetch] Using preloaded batch ✅');
    console.log('[Prefetch] 📦 实际加载的预加载单词:', this.data.prefetchedBatch.words.map(w => w.word).join(', '));

    const batch = this.data.prefetchedBatch;
    const story = this.data.activeStory;
    this.traceLearningFlow('prefetch-consumed', {
      batchId: batch && batch.debugMeta && batch.debugMeta.batchId ? batch.debugMeta.batchId : '',
      source: batch && batch.debugMeta && batch.debugMeta.source ? batch.debugMeta.source : '',
      storyId: batch && batch.debugMeta && batch.debugMeta.storyId ? batch.debugMeta.storyId : '',
      storyEpisode: batch && batch.debugMeta && batch.debugMeta.storyEpisode ? batch.debugMeta.storyEpisode : 0,
      firstWords: this.summarizeWords(batch && batch.words, 3)
    });
    this.clearPersistedPrefetchBatch();
    if (app && typeof app.clearPrefetchReservationWords === 'function') {
      app.clearPrefetchReservationWords();
    }

    // 构造 session 对象
    const initialSession = {
      storyId: story && story.id ? story.id : '',
      words: batch.words,
      paragraph: { english: "Creating story...", mixed: "故事生成中..." },
      deck: batch.deck,
      wordCount: batch.wordCount,
      wordSelectionVersion: WORD_SELECTION_VERSION,
      generatedAt: Date.now()
    };

    // 直接 hydrate
    sessionManager.hydrateSession(this, app, initialSession);

    // 清空预加载
    this.setData({
      prefetchedBatch: null,
      prefetchValid: false,
      prefetchSettings: null
    });

    // ✅ 已弃用非故事模式段落生成：如果正在进行故事，则为当前 episode 触发草稿生成
    if (this.isStoryOngoing(story) && typeof this.startEpisodeDraftGeneration === 'function') {
      this.startEpisodeDraftGeneration(batch.words, batch.deck);
    }
  },

  /**
   * 🏷️ 统一更新故事状态 & 计算题材
   * @param {object} story - story 对象 (nullable)
   */
  updateActiveStoryState(story, done) {
    if (!story) {
      if (app && typeof app.clearPrefetchReservationWords === 'function') {
        app.clearPrefetchReservationWords();
      }
      this.setData({ activeStory: null, activeStoryTheme: null, remainingDays: 0, storyDisplayEpisode: 1 }, () => {
        this.clearEpisodeDraftState();
        this.refreshActionButtonText();
        if (typeof done === 'function') done();
      });
      return;
    }

    // 计算 Theme Display
    const themeId = normalizeThemeId(story.theme || 'Fantasy');
    const themeOption = this.data.vibeOptions.find(v => v.id === themeId) || this.data.vibeOptions[2];

    // 计算断更天数 (7天周期)
    const toTimestamp = (value) => {
      if (!value) return null;
      if (value instanceof Date) return value.getTime();
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
      }
      if (typeof value === 'object') {
        if (typeof value.getTime === 'function') return value.getTime();
        if (typeof value.$date === 'number') return value.$date;
        if (typeof value.$date === 'string') {
          const parsed = Date.parse(value.$date);
          return Number.isNaN(parsed) ? null : parsed;
        }
        if (typeof value.seconds === 'number') return value.seconds * 1000;
        if (typeof value._seconds === 'number') return value._seconds * 1000;
      }
      return null;
    };

    const startTimeMs = toTimestamp(story.startTime) || toTimestamp(story.lastUpdateTime) || Date.now();
    const now = Date.now();
    const diffDays = (now - startTimeMs) / (24 * 3600 * 1000);
    const remainingDays = Math.max(0, Math.ceil(7 - diffDays));

    this.setData({
      activeStory: story,
      activeStoryTheme: themeOption,
      remainingDays,
      storyDisplayEpisode: story.currentEpisode || 1
    }, () => {
      if (!this.isSessionCompatibleWithActiveStory(app.globalData.lastSession)) {
        app.globalData.lastSession = null;
        try { wx.removeStorageSync(PERSISTED_SESSION_KEY); } catch (e) { console.warn('[Story] removeStorageSync error:', e); }
      }
      this.refreshActionButtonText();
      if (typeof done === 'function') done();
    });
  },

  getActiveStoryId() {
    const story = this.data.activeStory;
    return story && story.id ? String(story.id) : '';
  },

  isSessionCompatibleWithActiveStory(session) {
    if (!session || typeof session !== 'object') return false;
    const activeStoryId = this.getActiveStoryId();
    if (!activeStoryId) return true;
    const sessionStoryId = typeof session.storyId === 'string' ? session.storyId : '';
    return !!sessionStoryId && sessionStoryId === activeStoryId;
  },

  /**
   * 失效预加载
   */
  invalidatePrefetch() {
    this._prefetchRequestId = 0;
    this.clearPersistedPrefetchBatch();
    if (app && typeof app.clearPrefetchReservationWords === 'function') {
      app.clearPrefetchReservationWords();
    }
    this.setData({
      prefetchedBatch: null,
      prefetchValid: false,
      prefetchSettings: null
    });
    console.log('[Prefetch] Invalidated');
  }
});
