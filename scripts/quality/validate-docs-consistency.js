#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const DOC_SPECS = [
  {
    file: "docs/CURRENT_ARCHITECTURE.md",
    anchors: [
      "Source of Truth",
      "operationId",
      "expectedRev",
      "REV_CONFLICT",
      "reviveEligibleUntil",
      "reviveCount",
      "protagonist",
      "BRANCH_IMMUTABLE",
      "verify:rollout",
      "verify:regression"
    ]
  },
  {
    file: "docs/product/PRODUCT_BACKLOG.md",
    anchors: [
      "Protagonist Mode",
      "retain-and-mark",
      "operationId",
      "expectedRev",
      "REV_CONFLICT",
      "BRANCH_IMMUTABLE",
      "verify:rollout",
      "verify:regression"
    ]
  },
  {
    file: "docs/guides/CONTENT_QUALITY.md",
    anchors: [
      "promptMeta",
      "contextFlags.protagonistMode",
      "contextFlags.revivalActive",
      "contextFlags.revivalEligible",
      "contextFlags.branchPlanned",
      "BRANCH_IMMUTABLE"
    ]
  },
  {
    file: "docs/guides/TESTING_GUIDE.md",
    anchors: [
      "operationId",
      "expectedRev",
      "REV_CONFLICT",
      "reviveEligibleUntil",
      "reviveCount",
      "BRANCH_IMMUTABLE",
      "verify:rollout",
      "verify:regression"
    ]
  },
  {
    file: "docs/README.md",
    anchors: [
      "docs/CURRENT_ARCHITECTURE.md",
      "docs/guides/CONTENT_QUALITY.md",
      "docs/guides/TESTING_GUIDE.md",
      "docs/product/PRODUCT_BACKLOG.md",
      "verify:rollout",
      "verify:regression"
    ]
  }
];

const FORBIDDEN_PATTERNS = [
  /\bstory_cycles\b/i,
  /\buser_story_cycles\b/i,
  /delete\s+activeStory/i,
  /remove\s+activeStory/i,
  /branch\s+choice\s+is\s+mutable/i,
  /branch\s+can\s+be\s+changed\s+after\s+selection/i
];

function fail(message, details) {
  console.error(`[docs-consistency] ${message}`);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    fixture: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixture") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        fail("Missing value for --fixture", []);
      }
      args.fixture = next;
      i += 1;
    }
  }

  return args;
}

function checkFile(absPath, relPath, requiredAnchors) {
  const issues = [];
  if (!fs.existsSync(absPath)) {
    issues.push(`Missing file: ${relPath}`);
    return issues;
  }

  const raw = fs.readFileSync(absPath, "utf8");
  for (const anchor of requiredAnchors) {
    if (!raw.includes(anchor)) {
      issues.push(`Missing anchor in ${relPath}: ${anchor}`);
    }
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(raw)) {
      issues.push(`Forbidden pattern in ${relPath}: ${pattern}`);
    }
  }

  return issues;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const issues = [];

  if (args.fixture) {
    const rel = args.fixture;
    const abs = path.resolve(ROOT, rel);
    const fixtureIssues = checkFile(abs, rel, [
      "Source of Truth",
      "operationId",
      "expectedRev",
      "REV_CONFLICT",
      "reviveEligibleUntil",
      "reviveCount",
      "BRANCH_IMMUTABLE",
      "verify:rollout",
      "verify:regression"
    ]);
    if (fixtureIssues.length > 0) {
      fail("FAIL", fixtureIssues);
    }
    console.log("[docs-consistency] PASS");
    console.log(`[docs-consistency] Checked fixture: ${rel}`);
    return;
  }

  for (const spec of DOC_SPECS) {
    const abs = path.resolve(ROOT, spec.file);
    const fileIssues = checkFile(abs, spec.file, spec.anchors);
    issues.push(...fileIssues);
  }

  if (issues.length > 0) {
    fail("FAIL", issues);
  }

  console.log("[docs-consistency] PASS");
  for (const spec of DOC_SPECS) {
    console.log(`[docs-consistency] Checked: ${spec.file}`);
  }
}

main();
