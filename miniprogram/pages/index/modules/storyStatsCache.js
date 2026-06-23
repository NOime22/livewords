const STORY_STATS_CACHE_KEY = 'storyStatsCache';

function sanitizeCreatedStories(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.floor(num);
}

function normalizeStoryStatsCache(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        createdStories: sanitizeCreatedStories(raw.createdStories),
        savedAt: Number(raw.savedAt) || 0,
    };
}

function buildStoryStatsCachePayload(createdStories, now = Date.now()) {
    return {
        createdStories: sanitizeCreatedStories(createdStories),
        savedAt: Number(now) || Date.now(),
    };
}

module.exports = {
    STORY_STATS_CACHE_KEY,
    sanitizeCreatedStories,
    normalizeStoryStatsCache,
    buildStoryStatsCachePayload,
};
