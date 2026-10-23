const { pool, isDatabaseAvailable } = require('./database');
const Logger = require('./logger');
const openticket = require('../commands/openticket');

/**
 * Bridges website ticket actions to Discord:
 *   - close requests (ticket_close_requests) → run the bot's close flow
 *   - live transcript capture is handled in bot.js MessageCreate via
 *     openticket.captureTicketMessage()
 *   - on startup, backfill transcripts for currently-open tickets
 */

let interval = null;
let tablesReady = false;

/**
 * Create the website-shared ticket tables if they don't exist. The bot writes
 * to these (transcript capture, request processing) and can't assume the website
 * has run its own migration first, so it owns the CREATE here too. Definitions
 * mirror the website's lib/leagueSchema.js exactly.
 */
async function ensureTicketTables() {
    if (!isDatabaseAvailable()) return false;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id SERIAL PRIMARY KEY,
                channel_id TEXT NOT NULL,
                message_id TEXT,
                author_id TEXT,
                author_username TEXT,
                author_display TEXT,
                author_avatar TEXT,
                author_color TEXT,
                is_bot BOOLEAN NOT NULL DEFAULT FALSE,
                content TEXT,
                attachments JSONB DEFAULT '[]'::jsonb,
                embeds JSONB DEFAULT '[]'::jsonb,
                message_created_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (channel_id, message_id)
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_messages_channel ON ticket_messages(channel_id, message_created_at)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS ticket_close_requests (
                id SERIAL PRIMARY KEY,
                channel_id TEXT NOT NULL,
                requested_by_discord_id TEXT,
                requested_by_username TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fulfilled_at TIMESTAMP
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_close_requests ON ticket_close_requests(status, requested_at)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS ticket_requests (
                id SERIAL PRIMARY KEY,
                target_kind TEXT NOT NULL,
                target_id TEXT NOT NULL,
                reason TEXT,
                requested_by_discord_id TEXT,
                requested_by_username TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                ticket_channel_id TEXT,
                requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fulfilled_at TIMESTAMP
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_requests_status ON ticket_requests(status, requested_at DESC)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS ticket_archives (
                channel_id TEXT PRIMARY KEY,
                channel_name TEXT,
                reason TEXT,
                opened_by_username TEXT,
                opened_at TIMESTAMP,
                closed_by_username TEXT,
                closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                message_count INTEGER NOT NULL DEFAULT 0
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ticket_archives_closed ON ticket_archives(closed_at DESC)`);
        await pool.query(`ALTER TABLE ticket_archives ADD COLUMN IF NOT EXISTS transcript JSONB`).catch(() => {});

        await pool.query(`
            CREATE TABLE IF NOT EXISTS thread_messages (
                id SERIAL PRIMARY KEY,
                thread_id TEXT NOT NULL,
                message_id TEXT,
                author_id TEXT,
                author_username TEXT,
                author_display TEXT,
                author_avatar TEXT,
                author_color TEXT,
                is_bot BOOLEAN NOT NULL DEFAULT FALSE,
                content TEXT,
                attachments JSONB DEFAULT '[]'::jsonb,
                embeds JSONB DEFAULT '[]'::jsonb,
                message_created_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (thread_id, message_id)
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_thread_messages_thread ON thread_messages(thread_id, message_created_at)`);

        tablesReady = true;
        Logger.success('Ticket sync tables ensured');
        return true;
    } catch (err) {
        Logger.error('ensureTicketTables failed', err);
        return false;
    }
}

async function processCloseRequests(client) {
    if (!isDatabaseAvailable() || !tablesReady) return;
    let rows;
    try {
        const r = await pool.query(`
            SELECT id, channel_id, requested_by_username
            FROM ticket_close_requests
            WHERE status = 'pending'
            ORDER BY requested_at
            LIMIT 25
        `);
        rows = r.rows;
    } catch {
        return; // table may not exist yet
    }
    for (const row of rows) {
        try {
            const result = await openticket.closeTicketByChannelId(
                client, row.channel_id, row.requested_by_username || 'Website Admin'
            );
            await pool.query(
                `UPDATE ticket_close_requests SET status = $1, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [result.ok ? 'fulfilled' : 'failed', row.id]
            );
        } catch (err) {
            Logger.error(`processCloseRequests failed for request ${row.id}`, err);
            await pool.query(
                `UPDATE ticket_close_requests SET status = 'failed', fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [row.id]
            ).catch(() => {});
        }
    }
}

async function processOpenRequests(client) {
    if (!isDatabaseAvailable() || !tablesReady) return;
    let rows;
    try {
        const r = await pool.query(`
            SELECT id, target_kind, target_id, reason, requested_by_discord_id, requested_by_username
            FROM ticket_requests
            WHERE status = 'pending'
            ORDER BY requested_at
            LIMIT 25
        `);
        rows = r.rows;
    } catch {
        return; // table may not exist yet
    }
    for (const row of rows) {
        try {
            const result = await openticket.createTicketFromRequest(client, {
                targetKind: row.target_kind,
                targetId: row.target_id,
                reason: row.reason,
                requestedByDiscordId: row.requested_by_discord_id,
                requestedByUsername: row.requested_by_username,
            });
            if (result.ok) {
                await pool.query(
                    `UPDATE ticket_requests SET status = 'fulfilled', ticket_channel_id = $1, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $2`,
                    [result.channelId, row.id]
                );
                // Capture the just-created welcome message into the transcript.
                const ch = await client.channels.fetch(result.channelId).catch(() => null);
                if (ch) await openticket.backfillTicketChannel(ch);
            } else {
                await pool.query(
                    `UPDATE ticket_requests SET status = 'failed', fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [row.id]
                );
            }
        } catch (err) {
            Logger.error(`processOpenRequests failed for request ${row.id}`, err);
            await pool.query(
                `UPDATE ticket_requests SET status = 'failed', fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [row.id]
            ).catch(() => {});
        }
    }
}

/**
 * Re-read open tickets so nothing missed by live capture (e.g. while the bot was
 * down) is lost. `full` re-reads every ticket's whole history (startup); otherwise
 * only messages newer than the newest one already captured (every 10 minutes).
 */
async function backfillOpenTickets(client, { full = true } = {}) {
    if (!isDatabaseAvailable() || !tablesReady) return;
    try {
        const r = await pool.query('SELECT channel_id FROM tickets');
        let added = 0;
        for (const row of r.rows) {
            const channel = await client.channels.fetch(row.channel_id).catch(() => null);
            if (!channel) continue;
            let stopAtId = null;
            if (!full) {
                const last = await pool.query(
                    `SELECT message_id FROM ticket_messages WHERE channel_id = $1 ORDER BY message_created_at DESC, id DESC LIMIT 1`,
                    [row.channel_id]
                ).catch(() => null);
                if (!last) continue; // DB blip — next round
                stopAtId = last.rows[0]?.message_id || null;
            }
            const res = await openticket.backfillTicketChannel(channel, { stopAtId });
            added += res?.fetched || 0;
        }
        if (full || added) Logger.info(`Ticket transcripts ${full ? 'backfilled' : 'caught up'} for ${r.rows.length} open ticket(s) (${added} message(s))`);
    } catch (err) {
        Logger.error('backfillOpenTickets failed', err);
    }
}

function startTicketSync(client, intervalMs = 20 * 1000) {
    if (interval) clearInterval(interval);
    // Ensure the shared tables exist BEFORE any capture/backfill/poll runs, so
    // we never spam "relation does not exist" against a fresh database.
    ensureTicketTables()
        .then((ok) => {
            if (!ok) {
                Logger.warning('Ticket sync: tables not ready; capture + polling disabled this run');
                return;
            }
            // Backfill once shortly after startup (whole history), then catch up
            // every 10 minutes so bot downtime can't leave holes in a transcript.
            setTimeout(() => { backfillOpenTickets(client, { full: true }).catch(() => {}) }, 8000);
            setInterval(() => { backfillOpenTickets(client, { full: false }).catch(() => {}) }, 10 * 60 * 1000);
            // Poll open + close requests so website actions feel responsive.
            interval = setInterval(() => {
                processCloseRequests(client).catch(() => {})
                processOpenRequests(client).catch(() => {})
            }, intervalMs);
            Logger.info(`Ticket sync started (request poll every ${Math.round(intervalMs / 1000)}s)`);
        })
        .catch((err) => Logger.error('startTicketSync failed', err));
}

module.exports = { startTicketSync, ensureTicketTables, processCloseRequests, processOpenRequests, backfillOpenTickets };
