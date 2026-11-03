/**
 * The slur word engine. Exact, not fuzzy: a message only matches when a whole word in
 * it, after normalize.js has undone any disguise, equals an entry on the list. There is
 * no substring matching at all, which is what keeps "Scunthorpe"-style words safe.
 *
 * The list lives in `mod_words` and is edited on the Mod Logs tab. On first boot it is
 * seeded from the "Rule 1 (Worst)" AutoMod list so it starts where the server already is.
 */

const { pool } = require('../../utils/database');
const Logger = require('../../utils/logger');
const { tokenize, literalTokens, foldLetters, collapse, isStretchOf, flatten } = require('./normalize');

const SEED_RULE = 'Rule 1 (Worst)';
const PLURALS = ['s', 'es', 'z', 'ed'];
const MIN_SPLIT_WORD = 6;       // "ni gger" is only checked for longer words

let words = new Set();
let literals = new Set();
let phrases = [];
let byCollapsed = new Map();
let allowed = [];
let loaded = false;

function compile(list, allowList) {
    words = new Set();
    literals = new Set();
    phrases = [];
    byCollapsed = new Map();
    for (const raw of list) {
        // A list entry with digits or symbols is itself a disguised spelling. Decoding
        // it would turn "c4nt" into the everyday word "cant", so it only ever matches
        // exactly as written. Message text is what gets decoded, never the list.
        const folded = foldLetters(raw).trim();
        if (/[^a-z\s]/.test(folded)) {
            literals.add(folded);
            continue;
        }
        const entry = flatten(raw);
        if (!entry) continue;
        if (entry.includes(' ')) {
            phrases.push(entry);
            continue;
        }
        words.add(entry);
        const key = collapse(entry);
        if (!byCollapsed.has(key)) byCollapsed.set(key, []);
        byCollapsed.get(key).push(entry);
    }
    allowed = allowList.map(flatten).filter(Boolean);
    loaded = true;
}

async function reload() {
    const [list, allow] = await Promise.all([
        pool.query(`SELECT word FROM mod_words WHERE enabled = TRUE AND tier = 'slur'`),
        pool.query('SELECT phrase FROM mod_allowlist'),
    ]);
    compile(list.rows.map((r) => r.word), allow.rows.map((r) => r.phrase));
    return words.size + phrases.length;
}

/** First boot only. Never overwrites a list staff have edited. */
async function seedIfEmpty(guild) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM mod_words');
    if (rows[0].n > 0) return 0;
    const rules = await guild.autoModerationRules.fetch();
    const rule = rules.find((r) => r.name === SEED_RULE);
    const keywords = rule?.triggerMetadata?.keywordFilter || [];
    for (const word of keywords) {
        await pool.query(
            `INSERT INTO mod_words (word, tier, source) VALUES ($1, 'slur', 'rule1') ON CONFLICT (word) DO NOTHING`,
            [String(word).replace(/\*/g, '').trim().toLowerCase()],
        );
    }
    Logger.info(`Chat filter: seeded ${keywords.length} words from "${SEED_RULE}"`);
    return keywords.length;
}

function hitToken(token) {
    if (words.has(token)) return token;
    for (const suffix of PLURALS) {
        if (token.endsWith(suffix) && words.has(token.slice(0, -suffix.length))) return token.slice(0, -suffix.length);
    }
    const near = byCollapsed.get(collapse(token));
    return near?.find((word) => isStretchOf(token, word)) || null;
}

/** Drop any stretch of the message covered by an allow-list phrase. */
function withoutAllowed(groups) {
    if (!allowed.length) return groups;
    const flat = groups.map((g) => g[0]);
    const keep = new Array(flat.length).fill(true);
    for (const phrase of allowed) {
        const parts = phrase.split(' ');
        for (let i = 0; i + parts.length <= flat.length; i += 1) {
            if (parts.every((p, j) => flat[i + j] === p)) {
                for (let j = 0; j < parts.length; j += 1) keep[i + j] = false;
            }
        }
    }
    return groups.filter((_, i) => keep[i]);
}

/** @returns {{word:string}|null} */
function matchText(text) {
    if (!loaded || (!words.size && !phrases.length && !literals.size)) return null;
    const groups = withoutAllowed(tokenize(text));
    if (!groups.length) return null;

    if (literals.size) {
        const literal = literalTokens(text).find((token) => literals.has(token));
        if (literal) return { word: literal };
    }

    for (const group of groups) {
        for (const token of group) {
            const word = hitToken(token);
            if (word) return { word };
        }
    }

    // s p a c e d letters: a run of single-letter tokens read as one word.
    let run = '';
    const flushRun = () => {
        const word = run.length >= 3 ? hitToken(run) : null;
        run = '';
        return word;
    };
    for (const group of groups) {
        const token = group[0];
        if (token.length === 1) {
            run += token;
        } else {
            const word = flushRun();
            if (word) return { word };
        }
    }
    const trailing = flushRun();
    if (trailing) return { word: trailing };

    // A long word split once: "ni gger".
    for (let i = 0; i + 1 < groups.length; i += 1) {
        const joined = groups[i][0] + groups[i + 1][0];
        if (joined.length >= MIN_SPLIT_WORD && words.has(joined)) return { word: joined };
    }

    if (phrases.length) {
        const flat = ` ${groups.map((g) => g[0]).join(' ')} `;
        const phrase = phrases.find((p) => flat.includes(` ${p} `));
        if (phrase) return { word: phrase };
    }
    return null;
}

/** Staff marked this word a false alarm, so the AI can't act on it by itself either. */
function isAllowed(word) {
    const flat = flatten(String(word || ''));
    return !!flat && allowed.includes(flat);
}

module.exports = { compile, reload, seedIfEmpty, matchText, isAllowed };
