/**
 * hyphenator.js
 * A lightweight rule-based soft hyphen injector for English words.
 * Inserts \u00AD (Soft Hyphen) at safe break points using common prefixes and suffixes.
 */

const SOFT_HYPHEN = '\u00AD';

const PREFIXES = [
    'trans', 'inter', 'micro', 'hyper', 'super', 'anti', 'auto', 'circum', 'counter', 'extra',
    'infra', 'intra', 'macro', 'multi', 'ortho', 'over', 'post', 'pre', 'pro', 'pseudo',
    'retro', 'semi', 'sub', 'tele', 'ultra', 'under', 'uni', 'with', 'con', 'com', 'dis',
    'en', 'ex', 'im', 'in', 'non', 're', 'un'
];

const SUFFIXES = [
    'able', 'ible', 'ness', 'ment', 'tion', 'sion', 'ing', 'est', 'ism', 'ist',
    'ful', 'less', 'lly', 'ty', 'ry', 'al', 'ance', 'ence', 'ure', 'age'
];

/**
 * Inserts soft hyphens into a single word.
 * @param {string} word 
 */
function hyphenateWord(word) {
    if (word.length < 6) return word;

    let lower = word.toLowerCase();
    let chunks = [];
    let remaining = word;
    let remainingLower = lower;

    // 1. Check Prefixes
    for (const pre of PREFIXES) {
        if (remainingLower.startsWith(pre) && remainingLower.length > pre.length + 3) {
            chunks.push(remaining.slice(0, pre.length));
            chunks.push(SOFT_HYPHEN);
            remaining = remaining.slice(pre.length);
            remainingLower = remainingLower.slice(pre.length);
            break;
        }
    }

    // 2. Check Suffixes (working backwards from the end)
    let suffixPart = "";
    for (const suf of SUFFIXES) {
        if (remainingLower.endsWith(suf) && remainingLower.length > suf.length + 3) {
            const splitIdx = remaining.length - suf.length;
            suffixPart = SOFT_HYPHEN + remaining.slice(splitIdx);
            remaining = remaining.slice(0, splitIdx);
            // No need to update remainingLower for suffix check as we are done
            break;
        }
    }

    // 3. Simple VCV rule (Vowel-Consonant-Vowel) -> Break before Consonant? 
    // Simplified: just return what we have to be safe. 
    // Aggressive hyphenation requires a dictionary. Prefix/Suffix is 80/20 rule.

    return chunks.join("") + remaining + suffixPart;
}

/**
 * Processes an HTML string, hyphenating words outside of tags.
 * @param {string} html 
 */
function processHtml(html) {
    // Regex matches HTML tags OR Words (6+ chars)
    // Group 1: Tag
    // Group 2: Word
    return html.replace(/(<[^>]+>)|([a-zA-Z]{6,})/g, (match, tag, word) => {
        if (tag) return tag;
        return hyphenateWord(word);
    });
}

module.exports = {
    hyphenateWord,
    processHtml
};
