const app = getApp();
const { callUserData } = require("../../utils/cloudCall");
const { getWindowMetrics } = require("../../utils/windowInfo");

function decorateWords(words, activeIndex) {
  const list = Array.isArray(words) ? words : [];
  return list.map((item, index) => ({
    ...item,
    cardIndex: index,
    isActive: index === activeIndex,
    isBeforeActive: activeIndex >= 0 && index < activeIndex,
    isAfterActive: activeIndex >= 0 && index > activeIndex,
    zIndex: index === activeIndex ? list.length + 2 : index + 1,
  }));
}

Page({
  data: {
    loading: true,
    error: '',
    words: [],
    displayWords: [],
    total: 0,
    activeIndex: -1,
    statusBarHeight: 20,
  },

  async onLoad() {
    const { statusBarHeight } = getWindowMetrics();
    this.setData({ statusBarHeight });

    try {
      await app.ensureAuthSession();
    } catch (error) {
      console.error('[MasteredWords] ensureAuthSession failed', error);
    }
    this.loadWords();
  },

  async loadWords() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await callUserData('getMasteredWordsList', {}, { silent: true });
      if (!res || res.ok === false) {
        this.setData({
          loading: false,
          error: (res && (res.error || res.msg)) || '加载失败',
          words: [],
          displayWords: [],
          total: 0,
          activeIndex: -1,
        });
        return;
      }

      const words = Array.isArray(res.words) ? res.words : [];
      this.setData({
        loading: false,
        error: '',
        words,
        displayWords: decorateWords(words, -1),
        total: Number(res.total) || 0,
        activeIndex: -1,
      });
    } catch (error) {
      console.error('[MasteredWords] loadWords failed', error);
      this.setData({
        loading: false,
        error: '加载失败，请稍后重试',
        words: [],
        displayWords: [],
        total: 0,
        activeIndex: -1,
      });
    }
  },

  toggleWordCard(event) {
    const nextIndex = Number(event.currentTarget.dataset.index);
    const activeIndex = this.data.activeIndex === nextIndex ? -1 : nextIndex;
    this.setData({
      activeIndex,
      displayWords: decorateWords(this.data.words, activeIndex),
    });
  },

  onBack() {
    const pages = getCurrentPages();
    if (!pages || pages.length <= 1) {
      wx.reLaunch({ url: '/pages/index/index' });
      return;
    }
    wx.navigateBack();
  },
});
