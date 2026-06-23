function sanitizeTimestamp(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function summarizePromptMeta(promptMeta) {
    const meta = promptMeta && typeof promptMeta === 'object' ? promptMeta : {};
    return {
        backendGenerateMs: sanitizeTimestamp(meta.fullDurationMs || meta.durationMs),
        firstPassMs: sanitizeTimestamp(meta.durationMs),
        repairAttempted: !!meta.fullRepairAttempted,
        englishHumanizeAttempted: !!(meta.fullEnglishHumanize && meta.fullEnglishHumanize.attempted),
        mixedHumanizeAttempted: !!(meta.fullMixedZhHumanize && meta.fullMixedZhHumanize.attempted),
    };
}

function startStoryGenerationTiming({ storyId, episodeIndex, startedAt = Date.now() }) {
    if (!storyId || !episodeIndex) return null;
    return {
        storyId: String(storyId),
        episodeIndex: Number(episodeIndex) || 0,
        generationStartedAt: sanitizeTimestamp(startedAt) || Date.now(),
        draftReadyAt: 0,
        storyRenderReadyAt: 0,
        backendGenerateMs: 0,
        firstPassMs: 0,
        repairAttempted: false,
        englishHumanizeAttempted: false,
        mixedHumanizeAttempted: false,
    };
}

function markDraftReadyTiming(timing, draft, now = Date.now()) {
    if (!timing || !draft) return timing;
    if (String(draft.storyId || '') !== String(timing.storyId || '')) return timing;
    if (Number(draft.episodeIndex || 0) !== Number(timing.episodeIndex || 0)) return timing;
    const summary = summarizePromptMeta(draft.promptMeta);
    return {
        ...timing,
        draftReadyAt: timing.draftReadyAt || sanitizeTimestamp(draft.readyAt) || sanitizeTimestamp(now),
        ...summary,
    };
}

function markStoryRenderReadyTiming(timing, payload = {}, now = Date.now()) {
    if (!timing) return timing;
    const storyId = String(payload.storyId || timing.storyId || '');
    const episodeIndex = Number(payload.episodeIndex || timing.episodeIndex || 0);
    if (storyId !== String(timing.storyId || '')) return timing;
    if (episodeIndex !== Number(timing.episodeIndex || 0)) return timing;
    if (timing.storyRenderReadyAt) return timing;
    return {
        ...timing,
        storyRenderReadyAt: sanitizeTimestamp(now) || Date.now(),
    };
}

function buildStoryTimingPayload(timing) {
    if (!timing || !timing.storyId || !timing.episodeIndex || !timing.generationStartedAt) {
        return null;
    }
    const draftReadyAt = sanitizeTimestamp(timing.draftReadyAt);
    const storyRenderReadyAt = sanitizeTimestamp(timing.storyRenderReadyAt);
    const effectiveDraftReadyAt = draftReadyAt
        ? Math.max(draftReadyAt, sanitizeTimestamp(timing.generationStartedAt))
        : 0;
    return {
        storyId: String(timing.storyId),
        episodeIndex: Number(timing.episodeIndex) || 0,
        generationStartedAt: sanitizeTimestamp(timing.generationStartedAt),
        draftReadyAt,
        storyRenderReadyAt,
        backendGenerateMs: sanitizeTimestamp(timing.backendGenerateMs),
        firstPassMs: sanitizeTimestamp(timing.firstPassMs),
        repairAttempted: !!timing.repairAttempted,
        englishHumanizeAttempted: !!timing.englishHumanizeAttempted,
        mixedHumanizeAttempted: !!timing.mixedHumanizeAttempted,
        draftWaitMs: effectiveDraftReadyAt && timing.generationStartedAt
            ? Math.max(0, effectiveDraftReadyAt - timing.generationStartedAt)
            : 0,
        renderMs: effectiveDraftReadyAt && storyRenderReadyAt
            ? Math.max(0, storyRenderReadyAt - effectiveDraftReadyAt)
            : 0,
        frontendTotalMs: storyRenderReadyAt && timing.generationStartedAt
            ? Math.max(0, storyRenderReadyAt - timing.generationStartedAt)
            : 0,
    };
}

module.exports = {
    sanitizeTimestamp,
    summarizePromptMeta,
    startStoryGenerationTiming,
    markDraftReadyTiming,
    markStoryRenderReadyTiming,
    buildStoryTimingPayload,
};
