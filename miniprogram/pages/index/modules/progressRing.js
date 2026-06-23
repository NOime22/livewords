/**
 * progressRing.js - Canvas 进度环绘制模块
 */

/**
 * 初始化 Canvas 2D 节点
 * @param {Object} page - Page 实例
 * @param {Function} callback - 初始化完成回调
 */
function initCanvas(page, callback) {
    const { pixelRatio } = page.data;

    try {
        wx.createSelectorQuery()
            .in(page)
            .select('#progressRingNode')
            .fields({ node: true, size: true })
            .exec((res) => {
                const info = res && res[0];
                if (info && info.node && info.width) {
                    const canvas = info.node;
                    const dpr = pixelRatio;
                    canvas.width = Math.round(info.width * dpr);
                    canvas.height = Math.round(info.height * dpr);
                    const ctx = canvas.getContext('2d');
                    if (ctx && ctx.scale) ctx.scale(dpr, dpr);
                    page._ringCtx2d = ctx;
                    page.canvasReady = true;
                    if (callback) callback(ctx);
                } else {
                    page.canvasReady = true;
                    if (callback) callback(null);
                }
            });
    } catch (e) {
        page.canvasReady = true;
        if (callback) callback(null);
    }
}

/**
 * 绘制进度环
 * @param {Object} page - Page 实例
 * @param {number} percent - 进度百分比 (0-100)
 */
function drawProgressRing(page, percent) {
    const { ringDisplaySize, ringStrokeWidth, pixelRatio } = page.data;
    const size = ringDisplaySize;
    if (!size) return;

    // Canvas 2D 节点优先
    if (page._ringCtx2d) {
        const ctx = page._ringCtx2d;
        const stroke = ringStrokeWidth;
        const center = size / 2;
        const radius = center - stroke / 2;

        ctx.clearRect(0, 0, size, size);

        // 背景环
        ctx.beginPath();
        ctx.lineWidth = stroke;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineCap = 'round';
        ctx.arc(center, center, radius, 0, 2 * Math.PI);
        ctx.stroke();

        // 进度环
        if (percent > 0) {
            const angle = (percent / 100) * 2 * Math.PI;
            ctx.beginPath();
            ctx.lineWidth = stroke;
            ctx.strokeStyle = '#ffffff';
            ctx.lineCap = 'round';
            ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + angle, false);
            ctx.stroke();
        }
        return;
    }

    // 旧版 API 回退
    const ratio = pixelRatio || 1;
    const physical = Math.round(size * ratio);
    const ctx = wx.createCanvasContext('progressRing', page);
    const stroke = ringStrokeWidth * ratio;
    const center = physical / 2;
    const radius = center - stroke / 2;

    ctx.clearRect(0, 0, physical, physical);
    ctx.beginPath();
    ctx.setLineWidth(stroke);
    ctx.setStrokeStyle('rgba(255,255,255,0.55)');
    ctx.setLineCap('round');
    ctx.arc(center, center, radius, 0, 2 * Math.PI);
    ctx.stroke();

    if (percent > 0) {
        const angle = (percent / 100) * 2 * Math.PI;
        ctx.beginPath();
        ctx.setLineWidth(stroke);
        ctx.setStrokeStyle('#ffffff');
        ctx.setLineCap('round');
        ctx.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + angle, false);
        ctx.stroke();
    }
    ctx.draw();
}

/**
 * 更新进度环
 * @param {Object} page - Page 实例
 * @param {number} percent - 进度百分比 (0-100)
 */
function updateRing(page, percent) {
    const clamped = Math.max(0, Math.min(100, percent || 0));
    page.pendingRingPercent = clamped;
    if (page.canvasReady) {
        drawProgressRing(page, clamped);
    }
}

/**
 * 停止进度环动画并清空 Canvas
 * @param {Object} page - Page 实例
 */
function stopRingAnimation(page) {
    if (page._ringCtx2d) {
        const { ringDisplaySize } = page.data;
        page._ringCtx2d.clearRect(0, 0, ringDisplaySize, ringDisplaySize);
    }
    page.canvasReady = false;
}

/**
 * 清理完成定时器
 * @param {Object} page - Page 实例
 */
function clearCompletionTimers(page) {
    if (page.completionTimers && page.completionTimers.length) {
        page.completionTimers.forEach(function (timer) { clearTimeout(timer); });
        page.completionTimers = [];
    }
}

/**
 * 调度完成定时器
 * @param {Object} page - Page 实例
 * @param {Function} callback - 回调函数
 * @param {number} delay - 延迟毫秒数
 */
function scheduleCompletionTimer(page, callback, delay) {
    if (!page.completionTimers) page.completionTimers = [];
    const timer = setTimeout(() => {
        callback();
    }, delay);
    page.completionTimers.push(timer);
}

module.exports = {
    initCanvas,
    drawProgressRing,
    updateRing,
    stopRingAnimation,
    clearCompletionTimers,
    scheduleCompletionTimer,
};
