const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[FAILED] ${message}`);
  }
  console.log(`[PASSED] ${message}`);
}

function runTests() {
  console.log('======== welcome page tests ========\n');

  let passed = 0;
  let failed = 0;

  try {
    const source = fs.readFileSync(path.join(__dirname, 'index.wxml'), 'utf8');
    assert(source.includes('<text class="hero-title">上头</text>'), 'welcome page renders the first title row');
    assert(source.includes('<text class="hero-title filled">单词</text>'), 'welcome page renders the second title row');
    passed += 2;
  } catch (error) {
    console.error(error.message);
    failed += 1;
  }

  try {
    const style = fs.readFileSync(path.join(__dirname, 'index.wxss'), 'utf8');
    const filledBlockMatch = style.match(/\.hero-title\.filled\s*\{[\s\S]*?\}/);
    const filledBlock = filledBlockMatch ? filledBlockMatch[0] : '';
    assert(filledBlock.length > 0, 'welcome page defines a dedicated filled title style');
    assert(!filledBlock.includes('text-shadow:'), 'welcome page filled title avoids heavy shadow stacking');
    assert(!filledBlock.includes('transform:'), 'welcome page filled title avoids tilted rendering');
    assert(filledBlock.includes('-webkit-text-stroke: 3rpx'), 'welcome page filled title uses a lighter outline');
    passed += 4;
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
