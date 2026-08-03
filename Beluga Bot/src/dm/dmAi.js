/**
 * DM AI — the auto-responder for one-to-one DMs with the bot.
 *
 * Deliberately SEPARATE from the server chatbot (`utils/aiChat.js`):
 *
 *  - **Memory is per-conversation.** The server bot keeps one shared rolling
 *    history across every channel and member. A DM must not see that, and one
 *    member's DM must not see another's — so history here is rebuilt from the
 *    last `HISTORY_MESSAGES` rows of `dm_messages` for that person alone.
 *  - **Nothing written here touches the server bot's state.** We call its
 *    provider plumbing (`callText`) with our own history array and our own
 *    system prompt, so `aiChat.history`, its cooldown maps and its pinned
 *    rulebook context are all left exactly as they were.
 *
 * Two personas, chosen per conversation from the DM Center:
 *  - `professional` (default) — the same voice the bot uses in the server.
 *  - `unhinged` — a savage roast persona.
 *
 * The bot only ever speaks here when staff switched AI on for that specific
 * conversation (see dmInbox.maybeAiReply).
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const {
    MODES, DEFAULT_MODE, normalizeMode, getPersona, systemPromptFor, providerOrder,
} = require('../ai/persona');
const { buildContextBlock } = require('../ai/playerContext');

/** How many past DM messages of context the model gets. */
const HISTORY_MESSAGES = 15;

/** Per-person cooldown so a member spamming the bot can't burn the API quota. */
const COOLDOWN_MS = 3000;
const cooldowns = new Map();

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

/**
 * Build the model's view of this DM from the stored thread.
 *
 * `dm_messages` is a flat in/out log, so it gets folded into the
 * {userMessage, botResponse} pairs `aiChat.callText` expects. Staff replies and
 * broadcasts count as things "the bot" said — from the member's side of the DM
 * that's exactly what they were — so the AI stays consistent with whatever a
 * human already told them.
 *
 * Returns `{ history, pending }`, where `pending` is any incoming message that
 * was never answered; the caller folds those into the current message rather
 * than inventing a fake reply for them.
 */
async function loadDmHistory(discordId, { limit = HISTORY_MESSAGES, excludeMessageId = null, displayName = 'Member' } = {}) {
    const res = await pool.query(
        `SELECT * FROM (
            SELECT id, direction, content
              FROM dm_messages
             WHERE discord_id = $1
               AND COALESCE(content, '') <> ''
               AND (direction = 'in' OR status = 'sent')
               AND ($2::text IS NULL OR discord_message_id IS DISTINCT FROM $2)
             ORDER BY id DESC
             LIMIT $3
         ) t ORDER BY id ASC`,
        [String(discordId), excludeMessageId ? String(excludeMessageId) : null, Math.max(1, Number(limit) || HISTORY_MESSAGES)]
    );

    const history = [];
    let pending = [];

    for (const row of res.rows) {
        const text = String(row.content || '').trim();
        if (!text) continue;

        if (row.direction === 'in') {
            pending.push(text);
            continue;
        }

        if (!pending.length && history.length) {
            // Consecutive outgoing messages belong to the same turn.
            history[history.length - 1].botResponse += `\n${text}`;
        } else {
            history.push({
                displayName,
                userMessage: pending.join('\n'),
                botResponse: text,
                imageContext: null,
            });
            pending = [];
        }
    }

    return { history, pending };
}

/** Rulebook context, WITHOUT touching aiChat's shared `pinnedRule` state. */
async function ruleContextFor(aiChat, userMessage) {
    const lower = String(userMessage || '').toLowerCase();
    const keywords = ['rule', 'rules', 'rulebook', 'roster', 'substitute', 'forfeit',
        'penalty', 'playoff', 'eligibility', 'trade', 'captain', 'salary cap', 'reschedule',
        'suspension', 'transfer', 'ineligible'];
    if (!keywords.some((kw) => lower.includes(kw))) return null;

    try {
        await aiChat.ruleBook.ensureLoaded();
        const found = aiChat.ruleBook.searchRules(userMessage) || [];
        if (!found.length) return null;
        return found.slice(0, 2)
            .map((r) => `Section ${r.number} (${r.section}): ${r.content.substring(0, 600)}`)
            .join('\n\n');
    } catch (err) {
        Logger.warning(`DM AI rulebook lookup failed: ${err.message}`);
        return null;
    }
}

/**
 * Generate the auto-reply for one DM. Returns the reply string, or null when we
 * should stay silent (cooled down, no providers, or every provider failed).
 *
 * `mode` is optional — when omitted the person's persona is looked up, which is
 * the same persona they get in the server.
 */
async function generateDmReply({ aiChat, discordId, displayName, userMessage, mode, excludeMessageId = null }) {
    if (!aiChat || typeof aiChat.callText !== 'function') return null;
    if (!db()) return null;

    const text = String(userMessage || '').trim();
    if (!text) return null;

    const id = String(discordId);
    const last = cooldowns.get(id);
    if (last && Date.now() - last < COOLDOWN_MS) return null;

    // Same persona they get in the server — it's a property of the person.
    const persona = mode == null ? await getPersona(id) : normalizeMode(mode);
    const who = displayName || 'Member';

    let history = [];
    let pending = [];
    try {
        ({ history, pending } = await loadDmHistory(id, { excludeMessageId, displayName: who }));
    } catch (err) {
        // No memory is better than no reply.
        Logger.warning(`DM AI history load failed for ${id}: ${err.message}`);
    }

    // Anything they said that nobody answered is part of what they're asking now.
    const composed = [...pending, text].join('\n');

    let systemPrompt = systemPromptFor(persona);
    if (persona !== 'unhinged') {
        const rules = await ruleContextFor(aiChat, composed);
        if (rules) {
            systemPrompt += `\n\n[Rulebook context you can use to answer accurately and naturally — cite the section briefly only if it helps:]\n${rules}`;
        }
    }

    // Everything the bot knows about them (and anyone they named).
    const context = await buildContextBlock({
        discordId: id, displayName: who, message: composed, mode: persona,
    });
    if (context) systemPrompt += `\n\n${context}`;

    systemPrompt += `\n\nYou are in a private direct message with ${who}. Only this conversation is visible to you; nothing said in the server carries over.`;

    const tried = [];
    for (const provider of providerOrder(persona, aiChat.buildTextOrder())) {
        if (!aiChat.hasKey(provider)) {
            tried.push(`${provider}(no key)`);
            continue;
        }
        // NOTE: callText takes history as an argument and mutates nothing, so
        // the server bot's shared history is untouched by this call.
        const reply = await aiChat.callText(provider, history, composed, who, systemPrompt);
        if (reply) {
            cooldowns.set(id, Date.now());
            await aiChat.log(`💬 [DM AI · ${persona}] ${tried.length ? `${tried.join(' → ')} → ` : ''}${provider}✓ · ${who}`);
            return reply;
        }
        tried.push(`${provider}✗`);
    }

    cooldowns.set(id, Date.now());
    await aiChat.log(`🔴 [DM AI · ${persona}] all providers failed (${tried.join(' → ') || 'none'}) · ${who}`);
    return null;
}

/** Drop stale cooldown entries. Called from the bot's existing cleanup pass. */
function cleanup() {
    const now = Date.now();
    for (const [id, ts] of cooldowns.entries()) {
        if (now - ts > 60000) cooldowns.delete(id);
    }
}

module.exports = {
    generateDmReply,
    loadDmHistory,
    // Re-exported from ai/persona.js so existing callers keep working.
    normalizeMode,
    cleanup,
    MODES,
    DEFAULT_MODE,
    HISTORY_MESSAGES,
};
