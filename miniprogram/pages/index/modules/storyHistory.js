function toTimestamp(value) {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
}

function groupStoryHistory(list) {
    const groupsByTheme = new Map();
    const stories = Array.isArray(list) ? list.slice() : [];

    stories.sort((a, b) => toTimestamp(b.archivedAt) - toTimestamp(a.archivedAt));

    stories.forEach((story) => {
        const theme = story && story.theme ? story.theme : 'unknown';
        const existing = groupsByTheme.get(theme);
        if (existing) {
            existing.stories.push(story);
            existing.count += 1;
            return;
        }

        groupsByTheme.set(theme, {
            theme,
            themeName: story.themeName || story.theme || '未命名题材',
            themeIcon: story.themeIcon || '📖',
            stories: [story],
            count: 1,
            latestArchivedAt: story.archivedAt || '',
            latestFormattedDate: story.formattedDate || '',
            expanded: false,
        });
    });

    return Array.from(groupsByTheme.values()).sort((a, b) => {
        return toTimestamp(b.latestArchivedAt) - toTimestamp(a.latestArchivedAt);
    });
}

function calculateStoryDrawerHeight(options = {}) {
    const {
        groupCount = 0,
        expandedStoryCount = 0,
        windowHeight = 0,
        safeAreaBottom = 0,
        loading = false,
        empty = false,
    } = options;

    const viewportHeight = Math.max(0, Number(windowHeight) || 0);
    const bottomInset = Math.max(0, Number(safeAreaBottom) || 0);
    const minHeight = 280;
    const maxHeight = viewportHeight > 0 ? Math.round(viewportHeight * 0.78) : 560;
    const baseHeight = 108 + bottomInset;

    if (loading || empty) {
        return Math.max(minHeight, Math.min(maxHeight, baseHeight + 172));
    }

    const groupRowsHeight = groupCount * 92;
    const expandedRowsHeight = expandedStoryCount * 72;
    const contentHeight = baseHeight + groupRowsHeight + expandedRowsHeight + 24;

    return Math.max(minHeight, Math.min(maxHeight, contentHeight));
}

function shouldReloadStoryHistory(list, metricsCreatedStories) {
    const cachedCount = Array.isArray(list) ? list.length : 0;
    const expectedCount = Math.max(0, Number(metricsCreatedStories) || 0);
    return cachedCount < expectedCount;
}

module.exports = {
    groupStoryHistory,
    calculateStoryDrawerHeight,
    shouldReloadStoryHistory,
};
