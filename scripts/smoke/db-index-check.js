#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const USER_DATA_FILE = path.join(ROOT, "cloudfunctions", "userData", "index.js");
const STORY_DATA_FILE = path.join(ROOT, "cloudfunctions", "storyData", "index.js");

const MIN_REQUIRED_INDEX_MAP = Object.freeze({
  user_words: [
    ["userId", "word"],
    ["userId", "lastSeenAt"],
    ["userId", "status", "familiarity", "lastSeenAt"],
    ["userId", "lastLearnedAt"],
    ["userId", "lastReviewedAt"],
    ["userId", "status"],
  ],
  story_episode_drafts: [
    ["_openid", "storyId"],
    ["_openid", "storyId", "episodeIndex"],
  ],
});

function parseArgs(argv) {
  const args = {
    strict: true,
    fixture: "none",
    remote: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--strict") {
      args.strict = true;
      continue;
    }
    if (token === "--fixture" && argv[i + 1]) {
      args.fixture = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--remote") {
      args.remote = true;
    }
  }

  return args;
}

function cloneIndexMap(indexMap) {
  const out = {};
  for (const collection of Object.keys(indexMap)) {
    out[collection] = indexMap[collection].map((group) => group.slice());
  }
  return out;
}

function normalizeGroupKey(group) {
  return group.join("+");
}

function normalizeIndexMap(indexMap) {
  const out = {};
  for (const collection of Object.keys(indexMap)) {
    const groups = Array.isArray(indexMap[collection]) ? indexMap[collection] : [];
    out[collection] = groups
      .map((group) => Array.from(new Set(group.map((field) => String(field).trim()).filter(Boolean))))
      .filter((group) => group.length > 0)
      .sort((a, b) => normalizeGroupKey(a).localeCompare(normalizeGroupKey(b)));
  }
  return out;
}

function applyFixture(indexMap, fixture) {
  if (!fixture || fixture === "none") {
    return { map: indexMap, fixtureNotes: [] };
  }

  if (fixture === "missing-user-words") {
    const mutated = cloneIndexMap(indexMap);
    mutated.user_words = (mutated.user_words || []).filter(
      (group) => normalizeGroupKey(group) !== "userId+word"
    );
    return {
      map: mutated,
      fixtureNotes: ["removed required index group: user_words:userId+word"],
    };
  }

  throw new Error(`unsupported fixture: ${fixture}`);
}

function extractBalancedBlock(source, startIndex, openChar, closeChar) {
  if (source[startIndex] !== openChar) return null;
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          text: source.slice(startIndex, i + 1),
          end: i + 1,
        };
      }
    }
  }

  return null;
}

function parseTopLevelObjectKeys(objectText) {
  if (!objectText || objectText[0] !== "{") return [];
  const keys = [];
  let i = 1;
  let depth = 1;
  let inString = false;
  let quote = "";
  let escaped = false;

  while (i < objectText.length - 1) {
    const ch = objectText[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = "";
      }
      i += 1;
      continue;
    }

    if (ch === "\"" || ch === "'") {
      inString = true;
      quote = ch;
      i += 1;
      continue;
    }

    if (ch === "{" || ch === "[" || ch === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      i += 1;
      continue;
    }

    if (depth !== 1) {
      i += 1;
      continue;
    }

    if (ch === "," || /\s/.test(ch)) {
      i += 1;
      continue;
    }

    let key = "";
    let consumed = 0;
    if (ch === "\"" || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < objectText.length) {
        if (objectText[j] === "\\") {
          j += 2;
          continue;
        }
        if (objectText[j] === q) break;
        j += 1;
      }
      key = objectText.slice(i + 1, j);
      consumed = (j - i) + 1;
    } else {
      const idMatch = objectText.slice(i).match(/^[_$A-Za-z][_$A-Za-z0-9]*/);
      if (idMatch) {
        key = idMatch[0];
        consumed = key.length;
      }
    }

    if (!key || consumed <= 0) {
      i += 1;
      continue;
    }

    const nextPart = objectText.slice(i + consumed).match(/^\s*:/);
    if (nextPart) {
      keys.push(key);
      i += consumed + nextPart[0].length;
      continue;
    }

    i += consumed;
  }

  return Array.from(new Set(keys));
}

function resolveVariableObjectKeys(source, varName, beforeIndex) {
  const pattern = new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*\\{`, "g");
  let match = pattern.exec(source);
  let lastMatch = null;

  while (match && match.index < beforeIndex) {
    lastMatch = match;
    match = pattern.exec(source);
  }

  if (!lastMatch) return [];
  const openBraceIndex = source.indexOf("{", lastMatch.index);
  if (openBraceIndex < 0 || openBraceIndex >= beforeIndex) return [];

  const objectBlock = extractBalancedBlock(source, openBraceIndex, "{", "}");
  if (!objectBlock) return [];
  return parseTopLevelObjectKeys(objectBlock.text);
}

function parseWhereCall(source, argStartIndex) {
  let cursor = argStartIndex;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;

  const whereFields = [];
  if (source[cursor] === "{") {
    const objectBlock = extractBalancedBlock(source, cursor, "{", "}");
    if (objectBlock) {
      whereFields.push(...parseTopLevelObjectKeys(objectBlock.text));
      cursor = objectBlock.end;
    }
  } else {
    const idMatch = source.slice(cursor).match(/^[_$A-Za-z][_$A-Za-z0-9]*/);
    if (idMatch) {
      whereFields.push(...resolveVariableObjectKeys(source, idMatch[0], cursor));
      cursor += idMatch[0].length;
    }
  }

  const closeParen = source.indexOf(")", cursor);
  cursor = closeParen >= 0 ? closeParen + 1 : cursor;

  const sortFields = [];
  const chainWindow = source.slice(cursor, cursor + 800);
  const orderRegex = /\.orderBy\(\s*['\"]([_$A-Za-z][_$A-Za-z0-9]*)['\"]/g;
  let orderMatch = orderRegex.exec(chainWindow);
  while (orderMatch) {
    sortFields.push(orderMatch[1]);
    orderMatch = orderRegex.exec(chainWindow);
  }

  return {
    fields: Array.from(new Set(whereFields.concat(sortFields))),
    whereFields: Array.from(new Set(whereFields)),
    sortFields: Array.from(new Set(sortFields)),
  };
}

function extractQueryPathsForPattern(source, collectionPattern) {
  const paths = [];
  let match = collectionPattern.exec(source);
  while (match) {
    const whereCallStart = match.index + match[0].length;
    const parsed = parseWhereCall(source, whereCallStart);
    if (parsed.fields.length > 0) {
      paths.push(parsed);
    }
    match = collectionPattern.exec(source);
  }
  return paths;
}

function collectionQueryPaths() {
  const userDataSource = fs.readFileSync(USER_DATA_FILE, "utf8");
  const storyDataSource = fs.readFileSync(STORY_DATA_FILE, "utf8");

  const userWordsPattern = /(userWords\s*\.where\s*\(|db\.collection\((['"])user_words\2\)\s*\.where\s*\()/g;
  const storyDraftPattern = /(db\.collection\(DRAFT_COLLECTION\)\s*\.where\s*\()/g;

  return {
    user_words: extractQueryPathsForPattern(userDataSource, userWordsPattern),
    story_episode_drafts: extractQueryPathsForPattern(storyDataSource, storyDraftPattern),
  };
}

function validateRequiredMapCompleteness(requiredMap) {
  const missing = [];

  for (const collection of Object.keys(MIN_REQUIRED_INDEX_MAP)) {
    const minGroups = MIN_REQUIRED_INDEX_MAP[collection] || [];
    const actualGroups = requiredMap[collection] || [];

    if (actualGroups.length === 0) {
      missing.push(`required-map-empty:${collection}`);
      continue;
    }

    const actualKeySet = new Set(actualGroups.map((group) => normalizeGroupKey(group)));
    for (const minGroup of minGroups) {
      const minKey = normalizeGroupKey(minGroup);
      if (!actualKeySet.has(minKey)) {
        missing.push(`${collection}:${minKey}`);
      }
    }
  }

  return missing;
}

function coversQuery(requiredGroups, queryFields) {
  if (!Array.isArray(requiredGroups) || requiredGroups.length === 0) return false;
  if (!Array.isArray(queryFields) || queryFields.length === 0) return true;

  return requiredGroups.some((group) => queryFields.every((field) => group.includes(field)));
}

function validateQueryCoverage(requiredMap, pathsByCollection) {
  const missing = [];

  for (const collection of Object.keys(pathsByCollection)) {
    const requiredGroups = requiredMap[collection] || [];
    const paths = pathsByCollection[collection] || [];

    for (const queryPath of paths) {
      if (!coversQuery(requiredGroups, queryPath.fields)) {
        missing.push(
          `coverage-miss:${collection}:${queryPath.fields.sort().join("+")}`
        );
      }
    }
  }

  return missing;
}

function summarizePaths(pathsByCollection) {
  const summary = {};
  for (const collection of Object.keys(pathsByCollection)) {
    summary[collection] = (pathsByCollection[collection] || []).map((pathItem) => ({
      whereFields: pathItem.whereFields,
      sortFields: pathItem.sortFields,
      fields: pathItem.fields,
    }));
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const requiredRaw = cloneIndexMap(MIN_REQUIRED_INDEX_MAP);
  const fixtureResult = applyFixture(requiredRaw, args.fixture);
  const requiredMap = normalizeIndexMap(fixtureResult.map);
  const pathsByCollection = collectionQueryPaths();

  const missing = [];
  if (args.strict) {
    missing.push(...validateRequiredMapCompleteness(requiredMap));
    missing.push(...validateQueryCoverage(requiredMap, pathsByCollection));
  }

  const checkedCollections = Array.from(
    new Set(
      Object.keys(requiredMap).concat(Object.keys(pathsByCollection))
    )
  ).sort();

  const output = {
    script: "db-index-check",
    strict: args.strict,
    fixture: args.fixture,
    fixtureNotes: fixtureResult.fixtureNotes,
    ok: missing.length === 0,
    missing,
    checkedCollections,
    requiredIndexMap: requiredMap,
    queryPaths: summarizePaths(pathsByCollection),
    remote: args.remote ? "skipped" : "skipped",
  };

  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[smoke:db-index]", error && error.message ? error.message : String(error));
  process.exit(1);
});
