/**
 * MMR Updater → Discord outbox poller.
 *
 * The standalone TRN scraper service (separate Railway deploy) computes salary-sheet
 * changes for players and, when the operator has ARMED live writes, writes the sheet
 * itself and queues the player pings / staff reports into the shared Postgres table
 * `trn_outbox` (channel_id + message + the player's discord_id to @mention).
 *
 * This poller is the BOT half: it picks up unsent rows, posts each to its channel
 * (substituting the real <@discord_id> for the {mention} token), and marks it sent.
 * Mirrors the applications appBridge poller. Discord stays entirely in the bot — the
 * scraper never needs a bot token.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');

function dbAvailable() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

// Discord message hard limit is 2000 chars; keep a margin for the mention prefix.
const MAX_LEN = 1900;

/**
 * Replace the {mention} token with the real Discord mention (stripped if we have
 * no discord_id) and {salary_crew} with the Salary Crew role mention.
 */
function renderMessage(row) {
    const mention = row.discord_id ? `<@${row.discord_id}>` : '';
    let text = String(row.message || '')
        .replace(/\{mention\}/g, mention)
        .replace(/\{salary_crew\}/g, `<@&${ROLES.SALARY_CREW}>`)
        .trim();
    if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN - 1) + '…';
    return text;
}

/**
 * Who a message may actually ping. Lifetime-wins alerts are for Salary Crew: they
 * NAME the player (clickable) but must not ping them; the ranges notice pings
 * nobody. Everything else keeps the old behaviour (pings the player it's about).
 */
function allowedMentionsFor(row) {
    if (row.kind === 'wins_alert') return { parse: [], roles: [ROLES.SALARY_CREW], users: [] };
    if (row.kind === 'wins_info') return { parse: [] };
    return { parse: [], users: row.discord_id ? [String(row.discord_id)] : [], roles: [] };
}

async function postPendingOutbox(client) {
    if (!dbAvailable()) return;
    try {
        const res = await pool.query(
            `SELECT id, run_id, row_index, discord_id, channel_id, kind, message
               FROM trn_outbox
              WHERE sent = FALSE AND error IS NULL
              ORDER BY id ASC
              LIMIT 25`
        );

        for (const row of res.rows) {
            try {
                const channel = await client.channels.fetch(row.channel_id).catch(() => null);
                if (!channel?.isTextBased()) {
                    throw new Error(`outbox channel ${row.channel_id} unavailable or not text-based`);
                }

                const content = renderMessage(row);
                if (!content) throw new Error('empty message after render');

                await channel.send({ content, allowedMentions: allowedMentionsFor(row) });
                await pool.query(
                    `UPDATE trn_outbox SET sent = TRUE, sent_at = now(), error = NULL WHERE id = $1`,
                    [row.id]
                );
                Logger.success(`MMR outbox: posted ${row.kind} for row ${row.row_index} to #${row.channel_id}`);
            } catch (err) {
                // Record the error so we don't hammer a bad channel every tick; staff
                // can see it on the panel and fix the channel id, then it retries
                // once cleared. Log err.code/message per the bot's error-logging rule.
                Logger.error(
                    `MMR outbox post failed for id ${row.id} (channel ${row.channel_id}): ` +
                    `${err?.code || ''} ${err?.message || err}`
                );
                await pool.query(
                    `UPDATE trn_outbox SET error = $2 WHERE id = $1`,
                    [row.id, String(err?.message || err).slice(0, 300)]
                ).catch(() => {});
            }
        }
    } catch (err) {
        // The trn_* tables only exist once the scraper has run; ignore "missing table".
        if (!/relation .* does not exist/.test(String(err.message))) {
            Logger.error('postPendingOutbox failed', err);
        }
    }
}

function startMmrOutboxPoller(client, intervalMs = 15 * 1000) {
    setInterval(() => postPendingOutbox(client), intervalMs);
    setTimeout(() => postPendingOutbox(client), 8 * 1000);
    Logger.info('MMR outbox poller started');
}

module.exports = { startMmrOutboxPoller, postPendingOutbox };
