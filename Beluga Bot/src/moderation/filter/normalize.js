/**
 * Undoes the tricks people use to get a word past a filter: lookalike letters from
 * other alphabets, leetspeak, stretched letters, zero-width characters and s p a c i n g.
 *
 * The job is the opposite of a fuzzy match. Everything ends in an exact comparison
 * against a known word, because a filter that guesses is one that punishes the wrong
 * person. See matcher.js for how the tokens get compared.
 */

const ZERO_WIDTH = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯︀-️﻿]/g;
const COMBINING = /\p{M}/gu;

// Letters from other alphabets that are true lookalikes of Latin ones. Letters that
// only roughly resemble one are left out, so real Russian or Greek text is never
// bent into something it doesn't say. NFKC already handles fullwidth, circled and
// mathematical letters.
const CONFUSABLES = {
    а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ԛ: 'q', ԝ: 'w',
    α: 'a', ι: 'i', ο: 'o', ρ: 'p',
    ɑ: 'a', ɡ: 'g', ɢ: 'g', ɪ: 'i', ʀ: 'r', ʏ: 'y', ʜ: 'h', ʟ: 'l', ɴ: 'n', ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ғ: 'f', ᴊ: 'j', ᴋ: 'k', ᴍ: 'm', ᴏ: 'o', ᴘ: 'p', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ᴢ: 'z',
    ø: 'o', đ: 'd', ð: 'd', ł: 'l', ħ: 'h', ŧ: 't', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i',
};

// Only applied inside a token that also has letters, so "1v1" stays ordinary text.
const LEET = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g',
    '@': 'a', $: 's', '!': 'i', '|': 'i', '€': 'e', '£': 'l', '¥': 'y', '+': 't',
};
const LEET_ALTERNATE = { '1': 'l', '|': 'l', '!': 'l' };

/** Regional-indicator emoji letters (🇦 to 🇿) spell words too. */
function fromRegionalIndicators(text) {
    return text.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, (c) => String.fromCharCode(97 + c.codePointAt(0) - 0x1F1E6));
}

function stripDiscordSyntax(text) {
    return text
        .replace(/https?:\/\/\S+/gi, ' ')
        .replace(/<a?:\w+:\d+>/g, ' ')
        .replace(/<[@#][!&]?\d+>/g, ' ')
        .replace(/[*_~`|>]/g, (c) => (c === '|' ? '' : ' '));
}

function foldLetters(text) {
    const folded = fromRegionalIndicators(String(text || ''))
        .normalize('NFKC')
        .replace(ZERO_WIDTH, '')
        .normalize('NFD')
        .replace(COMBINING, '')
        .toLowerCase();
    let out = '';
    for (const ch of folded) out += CONFUSABLES[ch] ?? ch;
    return out;
}

function leetVariants(token) {
    const hasLetter = /[a-z]/.test(token);
    if (!hasLetter || !/[0-9@$!|€£¥+]/.test(token)) return [token];
    const primary = [...token].map((c) => LEET[c] ?? c).join('');
    const alternate = [...token].map((c) => LEET_ALTERNATE[c] ?? LEET[c] ?? c).join('');
    return primary === alternate ? [primary] : [primary, alternate];
}

/**
 * Text → groups of candidate spellings, one group per position in the message.
 * @returns {string[][]} e.g. "hi n1gg3r" → [["hi"], ["nigger", "nlgger"]]
 */
function tokenize(text) {
    const groups = [];
    const folded = foldLetters(stripDiscordSyntax(String(text || '')));
    for (const raw of folded.split(/\s+/)) {
        if (!raw) continue;
        const trimmed = raw.replace(/^[^a-z0-9@$!|€£¥+]+|[^a-z0-9@$!|€£¥+]+$/g, '');
        if (!trimmed) continue;
        const variants = leetVariants(trimmed);
        // A separator inside a token ("n.i.g", "word-word") splits it, in step with
        // every variant so positions stay aligned.
        const parts = variants.map((v) => v.split(/[^a-z]+/).filter(Boolean));
        const width = Math.max(...parts.map((p) => p.length), 0);
        for (let i = 0; i < width; i += 1) {
            const group = [...new Set(parts.map((p) => p[i]).filter(Boolean))];
            if (group.length) groups.push(group);
        }
    }
    return groups;
}

/** Letter runs: "coon" → [["c",1],["o",2],["n",1]]. */
function runs(word) {
    const out = [];
    for (const ch of word) {
        const last = out[out.length - 1];
        if (last && last[0] === ch) last[1] += 1;
        else out.push([ch, 1]);
    }
    return out;
}

function collapse(word) {
    return runs(word).map(([ch]) => ch).join('');
}

/**
 * Is `token` the word with letters held down? Every run must be at least as long as
 * the word's own, which keeps "conn" and "niger" from matching their doubled cousins.
 */
function isStretchOf(token, word) {
    const a = runs(token);
    const b = runs(word);
    if (a.length !== b.length) return false;
    return a.every(([ch, n], i) => ch === b[i][0] && n >= b[i][1]);
}

/** Words exactly as typed, with no leetspeak decoding, for literal list entries. */
function literalTokens(text) {
    return foldLetters(stripDiscordSyntax(String(text || '')))
        .split(/\s+/)
        .map((t) => t.replace(/^[^a-z0-9@$!|€£¥+]+|[^a-z0-9@$!|€£¥+]+$/g, ''))
        .filter(Boolean);
}

/** One clean lowercase string, for multi-word phrases and the allow-list. */
function flatten(text) {
    return tokenize(text).map((group) => group[0]).join(' ');
}

module.exports = { tokenize, literalTokens, runs, collapse, isStretchOf, flatten, foldLetters };
