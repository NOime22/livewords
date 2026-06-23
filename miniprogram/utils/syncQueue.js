/**
 * syncQueue.js - 失败同步重试队列
 * 当云端同步失败时，将操作暂存到本地，下次启动时自动重试
 */

const SYNC_QUEUE_KEY = 'pendingSyncQueue';
const MAX_QUEUE_SIZE = 100;
const MAX_RETRY_ATTEMPTS = 3;

/**
 * 获取待同步队列
 */
function getQueue() {
    try {
        const queue = wx.getStorageSync(SYNC_QUEUE_KEY);
        return Array.isArray(queue) ? queue : [];
    } catch (e) {
        console.warn('[SyncQueue] getQueue error:', e);
        return [];
    }
}

/**
 * 保存队列到本地存储
 */
function saveQueue(queue) {
    try {
        wx.setStorageSync(SYNC_QUEUE_KEY, queue);
    } catch (e) {
        console.warn('[SyncQueue] saveQueue error:', e);
    }
}

/**
 * 添加失败操作到队列
 * @param {string} action - 云函数 action 名称
 * @param {object} data - 调用参数
 */
function enqueue(action, data) {
    const queue = getQueue();
    const payload = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : {};

    if (payload.operationId !== undefined && payload.operationId !== null) {
        payload.operationId = String(payload.operationId);
    }

    // 防止队列过大
    if (queue.length >= MAX_QUEUE_SIZE) {
        queue.shift(); // 移除最旧的
    }

    queue.push({
        action,
        data: payload,
        attempts: 0,
        createdAt: Date.now()
    });

    saveQueue(queue);
    console.log('[SyncQueue] 已加入队列:', action, '当前队列长度:', queue.length);
}

/**
 * 处理队列中的所有待同步操作
 * 应在 App onLaunch 或用户登录后调用
 */
async function processQueue() {
    const queue = getQueue();
    if (queue.length === 0) {
        return { processed: 0, failed: 0 };
    }

    console.log('[SyncQueue] 开始处理队列，共', queue.length, '个待同步操作');

    const remaining = [];
    let processed = 0;
    let failed = 0;

    for (const item of queue) {
        try {
            const res = await wx.cloud.callFunction({
                name: 'userData',
                data: {
                    action: item.action,
                    ...(item.data || {})
                }
            });
            const result = res && res.result;
            if (result && result.ok === false) {
                const errMsg = result.error || result.msg || '业务失败';
                throw new Error(errMsg);
            }
            processed++;
            console.log('[SyncQueue] 同步成功:', item.action);
        } catch (e) {
            console.warn('[SyncQueue] 同步失败:', item.action, e);
            item.attempts++;

            // 如果未超过最大重试次数，保留在队列中
            if (item.attempts < MAX_RETRY_ATTEMPTS) {
                remaining.push(item);
            } else {
                console.warn('[SyncQueue] 已达最大重试次数，丢弃:', item.action);
                failed++;
            }
        }
    }

    saveQueue(remaining);
    console.log('[SyncQueue] 处理完成，成功:', processed, '失败:', failed, '待重试:', remaining.length);

    return { processed, failed, remaining: remaining.length };
}

/**
 * 清空队列（用于用户重置数据时）
 */
function clearQueue() {
    try {
        wx.removeStorageSync(SYNC_QUEUE_KEY);
        console.log('[SyncQueue] 队列已清空');
    } catch (e) {
        console.warn('[SyncQueue] clearQueue error:', e);
    }
}

/**
 * 获取队列长度
 */
function getQueueLength() {
    return getQueue().length;
}

module.exports = {
    enqueue,
    processQueue,
    clearQueue,
    getQueueLength
};
