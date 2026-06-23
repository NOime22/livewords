const MASTERED_STATS_CACHE_KEY = 'masteredStatsCache';

function sanitizeMasteredWords(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.floor(num);
}

function normalizeMasteredStatsCache(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        masteredWords: sanitizeMasteredWords(raw.masteredWords),
        savedAt: Number(raw.savedAt) || 0,
    };
}

function buildMasteredStatsCachePayload(masteredWords, now = Date.now()) {
    return {
        masteredWords: sanitizeMasteredWords(masteredWords),
        savedAt: Number(now) || Date.now(),
    };
}

module.exports = {
    MASTERED_STATS_CACHE_KEY,
    sanitizeMasteredWords,
    normalizeMasteredStatsCache,
    buildMasteredStatsCachePayload,
};
