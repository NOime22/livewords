// pages/welcome/index.js
const app = getApp();

Page({
  data: {
    isLoading: false,
    authFailed: false,
    canIUseGetUserProfile: false,
    authReady: false,
  },

  async onLoad() {
    console.log("[Welcome] onLoad - 启动页面加载");
    if (wx.getUserProfile) {
      this.setData({ canIUseGetUserProfile: true });
    }

    try {
      await app.ensureAuthSession();
    } catch (e) {
      console.error('[Welcome] ensureAuthSession failed', e);
    }

    this.setData({ authReady: !!app.globalData.userAuthorized });

    if (app.globalData.userAuthorized && typeof app.preloadAISession === 'function') {
      console.log("[Welcome] 已授权，触发 AI 预生成");
      app.preloadAISession();
    }
  },

  handleStart() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
