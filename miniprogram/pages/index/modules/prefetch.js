const { fetchWordBatch } = require("./wordLoader");

/**
 * 预加载下一批单词（70% 新词 + 30% 待复习词）
 * @param {object} page - 页面实例
 * @param {object} app - 应用实例
 * @param {object} options - 可选参数
 * @returns {Promise<object>} { words, deck, wordCount, newCount, reviewCount }
 */
async function prefetchNextBatch(page, app, options = {}) {
    try {
        const result = await fetchWordBatch(page, app, options);

        const newList = result.words.filter(w => !w.isReview).map(w => w.word).join(', ');
        const reviewList = result.words.filter(w => w.isReview).map(w => w.word).join(', ');
        console.log(
            `[Prefetch] Review candidates: ${result.reviewCandidateCount || 0}, used: ${result.reviewCount || 0}`
        );
        console.log(`[Prefetch] New words: ${newList}`);
        console.log(`[Prefetch] Review words: ${reviewList}`);

        return result;
    } catch (e) {
        console.error('[Prefetch] Failed:', e);
        throw e;
    }
}

module.exports = {
    prefetchNextBatch
};
