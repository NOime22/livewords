const {
    normalizeStoryStatsCache,
    buildStoryStatsCachePayload,
} = require('./storyStatsCache');

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`[FAILED] ${message} - Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    }
    console.log(`[PASSED] ${message}`);
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAILED] ${message}`);
    }
    console.log(`[PASSED] ${message}`);
}

function runTests() {
    console.log('======== storyStatsCache.js 单元测试 ========\n');

    let passed = 0;
    let failed = 0;

    try {
        const normalized = normalizeStoryStatsCache({ createdStories: 3, savedAt: 123 });
        assertEqual(normalized.createdStories, 3, 'normalizes valid cached story stats');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const normalized = normalizeStoryStatsCache({ createdStories: -2, savedAt: 123 });
        assertEqual(normalized.createdStories, 0, 'clamps invalid negative cache values to zero');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const payload = buildStoryStatsCachePayload(7, 456);
        assertEqual(payload.createdStories, 7, 'builds cache payload with sanitized story count');
        assertEqual(payload.savedAt, 456, 'builds cache payload with timestamp');
        passed += 2;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        assert(normalizeStoryStatsCache(null) === null, 'returns null for missing cache');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    console.log('\n======== 测试完成 ========');
    console.log(`通过: ${passed}`);
    console.log(`失败: ${failed}`);
    return { passed, failed };
}

module.exports = { runTests };
