/**
 * 生成随机 Trace ID
 */
function generateTraceId() {
    return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 统一云函数调用工具
 * 自动处理 action 路由、错误 Toast、返回值解包
 */

/**
 * 调用云函数
 * @param {string} name - 云函数名称 (e.g., 'userData', 'storyData')
 * @param {string} action - 动作名称 (e.g., 'getDailyMasteredCount')
 * @param {object} payload - 可选，传递给 action 的数据
 * @param {object} options - 可选配置
 * @param {boolean} options.silent - 是否静默（不显示错误 Toast）
 * @returns {Promise<any>} - 云函数返回的 result
 */
async function cloudCall(name, action, payload = {}, options = {}) {
    const { silent = false } = options;
    const traceId = generateTraceId();

    try {
        const res = await wx.cloud.callFunction({
            name,
            data: {
                action,
                traceId,
                ...payload
            }
        });

        const result = res.result;

        // 检查业务层错误
        if (result && result.ok === false) {
            const errMsg = result.msg || result.error || '操作失败';
            if (!silent) {
                wx.showToast({ title: errMsg, icon: 'none' });
            }
            console.warn(`[cloudCall] ${name}.${action} failed:`, errMsg);
            return result; // 仍然返回，让调用方决定如何处理
        }

        return result;

    } catch (err) {
        console.error(`[cloudCall] ${name}.${action} error:`, err);
        if (!silent) {
            wx.showToast({ title: '网络错误，请重试', icon: 'none' });
        }
        throw err;
    }
}

/**
 * 快捷方法：调用 userData 云函数
 */
function callUserData(action, payload = {}, options = {}) {
    return cloudCall('userData', action, payload, options);
}

/**
 * 快捷方法：调用 storyData 云函数
 */
function callStoryData(action, payload = {}, options = {}) {
    return cloudCall('storyData', action, payload, options);
}

module.exports = {
    cloudCall,
    callUserData,
    callStoryData
};
