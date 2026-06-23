const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const users = db.collection("users");
const userWords = db.collection("user_words");
const userOps = db.collection("user_ops");
const genLogs = db.collection("gen_logs");
const STREAK_TZ_OFFSET_MINUTES = 8 * 60; // 默认按北京时间计算连胜
const IDEMPOTENCY_IN_PROGRESS_TTL_MS = 30000;
const ADMIN_AUTH_WINDOW_MS = 5 * 60 * 1000;
const ENABLE_DEV_OPENID = String(process.env.ENABLE_DEV_OPENID || '0').trim() === '1';
const DAILY_NEW_COUNT_MIN = 5;
const DAILY_NEW_COUNT_MAX = 50;
const DEFAULT_STORY_MODEL = "hy3-preview";
// [2026-05-13 模型迁移] 默认模型切到 CloudBase 内置 hy3-preview。
// 白名单里保留所有老名字，使历史 settings 里的 aiModel 在归一化/校验阶段仍能通过，
// 实际调用路径由 storyData 云函数的 STORY_MODEL_CATALOG 统一映射到 hy3-preview。
const STORY_MODEL_ALLOWLIST = Object.freeze({
  "hy3-preview": 1,
  "deepseek-v4-flash": 1,
  "hunyuan-turbos-latest": 1,
  "hunyuan-t1-latest": 1,
  "hunyuan-2.0-thinking-20251109": 1,
  "hunyuan-2.0-instruct-20251111": 1,
});
const STORY_MODEL_ALIASES = Object.freeze({
  deepseek: "hy3-preview",
  hunyuan: "hy3-preview",
});
const DEV_OPENID_ACTION_ALLOWLIST = Object.freeze(new Set([
  "initProfile",
  "getProfile",
  "upsertWordStatus",
  "getSeenWords",
  "getAvoidList",
  "getReviewSet",
  "logGeneration",
  "updateSettings",
  "resetUserData",
  "getDailyMasteredCount",
  "getMasteredCount",
  "getMasteredWordsList",
]));

function sha1Hex(input) {
  return crypto.createHash("sha1").update(String(input)).digest("hex");
}

function normalizeOpenid(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized === "undefined" || normalized === "null") return "";
  return normalized;
}

function makeUserWordId(openid, lang, word) {
  const w = String(word || "").trim().toLowerCase();
  const l = String(lang || "en").trim().toLowerCase();
  return `uw_${sha1Hex(`${openid}|${l}|${w}`)}`;
}

function makeUserOperationId(openid, operationId) {
  const op = String(operationId || "").trim();
  return `uop_${sha1Hex(`${openid}|${op}`)}`;
}

function extractErrorCode(err) {
  return err && (err.errCode || err.code || err.error);
}

function extractErrorMessage(err) {
  return err && (err.message || err.msg || String(err));
}

function buildAdminSignaturePayload({ action, devOpenid, timestamp, nonce }) {
  return `${String(action || "").trim()}\n${String(devOpenid || "").trim()}\n${String(timestamp || "")}\n${String(nonce || "")}`;
}

function secureEqualHex(left, right) {
  const leftBuf = Buffer.from(String(left || "").toLowerCase(), "utf8");
  const rightBuf = Buffer.from(String(right || "").toLowerCase(), "utf8");
  if (leftBuf.length !== rightBuf.length || leftBuf.length === 0) return false;
  try {
    return crypto.timingSafeEqual(leftBuf, rightBuf);
  } catch (e) {
    return false;
  }
}

function verifyAdminAuth({ action, devOpenid, adminAuth }) {
  if (!ENABLE_DEV_OPENID) {
    return { ok: false, code: "ADMIN_AUTH_REQUIRED", error: "admin path disabled: ENABLE_DEV_OPENID=0" };
  }

  const secret = String(process.env.STORYDATA_ADMIN_HMAC_SECRET || "").trim();
  if (!secret) {
    return { ok: false, code: "ADMIN_AUTH_INVALID", error: "admin auth secret missing" };
  }

  const auth = (adminAuth && typeof adminAuth === "object") ? adminAuth : null;
  if (!auth) {
    return { ok: false, code: "ADMIN_AUTH_REQUIRED", error: "adminAuth required" };
  }

  const timestamp = Number(auth.timestamp);
  const nonce = String(auth.nonce || "").trim();
  const signature = String(auth.signature || "").trim().toLowerCase();

  if (!Number.isFinite(timestamp) || timestamp <= 0 || !nonce || !/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, code: "ADMIN_AUTH_INVALID", error: "invalid adminAuth payload" };
  }

  if (Math.abs(Date.now() - timestamp) > ADMIN_AUTH_WINDOW_MS) {
    return { ok: false, code: "ADMIN_AUTH_INVALID", error: "admin auth timestamp expired" };
  }

  const payload = buildAdminSignaturePayload({
    action,
    devOpenid,
    timestamp,
    nonce,
  });
  const expected = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  if (!secureEqualHex(signature, expected)) {
    return { ok: false, code: "ADMIN_AUTH_INVALID", error: "admin auth signature mismatch" };
  }

  return { ok: true };
}

function isDocNotFoundError(err) {
  const code = extractErrorCode(err);
  const message = extractErrorMessage(err);
  return code === "DATABASE_DOCUMENT_NOT_EXIST" || /document\s*(not\s*exist|does\s*not\s*exist)/i.test(message);
}

function isDocAlreadyExistsError(err) {
  const code = extractErrorCode(err);
  const message = extractErrorMessage(err);
  return code === "DATABASE_DOCUMENT_ALREADY_EXIST" || /document\s*(already\s*exist|has\s*exist)/i.test(message);
}

function isCollectionNotFoundError(err) {
  const code = extractErrorCode(err);
  const message = extractErrorMessage(err);
  return code === "DATABASE_COLLECTION_NOT_EXIST"
    || /collection\s*(not\s*exist|does\s*not\s*exist)/i.test(message)
    || /user_ops/i.test(message) && /not\s*exist/i.test(message);
}

function logResult(context, result) {
  const { openid, action, traceId, sessionId, operationId } = context;
  const resultCode = result.ok ? "SUCCESS" : (result.code || "ERROR");
  console.log(`[Observability] ${action} ${resultCode}`, {
    traceId,
    action,
    openid,
    sessionId,
    operationId,
    resultCode,
    ok: result.ok,
    msg: result.msg || result.error || ""
  });
}


function toTimestamp(input) {
  if (!input) return 0;
  if (input instanceof Date) return input.getTime();
  if (typeof input === "number") return input;
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof input === "object" && input.$date) {
    const parsed = Date.parse(input.$date);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeOperationResponse(record) {
  const response = record && record.response && typeof record.response === "object" ? record.response : { ok: true };
  return {
    ...response,
    ok: response.ok !== false,
    deduped: true,
  };
}

function normalizeOperationState(record) {
  if (!record || !record.status) return "unknown";
  return String(record.status).toLowerCase();
}

async function getUserOperationRecord(operationDocId) {
  try {
    const res = await userOps.doc(operationDocId).get();
    return res && res.data ? res.data : null;
  } catch (err) {
    if (isDocNotFoundError(err) || isCollectionNotFoundError(err)) return null;
    throw err;
  }
}

async function startUserOperation(openid, operationId) {
  const operationDocId = makeUserOperationId(openid, operationId);
  const operation = {
    userId: openid,
    operationId: String(operationId || "").trim(),
    status: "started",
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };

  try {
    await userOps.doc(operationDocId).set({ data: operation });
    return { mode: "execute", operationDocId };
  } catch (err) {
    if (isCollectionNotFoundError(err)) {
      console.warn("[Idempotency] user_ops collection missing, skipping operation log", {
        operationDocId,
        error: extractErrorMessage(err),
      });
      return { mode: "execute", operationDocId: "" };
    }
    if (!isDocAlreadyExistsError(err)) {
      throw err;
    }
  }

  const existing = await getUserOperationRecord(operationDocId);
  const status = normalizeOperationState(existing);

  if (status === "completed") {
    return { mode: "deduped", response: normalizeOperationResponse(existing), operationDocId };
  }

  if (status === "started") {
    const startedAt = Math.max(
      toTimestamp(existing && existing.updatedAt),
      toTimestamp(existing && existing.createdAt),
    );
    const isFresh = startedAt > 0 && Date.now() - startedAt <= IDEMPOTENCY_IN_PROGRESS_TTL_MS;
    if (isFresh) {
      return {
        mode: "in_progress",
        response: { ok: false, code: "IDEMPOTENCY_IN_PROGRESS", error: "operation in progress", deduped: true, retryable: true },
        operationDocId,
      };
    }
  }

  await userOps.doc(operationDocId).update({
    data: {
      status: "started",
      updatedAt: db.serverDate(),
      lastError: _.remove(),
      response: _.remove(),
    }
  });
  return { mode: "execute", operationDocId };
}

async function finishUserOperation(operationDocId, response) {
  if (!operationDocId) return;
  await userOps.doc(operationDocId).update({
    data: {
      status: "completed",
      response: response || { ok: true },
      completedAt: db.serverDate(),
      updatedAt: db.serverDate(),
      lastError: _.remove(),
    }
  });
}

async function failUserOperation(operationDocId, err) {
  if (!operationDocId) return;
  const message = extractErrorMessage(err);
  try {
    await userOps.doc(operationDocId).update({
      data: {
        status: "failed",
        lastError: message,
        updatedAt: db.serverDate(),
      }
    });
  } catch (updateErr) {
    console.warn("[Idempotency] failed to write operation failure", {
      operationDocId,
      error: extractErrorMessage(updateErr),
      originalError: message,
    });
  }
}

function getDateKey(date, offsetMinutes = STREAK_TZ_OFFSET_MINUTES) {
  const target = new Date(date.getTime() + offsetMinutes * 60000);
  const year = target.getUTCFullYear();
  const month = `${target.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${target.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayStartUtc(offsetHours = 8) {
  const now = new Date();
  const zoneOffset = offsetHours * 60 * 60 * 1000;
  const utcNow = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const zonedNow = new Date(utcNow + zoneOffset);
  const todayStart = new Date(zonedNow);
  todayStart.setHours(0, 0, 0, 0);
  return new Date(todayStart.getTime() - zoneOffset);
}

function isWordEligibleForReviewToday(item, todayStartUtc) {
  const todayStartTs = todayStartUtc instanceof Date ? todayStartUtc.getTime() : 0;
  if (!todayStartTs || !item) return true;
  const createdAtTs = toTimestamp(item.createdAt);
  const lastSeenAtTs = toTimestamp(item.lastSeenAt);
  const lastLearnedAtTs = toTimestamp(item.lastLearnedAt);
  const lastReviewedAtTs = toTimestamp(item.lastReviewedAt);
  if (createdAtTs && createdAtTs >= todayStartTs) return false;
  if (lastSeenAtTs && lastSeenAtTs >= todayStartTs) return false;
  if (lastLearnedAtTs && lastLearnedAtTs >= todayStartTs) return false;
  if (lastReviewedAtTs && lastReviewedAtTs >= todayStartTs) return false;
  return true;
}

function getLeadingAlphabetLetter(word) {
  const value = String(word || "").trim().toLowerCase();
  const match = value.match(/[a-z]/);
  return match ? match[0] : "";
}

function buildOrderedLetterSequence(anchorLetter) {
  const normalizedAnchor = String(anchorLetter || "").trim().toLowerCase();
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const startIdx = letters.indexOf(normalizedAnchor);
  if (startIdx < 0) return letters.split("");

  const orderedLetters = [];
  for (let i = 0; i < 26; i += 1) {
    orderedLetters.push(letters[(startIdx + i) % 26]);
  }
  return orderedLetters;
}

function applyLetterWindowOrderForSettings(rows, payload, getWord) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const orderMode = payload && payload.orderMode;
  const requestedLetter = String(payload && payload.orderAlphaLetter || "a").trim().toLowerCase();

  if ((orderMode !== "alphabet" && orderMode !== "similar") || !requestedLetter || requestedLetter < "a" || requestedLetter > "z") {
    return list;
  }

  const orderedLetters = buildOrderedLetterSequence(requestedLetter);
  const buckets = new Map();
  const fallback = [];
  for (const item of list) {
    const rawWord = typeof getWord === "function" ? getWord(item) : item;
    const lead = getLeadingAlphabetLetter(rawWord);
    if (!lead) {
      fallback.push(item);
      continue;
    }
    if (!buckets.has(lead)) buckets.set(lead, []);
    buckets.get(lead).push(item);
  }

  const ordered = [];
  for (const letter of orderedLetters) {
    const group = buckets.get(letter);
    if (group && group.length) {
      ordered.push(...group);
      buckets.delete(letter);
    }
  }

  for (const group of buckets.values()) {
    ordered.push(...group);
  }

  ordered.push(...fallback);
  return ordered;
}

async function updateUserCounters(openid, deltas) {
  deltas = deltas || {};
  const known = deltas.known || 0;
  const unknown = deltas.unknown || 0;
  const totalLearned = deltas.totalLearned || 0;

  if (!known && !unknown && !totalLearned) return;

  const updateData = { updatedAt: db.serverDate() };
  if (known) updateData["counters.known"] = _.inc(known);
  if (unknown) updateData["counters.unknown"] = _.inc(unknown);
  if (totalLearned) updateData["counters.totalLearned"] = _.inc(totalLearned);

  try {
    await users.doc(openid).update({ data: updateData });
  } catch (e) {
    console.warn("[Counters] update failed", { openid, deltas, error: e && e.message ? e.message : String(e) });
  }
}

async function getUserDoc(openid) {
  try {
    const res = await users.doc(openid).get();
    const doc = Array.isArray(res.data) ? res.data[0] : res.data;
    return doc || null;
  } catch (e) {
    return null;
  }
}

async function initProfile(openid, payload) {
  payload = payload || {};
  const existing = await getUserDoc(openid);

  if (existing) {
    const updateData = {
      updatedAt: db.serverDate()
    };
    const nickName = String(payload.nickName || "").trim();
    const avatarUrl = String(payload.avatarUrl || "").trim();
    if (nickName && nickName !== existing.nickName) {
      updateData.nickName = nickName;
    }
    if (avatarUrl && avatarUrl !== existing.avatarUrl) {
      updateData.avatarUrl = avatarUrl;
    }
    await users.doc(openid).update({ data: updateData });
    return { ok: true, existed: true };
  }

  const base = {
    nickName: payload.nickName || "",
    avatarUrl: payload.avatarUrl || "",
    settings: {
      reviewModeDefault: false,
      dailyNewCount: 5,
      orderMode: 'alphabet',
      orderAlphaLetter: 'a',
      cefrLevel: "A1",
      defaultDeckId: "book_a2",  // 默认A2词库
      aiModel: DEFAULT_STORY_MODEL,
    },
    counters: {
      known: 0,
      unknown: 0,
      totalLearned: 0,
      streak: 0,
      longestStreak: 0,
    },
    lastStudyDate: "",
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
  };

  // Use deterministic doc id = openid for all subsequent doc(openid) reads/updates.
  await users.doc(openid).set({ data: base });
  return { ok: true, existed: false };
}

async function getProfile(openid) {
  let doc = await getUserDoc(openid);
  if (!doc) {
    await initProfile(openid);
    doc = await getUserDoc(openid);
  }
  return { ok: true, user: doc || null };
}

async function ensureAuthSession(wxContext) {
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : "";
  if (!openid) {
    return { ok: false, error: "missing openid" };
  }

  let doc = await getUserDoc(openid);
  if (!doc) {
    await initProfile(openid, {});
    doc = await getUserDoc(openid);
  }

  const hasNick = !!(doc && String(doc.nickName || "").trim());
  const hasAvatar = !!(doc && String(doc.avatarUrl || "").trim());

  return {
    ok: true,
    auth: {
      openid,
      appid: (wxContext && wxContext.APPID) || "",
      unionid: (wxContext && wxContext.UNIONID) || "",
    },
    profileCompleted: hasNick && hasAvatar,
    user: doc || null,
  };
}

async function updateStreak(openid) {
  const doc = await getUserDoc(openid);
  if (!doc) return;
  const counters = doc.counters || {};
  const todayKey = getDateKey(new Date());
  const lastKey = doc.lastStudyDate || null;
  if (lastKey === todayKey) {
    return;
  }
  const yesterdayKey = getDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  let current = typeof counters.streak === 'number' ? counters.streak : 0;
  let longest = typeof counters.longestStreak === 'number' ? counters.longestStreak : 0;
  if (lastKey === yesterdayKey) {
    current += 1;
  } else {
    current = 1;
  }
  if (current > longest) {
    longest = current;
  }
  try {
    await users.doc(openid).update({
      data: {
        'counters.streak': current,
        'counters.longestStreak': longest,
        lastStudyDate: todayKey,
        updatedAt: db.serverDate(),
      }
    });
  } catch (e) {
    console.error('[Streak] update error', e);
  }
}

async function upsertWordStatus(openid, payload) {
  payload = payload || {};
  const word = (payload.word || "").trim();
  const operationId = String(payload.operationId || "").trim();
  let operationDocId = "";

  // Input validation for 'word' field
  if (!word) {
    return { ok: false, error: "word required" };
  }
  if (word.length < 2) {
    return { ok: false, error: "word too short" };
  }
  if (word.length > 50) {
    return { ok: false, error: "word too long" };
  }
  // Reject words with special characters (allow hyphens and apostrophes)
  if (/[·.&_\d]/.test(word)) {
    return { ok: false, error: "word contains invalid characters" };
  }

  const allowStatuses = new Set(["known", "unknown", "learning", "banned", "mastered"]);
  const status = allowStatuses.has(payload.status) ? payload.status : "unknown";
  const meta = payload.meta || {};
  const exposuresDelta = typeof payload.exposuresDelta === "number" ? payload.exposuresDelta : 1;
  const familiarityDelta = typeof payload.familiarityDelta === "number" ? payload.familiarityDelta : 0;
  const reviewMode = payload.reviewMode === true; // 是否为复习模式
  let nextReviewAt = payload.nextReviewAt ? new Date(payload.nextReviewAt) : null;

  const metaLang = meta.lang || "en";
  const deterministicId = makeUserWordId(openid, metaLang, word);
  let prev = null;
  let targetId = null;

  // Prefer deterministic doc id to avoid duplicates under concurrency.
  try {
    const byId = await userWords.doc(deterministicId).get();
    if (byId && byId.data) {
      prev = byId.data;
      targetId = deterministicId;
    }
  } catch (err) {
    const code = err && (err.errCode || err.code || err.error);
    const message = err && (err.message || err.msg || String(err));
    const isNotFound = code === 'DATABASE_DOCUMENT_NOT_EXIST' || /document\s*(not\s*exist|does\s*not\s*exist)/i.test(message);
    if (!isNotFound) {
      console.warn('[userData] deterministic user_words lookup failed:', err);
    }
  }

  // Backward-compat: fall back to legacy lookup by (userId, word) for old data.
  if (!targetId) {
    const legacy = await userWords.where({ userId: openid, word: word }).limit(1).get();
    const hasLegacy = Array.isArray(legacy.data) && legacy.data.length > 0;
    if (hasLegacy) {
      prev = legacy.data[0];
      targetId = legacy.data[0]._id;
    }
  }

  const updateMetaField = function (value) {
    if (value === null || value === undefined || value === "") {
      return _.remove();
    }
    return value;
  };

  const clampFam = (val) => Math.max(0, Math.min(5, Number(val) || 0));
  let computedFinalStatus = status;

  if (operationId) {
    const opState = await startUserOperation(openid, operationId);
    operationDocId = opState.operationDocId || "";
    if (opState.mode === "deduped" || opState.mode === "in_progress") {
      return opState.response;
    }
  }

  try {
    if (targetId) {
    // compute next review due if marking as known and not provided by client
    const prevFam = prev && typeof prev.familiarity === 'number' ? prev.familiarity : 0;
    let newFam = clampFam(prevFam + familiarityDelta);

    // 【熟知系统】累计右滑 5 次 → 进入 mastered 状态
    let finalStatus = status;
    if (status !== "known" && newFam >= 5) {
      // 非“认识”状态不允许停留在 5（否则会被错误剔除），最多回落到 4
      newFam = 4;
    }
    if (status === "known" && newFam >= 5) {
      finalStatus = "mastered";
      console.log('[Mastery] Word graduated:', word, 'familiarity:', newFam);
    }
    computedFinalStatus = finalStatus;

    if (finalStatus === "known" && !nextReviewAt) {
      const intervals = [1, 3, 7, 14, 30, 60];
      const idx = Math.max(0, Math.min(intervals.length - 1, newFam > 0 ? newFam - 1 : 0));
      nextReviewAt = new Date(Date.now() + intervals[idx] * 24 * 60 * 60 * 1000);
    }
    const updateData = {
      status: finalStatus,
      lastSeenAt: db.serverDate(),
      updatedAt: db.serverDate(),
    };

    if (meta.lang) updateData.lang = meta.lang;
    updateData.pos = updateMetaField(meta.pos);
    updateData.phonetic = updateMetaField(meta.phonetic);
    updateData.translation = updateMetaField(meta.translation);
    updateData.definition = updateMetaField(meta.definition);
    updateData.topic = updateMetaField(meta.topic);
    if (exposuresDelta) updateData.exposures = _.inc(exposuresDelta);
    if (typeof familiarityDelta === "number" && familiarityDelta !== 0) updateData.familiarity = newFam;
    if (typeof payload.correctRate === "number") updateData.correctRate = payload.correctRate;

    // 记录模式特定的时间戳（用于统计今日学习/复习数）
    if (familiarityDelta > 0 && status === "known") {
      if (reviewMode) {
        updateData.lastReviewedAt = db.serverDate();
      } else {
        updateData.lastLearnedAt = db.serverDate();
      }
    }

    if (finalStatus === "known") {
      if (nextReviewAt) updateData.nextReviewAt = nextReviewAt;
    } else {
      // mastered or not known → clear any review schedule
      updateData.nextReviewAt = _.remove();
    }


      await userWords.doc(targetId).update({ data: updateData });
    } else {
      // 创建新单词记录
      let initialFam = clampFam(familiarityDelta);
      let initialStatus = status;
      if (initialStatus !== "known" && initialFam >= 5) {
        initialFam = 4;
      }
      if (initialStatus === "known" && initialFam >= 5) {
        initialStatus = "mastered";
      }
      computedFinalStatus = initialStatus;
      const newWordData = {
        userId: openid,
        word: word,
        lang: metaLang,
        pos: meta.pos || "",
        phonetic: meta.phonetic || "",
        translation: meta.translation || "",
        definition: meta.definition || "",
        topic: meta.topic || "",
        status: initialStatus,
        familiarity: initialFam,
        exposures: exposuresDelta > 0 ? exposuresDelta : 0,
        correctRate: typeof payload.correctRate === "number" ? payload.correctRate : 0,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
        firstSeenAt: db.serverDate(),
        lastSeenAt: db.serverDate(),
        nextReviewAt: (initialStatus === "known") ? (nextReviewAt || new Date(Date.now() + 24 * 60 * 60 * 1000)) : null,
      };

      // 记录模式特定的时间戳
      if (familiarityDelta > 0 && status === "known") {
        if (reviewMode) {
          newWordData.lastReviewedAt = db.serverDate();
        } else {
          newWordData.lastLearnedAt = db.serverDate();
        }
      }

      await userWords.doc(deterministicId).set({ data: newWordData });
    }

    const deltas = {};
    const prevStatus = prev ? prev.status : "";

    // counters.known：用作“完全掌握(mastered)词数”
    if (computedFinalStatus === "mastered" && prevStatus !== "mastered") {
      deltas.known = 1;
    }
    if (prev && prevStatus === "mastered" && computedFinalStatus !== "mastered") {
      deltas.known = (deltas.known || 0) - 1;
    }

    // totalLearned：首次进入“认识/掌握”时累计（不回退）
    if ((computedFinalStatus === "known" || computedFinalStatus === "mastered") &&
      (!prev || (prevStatus !== "known" && prevStatus !== "mastered"))) {
      deltas.totalLearned = 1;
    }

    if (computedFinalStatus === "unknown" && (!prev || prevStatus !== "unknown")) {
      deltas.unknown = 1;
    }
    if (prev && prevStatus === "unknown" && computedFinalStatus !== "unknown") {
      deltas.unknown = (deltas.unknown || 0) - 1;
    }

    await updateUserCounters(openid, deltas);
    const response = { ok: true, deduped: false };
    await finishUserOperation(operationDocId, response);
    return response;
  } catch (err) {
    await failUserOperation(operationDocId, err);
    throw err;
  }
}

async function getSeenWords(openid, payload) {
  payload = payload || {};
  const limit = Math.max(1, Math.min(1000, Number(payload.limit) || 500));
  const res = await userWords
    .where({ userId: openid })
    .orderBy("lastSeenAt", "desc")
    .field({ word: true })
    .limit(limit)
    .get();

  const words = (res.data || []).map(function (x) { return x.word; }).filter(Boolean);
  const set = Array.from(new Set(words));

  return { ok: true, words: set.slice(0, limit) };
}

async function getAvoidList(openid, payload) {
  return getSeenWords(openid, payload);
}

async function getReviewSet(openid, payload) {
  payload = payload || {};
  const limit = Math.max(1, Math.min(200, Number(payload.limit) || 20));
  const todayStartUtc = getTodayStartUtc(8);

  // 基础条件：未达到 mastered 的复习池（全局，不按词库拆分）
  const whereCondition = {
    userId: openid,
    status: _.in(["known", "unknown"]),
    familiarity: _.lt(5)  // 排除已达到 5 次的
  };

  const baseRes = await userWords
    .where(whereCondition)
    .orderBy("familiarity", "asc")  // 优先复习熟悉度低的
    .orderBy("lastSeenAt", "asc")   // 其次复习很久没见的
    .field({
      word: true,
      pos: true,
      definition: true,
      topic: true,
      familiarity: true,
      phonetic: true,
      translation: true,
      createdAt: true,
      lastSeenAt: true,
      lastLearnedAt: true,
      lastReviewedAt: true
    })
    .limit(200)
    .get();

  const eligibleRows = (baseRes.data || []).filter((item) => isWordEligibleForReviewToday(item, todayStartUtc));
  const orderedEligibleRows = applyLetterWindowOrderForSettings(eligibleRows, payload, item => item && item.word);

  const words = orderedEligibleRows.slice(0, limit).map(function (x) {
    return {
      word: x.word,
      phonetic: x.phonetic || "",
      translation: x.translation || "",
      pos: x.pos || "",
      definition: x.definition || "",
      topic: x.topic || "",
      familiarity: x.familiarity || 0,
    };
  }).filter(function (x) { return !!x.word; });

  // 补全缺失的音标（针对旧数据）
  const missingPhoneticWords = words.filter(w => !w.phonetic).map(w => w.word);
  if (missingPhoneticWords.length > 0) {
    try {
      const dictRes = await db.collection('dictionary')
        .where({ word: _.in(missingPhoneticWords) })
        .field({ word: true, phonetic: true })
        .limit(100)
        .get();

      const dictMap = {};
      (dictRes.data || []).forEach(d => {
        if (d.word && d.phonetic) dictMap[d.word] = d.phonetic;
      });

      words.forEach(w => {
        if (!w.phonetic && dictMap[w.word]) {
          w.phonetic = dictMap[w.word];
        }
      });
    } catch (err) {
      console.error('[getReviewSet] Backfill phonetic error:', err);
    }
  }

  // 获取总量用于动态调整复习比例 (例如：总量 < 30 时不安排复习)
  const totalCount = eligibleRows.length;

  return { ok: true, words: words, totalCount: totalCount };
}


async function logGeneration(openid, payload) {
  payload = payload || {};

  const data = {
    userId: openid,
    mode: payload.mode || "new",
    requestedAt: db.serverDate(),
    model: payload.model || "",
    deckId: payload.deckId || "",
    targetCount: payload.targetCount || 0,
    topic: payload.topic || "",
    totalWords: payload.totalWords || 0,
    generatedWords: Array.isArray(payload.generatedWords) ? payload.generatedWords : [],
    filteredOut: Array.isArray(payload.filteredOut) ? payload.filteredOut : [],
    avoidWordsSize: payload.avoidWordsSize || 0,
    reviewWordsSize: payload.reviewWordsSize || 0,
    promptChars: payload.promptChars || 0,
    durationMs: payload.durationMs || 0,
    eof: !!payload.eof,
  };

  await genLogs.add({ data: data });
  // Streak is now updated in getDailyMasteredCount when goal is met
  return { ok: true };
}

async function updateSettings(openid, payload) {
  payload = payload || {};
  const settings = payload.settings || {};
  const updateData = { updatedAt: db.serverDate() };

  if (typeof settings.nickName === 'string') {
    const name = settings.nickName.trim();
    if (name) {
      updateData.nickName = name;
    }
  }
  if (typeof settings.avatarUrl === 'string') {
    const url = settings.avatarUrl.trim();
    if (url) {
      updateData.avatarUrl = url;
    }
  }

  if (typeof settings.reviewModeDefault === 'boolean') {
    updateData['settings.reviewModeDefault'] = settings.reviewModeDefault;
  }
  if (typeof settings.dailyNewCount === 'number') {
    const n = Math.round(settings.dailyNewCount);
    if (Number.isFinite(n)) {
      // 🆕 特殊处理：测试模式下的 1 不进行截断
      if (n === 1) {
        updateData['settings.dailyNewCount'] = 1;
      } else {
        updateData['settings.dailyNewCount'] = Math.max(DAILY_NEW_COUNT_MIN, Math.min(DAILY_NEW_COUNT_MAX, n));
      }
    }
  }
  if (typeof settings.testMode === 'boolean') {
    updateData['settings.testMode'] = settings.testMode;
  }
  if (typeof settings.orderMode === 'string') {
    const allow = { alphabet: 1, similar: 1, shuffle: 1 };
    if (allow[settings.orderMode]) {
      updateData['settings.orderMode'] = settings.orderMode;
    }
  }
  if (typeof settings.orderAlphaLetter === 'string' && settings.orderAlphaLetter.length === 1) {
    const ch = settings.orderAlphaLetter.toLowerCase();
    if (ch >= 'a' && ch <= 'z') {
      updateData['settings.orderAlphaLetter'] = ch;
    }
  }
  if (typeof settings.defaultDeckId === 'string' && settings.defaultDeckId) {
    updateData['settings.defaultDeckId'] = settings.defaultDeckId;
  }
  if (typeof settings.cefrLevel === 'string') {
    const allow = { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1, C2: 1 };
    const lvl = settings.cefrLevel.toUpperCase();
    if (allow[lvl]) {
      updateData['settings.cefrLevel'] = lvl;
    }
  }
  if (typeof settings.aiModel === 'string') {
    const requestedRaw = settings.aiModel.trim();
    const requested = STORY_MODEL_ALIASES[requestedRaw] || requestedRaw;
    if (requested && STORY_MODEL_ALLOWLIST[requested]) {
      updateData['settings.aiModel'] = requested;
    }
  }

  try {
    await users.doc(openid).update({ data: updateData });
    return { ok: true };
  } catch (e) {
    console.warn("[Settings] update failed", { openid, settings, error: e && e.message ? e.message : String(e) });
    return { ok: false, error: e && e.message ? e.message : 'update failed' };
  }
}

async function resetUserData(openid) {
  try {
    // 仅删除非完全掌握的单词记录（保留 status = 'mastered'）
    await userWords.where({
      userId: openid,
      status: _.neq('mastered')  // 删除 status != 'mastered' 的单词
    }).remove();

    // 删除生成日志
    await genLogs.where({ userId: openid }).remove();

    // 获取保留的完全掌握单词数（用于更新 counters.known）
    const masteredRes = await userWords.where({
      userId: openid,
      status: 'mastered'
    }).count();
    const masteredCount = masteredRes.total || 0;

    // 重置用户统计数据，保留设置和完全掌握的单词计数
    await users.doc(openid).update({
      data: {
        'counters.known': masteredCount,  // 保留完全掌握数
        'counters.unknown': 0,
        'counters.totalLearned': masteredCount,  // 总学习数等于保留的完全掌握数
        'counters.streak': 0,
        'counters.longestStreak': 0,
        lastStudyDate: '',
        updatedAt: db.serverDate()
      }
    });

    return { ok: true, preserved: masteredCount };
  } catch (e) {
    console.error('[Reset] error:', e);
    return { ok: false, error: e && e.message ? e.message : 'reset failed' };
  }
}

// 实时查询今日掌握的不同单词数（优化版：使用聚合管道）
async function getDailyMasteredCount(openid) {
  try {
    const todayStartUtc = getTodayStartUtc(8);

    // 【兼容性修复】不使用 aggregate，改用 Promise.all 并行查询
    // 本地调试环境可能不支持 aggregate.facet
    const getUserStats = async () => {
      const p1 = db.collection('user_words').where({
        userId: openid,
        lastLearnedAt: _.gte(todayStartUtc)
      }).count();

      const p2 = db.collection('user_words').where({
        userId: openid,
        lastReviewedAt: _.gte(todayStartUtc)
      }).count();

      const p3 = db.collection('user_words').where({
        userId: openid,
        status: _.in(['known', 'mastered']),
        lastSeenAt: _.gte(todayStartUtc)
      }).count();

      const p4 = db.collection('user_words').where({
        userId: openid,
        status: 'mastered'
      }).count();

      const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);
      return {
        newWords: r1.total,
        reviewWords: r2.total,
        todayMastered: r3.total,
        totalMastered: r4.total
      };
    };

    const stats = await getUserStats();

    const newWords = stats.newWords;
    const reviewWords = stats.reviewWords;
    const total = stats.todayMastered;
    const masteredCount = stats.totalMastered;

    // 获取用户设置的目标（用于判断是否更新连胜）
    const userDoc = await getUserDoc(openid);
    const dailyGoal = userDoc && userDoc.settings && userDoc.settings.dailyNewCount ? userDoc.settings.dailyNewCount : 10;

    // 检查是否达成目标，如果达成则尝试更新连胜
    if (total >= dailyGoal) {
      await updateStreak(openid);
    }

    // 重新获取最新的 streak（updateStreak可能已更新）
    const latestDoc = await getUserDoc(openid);
    const streak = latestDoc && latestDoc.counters && typeof latestDoc.counters.streak === 'number' ? latestDoc.counters.streak : 0;

    return {
      ok: true,
      newWords: newWords,
      reviewWords: reviewWords,
      total: total,
      masteredCount: masteredCount, // 【新增】同时返回完全掌握数
      streak: streak
    };
  } catch (e) {
    console.error('[getDailyMasteredCount] error:', e);
    return { ok: false, error: e && e.message ? e.message : 'query failed', newWords: 0, reviewWords: 0, total: 0, masteredCount: 0, streak: 0 };
  }
}

async function getMasteredCount(openid) {
  try {
    const res = await userWords
      .where({
        userId: openid,
        status: _.in(['mastered'])  // 仅统计 status = mastered 的单词（familiarity >= 5自动变mastered）
      })
      .count();

    return { ok: true, count: res.total || 0 };
  } catch (e) {
    console.error('[getMasteredCount] error:', e);
    return { ok: false, error: e && e.message ? e.message : 'query failed', count: 0 };
  }
}

async function getMasteredWordsList(openid) {
  try {
    const res = await userWords
      .where({
        userId: openid,
        status: _.in(['mastered'])
      })
      .orderBy('lastSeenAt', 'desc')
      .limit(500)
      .field({
        word: true,
        pos: true,
        phonetic: true,
        translation: true,
        definition: true,
        familiarity: true,
        lastSeenAt: true
      })
      .get();

    const words = (res.data || []).map((item) => ({
      word: item.word || '',
      pos: item.pos || '',
      phonetic: item.phonetic || '',
      translation: item.translation || '',
      definition: item.definition || '',
      familiarity: typeof item.familiarity === 'number' ? item.familiarity : 0,
      lastSeenAt: item.lastSeenAt || null
    }));

    return {
      ok: true,
      words,
      total: words.length
    };
  } catch (e) {
    console.error('[getMasteredWordsList] error:', e);
    return { ok: false, error: e && e.message ? e.message : 'query failed', words: [], total: 0 };
  }
}

exports.main = async function (event, context) {
  const wxContext = cloud.getWXContext();
  const rawOpenid = normalizeOpenid(wxContext.OPENID || "");
  const requestedDevOpenid = !rawOpenid ? normalizeOpenid(event && event.devOpenid) : "";
  const adminAuth = event && event.adminAuth ? event.adminAuth : null;
  const action = (event && event.action) || "";
  const traceId = (event && event.traceId) || "";
  const sessionId = (event && event.sessionId) || "";
  const operationId = (event && event.operationId) || "";
  let openid = rawOpenid;

  const ctx = { openid, action, traceId, sessionId, operationId };
  let result = null;

  try {
    if (!openid && requestedDevOpenid) {
      if (!DEV_OPENID_ACTION_ALLOWLIST.has(action)) {
        result = { ok: false, code: "FORBIDDEN_ACTION", error: "devOpenid is not allowed for this action" };
      } else {
        const adminCheck = verifyAdminAuth({
          action,
          devOpenid: requestedDevOpenid,
          adminAuth,
        });
        if (!adminCheck.ok) {
          result = { ok: false, code: adminCheck.code, error: adminCheck.error };
        } else {
          openid = requestedDevOpenid;
          ctx.openid = openid;
        }
      }
    }

    if (!result) {
      switch (action) {
        case "ensureAuthSession":
          result = await ensureAuthSession(openid ? { ...wxContext, OPENID: openid } : wxContext);
          break;
        case "initProfile":
          result = await initProfile(openid, event || {});
          break;
        case "getProfile":
          result = await getProfile(openid);
          break;
        case "upsertWordStatus":
          result = await upsertWordStatus(openid, event || {});
          break;
        case "getSeenWords":
          result = await getSeenWords(openid, event || {});
          break;
        case "getAvoidList":
          result = await getAvoidList(openid, event || {});
          break;
        case "getReviewSet":
          result = await getReviewSet(openid, event || {});
          break;
        case "logGeneration":
          result = await logGeneration(openid, event || {});
          break;
        case "updateSettings":
          result = await updateSettings(openid, event || {});
          break;
        case "resetUserData":
          result = await resetUserData(openid);
          break;
        case "getDailyMasteredCount":
          result = await getDailyMasteredCount(openid);
          break;
        case "getMasteredCount":
          result = await getMasteredCount(openid);
          break;
        case "getMasteredWordsList":
          result = await getMasteredWordsList(openid);
          break;
        default:
          result = { ok: false, error: "unknown action", code: "UNKNOWN_ACTION" };
      }
    }
  } catch (e) {
    console.error(`[userData] ${action} internal error:`, e);
    result = { ok: false, error: e && e.message ? e.message : "internal error", code: "INTERNAL_ERROR" };
  }

  // Standardize response envelope
  result = {
    ...result,
    traceId,
    action,
    resultCode: result.ok ? "SUCCESS" : (result.code || "ERROR")
  };

  logResult(ctx, result);
  return result;
};
