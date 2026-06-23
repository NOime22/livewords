const {
    startStoryGenerationTiming,
    markDraftReadyTiming,
    markStoryRenderReadyTiming,
    buildStoryTimingPayload,
} = require('./storyGenerationTiming');

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAILED] ${message}`);
    }
    console.log(`[PASSED] ${message}`);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`[FAILED] ${message} - Expected: ${expected}, Got: ${actual}`);
    }
    console.log(`[PASSED] ${message}`);
}

function runTests() {
    console.log('======== storyGenerationTiming.js 单元测试 ========\n');

    let passed = 0;
    let failed = 0;

    try {
        const started = startStoryGenerationTiming({
            storyId: 'story-1',
            episodeIndex: 4,
            startedAt: 1000,
        });
        const ready = markDraftReadyTiming(started, {
            storyId: 'story-1',
            episodeIndex: 4,
            readyAt: 2200,
            promptMeta: {
                fullDurationMs: 18000,
                durationMs: 9000,
                fullRepairAttempted: true,
                fullEnglishHumanize: { attempted: true },
                fullMixedZhHumanize: { attempted: false },
            },
        });
        const rendered = markStoryRenderReadyTiming(ready, { storyId: 'story-1', episodeIndex: 4 }, 2500);
        const payload = buildStoryTimingPayload(rendered);

        assertEqual(payload.backendGenerateMs, 18000, 'payload keeps backend total generation duration');
        assertEqual(payload.firstPassMs, 9000, 'payload keeps first-pass generation duration');
        assertEqual(payload.draftWaitMs, 1200, 'payload computes wait until draft ready');
        assertEqual(payload.renderMs, 300, 'payload computes render time after draft ready');
        assertEqual(payload.frontendTotalMs, 1500, 'payload computes total client-visible time');
        assert(payload.repairAttempted, 'payload preserves repair flag');
        assert(payload.englishHumanizeAttempted, 'payload preserves english humanize flag');
        passed += 7;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const started = startStoryGenerationTiming({
            storyId: 'story-1',
            episodeIndex: 2,
            startedAt: 1000,
        });
        const untouched = markDraftReadyTiming(started, {
            storyId: 'story-2',
            episodeIndex: 2,
            readyAt: 1600,
            promptMeta: { fullDurationMs: 12000 },
        });
        const payload = buildStoryTimingPayload(untouched);
        assertEqual(payload.draftReadyAt, 0, 'mismatched story draft does not contaminate current timing session');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const started = startStoryGenerationTiming({
            storyId: 'story-1',
            episodeIndex: 3,
            startedAt: 5000,
        });
        const ready = markDraftReadyTiming(started, {
            storyId: 'story-1',
            episodeIndex: 3,
            readyAt: 3000,
            promptMeta: { fullDurationMs: 12000, durationMs: 6000 },
        });
        const rendered = markStoryRenderReadyTiming(ready, { storyId: 'story-1', episodeIndex: 3 }, 5600);
        const payload = buildStoryTimingPayload(rendered);
        assertEqual(payload.draftWaitMs, 0, 'draft wait clamps to zero when draft was already ready before the user entered story view');
        assertEqual(payload.renderMs, 600, 'render time is measured from the user-visible start point, not the historical ready timestamp');
        assertEqual(payload.frontendTotalMs, 600, 'frontend total keeps only the visible wait after word-card completion');
        passed += 3;
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
