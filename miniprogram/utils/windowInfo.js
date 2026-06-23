function readSystemInfoFallback() {
  if (!wx.getSystemInfoSync) return {};
  try {
    return wx.getSystemInfoSync() || {};
  } catch (error) {
    console.warn('[windowInfo] getSystemInfoSync fallback failed', error);
    return {};
  }
}

function getWindowMetrics() {
  const windowInfo = wx.getWindowInfo ? (wx.getWindowInfo() || {}) : {};
  const deviceInfo = wx.getDeviceInfo ? (wx.getDeviceInfo() || {}) : {};
  const needFallback = !windowInfo.statusBarHeight
    || !windowInfo.windowWidth
    || !windowInfo.windowHeight
    || !(windowInfo.pixelRatio || deviceInfo.pixelRatio);
  const fallback = needFallback ? readSystemInfoFallback() : {};

  const safeArea = windowInfo.safeArea || fallback.safeArea || null;
  const screenHeight = windowInfo.screenHeight || fallback.screenHeight || 0;

  return {
    statusBarHeight: windowInfo.statusBarHeight || fallback.statusBarHeight || 20,
    pixelRatio: windowInfo.pixelRatio || deviceInfo.pixelRatio || fallback.pixelRatio || 1,
    windowWidth: windowInfo.windowWidth || fallback.windowWidth || 375,
    windowHeight: windowInfo.windowHeight || fallback.windowHeight || 0,
    safeAreaBottom: safeArea && screenHeight ? Math.max(0, screenHeight - safeArea.bottom) : 0,
  };
}

module.exports = {
  getWindowMetrics,
};
