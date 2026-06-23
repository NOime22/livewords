const {
    normalizeMasteredStatsCache,
    buildMasteredStatsCachePayload,
} = require('./masteredStatsCache');

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
    console.log('======== masteredStatsCache.js 单元测试 ========\n');

    let passed = 0;
    let failed = 0;

    try {
        const normalized = normalizeMasteredStatsCache({ masteredWords: 3, savedAt: 123 });
        assertEqual(normalized.masteredWords, 3, 'normalizes valid cached mastered word stats');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const normalized = normalizeMasteredStatsCache({ masteredWords: -2, savedAt: 123 });
        assertEqual(normalized.masteredWords, 0, 'clamps invalid negative mastered word cache values to zero');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const payload = buildMasteredStatsCachePayload(7, 456);
        assertEqual(payload.masteredWords, 7, 'builds cache payload with sanitized mastered word count');
        assertEqual(payload.savedAt, 456, 'builds mastered word cache payload with timestamp');
        passed += 2;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        assert(normalizeMasteredStatsCache(null) === null, 'returns null for missing mastered word cache');
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
