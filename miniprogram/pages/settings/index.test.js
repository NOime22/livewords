const fs = require('fs');
const path = require('path');

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAILED] ${message}`);
    }
    console.log(`[PASSED] ${message}`);
}

function runTests() {
    console.log('======== settings page tests ========\n');

    let passed = 0;
    let failed = 0;

    try {
        const settingsUtils = require(path.join(__dirname, '../../utils/settings.js'));
        assert(settingsUtils.WORD_COUNT_DEFAULT === 5, 'new user default daily word count is 5');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageJson = JSON.parse(
            fs.readFileSync(
                path.join(__dirname, 'index.json'),
                'utf8'
            )
        );
        assert(pageJson.navigationStyle === 'custom', 'settings page uses custom navigation for fullscreen layout');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        assert(pageSource.includes('class="page-header"'), 'settings page renders custom header');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        assert(!pageSource.includes('bindchange="onModelChange"'), 'settings page no longer exposes model picker interaction');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        const modelSectionMatch = pageSource.match(/<text class="label-main">故事生成模型<\/text>[\s\S]*?<view class="model-pill">([\s\S]*?)<\/view>/);
        const modelSection = modelSectionMatch ? modelSectionMatch[0] : '';
        assert(modelSection.length > 0, 'settings page renders model display section');
        assert(!modelSection.includes('固定'), 'settings page does not render fixed model badge text');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        assert(pageSource.includes('orderOptions: ["按首字母", "按相似", "乱序"]'), 'settings page keeps alphabet ordering as the first option');
        assert(pageSource.includes('orderIndex: 0'), 'new user default ordering is alphabet');
        assert(pageSource.includes("letterIndex: 0"), 'new user default priority letter is A');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        const deckSnippetStart = pageSource.indexOf('async selectDeck(e) {');
        const deckSnippetEnd = pageSource.indexOf('  // ==================== 往期故事抽屉', deckSnippetStart);
        const deckSnippet = deckSnippetStart >= 0 && deckSnippetEnd > deckSnippetStart
            ? pageSource.slice(deckSnippetStart, deckSnippetEnd)
            : '';
        const countSnippetStart = pageSource.indexOf('onWordCountChange(e) {');
        const countSnippetEnd = pageSource.indexOf('  onReviewModeSwitch(e) {', countSnippetStart);
        const countSnippet = countSnippetStart >= 0 && countSnippetEnd > countSnippetStart
            ? pageSource.slice(countSnippetStart, countSnippetEnd)
            : '';

        assert(!deckSnippet.includes('restartStoryCycle'), 'changing deck in settings does not restart the current story cycle');
        assert(!deckSnippet.includes('resetStory'), 'changing deck in settings does not reset the current story');
        assert(!countSnippet.includes('restartStoryCycle'), 'changing daily word count in settings does not restart the current story cycle');
        assert(!countSnippet.includes('resetStory'), 'changing daily word count in settings does not reset the current story');
        passed += 4;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        assert(pageSource.includes("const currentOrderMode = this.data.orderIndex === 0 ? 'alphabet' : (this.data.orderIndex === 1 ? 'similar' : 'shuffle');"), 'settings page derives current order mode when leaving the page');
        assert(pageSource.includes("const currentOrderAlphaLetter = (this.data.letters[this.data.letterIndex] || 'A').toLowerCase();"), 'settings page derives current priority letter when leaving the page');
        assert(pageSource.includes('currentOrderMode,'), 'settings page syncs current order mode back to the index page state');
        assert(pageSource.includes('currentOrderAlphaLetter,'), 'settings page syncs current priority letter back to the index page state');
        assert(pageSource.includes('orderMode: currentOrderMode,'), 'settings page stores current order mode in pendingRegenerate');
        assert(pageSource.includes('orderAlphaLetter: currentOrderAlphaLetter'), 'settings page stores current priority letter in pendingRegenerate');
        passed += 6;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        assert(pageSource.includes('title="开发者工具"'), 'settings page renders developer tools card');
        assert(pageSource.includes('开发者重置'), 'settings page renders developer reset entry');
        assert(pageSource.includes('bindtap="onResetData"'), 'settings page exposes reset action entry');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        assert(!pageSource.includes('bindtap="onVersionTap"'), 'settings page version footer is not a hidden dev entry');
        assert(!pageSource.includes('评测模式'), 'settings page hides eval mode entry for release');
        assert(!pageSource.includes('内部专用'), 'settings page hides internal-only badge for release');
        assert(!pageSource.includes('bindchange="onEvalModeSwitch"'), 'settings page hides eval mode switch for release');
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
