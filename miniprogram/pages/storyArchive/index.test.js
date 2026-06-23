const fs = require('fs');
const path = require('path');

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`[FAILED] ${message} - Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
    }
    console.log(`[PASSED] ${message}`);
}

function runTests() {
    console.log('======== storyArchive page config tests ========\n');

    let passed = 0;
    let failed = 0;

    try {
        const filePath = path.join(__dirname, 'index.json');
        const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        assertEqual(config.navigationStyle, 'custom', 'storyArchive page uses custom navigation for fullscreen reader');
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
