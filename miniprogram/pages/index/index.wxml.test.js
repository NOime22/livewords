const fs = require('fs');
const path = require('path');

function assert(condition, message) {
    if (!condition) {
        throw new Error(`[FAILED] ${message}`);
    }
    console.log(`[PASSED] ${message}`);
}

function runTests() {
    console.log('======== index.wxml story history template tests ========\n');

    let passed = 0;
    let failed = 0;

    try {
        const filePath = path.join(__dirname, 'index.wxml');
        const source = fs.readFileSync(filePath, 'utf8');
        assert(source.includes("{{item.title || ''}}"), 'story history child title binds archived story title');
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
