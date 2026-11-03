/**
 * Moderation constants: channels, roles, the rule list and runtime settings.
 *
 * The rule list and DEFAULT_SETTINGS are MIRRORED in beluga-league-main/lib/modStore.js.
 * Settings live in `mod_settings` and are edited on the admin Mod Logs tab; anything
 * missing falls back to the defaults here, so a fresh database still behaves.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const { db } = require('./modSchema');

const CHANNELS = {
    STRIKES: '1156814622070935636',
    SUSPENSIONS: '1156814622070935637',
    TIMEOUT_LOG: '1156814624499449973',
    GENERAL: '1156814622070935640',
    AUTOMOD_LOG: '1419152838961004564',
    BALLCHASING_LOG: '1512286372772184208',
    ADMIN_CHAT: '1299015210702737429',
    DIRECTOR_CHAT: '1473156680568016906',
    MODERATOR_CHAT: '1156814622322602104',
    BELUGA_BANNED: '1365801926947635434',
    CODE_OF_CONDUCT: '1393072567056863312',
    RULEBOOK: '1156814621865427023',
    WELCOME: '1156814622070935632',
    LEADERSHIP_CATEGORY: '1203051640555438171',
    TICKET_CATEGORY: '1156814621865427022',
};

const STAFF_ROLES = {
    DIRECTOR: '1156814621429215240',
    ADMIN: '1299015429355999263',
    MODERATOR: '1156814621429215239',
    TRIAL_MODERATOR: '1186906753615536268',
};

// Rulebook §6.1 — the package each strike carries. Server timeouts are in seconds.
const STRIKE_PACKAGE = {
    1: { timeoutSeconds: 2 * 86400, series: 1, ban: false },
    2: { timeoutSeconds: 7 * 86400, series: 3, ban: false },
    3: { timeoutSeconds: 0, series: 0, ban: true },
};

// Discord caps a timeout at 28 days.
const MAX_TIMEOUT_SECONDS = 28 * 86400;

// `ref` picks which channel the public post points at, matching the old format.
const RULES = [
    { code: 'coc1', label: 'Code of Conduct 1: Harassment', short: 'harassment', ref: 'coc' },
    { code: 'coc2', label: 'Code of Conduct 2: Threats', short: 'threats', ref: 'coc' },
    { code: 'coc3', label: 'Code of Conduct 3: Sharing personal information', short: 'sharing personal information', ref: 'coc' },
    { code: 'coc4', label: 'Code of Conduct 4: Hate speech', short: 'hate speech', ref: 'coc' },
    { code: 'coc5', label: 'Code of Conduct 5: Sexual content', short: 'sexual content', ref: 'coc' },
    { code: 'coc6', label: 'Code of Conduct 6: Self-harm content', short: 'self-harm content', ref: 'coc' },
    { code: 'coc7', label: 'Code of Conduct 7: Bending the conduct rules', short: 'bending the conduct rules', ref: 'coc' },
    { code: 'rb2.1', label: 'Rulebook 2.1: Account withholding', short: 'account withholding', ref: 'rulebook' },
    { code: 'rb2.3', label: 'Rulebook 2.3: Hiding a sal-out', short: 'hiding a sal-out', ref: 'rulebook' },
    { code: 'rb5.4', label: 'Rulebook 5.4: Cheating or in-game etiquette', short: 'cheating', ref: 'rulebook' },
    { code: 'rb6.1.2', label: 'Rulebook 6.1.2: Server breach or tampering', short: 'server breach or tampering', ref: 'rulebook' },
    { code: 'rb6.2', label: 'Rulebook 6.2: Smurfing', short: 'smurfing', ref: 'rulebook' },
    { code: 'rb6.3', label: 'Rulebook 6.3: Account sharing', short: 'account sharing', ref: 'rulebook' },
    { code: 'rb6.4', label: 'Rulebook 6.4: Fraud', short: 'fraud', ref: 'rulebook' },
    { code: 'rb6.5', label: 'Rulebook 6.5: False reporting', short: 'false reporting', ref: 'rulebook' },
    { code: 'rb6.1', label: 'Rulebook 6.1: Board discretion', short: 'board discretion', ref: 'rulebook' },
    { code: 'spam', label: 'Spam or channel misuse', short: 'spam', ref: 'coc' },
];

function ruleByCode(code) {
    return RULES.find((r) => r.code === code) || null;
}

function ruleChoices() {
    return RULES.map((r) => ({ name: r.label.slice(0, 100), value: r.code }));
}

function refChannelId(rule) {
    return rule?.ref === 'rulebook' ? CHANNELS.RULEBOOK : CHANNELS.CODE_OF_CONDUCT;
}

// Everything the Mod Logs tab can change. Values are strings in the table.
const DEFAULT_SETTINGS = {
    appeal_after_months: '6',
    appeal_vote_threshold: '5',
    rogue_action_limit: '5',
    rogue_window_minutes: '10',
    filter_enabled: 'true',
    filter_slur_enabled: 'true',
    filter_spam_enabled: 'true',
    // Off until someone turns it on in the Mod Logs tab: this sends member chat to an AI
    // provider, so it never starts by itself.
    filter_ai_enabled: 'false',
    // A slur the word list missed but the AI caught gets the same delete and timeout,
    // once a second look at that message alone agrees.
    filter_ai_slur_action: 'true',
    filter_ai_slur_confidence: '0.9',
    filter_slur_timeout_seconds: '300',
    // The chat AI joining in without being @mentioned. Claude only.
    chat_join_enabled: 'true',
    chat_join_channels: CHANNELS.GENERAL,
    chat_join_fun_minutes: '5',
    claude_daily_alert_usd: '0.25',
    filter_spam_timeout_seconds: '600',
    filter_spam_burst_messages: '7',
    filter_spam_burst_seconds: '6',
    filter_spam_duplicate_messages: '4',
    filter_spam_duplicate_seconds: '30',
    // Claude first. The two Groq models are the free backups for when it can't answer.
    filter_ai_claude_model: 'claude-haiku-5-5',
    filter_ai_primary_model: 'qwen/qwen3.8-27b',
    filter_ai_fallback_model: 'openai/gpt-oss-120b',
    filter_ai_confidence: '0.8',
    filter_ai_batch_size: '8',
    filter_ai_batch_seconds: '5',
    // Groq's free tier cap. Claude is limited by the balance instead.
    filter_ai_daily_tokens: '380000',
    // Channel lists accept a channel id or a category id. Tickets stay away from the
    // AI because members put personal details in them.
    filter_ai_excluded_channels: `${CHANNELS.DIRECTOR_CHAT},${CHANNELS.ADMIN_CHAT},${CHANNELS.TICKET_CATEGORY}`,
    filter_flag_only_channels: `${CHANNELS.LEADERSHIP_CATEGORY},${CHANNELS.TICKET_CATEGORY}`,
    filter_ignored_channels: CHANNELS.AUTOMOD_LOG,
    filter_exempt_roles: '',
};

let cache = null;
let cachedAt = 0;
const CACHE_MS = 30 * 1000;

async function getSettings({ fresh = false } = {}) {
    if (!fresh && cache && Date.now() - cachedAt < CACHE_MS) return cache;
    const out = { ...DEFAULT_SETTINGS };
    if (db()) {
        try {
            const { rows } = await pool.query('SELECT key, value FROM mod_settings');
            for (const r of rows) if (r.value !== null && r.value !== '') out[r.key] = r.value;
        } catch (err) {
            if (!/does not exist/.test(String(err.message))) Logger.error('mod settings read failed', err);
        }
    }
    cache = out;
    cachedAt = Date.now();
    return out;
}

function clearSettingsCache() {
    cache = null;
}

const asBool = (v) => String(v).toLowerCase() === 'true';
const asInt = (v, fallback) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
};
const asList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
    CHANNELS, STAFF_ROLES, STRIKE_PACKAGE, MAX_TIMEOUT_SECONDS, RULES, DEFAULT_SETTINGS,
    ruleByCode, ruleChoices, refChannelId, getSettings, clearSettingsCache, asBool, asInt, asList,
};
