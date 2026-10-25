/**
 * Campaigns: end-date reminder + "end & archive" (shared by /invite-reset and the
 * website's queued action).
 *
 * Nothing ends on its own. When a campaign passes its end date the bot pings
 * Salary Crew ONCE in the staff channel; invites keep counting toward it until a
 * human ends it. Ending freezes the final top 10 into `final_top`, starts the next
 * campaign, and leaves lifetime counts untouched.
 *
 * MIRRORED: beluga-league-main/lib/inviteStore.js `endCampaign()` runs the same
 * transaction when staff end it from the admin tab.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const { db, logEvent } = require('./inviteSchema');
const { countsSql } = require('./inviteCounts');
const notify = require('./inviteNotify');

/**
 * @param {{ actorId?: string, actorName?: string, expectCampaignId?: number|null }} opts
 * @returns {Promise<{ ok: boolean, reason?: string, ended?: object, next?: object }>}
 */
async function archiveAndReset({ actorId = null, actorName = null, expectCampaignId = null } = {}) {
    if (!db()) return { ok: false, reason: 'Database unavailable.' };
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cur = await client.query(`SELECT * FROM invite_campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE`);
        const active = cur.rows[0];
        if (!active) { await client.query('ROLLBACK'); return { ok: false, reason: 'There is no active campaign.' }; }
        if (expectCampaignId && Number(expectCampaignId) !== active.id) {
            await client.query('ROLLBACK');
            return { ok: false, reason: `That campaign was already ended — the current one is ${active.name}.` };
        }
        const top = await client.query(`${countsSql('campaign')} LIMIT 10`, [active.id]);
        const finalTop = top.rows.map((r, i) => ({ rank: i + 1, id: String(r.id), total: Number(r.total) }));
        const ended = await client.query(
            `UPDATE invite_campaigns SET status = 'ended', ended_at = NOW(), final_top = $2::jsonb, ended_by = $3
              WHERE id = $1 RETURNING *`,
            [active.id, JSON.stringify(finalTop), actorName || actorId || null]
        );
        const count = await client.query('SELECT COUNT(*)::int AS n FROM invite_campaigns');
        const next = await client.query(
            `INSERT INTO invite_campaigns (name, created_by) VALUES ($1, $2) RETURNING *`,
            [`Campaign ${count.rows[0].n + 1}`, actorName || actorId || null]
        );
        await client.query('COMMIT');
        await logEvent({ kind: 'campaign_end', summary: `${active.name} ended and was archived; ${next.rows[0].name} started.`, actorId, actorName });
        return { ok: true, ended: ended.rows[0], next: next.rows[0] };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        Logger.error('Invite campaign archive failed', err);
        return { ok: false, reason: 'The archive failed — nothing was changed.' };
    } finally {
        client.release();
    }
}

/** Ping Salary Crew once when the active campaign passes its end date. */
async function checkEndDate(client) {
    if (!db()) return;
    try {
        const { rows } = await pool.query(
            `SELECT * FROM invite_campaigns WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= NOW() AND end_pinged_at IS NULL LIMIT 1`
        );
        const c = rows[0];
        if (!c) return;
        // Claim first so a slow send can't double-ping on the next tick.
        const claim = await pool.query(`UPDATE invite_campaigns SET end_pinged_at = NOW() WHERE id = $1 AND end_pinged_at IS NULL`, [c.id]);
        if (!claim.rowCount) return;
        const sent = await notify.sendCampaignEndPing(client, c);
        if (!sent) await pool.query(`UPDATE invite_campaigns SET end_pinged_at = NULL WHERE id = $1`, [c.id]);
    } catch (err) {
        Logger.error('Invite campaign end-date check failed', err);
    }
}

module.exports = { archiveAndReset, checkEndDate };
