/**
 * Tracks what the AI layer costs and whether it's working. Daily usage goes in
 * `mod_ai_usage` so the Mod Logs tab can show it. Staff get one notice when the AI goes
 * down and one when it recovers, however many batches fail in between.
 */

const { pool } = require('../../utils/database');
const Logger = require('../../utils/logger');
const higgenLog = require('../../utils/higgenLog');
const { CHANNELS } = require('../modConfig');
const { sendTo } = require('../modPosting');

let down = false;
let lastError = null;

const today = () => new Date().toISOString().slice(0, 10);

async function record(model, { tokens = 0, error = false }) {
    await pool.query(
        `INSERT INTO mod_ai_usage (day, model, requests, tokens, errors) VALUES ($1, $2, 1, $3, $4)
         ON CONFLICT (day, model) DO UPDATE SET requests = mod_ai_usage.requests + 1,
                tokens = mod_ai_usage.tokens + $3, errors = mod_ai_usage.errors + $4`,
        [today(), model, tokens, error ? 1 : 0],
    ).catch((err) => Logger.warning(`AI usage write failed: ${err.message}`));
}

async function tokensToday() {
    const { rows } = await pool.query('SELECT COALESCE(SUM(tokens), 0)::int AS n FROM mod_ai_usage WHERE day = $1', [today()]);
    return rows[0]?.n || 0;
}

async function setDown(client, reason) {
    lastError = reason;
    if (down) return;
    down = true;
    await sendTo(client, CHANNELS.AUTOMOD_LOG, {
        content: `The AI chat check is paused: ${reason}. Slur and spam detection are unaffected.`,
        allowedMentions: { parse: [] },
    }, 'an AI health notice');
    higgenLog.logFailure({ summary: `The chat filter's AI check paused: ${reason}`, action: 'moderation.ai-down', where: 'Chat filter' });
}

async function setUp(client) {
    lastError = null;
    if (!down) return;
    down = false;
    await sendTo(client, CHANNELS.AUTOMOD_LOG, {
        content: 'The AI chat check is working again.',
        allowedMentions: { parse: [] },
    }, 'an AI health notice');
}

function isDown() {
    return down;
}

module.exports = { record, tokensToday, setDown, setUp, isDown, lastError: () => lastError };
