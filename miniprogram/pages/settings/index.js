const app = getApp();
const {
  WORD_COUNT_MIN,
  WORD_COUNT_MAX,
  WORD_COUNT_DEFAULT,
  WORD_COUNT_STEP,
  clampWordCount,
} = require("../../utils/settings");
const { DECK_LIBRARY, DEFAULT_DECK_ID } = require("../../utils/decks");
const { callUserData, callStoryData } = require("../../utils/cloudCall");
const { MODEL_OPTIONS, DEFAULT_AI_MODEL } = require("../../utils/aiModels");
const { loadEvalModeEnabled, saveEvalModeEnabled } = require("../../utils/storyEval");
const { getWindowMetrics } = require("../../utils/windowInfo");

const LOCKED_MODEL_OPTION = MODEL_OPTIONS.find((item) => item && item.value === DEFAULT_AI_MODEL) || MODEL_OPTIONS[0];

function normalizeNormalWordCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return WORD_COUNT_DEFAULT;
  if (num === 1) return WORD_COUNT_DEFAULT;
  return clampWordCount(num);
}

function readCachedWordCount(cached) {
  const raw = cached && typeof cached === 'object'
    ? (cached.normalWordCount ?? cached.testModeWordCount)
    : null;
  return typeof raw === 'number' ? normalizeNormalWordCount(raw) : null;
}

Page({
  data: {
    deckOptions: DECK_LIBRARY,
    currentDeckId: DEFAULT_DECK_ID,
    wordCount: WORD_COUNT_DEFAULT,
    wordCountMin: WORD_COUNT_MIN,
    wordCountMax: WORD_COUNT_MAX,
    wordCountStep: WORD_COUNT_STEP,
    testMode: false,
    orderOptions: ["按首字母", "按相似", "乱序"],
    orderIndex: 0,
    letters: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"],
    letterIndex: 0,
    // User info
    userProfile: null,
    nickName: "",
    avatarUrl: "",
    knownCount: 0,
    unknownCount: 0,
    totalLearned: 0,
    studyDays: 0,
    reviewModeDefault: false,
    cefrLevels: ["A1", "A2", "B1", "B2", "C1", "C2"],
    cefrIndex: 1,
    modelOptions: [LOCKED_MODEL_OPTION],
    modelIndex: 0,
    evalModeEnabled: false,
    showEvalDevPanel: false,
    hasModified: false,
    changeLocked: false,
    todayKey: '',
    isAuthorized: false,
    canIUseGetUserProfile: false,
    authLoading: false,
    authFailed: false,
    hasWeChatProfile: false,
    statusBarHeight: 20,
  },

  async onLoad() {
    const { statusBarHeight } = getWindowMetrics();

    try {
      await app.ensureAuthSession();
    } catch (e) {
      console.error('[Settings] ensureAuthSession failed', e);
    }
    this.setData({
      statusBarHeight,
      isAuthorized: !!app.globalData.userAuthorized,
      canIUseGetUserProfile: !!wx.getUserProfile,
      evalModeEnabled: loadEvalModeEnabled(),
      showEvalDevPanel: !!app.globalData.storyEvalModeEnabled,
    });
    this.initChangeQuota();
    this.loadUserProfile();
    this.loadSettings();
  },

  async onShow() {
    try {
      await app.ensureAuthSession();
    } catch (e) {
      console.error('[Settings] ensureAuthSession failed', e);
    }
    this.setData({ isAuthorized: !!app.globalData.userAuthorized });
    const evalModeEnabled = loadEvalModeEnabled();
    this.setData({
      evalModeEnabled,
      showEvalDevPanel: this.data.showEvalDevPanel || evalModeEnabled,
    });
    if (app.globalData.userAuthorized) {
      this.loadUserProfile();
    }
  },

  // 页面卸载时保存设置（无论用户如何返回都会触发）
  onUnload() {
    console.log('[Settings] onUnload 触发');
    console.log('[Settings] hasModified:', this.data.hasModified);
    console.log('[Settings] testMode:', this.data.testMode);

    // 🆕 计算有效的单词数量（测试模式下为1）
    const effectiveWordCount = this.data.testMode ? 1 : this.data.wordCount;
    const currentOrderMode = this.data.orderIndex === 0 ? 'alphabet' : (this.data.orderIndex === 1 ? 'similar' : 'shuffle');
    const currentOrderAlphaLetter = (this.data.letters[this.data.letterIndex] || 'A').toLowerCase();

    // Save settings to index page
    const pages = getCurrentPages();
    if (pages.length > 1) {
      const indexPage = pages[pages.length - 2];
      if (indexPage && indexPage.setData) {
        const isSessionActive = !!(indexPage.data && indexPage.data.isSessionStarted);
        const nextData = {
          currentDeckId: this.data.currentDeckId,
          wordCount: effectiveWordCount,
          todayGoal: effectiveWordCount,
          testMode: this.data.testMode,
          currentOrderMode,
          currentOrderAlphaLetter,
        };
        if (!isSessionActive) {
          // 清除旧 session，强制重新生成
          nextData.session = null;
        }
        indexPage.setData(nextData, () => {
          if (typeof indexPage.refreshDeckInfo === 'function') {
            indexPage.refreshDeckInfo(this.data.currentDeckId);
          }
          if (typeof indexPage.syncUserState === 'function') {
            indexPage.syncUserState();
          }
        });
      }
    }

    if (this.data.hasModified) {
      console.log('[Settings] 检测到设置已修改，设置 pendingRegenerate');
      const today = this.data.todayKey || this.getTodayKey();
      try { wx.setStorageSync('settingsChangeDate', today); } catch (e) { console.warn('[Settings] setStorage error:', e); }
      try {
        const indexPage = pages.length > 1 ? pages[pages.length - 2] : null;
        const isSessionActive = !!(indexPage && indexPage.data && indexPage.data.isSessionStarted);
        if (!isSessionActive) {
          // Clear any old session so index won't hydrate stale deck
          app.globalData.lastSession = null;
        }
        app.globalData.pendingRegenerate = {
          reason: 'settings-update',
          deckId: this.data.currentDeckId,
          wordCount: effectiveWordCount,
          testMode: this.data.testMode,
          orderMode: currentOrderMode,
          orderAlphaLetter: currentOrderAlphaLetter
        };
        console.log('[Settings] pendingRegenerate 已设置:', app.globalData.pendingRegenerate);
      } catch (e) {
        console.error('[Settings] 设置 pendingRegenerate 失败:', e);
      }
    } else {
      console.log('[Settings] hasModified=false，不设置 pendingRegenerate');
    }
  },

  async loadUserProfile() {
    if (!app.globalData.isAuthenticated) {
      return;
    }

    const userProfile = app.globalData.userProfile;
    if (userProfile) {
      this.displayUserInfo(userProfile);
    } else {
      // Fetch from cloud
      try {
        await app.fetchUserProfile();
        const profile = app.globalData.userProfile;
        if (profile) {
          this.displayUserInfo(profile);
        }
      } catch (e) {
        console.error('[Settings] loadUserProfile error:', e);
      }
    }
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
      success: (res) => {
        console.log('[Settings] getUserProfile success:', res && res.userInfo);
        this.loginWithProfile(res.userInfo);
      },
      fail: (err) => {
        console.error('[Settings] Auth denied', err);
        wx.showToast({ title: '授权失败', icon: 'none' });
        this.setData({ authLoading: false, authFailed: true });
      }
    });
  },

  // New WeChat avatar picker flow (2021+ API)
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    if (!avatarUrl) return;

    this.setData({ avatarUrl });
    // Update local cache
    try {
      const cached = wx.getStorageSync('userProfileCache') || {};
      cached.avatarUrl = avatarUrl;
      wx.setStorageSync('userProfileCache', cached);
      wx.removeStorageSync('authPromptDismissed');
    } catch (e) { console.warn('[Settings] cache update error:', e); }
    // Update global
    app.globalData.userProfile = app.globalData.userProfile || {};
    app.globalData.userProfile.avatarUrl = avatarUrl;
    // Sync to cloud
    this.updateUserSettings({ avatarUrl });
  },

  onNicknameInput(e) {
    const nickName = e.detail.value || '';
    this.setData({ nickName });
  },

  onNicknameBlur(e) {
    const nickName = (e.detail.value || '').trim();
    if (!nickName) return;

    this.setData({ nickName });
    // Update local cache
    try {
      const cached = wx.getStorageSync('userProfileCache') || {};
      cached.nickName = nickName;
      wx.setStorageSync('userProfileCache', cached);
      wx.removeStorageSync('authPromptDismissed');
    } catch (e) { console.warn('[Settings] cache update error:', e); }
    // Update global
    app.globalData.userProfile = app.globalData.userProfile || {};
    app.globalData.userProfile.nickName = nickName;
    // Sync to cloud
    this.updateUserSettings({ nickName });
  },

  loginWithProfile(userInfo) {
    app.syncWeChatProfile(userInfo).then(() => {
      if (app.globalData.userProfile) {
        this.displayUserInfo(app.globalData.userProfile);
      }
      this.setData({ isAuthorized: true, authLoading: false, authFailed: false, hasWeChatProfile: true });
    }).catch((err) => {
      console.error('[Settings] sync profile failed', err);
      this.setData({ authLoading: false, authFailed: true });
    });
  },

  displayUserInfo(profile) {
    const cached = wx.getStorageSync('userProfileCache') || {};
    const counters = profile.counters || {};
    const settings = profile.settings || {};
    const createdAt = profile.createdAt ? new Date(profile.createdAt) : null;
    const now = new Date();
    const streakDays = typeof counters.streak === 'number' ? counters.streak : 0;
    const totalLearned = counters.totalLearned || 0;
    // 如果从未学习过（重置后），显示 0 天；否则使用 streak 或从创建日期计算
    const studyDays = totalLearned === 0 ? 0
      : (streakDays > 0 ? streakDays
        : (createdAt ? Math.max(0, Math.ceil((now - createdAt) / (1000 * 60 * 60 * 24))) : 0));
    const deckId = settings.defaultDeckId || profile.lastDeckId || DEFAULT_DECK_ID;
    const cefrLevels = this.data.cefrLevels || ["A1", "A2", "B1", "B2", "C1", "C2"];
    const cefrLevel = (settings.cefrLevel || "A1").toUpperCase();
    const cefrIndex = Math.max(0, cefrLevels.indexOf(cefrLevel));
    const aiModel = typeof settings.aiModel === 'string' ? settings.aiModel : DEFAULT_AI_MODEL;

    const nickName = profile.nickName || cached.nickName || "";
    const avatarUrl = profile.avatarUrl || cached.avatarUrl || "";

    const cachedNormalWordCount = readCachedWordCount(cached);
    const serverWordCountRaw = typeof settings.dailyNewCount === 'number' ? settings.dailyNewCount : WORD_COUNT_DEFAULT;
    let serverWordCount = clampWordCount(serverWordCountRaw);
    const resolvedTestMode = !!settings.testMode || !!cached.testMode || false;
    let displayWordCount = resolvedTestMode
      ? (cachedNormalWordCount || normalizeNormalWordCount(serverWordCount))
      : normalizeNormalWordCount(serverWordCount);

    // 修复异常：测试模式关闭但云端 dailyNewCount 仍为 1
    if (!resolvedTestMode && serverWordCount === 1) {
      displayWordCount = cachedNormalWordCount || WORD_COUNT_DEFAULT;
      try {
        cached.normalWordCount = displayWordCount;
        wx.setStorageSync('userProfileCache', cached);
      } catch (e) { console.warn('[Settings] cache update error:', e); }

      try {
        app.globalData.userProfile = app.globalData.userProfile || {};
        app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
        app.globalData.userProfile.settings.dailyNewCount = displayWordCount;
      } catch (e) { console.warn('[Settings] globalData error:', e); }

      if (app.globalData.userAuthorized) {
        this.updateUserSettings({ dailyNewCount: displayWordCount }).catch(() => { });
      }
    }

    this.setData({
      userProfile: profile,
      nickName: nickName || '微信用户',
      avatarUrl: avatarUrl || '',
      knownCount: counters.known || 0,
      unknownCount: counters.unknown || 0,
      totalLearned: counters.totalLearned || 0,
      studyDays: studyDays,
      reviewModeDefault: settings.reviewModeDefault || false,
      wordCount: displayWordCount,
      testMode: resolvedTestMode, // 🆕 同步测试模式状态
      currentDeckId: deckId,
      cefrIndex,
      modelIndex: 0,
      orderIndex: settings.orderMode === 'alphabet' ? 0 : (settings.orderMode === 'similar' ? 1 : 2),
      letterIndex: this.getLetterIndex(settings.orderAlphaLetter || 'a'),
      hasWeChatProfile: !!(nickName || avatarUrl),
    });

    if (aiModel !== DEFAULT_AI_MODEL) {
      try {
        app.globalData.userProfile = app.globalData.userProfile || {};
        app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
        app.globalData.userProfile.settings.aiModel = DEFAULT_AI_MODEL;
      } catch (error) {
        console.warn('[Settings] failed to normalize global aiModel', error);
      }

      if (app.globalData.userAuthorized) {
        this.updateUserSettings({ aiModel: DEFAULT_AI_MODEL }).catch((error) => {
          console.error('[Settings] normalize aiModel failed:', error);
        });
      }
    }
  },

  getLetterIndex(ch) {
    const idx = this.data.letters.indexOf((ch || 'a').toUpperCase());
    return idx >= 0 ? idx : 0;
  },

  getModelIndex(modelName) {
    const list = this.data.modelOptions || MODEL_OPTIONS;
    const idx = list.findIndex((item) => item && item.value === modelName);
    return idx >= 0 ? idx : 0;
  },

  loadSettings() {
    // 设置页始终显示用户保存的配置，不从 session 覆盖
    // 用户保存的设置已在 displayUserInfo() 中从云端加载
  },

  onDeckRadioChange(e) {
    const newDeckId = e.detail.value;
    const currentDeckId = this.data.currentDeckId;

    // 如果是同一个词库，无需操作
    if (newDeckId === currentDeckId) return;

    if (!this.ensureChangeAllowed()) {
      this.setData({ currentDeckId: currentDeckId });
      return;
    }

    // 切换词库是重大变更，需要确认
    wx.showModal({
      title: '更换词库',
      content: '更换词库将清空当前学习进度。已学单词、复习记录都会被重置。确定要继续吗？',
      confirmText: '确定更换',
      confirmColor: '#FF6B6B',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.performDeckChange(newDeckId);
        } else {
          // 用户取消，恢复原选择
          this.setData({ currentDeckId: currentDeckId });
        }
      }
    });
  },

  async performDeckChange(newDeckId) {
    wx.showLoading({ title: '切换中...' });

    try {
      // 清空用户的单词学习数据
      if (app.globalData.userAuthorized) {
        await wx.cloud.callFunction({
          name: 'userData',
          data: { action: 'resetUserData' }
        });
      }

      // 更新设置
      this.setData({ currentDeckId: newDeckId });
      try {
        app.globalData.userProfile = app.globalData.userProfile || {};
        app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
        app.globalData.userProfile.settings.defaultDeckId = newDeckId;
      } catch (e) { console.warn('[Settings] globalData error:', e); }

      if (app.globalData.userAuthorized) {
        await this.updateUserSettings({ defaultDeckId: newDeckId });
        await app.fetchUserProfile();
        this.loadUserProfile();
      }

      // 清除本地 session
      app.globalData.lastSession = null;

      wx.hideLoading();
      wx.showToast({ title: '已切换词库', icon: 'success', duration: 1500 });
    } catch (e) {
      console.error('[DeckChange] error:', e);
      wx.hideLoading();
      wx.showToast({ title: '切换失败，请重试', icon: 'none' });
    }
  },

  onWordCountChanging(e) {
    if (this.data.changeLocked) return;
    this.setData({ wordCount: clampWordCount(e.detail.value) });
  },

  onWordCountChange(e) {
    const count = clampWordCount(e.detail.value);
    const prev = this.data.wordCount;
    if (!this.ensureChangeAllowed()) {
      this.setData({ wordCount: prev });
      return;
    }
    this.setData({ wordCount: count });
    try {
      const cached = wx.getStorageSync('userProfileCache') || {};
      cached.normalWordCount = normalizeNormalWordCount(count);
      wx.setStorageSync('userProfileCache', cached);
    } catch (e) { console.warn('[Settings] cache update error:', e); }
    try {
      app.globalData.userProfile = app.globalData.userProfile || {};
      app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
      app.globalData.userProfile.settings.dailyNewCount = count;
    } catch (e) { console.warn('[Settings] globalData error:', e); }

    // Save to cloud if authorized
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({ dailyNewCount: count });
    }

    try {
      const pages = getCurrentPages();
      const indexPage = pages.length > 1 ? pages[pages.length - 2] : null;
      if (indexPage && indexPage.setData) {
        indexPage.setData({
          wordCount: count,
          todayGoal: count
        });
        if (typeof indexPage.fetchDailyModeCounts === 'function') {
          indexPage.fetchDailyModeCounts();
        }
      }
    } catch (e) { console.warn('[Settings] sync index error:', e); }
  },

  onReviewModeSwitch(e) {
    const enabled = e.detail.value;
    const prev = this.data.reviewModeDefault;
    if (!this.ensureChangeAllowed()) {
      this.setData({ reviewModeDefault: prev });
      return;
    }
    this.setData({ reviewModeDefault: enabled });

    // Save to cloud if authorized
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({ reviewModeDefault: enabled });
      app.globalData.reviewMode = enabled;
    }

    wx.showToast({
      title: enabled ? '已开启复习模式' : '已关闭复习模式',
      icon: 'success',
      duration: 1500
    });
  },

  /**
   * 🧪 测试模式开关
   */
  onTestModeSwitch(e) {
    const enabled = e.detail.value;
    let cached = {};
    try {
      cached = wx.getStorageSync('userProfileCache') || {};
    } catch (e) { console.warn('[Settings] cache read error:', e); }

    const cachedNormalWordCount = readCachedWordCount(cached);
    const normalWordCount = cachedNormalWordCount || normalizeNormalWordCount(this.data.wordCount);

    this.setData({
      testMode: enabled,
      wordCount: normalWordCount
    });

    // 测试模式开启时，目标单词量为1；关闭时恢复滑块值
    const effectiveWordCount = enabled ? 1 : normalWordCount;

    // 更新 globalData
    try {
      app.globalData.testMode = enabled;
      app.globalData.userProfile = app.globalData.userProfile || {};
      app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
      // dailyNewCount 始终保存“正常值”，不写 1（避免关闭测试模式后无法恢复）
      app.globalData.userProfile.settings.dailyNewCount = normalWordCount;
      app.globalData.userProfile.settings.testMode = enabled; // 🆕 记录测试模式状态
    } catch (e) { console.warn('[Settings] globalData error:', e); }

    // 🆕 同步到云端
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({
        dailyNewCount: normalWordCount,
        testMode: enabled
      });
    }

    // 🆕 更新本地缓存，确保刷新后状态保留
    try {
      if (enabled) {
        cached.testModeWordCount = normalWordCount;
      }
      cached.normalWordCount = normalWordCount;
      cached.testMode = enabled;
      wx.setStorageSync('userProfileCache', cached);
    } catch (e) { console.warn('[Settings] cache update error:', e); }

    // 立即同步到首页（无需等待退出设置页）
    try {
      const pages = getCurrentPages();
      const indexPage = pages.length > 1 ? pages[pages.length - 2] : null;
      if (indexPage && indexPage.setData) {
        const isSessionActive = !!(indexPage.data && indexPage.data.isSessionStarted);
        if (isSessionActive) {
          if (typeof indexPage.applyPendingSettings === 'function') {
            indexPage.applyPendingSettings({
              reason: 'settings-update',
              deckId: this.data.currentDeckId,
              wordCount: effectiveWordCount,
              testMode: enabled
            });
          } else {
            indexPage.setData({
              wordCount: effectiveWordCount,
              todayGoal: effectiveWordCount,
              testMode: enabled
            });
          }
          if (typeof indexPage.resetSessionForNewCycle === 'function') {
            indexPage.resetSessionForNewCycle();
          }
          if (typeof indexPage.triggerPrefetch === 'function') {
            indexPage.triggerPrefetch();
          }
          wx.showToast({ title: '测试模式已立即生效', icon: 'none', duration: 2000 });
        } else {
          if (typeof indexPage.applyPendingSettings === 'function') {
            indexPage.applyPendingSettings({
              reason: 'settings-update',
              deckId: this.data.currentDeckId,
              wordCount: effectiveWordCount,
              testMode: enabled
            });
          } else {
            indexPage.setData({
              wordCount: effectiveWordCount,
              todayGoal: effectiveWordCount,
              testMode: enabled
            });
          }
          if (typeof indexPage.refreshDeckInfo === 'function') {
            indexPage.refreshDeckInfo(this.data.currentDeckId);
          }
          if (typeof indexPage.triggerPrefetch === 'function') {
            indexPage.triggerPrefetch();
          }
        }
      }
    } catch (e) { console.warn('[Settings] sync index error:', e); }

    // 标记已修改
    if (!this.data.hasModified) {
      this.setData({ hasModified: true });
    }

    wx.showToast({
      title: enabled ? '测试模式已开启（目标:1）' : '测试模式已关闭',
      icon: 'none',
      duration: 1500
    });
  },

  onOrderChange(e) {
    const prev = this.data.orderIndex;
    const idx = Number(e.detail.value) || 0;
    if (!this.ensureChangeAllowed()) {
      this.setData({ orderIndex: prev });
      return;
    }
    this.setData({ orderIndex: idx });
    const mode = idx === 0 ? 'alphabet' : (idx === 1 ? 'similar' : 'shuffle');
    // 同步更新 globalData 缓存
    try {
      app.globalData.userProfile = app.globalData.userProfile || {};
      app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
      app.globalData.userProfile.settings.orderMode = mode;
    } catch (e) { console.warn('[Settings] globalData error:', e); }
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({ orderMode: mode });
    }
  },

  onOrderTab(e) {
    const idx = Number(e.currentTarget.dataset.idx) || 0;
    if (!this.ensureChangeAllowed()) {
      return;
    }
    this.setData({ orderIndex: idx });
    const mode = idx === 0 ? 'alphabet' : (idx === 1 ? 'similar' : 'shuffle');
    // 同步更新 globalData 缓存，避免未登录时配置丢失
    try {
      app.globalData.userProfile = app.globalData.userProfile || {};
      app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
      app.globalData.userProfile.settings.orderMode = mode;
    } catch (e) { console.warn('[Settings] globalData error:', e); }
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({ orderMode: mode, orderAlphaLetter: this.data.letters[this.data.letterIndex].toLowerCase() });
    }
  },

  onLetterChange(e) {
    const idx = Number(e.detail.value) || 0;
    if (!this.ensureChangeAllowed()) {
      return;
    }
    this.setData({ letterIndex: idx });
    // 同步更新 globalData 缓存
    try {
      app.globalData.userProfile = app.globalData.userProfile || {};
      app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
      app.globalData.userProfile.settings.orderAlphaLetter = this.data.letters[idx].toLowerCase();
    } catch (e) { console.warn('[Settings] globalData error:', e); }
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({ orderAlphaLetter: this.data.letters[idx].toLowerCase() });
    }
  },

  onCefrChange(e) {
    const idx = Number(e.detail.value) || 0;
    const prev = this.data.cefrIndex;
    if (!this.ensureChangeAllowed()) {
      this.setData({ cefrIndex: prev });
      return;
    }
    this.setData({ cefrIndex: idx });
    const level = (this.data.cefrLevels[idx] || "A1").toUpperCase();
    try {
      app.globalData.userProfile = app.globalData.userProfile || {};
      app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
      app.globalData.userProfile.settings.cefrLevel = level;
    } catch (e) { console.warn('[Settings] globalData error:', e); }
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({ cefrLevel: level });
    }
    wx.showToast({ title: `段落等级：${level}`, icon: 'none', duration: 1200 });
  },

  onModelChange(e) {
    const prev = this.data.modelIndex;
    const idx = Number(e.detail.value) || 0;
    if (!this.ensureChangeAllowed()) {
      this.setData({ modelIndex: prev });
      return;
    }
    const option = (this.data.modelOptions || MODEL_OPTIONS)[idx] || MODEL_OPTIONS[0];
    this.setData({
      modelIndex: idx,
      hasModified: true
    });
    try {
      app.globalData.userProfile = app.globalData.userProfile || {};
      app.globalData.userProfile.settings = app.globalData.userProfile.settings || {};
      app.globalData.userProfile.settings.aiModel = option.value;
    } catch (error) {
      console.warn('[Settings] globalData error:', error);
    }
    if (app.globalData.userAuthorized) {
      this.updateUserSettings({ aiModel: option.value });
    }
    wx.showToast({ title: '模型已更新', icon: 'none', duration: 1200 });
  },

  onVersionTap() {
    const now = Date.now();
    const nextCount = (this._evalEntryLastTapAt && (now - this._evalEntryLastTapAt) < 1200)
      ? ((this._evalEntryTapCount || 0) + 1)
      : 1;

    this._evalEntryLastTapAt = now;
    this._evalEntryTapCount = nextCount;

    if (nextCount < 5) return;

    this._evalEntryTapCount = 0;
    this.setData({ showEvalDevPanel: true });
    wx.showToast({ title: '评测入口已解锁', icon: 'none', duration: 1200 });
  },

  onEvalModeSwitch(e) {
    const enabled = !!(e && e.detail && e.detail.value);
    this.setData({
      evalModeEnabled: enabled,
      showEvalDevPanel: true,
    });
    app.globalData.storyEvalModeEnabled = enabled;
    saveEvalModeEnabled(enabled);

    try {
      const pages = getCurrentPages();
      const indexPage = pages.length > 1 ? pages[pages.length - 2] : null;
      if (indexPage && typeof indexPage.handleEvalModeChange === 'function') {
        indexPage.handleEvalModeChange(enabled);
      }
    } catch (error) {
      console.warn('[Settings] sync eval mode error:', error);
    }

    wx.showToast({
      title: enabled ? '评测模式已开启' : '评测模式已关闭',
      icon: 'none',
      duration: 1200,
    });
  },

  async updateUserSettings(settings) {
    try {
      // Update users collection via cloud function
      // Note: This requires adding updateSettings action to userData cloud function
      const res = await wx.cloud.callFunction({
        name: 'userData',
        data: {
          action: 'updateSettings',
          settings: settings
        }
      });

      if (res.result && res.result.ok) {
        // Refresh user profile
        await app.fetchUserProfile();
      }
    } catch (e) {
      console.error('[Settings] updateUserSettings error:', e);
    }
  },

  onBack() {
    // 保存逻辑已移至 onUnload，这里只需要返回
    const pages = getCurrentPages();
    if (!pages || pages.length <= 1) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    wx.navigateBack();
  },

  initChangeQuota() {
    // 解除每日仅一次调整的限制，允许用户随时修改
    this.setData({ changeLocked: false, todayKey: this.getTodayKey(), hasModified: false });
  },

  getTodayKey() {
    const d = new Date();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  },

  onResetData() {
    wx.showModal({
      title: '重置学习数据',
      content: '将清除所有学习记录和统计数据，但保留您的设置。此操作不可恢复，确定继续吗？',
      confirmText: '确定重置',
      confirmColor: '#FF6B6B',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.performReset();
        }
      }
    });
  },

  async performReset() {
    wx.showLoading({ title: '重置中...' });

    try {
      // 使用统一云函数调用工具
      const [userRes, storyRes] = await Promise.all([
        callUserData('resetUserData', {}, { silent: true }),
        callStoryData('resetStory', {}, { silent: true })
      ]);


      if (userRes && userRes.ok) {
        // 清除本地缓存
        app.globalData.lastSession = null;

        // 刷新用户档案
        await app.fetchUserProfile();
        this.loadUserProfile();

        wx.hideLoading();
        wx.showToast({ title: '重置成功', icon: 'success' });
      } else {
        throw new Error('重置失败');
      }
    } catch (e) {
      console.error('[Reset] error:', e);
      wx.hideLoading();
      wx.showToast({ title: '重置失败，请重试', icon: 'none' });
    }
  },

  ensureChangeAllowed() {
    if (this.data.changeLocked) {
      try { wx.showToast({ title: '今日已调整过设置，请明日再试', icon: 'none' }); } catch (e) { console.warn('[Settings] showToast error:', e); }
      return false;
    }
    if (!this.data.hasModified) {
      this.setData({ hasModified: true });
    }
    return true;
  },
});
