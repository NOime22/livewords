const app = getApp();
const { getWindowMetrics } = require("../../utils/windowInfo");

Page({
  data: {
    loading: true,
    error: null,
    storyId: '',
    storyData: null,
    currentContent: null,
    words: [],
    paragraphMode: 'en',
    statusBarHeight: 20
  },

  onLoad(options) {
    const { storyId } = options || {};
    if (!storyId) {
      this.setData({ loading: false, error: '缺少故事ID' });
      return;
    }

    const { statusBarHeight } = getWindowMetrics();

    this.setData({ storyId, statusBarHeight });
    this.loadStory();
  },

  async loadStory() {
    this.setData({ loading: true, error: null });
    try {
      const res = await wx.cloud.callFunction({
        name: 'storyData',
        data: {
          action: 'getStoryHistory',
          storyId: this.data.storyId
        }
      });

      if (!res.result || !res.result.ok) {
        throw new Error(res.result?.msg || '加载失败');
      }

      const { storyId, theme, status, history } = res.result;

      // 构建 story 对象用于 story-reader
      // history 中包含所有章节，currentEpisode 为最后一节的episode号
      const lastEpisode = history.length > 0 ? history[history.length - 1] : null;

      // story-reader 的 archive 模式需要 isCycleCompleted=true
      // 我们直接传入完整story并让组件进入 archive 模式
      // 注意：需要把 history 和 currentContent 组装好
      const storyData = {
        id: storyId,
        theme,
        status: 'completed',
        currentEpisode: res.result.currentEpisode || (history.length + 1),
        totalEpisodes: 7,
        history
      };

      // currentContent 传入最后一节的内容（用于显示第7节）
      const currentContent = lastEpisode ? {
        english: lastEpisode.contentEn || '',
        mixed: lastEpisode.contentMixed || lastEpisode.contentEn || ''
      } : { english: '', mixed: '' };

      // 收集所有章节的词汇
      const wordsSet = new Map();
      history.forEach(ep => {
        if (ep.words && Array.isArray(ep.words)) {
          ep.words.forEach(w => {
            if (w && w.word) {
              wordsSet.set(w.word, w);
            }
          });
        }
      });

      this.setData({
        loading: false,
        storyData,
        currentContent,
        words: Array.from(wordsSet.values())
      });

    } catch (err) {
      console.error('[StoryArchive] loadStory failed:', err);
      this.setData({
        loading: false,
        error: '加载故事失败，请稍后重试'
      });
    }
  },

  onBack() {
    wx.navigateBack();
  },

  onUnload() {
    // 清理
  }
});
