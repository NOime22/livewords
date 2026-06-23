const fs = require('fs');
const path = require('path');

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAILED] ${message}`);
    }
    console.log(`[PASSED] ${message}`);
}

function runTests() {
    console.log('======== masteredWords page tests ========\n');

    let passed = 0;
    let failed = 0;

    try {
        const appJson = JSON.parse(
            fs.readFileSync(
                path.join(__dirname, '..', '..', 'app.json'),
                'utf8'
            )
        );
        assert(appJson.pages.includes('pages/masteredWords/index'), 'app registers mastered words page route');
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
        assert(pageJson.navigationStyle === 'custom', 'mastered words page uses custom navigation for fullscreen layout');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        assert(pageSource.includes('wx:for="{{displayWords}}"'), 'mastered words page renders stacked cards from displayWords data');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        assert(pageSource.includes('class="summary-badge"'), 'mastered words page uses dedicated summary badge layout');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const styleSource = fs.readFileSync(path.join(__dirname, 'index.wxss'), 'utf8');
        assert(styleSource.includes('.word-card.is-active'), 'mastered words page styles expanded stacked card state');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const styleSource = fs.readFileSync(path.join(__dirname, 'index.wxss'), 'utf8');
        assert(styleSource.includes('background: transparent;') && styleSource.includes('.summary-badge'), 'mastered words summary badge uses transparent background');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const pageSource = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
        assert(pageSource.includes('bindtap="toggleWordCard"'), 'mastered words cards toggle expanded state on tap');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const jsSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        assert(jsSource.includes('displayWords: decorateWords(words, -1)'), 'mastered words page decorates stacked cards after loading');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const jsSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        assert(jsSource.includes('zIndex: index === activeIndex ? list.length + 2 : index + 1'), 'mastered words stack lets lower cards cover upper cards');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const styleSource = fs.readFileSync(path.join(__dirname, 'index.wxss'), 'utf8');
        assert(styleSource.includes('.word-card.is-after-active {\n  margin-top: -70rpx;'), 'cards after the active card keep stacked overlap instead of laying flat');
        passed += 1;
    } catch (error) {
        console.error(error.message);
        failed += 1;
    }

    try {
        const jsSource = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        assert(!jsSource.includes('wx.switchTab({'), 'mastered words back navigation does not use invalid switchTab fallback');
        assert(jsSource.includes("wx.reLaunch({ url: '/pages/index/index' });"), 'mastered words back navigation falls back to reLaunch home safely');
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
