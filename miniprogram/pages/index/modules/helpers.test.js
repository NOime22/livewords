/**
 * helpers.test.js - helpers.js 单元测试
 * 
 * 用法：在微信开发者工具控制台中执行
 * require('pages/index/modules/helpers.test.js').runTests()
 */

const {
    formatDate,
    rpxToPx,
    nextLetter,
    isValidWord,
    ensureWordShape,
    extractJson,
    sanitizeJsonText,
    tryParseSession,
    normalizeSession
} = require('./helpers');

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
    console.log('======== helpers.js 单元测试 ========\n');

    let passed = 0;
    let failed = 0;

    // ===================
    // formatDate 测试
    // ===================
    console.log('--- formatDate ---');
    try {
        assertEqual(formatDate(null), '', 'formatDate(null) should return empty string');
        assertEqual(formatDate(undefined), '', 'formatDate(undefined) should return empty string');
        const d = new Date(2025, 0, 15, 10, 30); // Jan 15, 2025 10:30
        const result = formatDate(d.getTime());
        assert(result.includes('2025'), 'formatDate should include year');
        assert(result.includes('01-15'), 'formatDate should include month-day');
        assert(result.includes('10:30'), 'formatDate should include time');
        passed += 3;
    } catch (e) {
        console.error(e.message);
        failed++;
    }

    // ===================
    // rpxToPx 测试
    // ===================
    console.log('\n--- rpxToPx ---');
    try {
        assertEqual(rpxToPx(750, 375), 375, 'rpxToPx(750, 375) should return 375');
        assertEqual(rpxToPx(375, 375), 187.5, 'rpxToPx(375, 375) should return 187.5');
        assertEqual(rpxToPx(100, 750), 100, 'rpxToPx(100, 750) should return 100');
        passed += 3;
    } catch (e) {
        console.error(e.message);
        failed++;
    }

    // ===================
    // nextLetter 测试
    // ===================
    console.log('\n--- nextLetter ---');
    try {
        assertEqual(nextLetter('a'), 'b', 'nextLetter(a) should return b');
        assertEqual(nextLetter('z'), 'a', 'nextLetter(z) should wrap to a');
        assertEqual(nextLetter('A'), 'b', 'nextLetter(A) should return b (case insensitive)');
        assertEqual(nextLetter(''), 'a', 'nextLetter empty should return a');
        assertEqual(nextLetter(null), 'a', 'nextLetter null should return a');
        passed += 5;
    } catch (e) {
        console.error(e.message);
        failed++;
    }

    // ===================
    // isValidWord 测试
    // ===================
    console.log('\n--- isValidWord ---');
    try {
        assertEqual(isValidWord('hello'), true, 'isValidWord(hello) should be true');
        assertEqual(isValidWord('A'), false, 'isValidWord(A) single letter should be false');
        assertEqual(isValidWord('B · C'), false, 'isValidWord with · should be false');
        assertEqual(isValidWord('U.S.A'), false, 'isValidWord with . should be false');
        assertEqual(isValidWord('abc123'), false, 'isValidWord with numbers should be false');
        assertEqual(isValidWord("don't"), true, "isValidWord(don't) should be true");
        assertEqual(isValidWord('well-known'), true, 'isValidWord with hyphen should be true');
        assertEqual(isValidWord(''), false, 'isValidWord empty should be false');
        assertEqual(isValidWord(null), false, 'isValidWord null should be false');
        passed += 9;
    } catch (e) {
        console.error(e.message);
        failed++;
    }

    // ===================
    // extractJson 测试
    // ===================
    console.log('\n--- extractJson ---');
    try {
        const json1 = extractJson('Here is some text {"key":"value"} more text');
        assertEqual(json1, '{"key":"value"}', 'extractJson should extract JSON from text');

        const json2 = extractJson('```json\n{"foo":"bar"}\n```');
        assert(json2.includes('"foo"'), 'extractJson should handle fenced code blocks');

        const json3 = extractJson('no json here');
        assertEqual(json3, null, 'extractJson should return null for no JSON');
        passed += 3;
    } catch (e) {
        console.error(e.message);
        failed++;
    }

    // ===================
    // tryParseSession 测试
    // ===================
    console.log('\n--- tryParseSession ---');
    try {
        const result1 = tryParseSession('{"words":[],"paragraph":{}}', { silent: true });
        assert(result1 !== null, 'tryParseSession should parse valid JSON');
        assert(Array.isArray(result1.words), 'tryParseSession result should have words array');

        const result2 = tryParseSession('invalid json', { silent: true });
        assertEqual(result2, null, 'tryParseSession should return null for invalid JSON');

        const result3 = tryParseSession('```json\n{"test":1,}\n```', { silent: true });
        assert(result3 !== null, 'tryParseSession should handle trailing commas');
        passed += 4;
    } catch (e) {
        console.error(e.message);
        failed++;
    }

    // ===================
    // ensureWordShape 测试
    // ===================
    console.log('\n--- ensureWordShape ---');
    try {
        const words = ensureWordShape([
            { word: 'test', translation: 'n. 测试；检验 v. 测试' },
            { word: 'hello' }
        ]);

        assertEqual(words.length, 2, 'ensureWordShape should return same number of words');
        assert(words[0].id !== undefined, 'ensureWordShape should add id');
        assert(words[0].status === 'pending', 'ensureWordShape should set default status');
        assert(Array.isArray(words[0].cnDefs), 'ensureWordShape should create cnDefs array');
        passed += 4;
    } catch (e) {
        console.error(e.message);
        failed++;
    }

    // ===================
    // 总结
    // ===================
    console.log('\n======== 测试完成 ========');
    console.log(`通过: ${passed}`);
    console.log(`失败: ${failed}`);

    return { passed, failed };
}

module.exports = { runTests };
