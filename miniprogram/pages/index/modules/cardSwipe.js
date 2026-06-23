/**
 * cardSwipe.js - 卡片触摸/滑动交互模块
 */

const SWIPE_THRESHOLD = 110;
const SWIPE_OUT_DURATION = 220;
const PREVIEW_SIZE = 2;

// ...



/**
 * 创建滑动处理器
 * 用于处理卡片的触摸开始、移动和结束事件
 */
function createSwipeHandlers(page, options = {}) {
    const { onSwipeComplete, onPronunciationTap } = options;

    return {
        /**
         * 触摸开始
         */
        onCardTouchStart(e) {
            console.log("[Touch] onCardTouchStart triggered");
            if (!page.data.currentCard) return;
            const touch = e.changedTouches && e.changedTouches[0];
            if (!touch) return;

            const targetAction = e.target && e.target.dataset && e.target.dataset.action;

            page.dragState = {
                startX: touch.pageX,
                startY: touch.pageY,
                targetAction: targetAction || null,
            };

            page.dragBasePercent = page.data.progressPercent || 0;
            page.dragBaseLabel = getProgressLabel(page.dragBasePercent, page.data.knownCount);
            page.dragProgressPreviewActive = false;

            page.setData({
                isDragging: true,
                cardLeaving: "",
                showUnknownTag: false,
            });
        },

        /**
         * 触摸移动
         */
        onCardTouchMove(e) {
            if (!page.dragState || !page.data.currentCard) return;
            const touch = e.changedTouches && e.changedTouches[0];
            if (!touch) return;

            const deltaX = touch.pageX - page.dragState.startX;
            const deltaY = touch.pageY - page.dragState.startY;
            const rotation = Math.max(-18, Math.min(18, deltaX / 10));

            page.setData({
                cardOffsetX: deltaX,
                cardOffsetY: deltaY,
                cardRotation: rotation,
                showUnknownTag: deltaX < -24,
            });

            // 右滑时同步预览进度
            if (deltaX > 0 && page.data.totalCount > 0) {
                const stepAdd = 100 / page.data.totalCount;
                const frac = Math.max(0, Math.min(1, deltaX / SWIPE_THRESHOLD));
                const preview = Math.min(100, page.dragBasePercent + stepAdd * frac);
                page.dragProgressPreviewActive = true;

                // 直接绘制避免频繁 setData
                if (typeof page.drawProgressRing === 'function') {
                    page.drawProgressRing(preview);
                }

                const label = `${Math.round(preview)}%`;
                if (label !== page.data.progressLabel) {
                    page.setData({ progressLabel: label });
                }
            } else if (page.dragProgressPreviewActive && deltaX <= 0) {
                page.dragProgressPreviewActive = false;
                if (typeof page.updateRing === 'function') {
                    page.updateRing(page.dragBasePercent);
                }
                const label = page.dragBaseLabel;
                if (label !== page.data.progressLabel) {
                    page.setData({ progressLabel: label });
                }
            }
        },

        /**
         * 触摸结束
         */
        onCardTouchEnd(e) {
            console.log("[Touch] onCardTouchEnd triggered");
            if (!page.dragState || !page.data.currentCard) {
                page.dragState = null;
                return;
            }

            const touch = e.changedTouches && e.changedTouches[0];
            if (!touch) {
                resetActiveCardPosition(page);
                page.dragState = null;
                return;
            }

            const deltaX = touch.pageX - page.dragState.startX;
            const deltaY = touch.pageY - page.dragState.startY;
            const targetAction = page.dragState.targetAction;
            page.dragState = null;

            if (Math.abs(deltaX) >= SWIPE_THRESHOLD) {
                const direction = deltaX > 0 ? "right" : "left";
                console.log("[Touch] Swipe detected! Direction:", direction);

                if (direction === "right") {
                    page.setData({ showUnknownTag: false });
                }
                commitSwipe(page, direction, onSwipeComplete);
            } else {
                // 检测是否点击了发音按钮
                const TAP_THRESHOLD = 15;
                if (Math.abs(deltaX) < TAP_THRESHOLD && Math.abs(deltaY) < TAP_THRESHOLD && targetAction === 'pronunciation') {
                    console.log("[Touch] Pronunciation tap detected!");
                    if (onPronunciationTap) {
                        onPronunciationTap();
                    }
                }

                // 恢复原始进度
                if (page.dragProgressPreviewActive) {
                    page.dragProgressPreviewActive = false;
                    if (typeof page.updateRing === 'function') {
                        page.updateRing(page.dragBasePercent);
                    }
                    page.setData({ progressLabel: page.dragBaseLabel });
                }
                resetActiveCardPosition(page);
            }
        },
    };
}

/**
 * 重置卡片位置
 */
function resetActiveCardPosition(page) {
    page.setData({
        isDragging: false,
        cardOffsetX: 0,
        cardOffsetY: 0,
        cardRotation: 0,
        cardLeaving: "",
        showUnknownTag: false,
    });
}

/**
 * 提交滑动动作
 */
function commitSwipe(page, direction, callback) {
    console.log("[commitSwipe] Called with direction:", direction);
    if (!page.data.currentCard) {
        console.error("[commitSwipe] ERROR: No currentCard!");
        return;
    }

    const targetX = direction === "right" ? 500 : -500;
    const targetRotation = direction === "right" ? 25 : -25;

    page.setData({
        isDragging: false,
        cardLeaving: direction,
        cardOffsetX: targetX,
        cardOffsetY: 0,
        cardRotation: targetRotation,
        showUnknownTag: direction === "left",
    });

    setTimeout(() => {
        if (callback) {
            callback(direction);
        }
    }, SWIPE_OUT_DURATION);
}

/**
 * 获取进度标签
 */
function getProgressLabel(percentNumber, knownCount) {
    const pct = Math.round(percentNumber);
    if (!knownCount || pct <= 0) return "换一组";
    return `${pct}%`;
}

module.exports = {
    SWIPE_THRESHOLD,
    SWIPE_OUT_DURATION,
    PREVIEW_SIZE,
    createSwipeHandlers,
    resetActiveCardPosition,
    commitSwipe,
    getProgressLabel,
};
