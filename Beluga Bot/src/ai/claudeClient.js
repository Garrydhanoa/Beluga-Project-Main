/**
 * The one door to the Claude API. The chat filter, the server chatbot and the DM AI all
 * come through here, so they share one spend tally and one out-of-credit alarm.
 *
 * Anthropic has no endpoint for remaining prepaid credit. The balance on the Mod Logs tab
 * is the amount staff last entered minus the cost of every response since, worked out from
 * each response's own token counts.
 *
 * When the credit runs out the API refuses every request, at no cost. Callers see that
 * Claude isn't ready and use their backups, and every 10 minutes one request is let through
 * to find out whether someone has refilled it. The alarm in #admin-chat fires once per
 * outage: `alert_sent` only clears after a request succeeds.
 *
 * There is no spending cap. Instead #admin-chat hears about it once a day (Eastern) when
 * that day's spend passes `claude_daily_alert_usd`.
 */

const AnthropicModule = require('@anthropic-ai/sdk');
const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { getSettings } = require('../moderation/modConfig');

const Anthropic = AnthropicModule.default || AnthropicModule;

const MODEL = 'claude-haiku-5-5';
const REQUEST_TIMEOUT_MS = 20 * 1000;
const RETRY_WHEN_EMPTY_MS = 10 * 60 * 1000;
const RETRY_WHEN_REJECTED_MS = 5 * 60 * 1000;

const ADMIN_CHAT = '1299015210702737429';
const BARRY = '769357454890631170';
const YEN = '558373493385854986';
const BROKE_MESSAGE = `<@${BARRY}> Your dumass claudes api shut it self off due to your gay ass claude balance being $0, Stop being broke and tell <@${YEN}> to refill the balance`;
const busyMessage = (amount) => `<@${BARRY}> BItch Im  being used like a hoe today, These Bitch Ass members already used $${amount.toFixed(2)} of my usage by now today. So tell those mother fuckers to off hop off my dick and chill. Holy.`;
const DEFAULT_DAILY_ALERT_USD = 0.05;

// Dollars per million tokens, for prompts under 100K tokens.
const PRICES = {
    'claude-haiku-5-5': { input: 0.10, output: 0.50 },
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-opus-5-5': { input: 4, output: 20 },
};

class ClaudeRefused extends Error {}

let anthropic = null;
let discord = null;
let retryAt = 0;
let knownWorking = false;
let alertedInMemory = false;    // Covers a bot running with no database.

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

function attachClient(client) {
    discord = client;
}

function sdk() {
    if (!anthropic) {
        // A key that isn't tied to one workspace has to name it on every request.
        const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
        anthropic = new Anthropic({
            apiKey: process.env.ANTHROPIC_API_KEY,
            maxRetries: 1,
            ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}),
        });
    }
    return anthropic;
}

function ready() {
    return !!process.env.ANTHROPIC_API_KEY && Date.now() >= retryAt;
}

function costOf(model, usage = {}) {
    const price = PRICES[model] || PRICES[MODEL];
    const input = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || 0) * 0.1
        + (usage.cache_creation_input_tokens || 0) * 1.25;
    return (input * price.input + (usage.output_tokens || 0) * price.output) / 1e6;
}

/** A low balance arrives as either a 402 or a 400 whose message says so. */
function isOutOfCredit(err) {
    return err?.status === 402 || err?.type === 'billing_error' || /credit balance/i.test(String(err?.message));
}

function easternDay() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

/** Adds to the running totals, starting the daily one over when the day changes. */
async function addSpend(cost) {
    const day = easternDay();
    const { rows } = await pool.query(
        `UPDATE mod_claude_account
            SET spent_usd = spent_usd + $1,
                day_spent_usd = CASE WHEN day_key = $2 THEN day_spent_usd + $1 ELSE $1 END,
                day_alert_sent = CASE WHEN day_key = $2 THEN day_alert_sent ELSE FALSE END,
                day_key = $2
          WHERE id = 1 RETURNING day_spent_usd, day_alert_sent`,
        [cost, day],
    );
    if (rows[0] && !rows[0].day_alert_sent) await maybeWarnBusy(Number(rows[0].day_spent_usd), day);
}

async function maybeWarnBusy(spent, day) {
    const settings = await getSettings();
    const limit = parseFloat(settings.claude_daily_alert_usd);
    const amount = Number.isFinite(limit) ? limit : DEFAULT_DAILY_ALERT_USD;
    if (amount <= 0 || spent < amount) return;
    const { rows } = await pool.query(
        'UPDATE mod_claude_account SET day_alert_sent = TRUE WHERE id = 1 AND day_alert_sent = FALSE AND day_key = $1 RETURNING id',
        [day],
    );
    if (!rows.length) return;
    try {
        const channel = await discord.channels.fetch(ADMIN_CHAT);
        await channel.send({ content: busyMessage(amount), allowedMentions: { users: [BARRY] } });
    } catch (err) {
        // Unsent, the alert stays unclaimed and the next response tries again.
        await pool.query('UPDATE mod_claude_account SET day_alert_sent = FALSE WHERE id = 1');
        Logger.error(`Could not post the Claude daily spend alert: ${err.message}`);
    }
}

async function record(model, purpose, { usage = null, error = false }) {
    if (!db()) return;
    const cost = usage ? costOf(model, usage) : 0;
    try {
        await pool.query(
            `INSERT INTO mod_claude_usage (day, purpose, model, requests, input_tokens, output_tokens, cost_usd, errors)
             VALUES ($1, $2, $3, 1, $4, $5, $6, $7)
             ON CONFLICT (day, purpose, model) DO UPDATE SET
                requests = mod_claude_usage.requests + 1,
                input_tokens = mod_claude_usage.input_tokens + $4,
                output_tokens = mod_claude_usage.output_tokens + $5,
                cost_usd = mod_claude_usage.cost_usd + $6,
                errors = mod_claude_usage.errors + $7`,
            [new Date().toISOString().slice(0, 10), purpose, model, usage?.input_tokens || 0, usage?.output_tokens || 0, cost, error ? 1 : 0],
        );
        if (cost) await addSpend(cost);
    } catch (err) {
        Logger.warning(`Claude usage write failed: ${err.message}`);
    }
}

/** True for the one caller that gets to send this outage's alarm. */
async function claimAlert(reason) {
    if (db()) {
        try {
            const { rows } = await pool.query(
                `UPDATE mod_claude_account
                    SET state = 'empty', alert_sent = TRUE, last_error = $1,
                        empty_since = COALESCE(empty_since, NOW()), spent_usd = GREATEST(spent_usd, balance_usd)
                  WHERE id = 1 AND alert_sent = FALSE RETURNING id`,
                [reason],
            );
            return rows.length > 0;
        } catch (err) {
            Logger.warning(`Claude alert claim failed: ${err.message}`);
        }
    }
    if (alertedInMemory) return false;
    alertedInMemory = true;
    return true;
}

async function releaseAlert() {
    alertedInMemory = false;
    if (db()) await pool.query('UPDATE mod_claude_account SET alert_sent = FALSE WHERE id = 1').catch(() => {});
}

async function sendAlert() {
    try {
        const channel = await discord.channels.fetch(ADMIN_CHAT);
        await channel.send({ content: BROKE_MESSAGE, allowedMentions: { users: [BARRY, YEN] } });
        return true;
    } catch (err) {
        Logger.error(`Could not post the Claude balance alert: ${err.message}`);
        return false;
    }
}

async function markEmpty(reason) {
    retryAt = Date.now() + RETRY_WHEN_EMPTY_MS;
    knownWorking = false;
    if (!(await claimAlert(reason))) return;
    higgenLog.logFailure({
        summary: 'The Claude API ran out of credit, so the chat AI and the chat filter moved to their backups.',
        action: 'ai.claude-out-of-credit',
        where: 'Claude API',
    });
    // Unsent, the alarm stays unclaimed and the next failed request tries again.
    if (!(await sendAlert())) await releaseAlert();
}

async function markRejected(err) {
    knownWorking = false;
    if ([401, 403].includes(err.status)) retryAt = Date.now() + RETRY_WHEN_REJECTED_MS;
    if (db()) {
        await pool.query(
            `UPDATE mod_claude_account SET last_error = $1 WHERE id = 1`,
            [String(err.message).slice(0, 300)],
        ).catch(() => {});
    }
}

async function markWorking() {
    retryAt = 0;
    if (knownWorking) return;
    knownWorking = true;
    alertedInMemory = false;
    if (!db()) return;
    await pool.query(
        `UPDATE mod_claude_account SET state = 'ok', alert_sent = FALSE, empty_since = NULL, last_error = NULL WHERE id = 1`,
    ).catch((err) => Logger.warning(`Claude status write failed: ${err.message}`));
}

/** messages.create with the tally and the alarm around it. Rethrows every failure. */
async function create(params, { purpose = 'chat', timeout = REQUEST_TIMEOUT_MS } = {}) {
    try {
        const response = await sdk().messages.create(params, { timeout });
        await record(params.model, purpose, { usage: response.usage });
        await markWorking();
        return response;
    } catch (err) {
        await record(params.model, purpose, { error: true });
        if (isOutOfCredit(err)) await markEmpty(String(err.message).slice(0, 300));
        else if ([400, 401, 403, 404].includes(err?.status)) await markRejected(err);
        throw err;
    }
}

function textOf(response) {
    return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

/** One prompt, one answer. Same shape as groqClient.complete, for the chat filter. */
async function complete({ model, system, user, maxTokens = 1500, effort = 'low', thinking = null, purpose = 'filter' }) {
    const response = await create({
        model,
        max_tokens: maxTokens,
        system,
        output_config: { effort },
        ...(thinking ? { thinking: { type: thinking } } : {}),
        messages: [{ role: 'user', content: user }],
    }, { purpose });
    if (response.stop_reason === 'refusal') throw new ClaudeRefused('Claude declined to read this batch');
    return {
        text: textOf(response),
        tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };
}

module.exports = {
    MODEL, BROKE_MESSAGE, busyMessage, ClaudeRefused, attachClient, ready, create, complete, textOf, costOf, isOutOfCredit,
};
