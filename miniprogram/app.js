const { envList } = require("./envList");
const syncQueue = require("./utils/syncQueue");
const { loadEvalModeEnabled } = require("./utils/storyEval");

App({
  globalData: {
    env: envList[0].envId,
    lastSession: null,
    userProfile: null,
    currentOpenid: "",
    reviewMode: false,
    userAuthorized: false,
    isAuthenticated: false,
    hasWeChatProfile: false,
    authBootstrapping: false,
    // 【秒开优化】预缓存 seenWords
    seenWordsCache: null,
    seenWordsCacheTime: 0,
    seenWordsCacheOwnerId: "",
    prefetchReservationSet: new Set(), // 仅锁定已预加载但尚未开始学习的词
    prefetchReservationOwnerId: "",
    debugTrace: [],
    testMode: false, // 开发者测试模式遮罩
    storyEvalModeEnabled: false,
  },
  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }
    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true,
    });

    // 【iOS静音模式播放】全局设置音频不遵循静音开关
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      mixWithOther: true,
      success: () => console.log('[App] 音频设置成功：静音模式下可播放'),
      fail: (err) => {
        const errMsg = String(err && err.errMsg || '');
        if (/开发者工具暂时不支持此 API 调试/i.test(errMsg)) {
          console.info('[App] 音频设置在开发者工具中跳过，真机可用');
          return;
        }
        console.error('[App] 音频设置失败:', err);
      }
    });

    // 【测试模式】从缓存恢复
    try {
      let cached = wx.getStorageSync('userProfileCache');
      // 容错处理：如果取出的是空串，转为空对象
      if (typeof cached === 'string' && !cached) cached = {};

      console.log('[App] 读取 userProfileCache:', cached);
      if (cached && typeof cached === 'object' && typeof cached.testMode === 'boolean') {
        this.globalData.testMode = cached.testMode;
        console.log('[App] 从缓存恢复 testMode:', cached.testMode);
      }
    } catch (e) {
      console.warn('[App] 读取 testMode 失败', e);
    }

    try {
      this.globalData.storyEvalModeEnabled = loadEvalModeEnabled();
      console.log('[App] 从缓存恢复 storyEvalModeEnabled:', this.globalData.storyEvalModeEnabled);
    } catch (e) {
      console.warn('[App] 读取 storyEvalModeEnabled 失败', e);
    }

    this.ensureAuthSession()
      .then(() => this.fetchUserProfile())
      .catch((e) => {
        console.error('[App] ensureAuthSession error:', e);
      });
  },

  isAuthResultExpiredError(error) {
    const message = String(
      (error && (error.errMsg || error.message || (error.toString && error.toString()))) || ""
    );
    return /-404010|result expired|timeout for result fetching|result cannot be fetched anymore/i.test(message);
  },

  retryEnsureAuthSessionAfterExpiry(error, force) {
    if (!this.isAuthResultExpiredError(error)) {
      return Promise.reject(error);
    }
    console.warn("[App] ensureAuthSession result expired, retry once:", error);
    return new Promise((resolve) => setTimeout(resolve, 350))
      .then(() => this.ensureAuthSession(true, false));
  },

  ensureAuthSession(force = false, allowRetry = true) {
    if (!force && this.globalData.userAuthorized && this.globalData.isAuthenticated) {
      return Promise.resolve({ ok: true, cached: true });
    }
    if (!force && this._authPromise) {
      return this._authPromise;
    }

    this.globalData.authBootstrapping = true;
    const authPromise = wx.cloud.callFunction({
      name: 'userData',
      data: { action: 'ensureAuthSession' }
    }).then((res) => {
      const result = res && res.result;
      if (!(result && result.ok)) {
        throw new Error((result && result.error) || 'ensureAuthSession failed');
      }

      const auth = result.auth || {};
      const user = result.user || {};
      const profileCompleted = !!result.profileCompleted;
      const previousUserId = this.globalData.currentOpenid || "";
      const nextUserId = String(auth.openid || "").trim();

      if (previousUserId && nextUserId && previousUserId !== nextUserId) {
        this.clearSeenWordsCache();
        this.clearPrefetchReservationWords();
      }

      this.globalData.currentOpenid = nextUserId;
      this.globalData.userAuthorized = !!nextUserId;
      this.globalData.isAuthenticated = !!nextUserId;
      this.globalData.hasWeChatProfile = profileCompleted;
      this.globalData.userProfile = user || null;

      if (nextUserId) {
        try { wx.setStorageSync('userAuthorized', true); } catch (e) { console.warn('[App] setStorage userAuthorized failed:', e); }
      }
      return result;
    }).catch((error) => {
      if (allowRetry && this.isAuthResultExpiredError(error)) {
        if (this._authPromise === authPromise) {
          this._authPromise = null;
        }
        return this.retryEnsureAuthSessionAfterExpiry(error, force);
      }
      throw error;
    }).finally(() => {
      this.globalData.authBootstrapping = false;
      if (this._authPromise === authPromise) {
        this._authPromise = null;
      }
    });

    this._authPromise = authPromise;
    return authPromise;
  },

  async syncWeChatProfile(userInfo) {
    const payload = {
      nickName: (userInfo && userInfo.nickName) || "",
      avatarUrl: (userInfo && userInfo.avatarUrl) || "",
    };
    const res = await wx.cloud.callFunction({
      name: 'userData',
      data: {
        action: 'initProfile',
        ...payload
      }
    });
    if (!(res && res.result && res.result.ok)) {
      throw new Error((res && res.result && (res.result.error || res.result.msg)) || 'Init profile failed');
    }

    this.globalData.userAuthorized = true;
    this.globalData.isAuthenticated = true;
    this.globalData.hasWeChatProfile = !!(payload.nickName && payload.avatarUrl);
    this.globalData.userProfile = this.globalData.userProfile || {};
    this.globalData.userProfile.nickName = payload.nickName;
    this.globalData.userProfile.avatarUrl = payload.avatarUrl;

    try {
      wx.setStorageSync('userAuthorized', true);
      wx.setStorageSync('userProfileCache', {
        nickName: payload.nickName,
        avatarUrl: payload.avatarUrl,
      });
      wx.removeStorageSync('authPromptDismissed');
    } catch (e) {
      console.warn('[App] sync profile storage error:', e);
    }

    try {
      await this.fetchUserProfile();
    } catch (e) {
      console.warn('[App] fetch profile after sync failed:', e);
    }

    return { ok: true };
  },

  getCurrentCacheOwnerId() {
    const openid = String(this.globalData.currentOpenid || "").trim();
    if (openid) return openid;
    const profile = this.globalData.userProfile || {};
    return String(profile._id || "").trim();
  },

  clearSeenWordsCache() {
    this.globalData.seenWordsCache = null;
    this.globalData.seenWordsCacheTime = 0;
    this.globalData.seenWordsCacheOwnerId = "";
    console.log('[App] seenWords cache cleared');
  },

  addDebugTrace(event, payload = {}) {
    const trace = Array.isArray(this.globalData.debugTrace) ? this.globalData.debugTrace : [];
    const nextTrace = trace.concat([{
      timestamp: Date.now(),
      event,
      payload
    }]);
    this.globalData.debugTrace = nextTrace.slice(-50);
    console.log('[Trace]', event, payload);
  },

  getDebugTrace() {
    return Array.isArray(this.globalData.debugTrace) ? this.globalData.debugTrace.slice() : [];
  },

  fetchUserProfile() {
    return wx.cloud.callFunction({
      name: 'userData',
      data: { action: 'getProfile' }
    }).then((res) => {
      if (res.result && res.result.ok && res.result.user) {
        const previousUserId = this.getCurrentCacheOwnerId();
        const nextUserId = String(res.result.user._id || this.globalData.currentOpenid || "").trim();
        if (previousUserId && nextUserId && previousUserId !== nextUserId) {
          this.clearSeenWordsCache();
          this.clearPrefetchReservationWords();
        }
        this.globalData.userProfile = res.result.user;
        if (nextUserId) {
          this.globalData.currentOpenid = nextUserId;
        }
        const missingProfile = !res.result.user.nickName || !res.result.user.avatarUrl;
        this.globalData.userAuthorized = true;
        this.globalData.isAuthenticated = true;
        this.globalData.hasWeChatProfile = !missingProfile;
        try { wx.setStorageSync('userAuthorized', true); } catch (e) { console.warn('[App] setStorage userAuthorized failed:', e); }
        if (res.result.user.settings) {
          if (res.result.user.settings.reviewModeDefault) {
            this.globalData.reviewMode = res.result.user.settings.reviewModeDefault;
          }
          // 🔒 保护本地测试模式：如果本地已开启，不要被云端的 false 覆盖
          // 只有当本地未开启时，才尝试从云端同步
          if (!this.globalData.testMode && res.result.user.settings.testMode) {
            this.globalData.testMode = true;
            console.log('[App] 从云端同步 testMode: true');
          }
        }

        // Action: Sync Daily Mastered Count
        const profile = res.result.user;
        const serverDate = profile.lastStudyDate || "";
        // Calculate local "today" key (need consistent timezone logic, ideally match server or use server returned data)
        // Ideally we trust server. But if server hasn't updated today, lastStudyDate will be old.
        // We can replicate getDateKey here or just check string equality.
        // To be safe: use local date.
        const now = new Date();
        // Adjust to Beijing Time for consistency with Cloud function default
        const target = new Date(now.getTime() + 8 * 60 * 60000);
        const year = target.getUTCFullYear();
        const month = `${target.getUTCMonth() + 1}`.padStart(2, "0");
        const day = `${target.getUTCDate()}`.padStart(2, "0");
        const todayKey = `${year}-${month}-${day}`;

        if (serverDate === todayKey && profile.counters && typeof profile.counters.dailyMastered === 'number') {
          this.globalData.dailyMasteredCount = profile.counters.dailyMastered;
        } else {
          // New day or no data
          this.globalData.dailyMasteredCount = 0;
        }

        console.log('[App] User profile loaded:', res.result.user._id);

        // 【秒开优化】预取 seenWords
        this.prefetchSeenWords();

        // 【重试队列】处理待同步操作
        syncQueue.processQueue().then((result) => {
          if (result.processed > 0) {
            console.log('[App] 同步队列已处理:', result.processed, '个操作');
          }
        });
      }
      return this.globalData.userProfile;
    }).catch((e) => {
      console.error('[App] fetchUserProfile error:', e);
      throw e;
    });
  },

  // 【秒开优化】预取 seenWords 并缓存
  prefetchSeenWords() {
    const ownerId = this.getCurrentCacheOwnerId();
    if (!ownerId) return;
    console.log('[App] 预取 seenWords...');
    wx.cloud.callFunction({
      name: 'userData',
      data: { action: 'getSeenWords', limit: 1000 }
    }).then((res) => {
      if (this.getCurrentCacheOwnerId() !== ownerId) {
        console.log('[App] seenWords prefetch discarded: owner changed');
        return;
      }
      if (res.result && res.result.words) {
        this.globalData.seenWordsCache = new Set(res.result.words.map(w => w.toLowerCase()));
        this.globalData.seenWordsCacheTime = Date.now();
        this.globalData.seenWordsCacheOwnerId = ownerId;
        console.log('[App] seenWords 缓存完成，共', res.result.words.length, '个词');
      }
    }).catch((e) => {
      console.error('[App] prefetchSeenWords error:', e);
    });
  },

  // 获取 seenWords（优先用缓存）
  async getSeenWords(force = false) {
    const currentUserId = this.getCurrentCacheOwnerId();
    // 如果缓存存在且不超过 5 分钟，直接返回
    const cacheAge = Date.now() - (this.globalData.seenWordsCacheTime || 0);
    const canUseSeenCache = !!currentUserId && this.globalData.seenWordsCacheOwnerId === currentUserId;
    const canUsePrefetchReservation = !!currentUserId && this.globalData.prefetchReservationOwnerId === currentUserId;

    // 缓存未过期时使用缓存（全局，不按词库拆分）
    if (!force && this.globalData.seenWordsCache && canUseSeenCache && cacheAge < 5 * 60 * 1000) {
      console.log('[App] 使用 seenWords 缓存');
      const merged = new Set(this.globalData.seenWordsCache);
      if (canUsePrefetchReservation) {
        this.globalData.prefetchReservationSet.forEach(w => merged.add(w));
      }
      return merged;
    }
    // 否则重新获取
    if (force) {
      console.log('[App] 强制刷新 seenWords...');
    } else {
      console.log('[App] seenWords 缓存过期，重新获取...');
    }
    try {
      let res;
      try {
        res = await wx.cloud.callFunction({
          name: 'userData',
          data: { action: 'getSeenWords', limit: 1000 }
        });
      } catch (err) {
        throw err;
      }

      const result = res && res.result;
      if (result && result.ok === false && result.code === 'UNKNOWN_ACTION') {
        res = await wx.cloud.callFunction({
          name: 'userData',
          data: { action: 'getAvoidList', limit: 1000 }
        });
      }

      if (res.result && res.result.words) {
        const ownerId = this.getCurrentCacheOwnerId();
        this.globalData.seenWordsCache = new Set(res.result.words.map(w => w.toLowerCase()));
        this.globalData.seenWordsCacheTime = Date.now();
        this.globalData.seenWordsCacheOwnerId = ownerId;

        const merged = new Set(this.globalData.seenWordsCache);
        if (ownerId && this.globalData.prefetchReservationOwnerId === ownerId) {
          this.globalData.prefetchReservationSet.forEach(w => merged.add(w));
        }
        return merged;
      }
    } catch (e) {
      console.error('[App] getSeenWords error:', e);
    }
    if (canUsePrefetchReservation) {
      return new Set(this.globalData.prefetchReservationSet);
    }
    return new Set();
  },

  /**
   * 兼容别名：历史调用仍可复用
   */
  async getAvoidList(force = false) {
    return this.getSeenWords(force);
  },

  /**
   * 锁定已预加载但尚未开始学习的单词
   */
  setPrefetchReservationWords(words) {
    this.globalData.prefetchReservationSet.clear();
    const ownerId = this.getCurrentCacheOwnerId();
    this.globalData.prefetchReservationOwnerId = ownerId;
    if (!Array.isArray(words)) return;
    words.forEach(w => {
      if (typeof w === 'string') this.globalData.prefetchReservationSet.add(w.toLowerCase());
      else if (w.word) this.globalData.prefetchReservationSet.add(w.word.toLowerCase());
    });
    console.log('[App] prefetchReservationSet updated, total locked:', this.globalData.prefetchReservationSet.size);
  },

  /**
   * 释放预加载保留锁
   */
  clearPrefetchReservationWords() {
    this.globalData.prefetchReservationSet.clear();
    this.globalData.prefetchReservationOwnerId = "";
    console.log('[App] prefetchReservationSet cleared');
  },

  // 兼容旧调用
  addSessionAvoidWords(words) {
    this.setPrefetchReservationWords(words);
  },

  clearSessionAvoidWords() {
    this.clearPrefetchReservationWords();
  },

  /**
   * 预生成/预加载占位
   * （当前仅用于消除无效调用日志，后续可接入真实预加载逻辑）
   */
  preloadAISession() {
    console.log('[App] preloadAISession placeholder: no-op');
  }
});
