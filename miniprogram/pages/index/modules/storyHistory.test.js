const {
    groupStoryHistory,
    calculateStoryDrawerHeight,
    shouldReloadStoryHistory,
} = require('./storyHistory');

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAILED] ${message}`);
    }
    console.log(`[PASSED] ${message}`);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`[FAILED] ${message} - Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    }
    console.log(`[PASSED] ${message}`);
}

function runTests() {
    console.log('======== storyHistory.js 单元测试 ========\n');

    let passed = 0;
    let failed = 0;

    const list = [
        { id: 'sf-2', theme: 'SciFi', themeName: '科幻', themeIcon: '🛸', archivedAt: '2026-03-24T12:00:00.000Z', formattedDate: '今天' },
        { id: 'rom-1', theme: 'Romance', themeName: '爱情', themeIcon: '🌇', archivedAt: '2026-03-23T12:00:00.000Z', formattedDate: '昨天' },
        { id: 'sf-1', theme: 'SciFi', themeName: '科幻', themeIcon: '🛸', archivedAt: '2026-03-22T12:00:00.000Z', formattedDate: '2天前' },
    ];

    try {
        const groups = groupStoryHistory(list);
        assertEqual(groups.length, 2, 'groups stories by theme');
        assertEqual(groups[0].theme, 'SciFi', 'sorts groups by latest archive time');
        assertEqual(groups[0].count, 2, 'stores story count on grouped item');
        assertEqual(groups[0].stories[0].id, 'sf-2', 'sorts stories within group by archivedAt desc');
        assertEqual(groups[0].stories[1].id, 'sf-1', 'keeps older stories after newer ones');
        assertEqual(groups[0].latestFormattedDate, '今天', 'uses latest story date as group summary');
        assertEqual(groups[0].expanded, false, 'defaults every group to collapsed');
        passed += 7;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const height = calculateStoryDrawerHeight({
            groupCount: 1,
            expandedStoryCount: 0,
            windowHeight: 900,
            safeAreaBottom: 34,
        });
        assert(height >= 280, 'keeps a minimum drawer height for small content');
        assert(height <= Math.round(900 * 0.78), 'caps drawer height at the viewport ratio');
        passed += 2;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const small = calculateStoryDrawerHeight({
            groupCount: 1,
            expandedStoryCount: 1,
            windowHeight: 900,
            safeAreaBottom: 0,
        });
        const large = calculateStoryDrawerHeight({
            groupCount: 6,
            expandedStoryCount: 12,
            windowHeight: 900,
            safeAreaBottom: 0,
        });
        assert(large > small, 'grows drawer height as visible content grows');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        assertEqual(
            shouldReloadStoryHistory([{ id: 'a' }, { id: 'b' }], 3),
            true,
            'reloads story history when cached list count lags behind metrics count'
        );
        assertEqual(
            shouldReloadStoryHistory([{ id: 'a' }, { id: 'b' }], 2),
            false,
            'does not reload when cached list count already matches metrics count'
        );
        passed += 2;
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
