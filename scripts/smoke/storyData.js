#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, "cloudfunctions", "storyData", "index.js");

function parseArgs(argv) {
  const args = { selftest: false, remote: false, caseName: "default" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--selftest") args.selftest = true;
    else if (token === "--remote") args.remote = true;
    else if (token === "--case" && argv[i + 1]) {
      args.caseName = String(argv[i + 1]);
      i += 1;
    }
  }
  if (!args.selftest && !args.remote && args.caseName === "default") args.selftest = true;
  return args;
}

function assertContains(source, regex, message, checks) {
  if (!regex.test(source)) {
    throw new Error(message);
  }
  checks.push(message);
}

function assertNotContains(source, regex, message, checks) {
  if (regex.test(source)) {
    throw new Error(message);
  }
  checks.push(message);
}

function staticContractChecks() {
  const source = fs.readFileSync(FILE, "utf8");
  const checks = [];

  assertContains(source, /case\s+'getStoryStatus'\s*:\s*result\s*=\s*await\s+getStoryStatus\(openid\)/, "router dispatches getStoryStatus action", checks);
  assertContains(source, /case\s+'getStats'\s*:\s*result\s*=\s*await\s+getStats\(openid\)/, "router dispatches getStats action", checks);
  assertContains(source, /const\s+ENABLE_DEV_OPENID\s*=\s*String\(process\.env\.ENABLE_DEV_OPENID/, "ENABLE_DEV_OPENID flag exists", checks);
  assertContains(source, /function\s+verifyAdminAuth\s*\(/, "admin auth verifier exists", checks);
  assertContains(source, /const\s+DEV_OPENID_ACTION_ALLOWLIST\s*=\s*Object\.freeze\(new Set\(/, "devOpenid allowlist exists", checks);
  assertContains(source, /code:\s*'AUTH_MISSING_OPENID'/, "OPENID guard returns AUTH_MISSING_OPENID", checks);
  assertContains(source, /action\s*===\s*'processDraftRetryQueue'/, "processDraftRetryQueue has dedicated route guard", checks);
  assertContains(source, /code:\s*'FORBIDDEN_ACTION'/, "FORBIDDEN_ACTION typed response exists", checks);
  assertContains(source, /code:\s*'ADMIN_AUTH_REQUIRED'/, "ADMIN_AUTH_REQUIRED typed response exists", checks);
  assertContains(source, /code:\s*'ADMIN_AUTH_INVALID'/, "ADMIN_AUTH_INVALID typed response exists", checks);
  return { source, checks };
}

function staticRevisionChecks() {
  const { source, checks } = staticContractChecks();
  assertContains(source, /function\s+parseExpectedRev\s*\(/, "storyData defines parseExpectedRev", checks);
  assertContains(source, /function\s+checkStoryRevConflict\s*\(/, "storyData defines checkStoryRevConflict", checks);
  assertContains(source, /code:\s*'REV_CONFLICT'/, "REV_CONFLICT typed response is present", checks);
  assertContains(source, /const\s+revConflict\s*=\s*checkStoryRevConflict\(story,\s*expectedRev\)/, "state mutations gate on expectedRev", checks);
  return { source, checks };
}

function staticIdempotencyChecks() {
  const { source, checks } = staticContractChecks();
  assertContains(source, /const\s+opId\s*=\s*String\(operationId\s*\|\|\s*''\)\.trim\(\)/, "operationId is normalized for story mutations", checks);
  assertContains(source, /startStoryOperation\(openid,\s*opId\)/, "story mutations invoke idempotency gate", checks);
  assertContains(source, /opState\.mode\s*===\s*'deduped'\s*\|\|\s*opState\.mode\s*===\s*'in_progress'/, "idempotency gate short-circuits replay/in-progress", checks);
  assertContains(source, /deduped:\s*true/, "deduped response contract exists", checks);
  assertContains(source, /finishStoryOperation\(operationDocId,\s*response\)/, "successful mutation persists idempotency completion", checks);
  return { source, checks };
}

function staticExpiryChecks() {
  const { source, checks } = staticContractChecks();
  assertNotContains(source, /Story expired, removing\.\.\./, "lazy expiry no longer logs removal", checks);
  assertNotContains(source, /if\s*\(story\.status\s*===\s*'ongoing'\)\s*\{[\s\S]*?activeStory:\s*_.remove\(\)/, "lazy expiry branch no longer removes activeStory", checks);
  assertContains(source, /if\s*\(diffDays\s*>\s*CYCLE_DAYS\)\s*\{[\s\S]*?'activeStory\.status':\s*'expired'/, "saveStoryEpisode marks status as expired", checks);
  assertContains(source, /if\s*\(diffDays\s*>\s*CYCLE_DAYS\)\s*\{[\s\S]*?'activeStory\.reviveEligibleUntil':\s*reviveEligibleUntil/, "saveStoryEpisode writes reviveEligibleUntil", checks);
  assertContains(source, /if\s*\(diffDays\s*>\s*CYCLE_DAYS\)\s*\{[\s\S]*?'activeStory\.reviveCount':\s*reviveCount/, "saveStoryEpisode writes reviveCount", checks);
  assertContains(source, /return\s*\{\s*ok:\s*true,\s*empty:\s*true,\s*expired:\s*true,\s*story:\s*expiredStory,\s*reviveEligible:\s*isStoryReviveEligible\(/, "getStoryStatus expiry response includes empty/expired/story/reviveEligible", checks);
  return { source, checks };
}

function staticRevivalLimitChecks() {
  const { source, checks } = staticExpiryChecks();
  assertContains(source, /function\s+isStoryReviveEligible\s*\(/, "revive eligibility helper exists", checks);
  assertContains(source, /if\s*\(reviveCount\s*>=\s*1\)\s*return\s*false;/, "revive eligibility blocks reviveCount >= 1", checks);
  assertContains(source, /if\s*\(!reviveEligibleUntilTs\s*\|\|\s*currentTs\s*>\s*reviveEligibleUntilTs\)\s*return\s*false;/, "revive eligibility blocks when window is missing or elapsed", checks);
  assertContains(source, /code:\s*'REVIVE_LIMIT_REACHED'/, "revive action returns REVIVE_LIMIT_REACHED typed code", checks);
  return { source, checks };
}

function staticRevivalHappyChecks() {
  const { source, checks } = staticContractChecks();
  assertContains(source, /case\s+'reviveStoryCycle'\s*:\s*result\s*=\s*await\s+reviveStoryCycle\(openid,\s*data\)/, "router dispatches reviveStoryCycle action", checks);
  assertContains(source, /async\s+function\s+reviveStoryCycle\s*\(openid,\s*\{\s*expectedRev,\s*operationId\s*\}\s*=\s*\{\s*\}\)/, "reviveStoryCycle mutation exists", checks);
  assertContains(source, /if\s*\(!isStoryReviveEligible\(story,\s*Date\.now\(\)\)\)\s*\{[\s\S]*?REVIVE_NOT_ELIGIBLE/, "reviveStoryCycle checks revive eligibility helper", checks);
  assertContains(source, /'activeStory\.status':\s*'ongoing'/, "reviveStoryCycle restores story status to ongoing", checks);
  assertContains(source, /'activeStory\.reviveCount':\s*1/, "reviveStoryCycle writes reviveCount=1", checks);
  assertContains(source, /'activeStory\.rev':\s*_\.inc\(1\)/, "reviveStoryCycle increments story rev", checks);
  assertContains(source, /code:\s*'REVIVE_STORY_MISSING'/, "revive action includes REVIVE_STORY_MISSING typed rejection", checks);
  assertContains(source, /code:\s*'REVIVE_NOT_EXPIRED'/, "revive action includes REVIVE_NOT_EXPIRED typed rejection", checks);
  assertContains(source, /code:\s*'REVIVE_NOT_ELIGIBLE'/, "revive action includes REVIVE_NOT_ELIGIBLE typed rejection", checks);
  assertContains(source, /code:\s*'REVIVE_LIMIT_REACHED'/, "revive action includes REVIVE_LIMIT_REACHED typed rejection", checks);
  return { source, checks };
}

function staticProtagonistChecks() {
  const { source, checks } = staticContractChecks();
  assertContains(source, /function\s+sanitizeProtagonistName\s*\(/, "protagonist sanitizer helper exists", checks);
  assertContains(source, /const\s+STORY_PROTAGONIST_FALLBACK\s*=\s*'你'/, "protagonist fallback constant exists", checks);
  assertContains(source, /function\s+resolveStoryProtagonist\s*\(/, "protagonist resolver helper exists", checks);
  assertContains(source, /targetWords:\s*words\s*\|\|\s*\[\],\s*\n\s*protagonist,/, "prompt payload includes protagonist", checks);
  assertContains(source, /const\s+promptMeta\s*=\s*\{[\s\S]*?protagonist,\s*\n\s*protagonistSource,/, "promptMeta includes protagonist metadata", checks);
  assertContains(source, /const\s+newStory\s*=\s*\{[\s\S]*?protagonist,/, "activeStory persists protagonist metadata", checks);
  return { source, checks };
}

function staticQualityContextChecks() {
  const { source, checks } = staticProtagonistChecks();
  assertContains(source, /const\s+flowMeta\s*=\s*\{[\s\S]*?storyStatus,[\s\S]*?reviveCount,[\s\S]*?reviveEligibleUntil,[\s\S]*?revivalEligible,[\s\S]*?branchPlanned,[\s\S]*?branchContext,/, "flowMeta carries revival and branch context fields", checks);
  assertContains(source, /const\s+contextFlags\s*=\s*\{[\s\S]*?protagonistMode:[\s\S]*?revivalActive:[\s\S]*?revivalEligible:[\s\S]*?branchPlanned:/, "promptMeta builds structured contextFlags", checks);
  assertContains(source, /const\s+promptMeta\s*=\s*\{[\s\S]*?contextFlags,/, "promptMeta includes contextFlags object", checks);
  assertContains(source, /reasons\.push\('illegalEnglishInMixed'\)/, "validator keeps illegalEnglishInMixed reason", checks);
  assertContains(source, /stripIllegalEnglishTokensFromMixed\(/, "deterministic mixed-token sanitize path exists", checks);
  return { source, checks };
}

function staticBranchChoiceChecks() {
  const { source, checks } = staticQualityContextChecks();
  assertContains(source, /case\s+'submitMidWeekChoice'\s*:\s*result\s*=\s*await\s+submitMidWeekChoice\(openid,\s*data\)/, "router dispatches submitMidWeekChoice action", checks);
  assertContains(source, /async\s+function\s+submitMidWeekChoice\s*\(openid,\s*\{\s*storyId,\s*choice,\s*expectedRev,\s*operationId\s*\}\)/, "submitMidWeekChoice mutation exists", checks);
  assertContains(source, /code:\s*'BRANCH_INVALID_CHOICE'/, "branch action validates A/B choice", checks);
  assertContains(source, /code:\s*'BRANCH_IMMUTABLE'/, "branch action exposes immutable conflict code", checks);
  assertContains(source, /'activeStory\.midWeekChoice':\s*nextMidWeekChoice/, "branch action persists midWeekChoice object", checks);
  assertContains(source, /'activeStory\.branchContext\.midWeekChoice':\s*selectedChoice/, "branch action persists branchContext choice", checks);
  assertContains(source, /'activeStory\.rev':\s*_\.inc\(1\)/, "branch action increments story rev", checks);
  assertContains(source, /branchChoice:\s*branchChoiceActive\s*\?\s*selectedBranch\s*:\s*''/, "flowMeta emits branchChoice only after boundary selection", checks);
  return { source, checks };
}

function staticDraftTimeoutChecks() {
  const { source, checks } = staticContractChecks();
  const indexSource = fs.readFileSync(path.join(ROOT, "miniprogram", "pages", "index", "index.js"), "utf8");

  const lockMatch = source.match(/const\s+DRAFT_LOCK_MS\s*=\s*([^;]+);/);
  if (!lockMatch) {
    throw new Error("unable to parse DRAFT_LOCK_MS");
  }
  const lockMs = Function(`"use strict"; return (${lockMatch[1]});`)();
  const lockMinutes = Number(lockMs) / (60 * 1000);
  if (!Number.isFinite(lockMinutes) || lockMinutes < 4) {
    throw new Error("DRAFT_LOCK_MS must be at least 4 minutes to outlast slow AI generation");
  }
  checks.push("DRAFT_LOCK_MS is at least 4 minutes");

  assertContains(indexSource, /isStoryTimeoutError\s*\(/, "mini program defines story timeout detection helper", checks);
  assertContains(indexSource, /recoverEpisodeDraftAfterTimeout\s*\(/, "mini program defines story draft timeout recovery helper", checks);
  assertContains(indexSource, /生成较慢，后台继续处理中/, "story timeout surfaces non-fatal user copy", checks);
  assertContains(source, /source:\s*'story-prod'/, "production drafts mark story-prod source", checks);
  assertNotContains(source, /forceSplitGeneration:\s*true/, "production drafts no longer force split generation", checks);
  assertContains(source, /async\s+function\s+rewriteStoryProdMixedFromEnglish\s*\(/, "production faithful mixed rewrite helper exists", checks);
  assertContains(source, /mixedFaithfulRewriteAttempted:\s*true/, "production faithful mixed rewrite metadata exists", checks);
  assertContains(source, /function\s+stripTargetWordChineseGloss\s*\(/, "mixed gloss cleanup helper exists", checks);
  assertContains(source, /\{\s*k:\s*5,\s*min:\s*105,\s*max:\s*155/, "5-word ladder increased by 10 words", checks);
  assertContains(source, /\{\s*k:\s*10,\s*min:\s*145,\s*max:\s*205/, "10-word ladder increased by 10 words", checks);
  return { source, checks };
}

function staticFaithfulMixedChecks() {
  const { source, checks } = staticDraftTimeoutChecks();
  assertContains(source, /function\s+analyzeMixedFaithfulnessAgainstEnglish\s*\(/, "production mixed defines english-alignment analyzer", checks);
  assertContains(source, /extraDialogueWithoutEnglishDialogue/, "faithfulness analyzer detects added dialogue", checks);
  assertContains(source, /extraLocationSpecificity/, "faithfulness analyzer detects added location specificity", checks);
  assertContains(source, /extraActionIntensity/, "faithfulness analyzer detects added action intensity", checks);
  assertContains(source, /faithfulnessAnalysis\s*=\s*analyzeMixedFaithfulnessAgainstEnglish\(/, "production mixed rewrite runs english-alignment analyzer", checks);
  assertContains(source, /mixedFaithfulnessGuarded:\s*true/, "production mixed metadata records alignment guard", checks);
  return { source, checks };
}

function hasRemoteCredentials() {
  const secretId = process.env.CLOUDBASE_SECRET_ID || process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.CLOUDBASE_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY;
  return Boolean(
    process.env.CLOUDBASE_ENV_ID &&
      secretId &&
      secretKey
  );
}

function normalizeFunctionResult(raw) {
  if (!raw) return null;
  if (raw.result && typeof raw.result === "object") return raw.result;
  if (typeof raw === "object") return raw;
  return null;
}

async function runRemoteCheck() {
  if (!hasRemoteCredentials()) {
    throw new Error("remote mode requires CLOUDBASE_ENV_ID/CLOUDBASE_SECRET_ID/CLOUDBASE_SECRET_KEY");
  }

  const tcb = require("@cloudbase/node-sdk");
  const secretId = process.env.CLOUDBASE_SECRET_ID || process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.CLOUDBASE_SECRET_KEY || process.env.TENCENTCLOUD_SECRETKEY;
  const sessionToken = process.env.CLOUDBASE_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN || "";
  const app = tcb.init({
    env: process.env.CLOUDBASE_ENV_ID,
    secretId,
    secretKey,
    sessionToken,
    timeout: 15000,
  });

  const res = await app.callFunction({
    name: "storyData",
    data: { action: "getStoryStatus" },
  });
  const statusResult = normalizeFunctionResult(res);

  if (!statusResult || statusResult.ok !== false || statusResult.code !== "AUTH_MISSING_OPENID") {
    throw new Error(`unexpected getStoryStatus remote response: ${JSON.stringify(statusResult)}`);
  }

  const queueRes = await app.callFunction({
    name: "storyData",
    data: { action: "processDraftRetryQueue" },
  });
  const queueResult = normalizeFunctionResult(queueRes);
  if (!queueResult || queueResult.ok !== false || queueResult.code !== "FORBIDDEN_ACTION") {
    throw new Error(`unexpected processDraftRetryQueue remote response: ${JSON.stringify(queueResult)}`);
  }

  return {
    getStoryStatus: statusResult,
    processDraftRetryQueue: queueResult,
  };
}

function runInvalidActionCase(source, checks) {
  const guardIndex = source.indexOf("else if (!openid)");
  const unknownActionIndex = source.indexOf("code: 'UNKNOWN_ACTION'");
  if (guardIndex === -1 || unknownActionIndex === -1 || guardIndex > unknownActionIndex) {
    throw new Error("OPENID guard is missing or appears after unknown-action return");
  }
  checks.push("OPENID guard is evaluated before unknown action return");

  const expected = { ok: false, error: "No OPENID found", code: "AUTH_MISSING_OPENID" };
  console.error(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "invalid-action",
    expectedError: expected,
    staticChecks: checks,
  }, null, 2));

  process.exit(2);
}

function runRevivalLimitCase(source, checks) {
  const expected = {
    reviveEligible: false,
    reason: "reviveCount>=1 or now>reviveEligibleUntil",
  };
  console.error(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "revival-limit",
    expectedError: expected,
    staticChecks: checks,
  }, null, 2));

  process.exit(2);
}

function runRevivalHappyCase(source, checks) {
  const expected = {
    ok: true,
    revived: true,
    reviveEligible: false,
    status: "ongoing",
    reviveCount: 1,
  };
  console.log(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "revival-happy",
    expected,
    staticChecks: checks,
  }, null, 2));
}

function runProtagonistFallbackCase(source, checks) {
  const expected = {
    protagonist: "你",
    source: "fallback",
  };
  console.error(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "protagonist-fallback",
    expectedError: expected,
    staticChecks: checks,
  }, null, 2));

  process.exit(2);
}

function runQualityContextCase(source, checks) {
  const expected = {
    promptMeta: {
      contextFlags: {
        protagonistMode: "boolean",
        revivalActive: "boolean",
        revivalEligible: "boolean",
        branchPlanned: "boolean",
      },
    },
    validatorReason: "illegalEnglishInMixed",
  };
  console.log(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "quality-context",
    expected,
    staticChecks: checks,
  }, null, 2));
}

function runInvalidMixedTokenCase(source, checks) {
  const expected = {
    guard: "illegalEnglishInMixed",
    strict: true,
    sanitizePath: "stripIllegalEnglishTokensFromMixed",
  };
  console.error(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "invalid-mixed-token",
    expectedError: expected,
    staticChecks: checks,
  }, null, 2));
  process.exit(2);
}

function runBranchHappyCase(source, checks) {
  const expected = {
    selectedBranch: "A",
    immutable: true,
    promptContext: {
      branchChoice: "A",
      branchChoiceActive: true,
    },
  };
  console.log(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "branch-happy",
    expected,
    staticChecks: checks,
  }, null, 2));
}

function runBranchErrorCase(source, checks) {
  const expected = {
    code: "BRANCH_IMMUTABLE",
    selectedBranch: "A",
    conflictChoice: "B",
  };
  console.error(JSON.stringify({
    script: "storyData",
    mode: "case",
    case: "branch-error",
    expectedError: expected,
    staticChecks: checks,
  }, null, 2));
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allowedCases = new Set(["default", "invalid-action", "invalid-mixed-token", "revision", "idempotency", "expiry", "revival-happy", "revival-limit", "protagonist", "protagonist-fallback", "quality-context", "branch-happy", "branch-error", "draft-timeout", "faithful-mixed"]);
  if (!allowedCases.has(args.caseName)) {
    throw new Error(`unsupported case: ${args.caseName}`);
  }

  const contracts = args.caseName === "revision"
    ? staticRevisionChecks()
    : args.caseName === "expiry"
      ? staticExpiryChecks()
      : args.caseName === "revival-happy"
        ? staticRevivalHappyChecks()
      : args.caseName === "revival-limit"
      ? staticRevivalLimitChecks()
      : args.caseName === "protagonist" || args.caseName === "protagonist-fallback"
        ? staticProtagonistChecks()
        : args.caseName === "quality-context" || args.caseName === "invalid-mixed-token"
          ? staticQualityContextChecks()
          : args.caseName === "branch-happy" || args.caseName === "branch-error"
            ? staticBranchChoiceChecks()
            : args.caseName === "draft-timeout"
              ? staticDraftTimeoutChecks()
              : args.caseName === "faithful-mixed"
                ? staticFaithfulMixedChecks()
    : args.caseName === "idempotency"
      ? staticIdempotencyChecks()
      : staticContractChecks();
  const { source, checks } = contracts;

  if (args.caseName === "invalid-action") {
    runInvalidActionCase(source, checks);
    return;
  }

  if (args.caseName === "revival-limit") {
    runRevivalLimitCase(source, checks);
    return;
  }

  if (args.caseName === "revival-happy") {
    runRevivalHappyCase(source, checks);
    return;
  }

  if (args.caseName === "protagonist-fallback") {
    runProtagonistFallbackCase(source, checks);
    return;
  }

  if (args.caseName === "quality-context") {
    runQualityContextCase(source, checks);
    return;
  }

  if (args.caseName === "invalid-mixed-token") {
    runInvalidMixedTokenCase(source, checks);
    return;
  }

  if (args.caseName === "branch-happy") {
    runBranchHappyCase(source, checks);
    return;
  }

  if (args.caseName === "branch-error") {
    runBranchErrorCase(source, checks);
    return;
  }

  const output = {
    script: "storyData",
    mode: args.remote ? "remote" : "selftest",
    case: args.caseName,
    staticChecks: checks,
    remote: "skipped",
  };

  if (args.remote) {
    output.remote = await runRemoteCheck();
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error("[smoke:storyData]", error && error.message ? error.message : String(error));
  process.exit(1);
});
