/**
 * wordLoader.test.js
 * 用法：在微信开发者工具控制台中执行
 * require('pages/index/modules/wordLoader.test.js').runTests()
 */

const {
    WORD_SELECTION_VERSION,
    getActiveDeck,
    buildOrderedLetterSequence,
    applyLetterWindowOrder,
    getLetterRangeEnd,
    fetchOrderedCandidatesByLetterWindow
} = require('./wordLoader');
const { DECK_LIBRARY, DEFAULT_DECK_ID } = require('../../../utils/decks');

function assert(condition, message) {
    if (!condition) throw new Error(`[FAILED] ${message}`);
    console.log(`[PASSED] ${message}`);
}
function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new Error(`[FAILED] ${message} - Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    console.log(`[PASSED] ${message}`);
}

async function runTests() {
    console.log('======== wordLoader.js 单元测试 ========\n');
    let passed = 0, failed = 0;

    console.log('--- getActiveDeck ---');

    // 1. 无参数时返回默认词库
    try {
        const deck = getActiveDeck({}, {});
        assert(deck && deck.id, 'getActiveDeck({}, {}) should return a deck');
        assertEqual(deck.id, DEFAULT_DECK_ID, 'getActiveDeck with no match should return DEFAULT_DECK_ID');
        passed += 2;
    } catch (e) { console.error(e.message); failed++; }

    // 2. userProfile.settings.defaultDeckId 优先级最高
    try {
        const secondDeckId = DECK_LIBRARY[1] && DECK_LIBRARY[1].id;
        if (secondDeckId) {
            const page = { data: { currentDeckId: DECK_LIBRARY[0].id } };
            const app = { globalData: { userProfile: { settings: { defaultDeckId: secondDeckId } } } };
            const deck = getActiveDeck(page, app);
            assertEqual(deck.id, secondDeckId, 'userProfile.settings should take priority over page.data');
            passed += 1;
        }
    } catch (e) { console.error(e.message); failed++; }

    // 3. 没有 userProfile 时 fallback 到 page.data.currentDeckId
    try {
        const firstDeckId = DECK_LIBRARY[0].id;
        const page = { data: { currentDeckId: firstDeckId } };
        const app = { globalData: {} };
        const deck = getActiveDeck(page, app);
        assertEqual(deck.id, firstDeckId, 'should fallback to page.data.currentDeckId when no userProfile');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    // 4. page 和 app 都为 null 时不崩溃
    try {
        const deck = getActiveDeck(null, null);
        assert(deck && deck.id, 'getActiveDeck(null, null) should not crash');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    // 5. defaultDeckId 无效时 fallback 到 DECK_LIBRARY[0]
    try {
        const app = { globalData: { userProfile: { settings: { defaultDeckId: 'nonexistent-id-xyz' } } } };
        const deck = getActiveDeck({}, app);
        assertEqual(deck.id, DECK_LIBRARY[0].id, 'invalid deckId should fallback to DECK_LIBRARY[0]');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    console.log('\n--- ordered letter helpers ---');

    try {
        const sequence = buildOrderedLetterSequence('c');
        assertEqual(sequence.slice(0, 5).join(','), 'c,d,e,f,g', 'ordered letter sequence starts from the selected anchor');
        assertEqual(sequence.slice(-2).join(','), 'a,b', 'ordered letter sequence wraps after z');
        passed += 2;
    } catch (e) { console.error(e.message); failed++; }

    try {
        const words = ['orphan', 'award', 'appear', 'additional', 'banana'];
        const ordered = applyLetterWindowOrder(words, 'a');
        assertEqual(ordered.join(','), 'award,appear,additional,banana,orphan', 'letter window ordering keeps nearer letters ahead of later letters');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    try {
        assertEqual(getLetterRangeEnd('a'), 'b', 'letter range end advances to the next letter');
        assertEqual(getLetterRangeEnd('z'), '{', 'letter range end for z uses the ascii sentinel');
        passed += 2;
    } catch (e) { console.error(e.message); failed++; }

    try {
        assert(typeof WORD_SELECTION_VERSION === 'string' && WORD_SELECTION_VERSION.length > 0, 'wordLoader exposes a non-empty word selection version');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    console.log('\n--- strict letter window fetching ---');

    try {
        const pages = {
            a: [
                { word: 'ability' },
                { word: 'abroad' },
                { word: 'accept' },
                { word: 'account' },
                { word: 'achieve' }
            ],
            b: [
                { word: 'background' },
                { word: 'badly' }
            ]
        };
        const command = {
            gte(value) {
                return {
                    and(other) {
                        return { __range: [value, other.__lt] };
                    }
                };
            },
            lt(value) {
                return { __lt: value };
            }
        };
        const db = {
            command,
            collection() {
                return {
                    where(query) {
                        const range = query.word && query.word.__range ? query.word.__range : ['a', '{'];
                        const letter = range[0];
                        return {
                            orderBy() { return this; },
                            skip(offset) { this._offset = offset; return this; },
                            limit(size) { this._limit = size; return this; },
                            async get() {
                                const list = (pages[letter] || []).slice(this._offset || 0, (this._offset || 0) + (this._limit || 100));
                                return { data: list };
                            }
                        };
                    }
                };
            }
        };
        const result = await fetchOrderedCandidatesByLetterWindow(db, 'book_a2', ['a', 'b'], 4, new Set());
        assertEqual(result.map((item) => item.word).join(','), 'ability,abroad,accept,account', 'letter window stays on the current letter while enough unseen words remain');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    try {
        const pages = {
            a: [
                { word: 'ability' },
                { word: 'abroad' }
            ],
            b: [
                { word: 'background' },
                { word: 'badly' },
                { word: 'badminton' }
            ]
        };
        const command = {
            gte(value) {
                return {
                    and(other) {
                        return { __range: [value, other.__lt] };
                    }
                };
            },
            lt(value) {
                return { __lt: value };
            }
        };
        const db = {
            command,
            collection() {
                return {
                    where(query) {
                        const range = query.word && query.word.__range ? query.word.__range : ['a', '{'];
                        const letter = range[0];
                        return {
                            orderBy() { return this; },
                            skip(offset) { this._offset = offset; return this; },
                            limit(size) { this._limit = size; return this; },
                            async get() {
                                const list = (pages[letter] || []).slice(this._offset || 0, (this._offset || 0) + (this._limit || 100));
                                return { data: list };
                            }
                        };
                    }
                };
            }
        };
        const result = await fetchOrderedCandidatesByLetterWindow(db, 'book_a2', ['a', 'b'], 4, new Set(['ability']));
        assertEqual(result.map((item) => item.word).join(','), 'abroad,background,badly,badminton', 'letter window advances only after the current letter is genuinely exhausted by filters');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    try {
        const pages = {
            a: [
                { word: 'ability' },
                { word: 'abroad' },
                { word: 'accept' }
            ],
            b: [
                { word: 'background' }
            ]
        };
        const command = {
            gte(value) {
                return {
                    and(other) {
                        return { __range: [value, other.__lt] };
                    }
                };
            },
            lt(value) {
                return { __lt: value };
            }
        };
        const db = {
            command,
            collection() {
                return {
                    where(query) {
                        const range = query.word && query.word.__range ? query.word.__range : ['a', '{'];
                        const letter = range[0];
                        return {
                            orderBy() { return this; },
                            skip(offset) { this._offset = offset; return this; },
                            limit(size) { this._limit = size; return this; },
                            async get() {
                                const list = (pages[letter] || []).slice(this._offset || 0, (this._offset || 0) + (this._limit || 100));
                                return { data: list };
                            }
                        };
                    }
                };
            }
        };
        const stats = [];
        await fetchOrderedCandidatesByLetterWindow(db, 'book_a2', ['a', 'b'], 3, new Set(['ability']), (entry) => stats.push(entry));
        assertEqual(stats.length, 2, 'letter window reports stats for each inspected letter');
        assertEqual(stats[0].letter, 'a', 'letter window stats record the current letter first');
        assertEqual(stats[0].accepted, 2, 'letter window stats record accepted words for a letter');
        assertEqual(stats[0].skippedAvoid, 1, 'letter window stats record avoid-set skips for a letter');
        assertEqual(stats[1].letter, 'b', 'letter window stats record the next fallback letter');
        passed += 5;
    } catch (e) { console.error(e.message); failed++; }

    try {
        const pages = {
            a: [
                { word: 'ability' },
                { word: 'abroad' },
                { word: 'accept' },
                { word: 'acceptable' },
                { word: 'accident' },
                { word: 'account' },
                { word: 'achieve' },
                { word: 'across' },
                { word: 'act' },
                { word: 'actually' },
                { word: 'addition' },
                { word: 'additional' },
                { word: 'adjective' },
                { word: 'adjust' },
                { word: 'admire' },
                { word: 'admit' },
                { word: 'adult' },
                { word: 'advanced' },
                { word: 'advantage' },
                { word: 'adventure' },
                { word: 'advertisement' },
                { word: 'advertising' },
                { word: 'advice' },
                { word: 'advise' },
                { word: 'affair' }
            ],
            b: [
                { word: 'background' },
                { word: 'badly' },
                { word: 'badminton' },
                { word: 'bake' },
                { word: 'balcony' }
            ]
        };
        const avoidWords = new Set(pages.a.slice(0, 20).map((item) => item.word.toLowerCase()));
        const command = {
            gte(value) {
                return {
                    and(other) {
                        return { __range: [value, other.__lt] };
                    }
                };
            },
            lt(value) {
                return { __lt: value };
            }
        };
        const db = {
            command,
            collection() {
                return {
                    where(query) {
                        const range = query.word && query.word.__range ? query.word.__range : ['a', '{'];
                        const letter = range[0];
                        return {
                            orderBy() { return this; },
                            skip(offset) { this._offset = offset; return this; },
                            limit(size) { this._limit = size; return this; },
                            async get() {
                                const cappedLimit = Math.min(this._limit || 100, 20);
                                const list = (pages[letter] || []).slice(this._offset || 0, (this._offset || 0) + cappedLimit);
                                return { data: list };
                            }
                        };
                    }
                };
            }
        };
        const result = await fetchOrderedCandidatesByLetterWindow(db, 'book_a2', ['a', 'b'], 5, avoidWords);
        assertEqual(result.map((item) => item.word).join(','), 'advertisement,advertising,advice,advise,affair', 'letter window continues paging within the same letter when the client query limit caps each response');
        passed += 1;
    } catch (e) { console.error(e.message); failed++; }

    console.log('\n======== 测试完成 ========');
    console.log(`通过: ${passed}`);
    console.log(`失败: ${failed}`);
    return { passed, failed };
}

module.exports = { runTests };
