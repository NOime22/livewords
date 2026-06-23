// =============================================================================
//  LiveWords · test runner (Public Showcase, Trimmed)
// =============================================================================
//
//  This is a trimmed version of the test runner that only invokes tests
//  present in the public build. References to scripts/story-eval/* test
//  suites (eval-iteration.test.js, run-production-sim.test.js) have been
//  removed — those depend on the private eval pipeline.
//
// =============================================================================

const { execSync } = require('child_process');

function run(label, command) {
  console.log(`\n— ${label} —`);
  execSync(command, { stdio: 'inherit' });
}

try {
  // App-level source tests
  run('app.source', `node -e "const t=require('./miniprogram/app.source.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);

  // Index page module tests (only files that ship in the public build)
  const indexTests = [
    'helpers', 'wordLoader', 'wordLoader.source',
    'storyHistory', 'storyStatsCache', 'masteredStatsCache',
    'storyGenerationTiming', 'sessionManager.source',
  ];
  indexTests.forEach((name) => {
    const path = `./miniprogram/pages/index/modules/${name}.test.js`;
    run(`index/${name}`, `node -e "const t=require('${path}'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  });

  // Page-level source tests
  run('index.source', `node -e "const t=require('./miniprogram/pages/index/index.source.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('index.wxml', `node -e "const t=require('./miniprogram/pages/index/index.wxml.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('welcome', `node -e "const t=require('./miniprogram/pages/welcome/index.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('masteredWords', `node -e "const t=require('./miniprogram/pages/masteredWords/index.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('story-reader.source', `node -e "const t=require('./miniprogram/components/story-reader/index.source.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('settings', `node -e "const t=require('./miniprogram/pages/settings/index.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('storyArchive', `node -e "const t=require('./miniprogram/pages/storyArchive/index.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);

  // Cloud function source tests
  run('userData/masteredWords', `node -e "const t=require('./cloudfunctions/userData/masteredWords.source.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('userData/seenWords', `node -e "const t=require('./cloudfunctions/userData/seenWords.source.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);
  run('userData/reviewSet', `node -e "const t=require('./cloudfunctions/userData/reviewSet.source.test.js'); const r=t.runTests(); if(!r||r.failed>0) process.exit(1);"`);

  // NOTE: story-eval pipeline tests (eval-iteration / run-production-sim) and
  //       storyData internal tests (midWeekChoice / performance) are not run
  //       here because those depend on the private eval/full-source code that
  //       is not part of the public build.
} catch (e) {
  process.exit(1);
}
