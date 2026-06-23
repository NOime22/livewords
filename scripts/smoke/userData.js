#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, "cloudfunctions", "userData", "index.js");
const APP_FILE = path.join(ROOT, "miniprogram", "app.js");

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
  if (!args.selftest && !args.remote) args.selftest = true;
  return args;
}

function assertContains(source, regex, message, checks) {
  if (!regex.test(source)) {
    throw new Error(message);
  }
  checks.push(message);
}

function staticDefaultChecks() {
  const source = fs.readFileSync(FILE, "utf8");
  const checks = [];

  assertContains(source, /case\s+"getProfile"\s*:/, "router has case \"getProfile\"", checks);
  assertContains(source, /case\s+"getAvoidList"\s*:/, "router has case \"getAvoidList\"", checks);
  assertContains(source, /case\s+"getReviewSet"\s*:/, "router has case \"getReviewSet\"", checks);
  assertContains(source, /default\s*:\s*\n\s*result\s*=\s*\{\s*ok:\s*false,\s*error:\s*"unknown action",\s*code:\s*"UNKNOWN_ACTION"\s*\}/, "default sets unknown action result", checks);

  return checks;
}

function staticIdempotencyChecks() {
  const source = fs.readFileSync(FILE, "utf8");
  const checks = [];

  assertContains(source, /const\s+operationId\s*=\s*String\(payload\.operationId\s*\|\|\s*""\)\.trim\(\)/, "upsertWordStatus reads payload.operationId", checks);
  assertContains(source, /startUserOperation\(openid,\s*operationId\)/, "upsertWordStatus invokes idempotency gate", checks);
  assertContains(source, /mode\s*===\s*"deduped"\s*\|\|\s*opState\.mode\s*===\s*"in_progress"/, "idempotency gate returns early for replay/in-progress", checks);
  assertContains(source, /status:\s*"completed"/, "idempotency record stores completed status", checks);
  assertContains(source, /status:\s*"failed"/, "idempotency record stores failed status", checks);

  return checks;
}

function staticAuthSessionChecks() {
  const checks = staticDefaultChecks();
  const appSource = fs.readFileSync(APP_FILE, "utf8");

  assertContains(appSource, /isAuthResultExpiredError\s*\(/, "app defines auth result-expired detector", checks);
  assertContains(appSource, /retryEnsureAuthSessionAfterExpiry\s*\(/, "app defines auth retry helper", checks);
  assertContains(appSource, /result expired|timeout for result fetching/i, "app recognizes result-expired auth error text", checks);
  assertContains(appSource, /retryEnsureAuthSessionAfterExpiry\(error,\s*force\)/, "ensureAuthSession retries on result-expired auth error", checks);

  return checks;
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
    name: "userData",
    data: { action: "__smoke_unknown__" },
  });
  const result = normalizeFunctionResult(res);

  if (!result || result.ok !== false || result.error !== "unknown action") {
    throw new Error(`unexpected remote response: ${JSON.stringify(result)}`);
  }

  return result;
}

async function runRemoteIdempotencyCheck() {
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

  const operationId = `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const payload = {
    action: "upsertWordStatus",
    operationId,
    word: `smoke${Date.now()}`,
    status: "known",
    meta: {
      lang: "en",
      pos: "",
      phonetic: "",
      translation: "",
      definition: "",
      topic: "smoke",
    },
    exposuresDelta: 1,
    familiarityDelta: 1,
  };

  const firstRaw = await app.callFunction({ name: "userData", data: payload });
  const secondRaw = await app.callFunction({ name: "userData", data: payload });
  const first = normalizeFunctionResult(firstRaw);
  const second = normalizeFunctionResult(secondRaw);

  if (!first || first.ok !== true || first.deduped !== false) {
    throw new Error(`unexpected first response: ${JSON.stringify(first)}`);
  }
  if (!second || second.ok !== true || second.deduped !== true) {
    throw new Error(`unexpected second response: ${JSON.stringify(second)}`);
  }

  return { operationId, first, second };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = {
    script: "userData",
    mode: args.remote ? "remote" : "selftest",
    case: args.caseName,
  };

  const allowedCases = new Set(["default", "idempotency", "auth-session"]);
  if (!allowedCases.has(args.caseName)) {
    throw new Error(`unsupported case: ${args.caseName}`);
  }

  const checks = args.caseName === "idempotency"
    ? staticIdempotencyChecks()
    : args.caseName === "auth-session"
      ? staticAuthSessionChecks()
      : staticDefaultChecks();
  output.staticChecks = checks;

  if (args.remote) {
    output.remote = args.caseName === "idempotency"
      ? await runRemoteIdempotencyCheck()
      : await runRemoteCheck();
  } else {
    output.remote = "skipped";
  }

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error("[smoke:userData]", error && error.message ? error.message : String(error));
  process.exit(1);
});
