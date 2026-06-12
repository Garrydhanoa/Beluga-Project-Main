/**
 * DB-backed persistence for in-progress report sessions and the per-thread
 * "Report Series" panels. Everything the live flow needs survives a bot restart
 * because state lives here, not in memory.
 */

const { pool, isDatabaseAvailable } = require('../../utils/database');
const Logger = require('../../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

// ---- sessions ---------------------------------------------------------------

// Every non-terminal state — used by the "one report at a time per thread"
// guard and the panel provisioner. Must match the states flow.js actually sets.
const ACTIVE_STATES = ['await_group', 'assign_sides', 'matching', 'await_confirm', 'disputed'];

async function createSession(data) {
    if (!db()) throw new Error('Database not available.');
    const r = await pool.query(
        `INSERT INTO stats_report_sessions (
            thread_id, channel_id, division, season_id, week, is_playoff, format,
            home_team_id, away_team_id, schedule_match_id, group_url, parsed,
            home_matches, away_matches, state, started_by_discord_id, message_ids, expires_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17::jsonb,$18)
         RETURNING *`,
        [
            data.threadId || null, data.channelId || null, data.division || null, data.seasonId || null,
            data.week ?? null, Boolean(data.isPlayoff), data.format || 'bo5',
            data.homeTeamId || null, data.awayTeamId || null, data.scheduleMatchId || null,
            data.groupUrl || null, data.parsed ? JSON.stringify(data.parsed) : null,
            data.homeMatches ? JSON.stringify(data.homeMatches) : null,
            data.awayMatches ? JSON.stringify(data.awayMatches) : null,
            data.state || 'await_group', data.startedByDiscordId || null,
            data.messageIds ? JSON.stringify(data.messageIds) : null,
            data.expiresAt || null,
        ]
    );
    return r.rows[0];
}

async function getSession(id) {
    if (!db() || !id) return null;
    const r = await pool.query(`SELECT * FROM stats_report_sessions WHERE id = $1`, [id]);
    return r.rows[0] || null;
}

/** The active (in-progress) session for a thread, if any. */
async function getActiveSessionByThread(threadId) {
    if (!db() || !threadId) return null;
    const r = await pool.query(
        `SELECT * FROM stats_report_sessions
         WHERE thread_id = $1 AND state = ANY($2)
         ORDER BY id DESC LIMIT 1`,
        [String(threadId), ACTIVE_STATES]
    );
    return r.rows[0] || null;
}

const SESSION_COLUMNS = {
    state: 'state', groupUrl: 'group_url', parsed: 'parsed', homeMatches: 'home_matches',
    awayMatches: 'away_matches', messageIds: 'message_ids', seriesId: 'series_id', expiresAt: 'expires_at',
};
const JSON_FIELDS = new Set(['parsed', 'homeMatches', 'awayMatches', 'messageIds']);

async function updateSession(id, patch) {
    if (!db() || !id) return null;
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [key, col] of Object.entries(SESSION_COLUMNS)) {
        if (patch[key] === undefined) continue;
        if (JSON_FIELDS.has(key)) {
            sets.push(`${col} = $${i}::jsonb`);
            vals.push(patch[key] === null ? null : JSON.stringify(patch[key]));
        } else {
            sets.push(`${col} = $${i}`);
            vals.push(patch[key]);
        }
        i += 1;
    }
    if (!sets.length) return getSession(id);
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    vals.push(id);
    const r = await pool.query(
        `UPDATE stats_report_sessions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        vals
    );
    return r.rows[0] || null;
}

async function cancelSession(id, state = 'cancelled') {
    if (!db() || !id) return;
    await pool.query(
        `UPDATE stats_report_sessions SET state = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [state, id]
    );
}

// ---- panels -----------------------------------------------------------------

async function upsertPanel(threadId, data) {
    if (!db() || !threadId) return;
    await pool.query(
        `INSERT INTO stats_report_panels (
            thread_id, channel_id, message_id, division, season_id, week,
            home_team_id, away_team_id, status, last_posted_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT (thread_id) DO UPDATE SET
            channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id,
            division = EXCLUDED.division, season_id = EXCLUDED.season_id, week = EXCLUDED.week,
            home_team_id = EXCLUDED.home_team_id, away_team_id = EXCLUDED.away_team_id,
            status = EXCLUDED.status, last_posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
        [
            String(threadId), data.channelId || null, data.messageId || null, data.division || null,
            data.seasonId || null, data.week ?? null, data.homeTeamId || null, data.awayTeamId || null,
            data.status || 'active',
        ]
    );
}

async function getPanel(threadId) {
    if (!db() || !threadId) return null;
    const r = await pool.query(`SELECT * FROM stats_report_panels WHERE thread_id = $1`, [String(threadId)]);
    return r.rows[0] || null;
}

async function getActivePanels() {
    if (!db()) return [];
    const r = await pool.query(`SELECT * FROM stats_report_panels WHERE status = 'active'`);
    return r.rows;
}

async function setPanelStatus(threadId, status) {
    if (!db() || !threadId) return;
    await pool.query(
        `UPDATE stats_report_panels SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE thread_id = $2`,
        [status, String(threadId)]
    );
}

async function setPanelMessage(threadId, messageId) {
    if (!db() || !threadId) return;
    await pool.query(
        `UPDATE stats_report_panels SET message_id = $1, last_posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE thread_id = $2`,
        [messageId, String(threadId)]
    );
}

module.exports = {
    ACTIVE_STATES,
    createSession,
    getSession,
    getActiveSessionByThread,
    updateSession,
    cancelSession,
    upsertPanel,
    getPanel,
    getActivePanels,
    setPanelStatus,
    setPanelMessage,
};
