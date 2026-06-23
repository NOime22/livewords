// 纯工具函数，无云服务依赖，供 index.js require 使用
'use strict';

const crypto = require('crypto');

function sha1(value) {
    return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex');
}

function extractErrorCode(err) {
    return err && (err.errCode || err.code || err.error);
}

function extractErrorMessage(err) {
    return err && (err.message || err.msg || String(err));
}

function isDocNotFoundError(err) {
    const code = extractErrorCode(err);
    const message = extractErrorMessage(err);
    return code === 'DATABASE_DOCUMENT_NOT_EXIST' || /document\s*(not\s*exist|does\s*not\s*exist)/i.test(message);
}

function isDocAlreadyExistsError(err) {
    const code = extractErrorCode(err);
    const message = extractErrorMessage(err);
    return code === 'DATABASE_DOCUMENT_ALREADY_EXIST' || /document\s*(already\s*exist|has\s*exist)/i.test(message);
}

function toTimestamp(input) {
    if (!input) return 0;
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number') return input;
    if (typeof input === 'string') {
        const parsed = Date.parse(input);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof input === 'object' && input.$date) {
        const parsed = Date.parse(input.$date);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function normalizeReviveCount(value) {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return Math.floor(raw);
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countEnglishWords(text) {
    const s = String(text || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/[^A-Za-z\s'-]/g, ' ');
    const parts = s.trim().split(/\s+/).filter(Boolean);
    return parts.length;
}

function countChineseChars(text) {
    const s = String(text || '');
    return (s.match(/[\u4e00-\u9fff]/g) || []).length;
}

module.exports = {
    sha1,
    extractErrorCode,
    extractErrorMessage,
    isDocNotFoundError,
    isDocAlreadyExistsError,
    toTimestamp,
    normalizeReviveCount,
    escapeRegExp,
    countEnglishWords,
    countChineseChars
};
