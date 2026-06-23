#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const INDEX_JS = path.join(ROOT, "miniprogram", "pages", "index", "index.js");
const INDEX_WXML = path.join(ROOT, "miniprogram", "pages", "index", "index.wxml");

function parseArgs(argv) {
  const args = { caseName: "happy" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--case" && argv[i + 1]) {
      args.caseName = String(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

function assertContains(source, regex, message, checks) {
  if (!regex.test(source)) {
    throw new Error(message);
  }
  checks.push(message);
}

function runHappyChecks(indexJsSource, indexWxmlSource) {
  const checks = [];

  assertContains(
    indexWxmlSource,
    /wx:if="\{\{storyExpired\s*&&\s*storyReviveEligible\s*&&\s*!activeStory\}\}"/,
    "revival CTA uses storyExpired && storyReviveEligible && !activeStory visibility",
    checks
  );
  assertContains(indexWxmlSource, /bindtap="handleReviveStory"/, "revival CTA binds handleReviveStory", checks);

  assertContains(indexJsSource, /async\s+handleReviveStory\s*\(/, "index page defines handleReviveStory", checks);
  assertContains(indexJsSource, /storyReviveBusy:\s*true/, "handleReviveStory sets busy state", checks);
  assertContains(indexJsSource, /action:\s*'reviveStoryCycle'/, "handleReviveStory calls reviveStoryCycle action", checks);

  return checks;
}

function runErrorCaseChecks(indexJsSource) {
  const checks = [];

  assertContains(indexJsSource, /REVIVE_NOT_ELIGIBLE/, "typed error code REVIVE_NOT_ELIGIBLE is handled", checks);
  assertContains(indexJsSource, /REVIVE_LIMIT_REACHED/, "typed error code REVIVE_LIMIT_REACHED is handled", checks);
  assertContains(indexJsSource, /REVIVE_NOT_EXPIRED/, "typed error code REVIVE_NOT_EXPIRED is handled", checks);
  assertContains(indexJsSource, /REVIVE_STORY_MISSING/, "typed error code REVIVE_STORY_MISSING is handled", checks);
  assertContains(indexJsSource, /storyReviveErrorCode/, "revive flow stores typed error marker in state", checks);

  const payload = {
    script: "index-revival-ui",
    mode: "case",
    case: "error",
    expectedError: {
      code: "REVIVE_NOT_ELIGIBLE|REVIVE_LIMIT_REACHED|REVIVE_NOT_EXPIRED|REVIVE_STORY_MISSING"
    },
    staticChecks: checks
  };

  console.error(JSON.stringify(payload, null, 2));
  process.exit(2);
}

function runStoryTimeoutChecks(indexJsSource) {
  const checks = [];

  assertContains(indexJsSource, /isStoryTimeoutError\s*\(/, "story page defines timeout detector", checks);
  assertContains(indexJsSource, /console\.warn\('\[Story\] startOrResumeEpisodeDraft timed out:/, "story timeout is downgraded to warning log", checks);
  assertContains(indexJsSource, /this\.startEpisodeDraftPolling\(\);[\s\S]*status:\s*'generating'/, "story timeout branch keeps polling alive while draft stays generating", checks);

  console.log(JSON.stringify({
    script: "index-revival-ui",
    mode: "case",
    case: "story-timeout",
    staticChecks: checks
  }, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const allowedCases = new Set(["happy", "error", "story-timeout"]);
  if (!allowedCases.has(args.caseName)) {
    throw new Error(`unsupported case: ${args.caseName}`);
  }

  const indexJsSource = fs.readFileSync(INDEX_JS, "utf8");
  const indexWxmlSource = fs.readFileSync(INDEX_WXML, "utf8");

  if (args.caseName === "error") {
    runErrorCaseChecks(indexJsSource);
    return;
  }

  if (args.caseName === "story-timeout") {
    runStoryTimeoutChecks(indexJsSource);
    return;
  }

  const checks = runHappyChecks(indexJsSource, indexWxmlSource);
  console.log(JSON.stringify({
    script: "index-revival-ui",
    mode: "case",
    case: "happy",
    staticChecks: checks
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error("[smoke:index-revival-ui]", error && error.message ? error.message : String(error));
  process.exit(1);
}
