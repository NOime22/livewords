const { cloudCall } = require('../../utils/cloudCall');
const { getWindowMetrics } = require('../../utils/windowInfo');

// Tokenization cache (LRU-like, max 20 entries)
const _tokenCache = new Map();
const TOKEN_CACHE_LIMIT = 20;

function getTokenCacheKey(text, wordsCount) {
    // Use text prefix + length + words count as key for performance
    return `${text.slice(0, 50)}_${text.length}_${wordsCount}`;
}

function buildWordVariants(word) {
    const base = String(word || '').trim().toLowerCase();
    if (!base) return [];
    const patterns = [base];
    // Normalize punctuation for cases like "no." -> "no"
    const normalized = base.replace(/[^a-z]/g, '');
    if (normalized && normalized !== base && normalized.length >= 2) {
        patterns.push(normalized);
    }
    const suffixes = ['s', 'es', 'ed', 'ing', 'er', 'est', 'ly', 'ment', 'ness', 'tion', 'sion'];
    suffixes.forEach(suffix => {
        patterns.push(base + suffix);
        if (normalized && normalized !== base) patterns.push(normalized + suffix);
    });
    if (base.endsWith('e')) {
        const stem = base.slice(0, -1);
        patterns.push(stem + 'ing');
        patterns.push(stem + 'ed');
        patterns.push(stem + 'er');
        patterns.push(stem + 'est');
        if (normalized && normalized !== base && normalized.endsWith('e')) {
            const nStem = normalized.slice(0, -1);
            patterns.push(nStem + 'ing');
            patterns.push(nStem + 'ed');
            patterns.push(nStem + 'er');
            patterns.push(nStem + 'est');
        }
    }
    const lastChar = base.slice(-1);
    if (/[bcdfgklmnprstvz]/.test(lastChar) && base.length >= 3) {
        patterns.push(base + lastChar + 'ing');
        patterns.push(base + lastChar + 'ed');
        patterns.push(base + lastChar + 'er');
        if (normalized && normalized !== base) {
            const nLast = normalized.slice(-1);
            if (/[bcdfgklmnprstvz]/.test(nLast) && normalized.length >= 3) {
                patterns.push(normalized + nLast + 'ing');
                patterns.push(normalized + nLast + 'ed');
                patterns.push(normalized + nLast + 'er');
            }
        }
    }
    if (base.endsWith('y') && base.length > 2) {
        const stem = base.slice(0, -1);
        patterns.push(stem + 'ies');
        patterns.push(stem + 'ied');
        patterns.push(stem + 'ier');
        patterns.push(stem + 'iest');
        if (normalized && normalized !== base && normalized.endsWith('y') && normalized.length > 2) {
            const nStem = normalized.slice(0, -1);
            patterns.push(nStem + 'ies');
            patterns.push(nStem + 'ied');
            patterns.push(nStem + 'ier');
            patterns.push(nStem + 'iest');
        }
    }
    return [...new Set(patterns)];
}

Component({
    properties: {
        story: {
            type: Object,
            value: null,
            // observer: 'updateDisplay'
        },
        mode: {
            type: String,
            value: 'en' // 'en' | 'mixed'
        },
        currentContent: {
            type: Object,
            value: null,
            // observer: removed
        },
        statusBarHeight: {
            type: Number,
            value: 20
        },
        words: {
            type: Array,
            value: []
        },
        currentEpisode: {
            type: Number,
            value: 1
        },
        aiFailed: {
            type: Boolean,
            value: false
        },
        aiRetrying: {
            type: Boolean,
            value: false
        },
        episodeReady: {
            type: Boolean,
            value: false
        },
        retryDisabled: {
            type: Boolean,
            value: false
        },
        retryLabel: {
            type: String,
            value: '再试一次'
        },
        isCycleCompleted: {
            type: Boolean,
            value: false,
            observer: '_onIsCycleCompletedChange'
        }
    },

    observers: {
        'currentContent, mode, words, story, currentEpisode': function (content, mode, words, story) {
            // 1. Update Current Episode Display
            if (content) {
                this.updateDisplay(content, words, mode);
            }

            // 2. Update History Display (if already loaded)
            if (this.data.historyLoaded && this.data.historyEpisodes.length > 0) {
                this.updateHistoryDisplay(words, mode);
            }
        }
    },

    data: {
        currentEpisodeContent: null, // Object for current episode
        historyEpisodes: [], // Array for history

        swiperIndex: 0, // 0: Current, 1: History
        loadingHistory: false,
        historyLoaded: false,
        historyError: null, // { en: string, cn: string } | null

        focusMode: false,
        lastScrollTop: 0,
        tooltip: {
            visible: false,
            x: 0,
            y: 0,
            text: ''
        },
        isCycleCompleted: false, // 是否已进入全篇回顾模式
        isLastEpisode: false,    // 是否为最后一节 (Ep 7)
        continueLabel: '继续下一节'
    },

    methods: {
        _onIsCycleCompletedChange(isCompleted) {
            if (isCompleted) {
                this.triggerCeremony();
            }
        },

        updateDisplay(content, words, mode) {
            // Use passed values or fallback to data
            const currentWords = words || this.data.words || [];
            const currentMode = mode || this.data.mode;
            const contentObj = content || this.data.currentContent;

            const story = this.data.story;
            if (!story || !contentObj) return;

            const passedEpisodeRaw = this.properties.currentEpisode;
            const passedEpisode = Number(passedEpisodeRaw);
            const currentEp = Number.isFinite(passedEpisode) && passedEpisode > 0
                ? passedEpisode
                : (story.currentEpisode || 1);

            // Debug first word to ensure structure
            if (currentWords.length > 0) {
                const first = currentWords[0];
                if (typeof first === 'string') {
                    console.error('[Reader] CRITICAL: Words array contains strings, expected Objects!');
                }
            }

            const rawEn = contentObj.english || "";
            const rawMixed = contentObj.mixed || contentObj.english || "";

            const tokensEn = this.tokenizeContent(rawEn, currentWords);
            const tokensMixed = this.tokenizeContent(rawMixed, currentWords);

            const currentContentObj = {
                episode: currentEp,
                contentEn: rawEn,
                contentMixed: rawMixed,
                tokensEn,
                tokensMixed,
                isNew: true
            };

            const initialSwiperIndex = currentEp > 1 ? 1 : 0;
            const totalEpisodes = story.totalEpisodes || 7;
            const isLast = currentEp >= totalEpisodes;
            const nextEpisode = Math.min(currentEp + 1, totalEpisodes);
            const continueLabel = isLast ? '查看完整故事' : `继续第${nextEpisode}节`;

            this.setData({
                currentEpisodeContent: currentContentObj,
                swiperIndex: initialSwiperIndex,
                displayMode: currentMode,
                isLastEpisode: isLast,
                continueLabel
            });
        },

        tokenizeContent(text, words) {
            if (!text) return [];

            // Use passed words list
            const wordList = words || this.data.words || [];

            // Check cache first
            const cacheKey = getTokenCacheKey(text, wordList.length);
            if (_tokenCache.has(cacheKey)) {
                return _tokenCache.get(cacheKey);
            }

            // Debug warning for empty word list
            if (wordList.length === 0) {
                console.warn('[Reader] Tokenizing with EMPTY word list!');
            }

            const normalizedText = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const parts = normalizedText.split(/(\n+|[a-zA-Z0-9'-]+)/g);

            const wordsMap = new Map();
            if (wordList && Array.isArray(wordList)) {
                wordList.forEach(w => {
                    if (w && typeof w === 'object' && w.word) {
                        const variants = buildWordVariants(w.word);
                        variants.forEach(v => wordsMap.set(v, w));
                    } else if (typeof w === 'string') {
                        const variants = buildWordVariants(w);
                        variants.forEach(v => wordsMap.set(v, { word: w, translation: w }));
                    }
                });
            }

            let matchCount = 0;
            const tokens = parts.map(part => {
                if (!part) return null;
                if (/^\n+$/.test(part)) {
                    return {
                        type: 'break',
                        kind: part.length >= 2 ? 'para' : 'line',
                        content: part
                    };
                }
                const isWord = /^[a-zA-Z0-9'-]+$/.test(part);
                const lowercasePart = part.toLowerCase();
                const wordData = isWord ? wordsMap.get(lowercasePart) : null;

                if (wordData) matchCount++;

                return {
                    type: isWord ? 'word' : 'text',
                    content: part,
                    isTarget: !!wordData, // Boolean coercion
                    definition: wordData ? (wordData.translation || wordData.word) : null
                };
            }).filter(Boolean);

            if (matchCount === 0 && text.length > 20 && wordList.length > 0) {
                console.warn('[Reader] Tokenize: Matches NOT found despite having words.');
            }

            // Store in cache (LRU eviction)
            if (_tokenCache.size >= TOKEN_CACHE_LIMIT) {
                const firstKey = _tokenCache.keys().next().value;
                _tokenCache.delete(firstKey);
            }
            _tokenCache.set(cacheKey, tokens);

            return tokens;
        },

        async onSwiperChange(e) {
            const index = e.detail.current;
            this.setData({
                swiperIndex: index,
                focusMode: false // Reset focus mode on swiper change for clean UI
            });
            this.data.lastScrollTop = 0; // Reset scroll tracking

            // Special Case: Pulling down on the LAST episode triggers the "End of Story" ceremony
            if (this.data.isLastEpisode && index === 0) {
                this.triggerCeremony();
                return;
            }

            // If we have history (Ep > 1) and user swipes to Index 0 (History View)
            if (this.data.currentEpisode > 1 && index === 0 && !this.data.historyLoaded && !this.data.loadingHistory) {
                this.loadHistory();
            }
        },

        async loadHistory() {
            this.setData({
                loadingHistory: true,
                historyError: null  // Clear previous error
            });

            try {
                const localHistory = this.getLocalHistoryEpisodes();
                if (localHistory.length > 0) {
                    this.setData({
                        historyEpisodes: localHistory,
                        historyLoaded: true
                    });
                    if (localHistory.length > 0) {
                        wx.vibrateShort({ type: 'medium' });
                    }
                    return;
                }

                // Check if storyId exists
                if (!this.data.story || !this.data.story.id) {
                    throw new Error('No valid story ID found');
                }

                const res = await cloudCall('storyData', 'getStoryHistory', {
                    storyId: this.data.story.id
                });

                let historyList = [];
                if (res.ok && res.history && res.history.length > 0) {
                    historyList = res.history.filter(h => h.episode < this.data.currentEpisode);
                }

                // Check for "Bad Data" (e.g., "Story generating..." placeholder)
                // Check for "Bad Data" (e.g., "Story generating..." placeholder)
                const hasBadData = historyList.some(h =>
                    (h.contentEn && h.contentEn.includes('生成中')) ||
                    (h.contentMixed && h.contentMixed.includes('生成中'))
                    // TODO: Add other bad data patterns if needed
                );

                if (hasBadData) {
                    // Filter out "generating" or empty content
                    historyList = historyList.filter(h =>
                        (!h.contentEn || !h.contentEn.includes('生成中')) &&
                        (!h.contentMixed || !h.contentMixed.includes('生成中'))
                    );
                }

                // Deduplicate: If the last history item matches the current content, remove it from history view
                // This happens when the user just finished an episode -> saved it -> activeStory updated -> but UI hasn't advanced yet.
                const currentEn = this.data.currentEpisodeContent?.contentEn;
                if (currentEn && historyList.length > 0) {
                    const lastHistory = historyList[historyList.length - 1];
                    if (lastHistory.contentEn === currentEn) {

                        historyList.pop();
                    }
                }

                const processedHistory = this.processHistoryEpisodes(historyList);

                this.setData({
                    historyEpisodes: processedHistory,
                    historyLoaded: true
                });

                if (processedHistory.length > 0) {
                    wx.vibrateShort({ type: 'medium' });
                }

            } catch (err) {
                console.error('[StoryReader] Failed to load history:', err);

                // 根据错误类型显示不同信息
                const errMsg = err.message || err.errMsg || '';
                const isNetworkError = errMsg.includes('network') ||
                    errMsg.includes('fail') ||
                    errMsg.includes('timeout') ||
                    err.code === -1;

                const errorInfo = isNetworkError
                    ? { en: 'NETWORK_ERROR\nCheck connection and retry', cn: '网络错误\n请检查连接后重试' }
                    : { en: 'LOAD_FAILED\n' + (errMsg.slice(0, 50) || 'Unknown error'), cn: '加载失败\n请稍后重试' };

                this.setData({
                    historyEpisodes: [],
                    historyLoaded: true,
                    historyError: errorInfo
                });
            } finally {

                this.setData({ loadingHistory: false });
            }
        },

        getLocalHistoryEpisodes() {
            const story = this.data.story;
            const currentEpisode = Number(this.data.currentEpisode || 0);
            if (!story || !Array.isArray(story.history) || !currentEpisode) {
                return [];
            }
            const historyList = story.history.filter(h => Number(h && h.episode) < currentEpisode);
            if (historyList.length === 0) {
                return [];
            }
            return this.processHistoryEpisodes(historyList);
        },

        processHistoryEpisodes(historyList) {
            const list = Array.isArray(historyList) ? historyList.slice() : [];
            const filtered = list.filter(h =>
                (!h.contentEn || !h.contentEn.includes('生成中')) &&
                (!h.contentMixed || !h.contentMixed.includes('生成中'))
            );
            const currentEn = this.data.currentEpisodeContent?.contentEn;
            if (currentEn && filtered.length > 0) {
                const lastHistory = filtered[filtered.length - 1];
                if (lastHistory.contentEn === currentEn) {
                    filtered.pop();
                }
            }
            const currentSessionWords = this.data.words || [];
            return filtered.map(item => ({
                ...item,
                tokensEn: this.tokenizeContent(item.contentEn || '', (item.words && item.words.length > 0) ? item.words : currentSessionWords),
                tokensMixed: this.tokenizeContent(item.contentMixed || item.contentEn || '', (item.words && item.words.length > 0) ? item.words : currentSessionWords)
            }));
        },

        onScroll(e) {
            // Keep focus mode logic if needed, but only for Current view?
            // For now, let's keep it simple.
            const scrollTop = e.detail.scrollTop;
            if (Math.abs(scrollTop - this.data.lastScrollTop) < 50) return;

            if (scrollTop > this.data.lastScrollTop && scrollTop > 100) {
                if (!this.data.focusMode) this.setData({ focusMode: true });
            } else {
                if (this.data.focusMode) this.setData({ focusMode: false });
            }
            this.data.lastScrollTop = scrollTop;

            // Hide tooltip on scroll
            if (this.data.tooltip.visible) {
                this.setData({ 'tooltip.visible': false });
            }
        },

        onTapWord(e) {
            const { word, def } = e.currentTarget.dataset;
            if (!word) return;

            // Dismiss any existing tooltip first (though logic below handles overwrite)
            if (this.tooltipTimer) clearTimeout(this.tooltipTimer);

            // Optional: Dismiss if tapping same word or empty area
            this.setData({
                tooltip: {
                    visible: true,
                    x: e.detail.x - 60, // Basic centering offset
                    y: e.detail.y - 50, // Above finger
                    text: def || word // Show definition if available, else word
                }
            });

            wx.vibrateShort({ type: 'light' });

            // Auto-hide
            this.tooltipTimer = setTimeout(() => {
                this.setData({ 'tooltip.visible': false });
            }, 3000);
        },

        onContainerTap() {
            // Tap outside (on the container) -> Dismiss if visible
            if (this.data.tooltip.visible) {
                this.dismissTooltip();
            }
        },

        dismissTooltip() {
            if (this.tooltipTimer) clearTimeout(this.tooltipTimer);
            this.setData({ 'tooltip.visible': false });
        },

        onContinue() {
            const isFinal = this.data.isLastEpisode;
            this.triggerEvent('continue', { isFinal });
            if (isFinal) {
                // 如果是第7节，触发仪式，不再只是 continue
                this.triggerCeremony();
            }
        },

        triggerCeremony() {
            console.log('[StoryReader] Final Episode Ceremony Triggered');

            wx.vibrateLong();

            // 异步加载历史（如果还没加载）
            if (!this.data.historyLoaded) {
                this.loadHistory();
            }

            // Simultaneous update to ensure smooth transition
            // We set the ID immediately so it renders at the correct position if possible
            this.setData({
                isCycleCompleted: true,
                scrollIntoId: 'ep-final'
            });
        },

        scrollToLastEpisode() {
            this.setData({
                scrollIntoId: ''
            }, () => {
                this.setData({
                    scrollIntoId: 'ep-final'
                });
            });
        },

        onFinishCycle() {
            this.triggerEvent('finish');
            // Reset local state if needed
            this.setData({
                isCycleCompleted: false
            });
        },

        onBack() {
            this.triggerEvent('back');
        },

        onToggleLanguage() {
            const newMode = this.data.mode === 'en' ? 'mixed' : 'en';
            // Optimistic update for immediate feedback
            this.setData({ mode: newMode });
            wx.vibrateShort({ type: 'light' });

            // Notify parent to persist
            this.triggerEvent('modeChange', { mode: newMode });
        },

        onRetryAi() {
            this.triggerEvent('retryAi');
        },

        async onShare() {
            wx.showLoading({ title: '生成分享卡...' });
            try {
                const isFullStory = !!this.data.isCycleCompleted;
                if (isFullStory && !this.data.historyLoaded && !this.data.loadingHistory) {
                    await this.loadHistory();
                }

                const query = this.createSelectorQuery();
                const canvasData = await new Promise(resolve => {
                    query.select('#shareCanvas')
                        .fields({ node: true, size: true })
                        .exec((res) => resolve(res[0]));
                });

                if (!canvasData || !canvasData.node) {
                    throw new Error('Canvas not found');
                }

                const canvas = canvasData.node;
                const ctx = canvas.getContext('2d');

                // Dynamic dimensions based on actual canvas element size
                const { pixelRatio } = getWindowMetrics();
                const dpr = pixelRatio || 1;
                const logicalWidth = canvasData.width;
                let logicalHeight = canvasData.height;

                const measureTextWrapped = (context, text, maxWidth, lineHeight) => {
                    if (!text) return lineHeight;
                    const paragraphs = text.split('\n');
                    let lines = 0;
                    paragraphs.forEach(p => {
                        const chars = p.split('');
                        let line = '';
                        for (let i = 0; i < chars.length; i++) {
                            const testLine = line + chars[i];
                            const testWidth = context.measureText(testLine).width;
                            if (testWidth > maxWidth && i > 0) {
                                lines += 1;
                                line = chars[i];
                            } else {
                                line = testLine;
                            }
                        }
                        lines += 1;
                    });
                    return lines * lineHeight;
                };

                const historyEpisodes = Array.isArray(this.data.historyEpisodes) ? this.data.historyEpisodes.slice() : [];
                historyEpisodes.sort((a, b) => (a.episode || 0) - (b.episode || 0));

                const currentEpisode = this.data.currentEpisodeContent;
                const episodeMap = new Map();
                historyEpisodes.forEach(item => {
                    if (!item || !item.episode) return;
                    const text = this.data.mode === 'en'
                        ? (item.contentEn || '')
                        : (item.contentMixed || item.contentEn || '');
                    if (text) {
                        episodeMap.set(item.episode, text);
                    }
                });
                if (currentEpisode && currentEpisode.episode) {
                    const text = this.data.mode === 'en'
                        ? (currentEpisode.contentEn || '')
                        : (currentEpisode.contentMixed || currentEpisode.contentEn || '');
                    if (text) {
                        episodeMap.set(currentEpisode.episode, text);
                    }
                }

                const orderedEpisodes = Array.from(episodeMap.entries()).sort((a, b) => a[0] - b[0]);
                const fullStoryText = orderedEpisodes
                    .map(([ep, text]) => `EP${String(ep).padStart(2, '0')}  ${text}`)
                    .join('\n\n');

                const epContent = currentEpisode || {};
                const singleText = (this.data.mode === 'en' ? epContent?.contentEn : epContent?.contentMixed) || epContent?.contentEn || "";

                const content = isFullStory ? fullStoryText : singleText;

                const vocabSet = new Set();
                historyEpisodes.forEach(item => {
                    (item.words || []).forEach(w => {
                        const word = w && w.word;
                        if (word) vocabSet.add(word);
                    });
                });
                (this.data.words || []).forEach(w => {
                    const word = w && w.word;
                    if (word) vocabSet.add(word);
                });
                const wordString = Array.from(vocabSet).join(' | ');

                const maxWidth = logicalWidth - 80;
                ctx.font = '16px Georgia, serif';
                const storyHeight = measureTextWrapped(ctx, content, maxWidth, 26);
                ctx.font = '12px Georgia, serif';
                const vocabHeight = measureTextWrapped(ctx, wordString, maxWidth, 20);
                const requiredHeight = 110 + storyHeight + 40 + 30 + 20 + vocabHeight + 80;
                logicalHeight = Math.max(logicalHeight, Math.ceil(requiredHeight));

                canvas.width = logicalWidth * dpr;
                canvas.height = logicalHeight * dpr;
                ctx.scale(dpr, dpr);

                // --- 1. Background ---
                ctx.fillStyle = '#E6E2D3'; // Retro Paper
                ctx.fillRect(0, 0, logicalWidth, logicalHeight);

                // Scanline Effect (Subtle)
                ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
                for (let i = 0; i < logicalHeight; i += 4) {
                    ctx.fillRect(0, i, logicalWidth, 1);
                }

                // --- 2. Border ---
                ctx.strokeStyle = '#2A2A2A';
                ctx.lineWidth = 2;
                ctx.strokeRect(10, 10, logicalWidth - 20, logicalHeight - 20);

                // --- 3. Header ---
                ctx.fillStyle = '#FF6B6B';
                ctx.fillRect(20, 20, logicalWidth - 40, 40);

                ctx.fillStyle = '#2A2A2A';
                ctx.lineWidth = 2;
                ctx.strokeRect(20, 20, logicalWidth - 40, 40);

                ctx.fillStyle = '#FFFFFF';
                ctx.font = 'bold 18px Courier New, monospace';
                const chapterLabel = isFullStory
                    ? 'FULL STORY'
                    : `CHAPTER ${(this.data.currentEpisode || 1).toString().padStart(3, '0')}`;
                ctx.fillText(chapterLabel, 40, 46);

                // --- 4. Content ---
                ctx.fillStyle = '#2A2A2A';
                ctx.font = '16px Georgia, serif';
                const margin = 40;
                let currentY = 110;

                currentY = this.drawTextWrapped(ctx, content, margin, currentY, maxWidth, 26);

                // --- 5. Footer (Words) ---
                currentY += 40;
                ctx.strokeStyle = 'rgba(42, 42, 42, 0.2)';
                ctx.setLineDash([5, 5]);
                ctx.beginPath();
                ctx.moveTo(40, currentY);
                ctx.lineTo(logicalWidth - 40, currentY);
                ctx.stroke();
                ctx.setLineDash([]);

                currentY += 30;
                ctx.font = 'bold 12px Courier New, monospace';
                ctx.fillText('TARGET VOCABULARY', 35, currentY);

                currentY += 20;
                ctx.font = '12px Georgia, serif';
                currentY = this.drawTextWrapped(ctx, wordString, 35, currentY, maxWidth, 20);

                // --- 6. Branding ---
                ctx.textAlign = 'right';
                ctx.font = 'bold 10px Courier New, monospace';
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fillText('LIVEWORDS SHARE - NO. 127.0.0.1', logicalWidth - 35, logicalHeight - 30);

                // --- 7. Export ---
                const tempFilePath = await new Promise((resolve, reject) => {
                    wx.canvasToTempFilePath({
                        canvas,
                        fileType: 'png', // Back to png, more standard for WeChat
                        success: (res) => resolve(res.tempFilePath),
                        fail: reject
                    }, this);
                });

                wx.hideLoading();

                // Add a small delay to ensure filesystem is ready
                setTimeout(() => {
                    wx.showShareImageMenu({
                        path: tempFilePath,
                        success: () => {
                            wx.vibrateShort({ type: 'medium' });
                        },
                        fail: (err) => {

                        }
                    });
                }, 100);

            } catch (err) {
                console.error('[StoryReader] Share Generation Failed:', err);
                wx.hideLoading();
                wx.showToast({ title: '生成失败', icon: 'error' });
            }
        },

        drawTextWrapped(ctx, text, x, y, maxWidth, lineHeight) {
            // Handle explicit newlines first
            const paragraphs = text.split('\n');
            let currentY = y;

            paragraphs.forEach(p => {
                const words = p.split(''); // Char-by-char for mixed lang support
                let line = '';

                for (let n = 0; n < words.length; n++) {
                    const testLine = line + words[n];
                    const metrics = ctx.measureText(testLine);
                    const testWidth = metrics.width;
                    if (testWidth > maxWidth && n > 0) {
                        ctx.fillText(line, x, currentY);
                        line = words[n];
                        currentY += lineHeight;
                    } else {
                        line = testLine;
                    }
                }
                ctx.fillText(line, x, currentY);
                currentY += lineHeight; // Paragraph spacing
            });

            return currentY;
        },

        updateHistoryDisplay(words, mode) {
            const list = this.data.historyEpisodes;
            if (!list || list.length === 0) return;

            const currentSessionWords = words || this.data.words || [];

            // Re-tokenize all history items
            const updatedList = list.map(item => ({
                ...item,
                tokensEn: this.tokenizeContent(item.contentEn || '', (item.words && item.words.length > 0) ? item.words : currentSessionWords),
                tokensMixed: this.tokenizeContent(item.contentMixed || item.contentEn || '', (item.words && item.words.length > 0) ? item.words : currentSessionWords)
            }));

            this.setData({
                historyEpisodes: updatedList
            });

        }
    }
});
