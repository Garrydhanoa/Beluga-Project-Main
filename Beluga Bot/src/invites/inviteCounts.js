/**
 * Invite counts + leaderboards.
 *
 * THE COUNTING RULE — mirrored in beluga-league-main/lib/inviteStore.js
 * (`countsSql`). Keep the two byte-identical in behaviour.
 *
 *   counted invitee = invites.status = 'counted' AND in_guild (registered + still here)
 *   campaign        = counted invitees credited to that campaign + campaign/both adjustments made in it
 *   lifetime        = every counted invitee                   + lifetime/both adjustments
 *
 * Inviters who are not in the server are hidden from leaderboards (data kept).
 * Ties: whoever reached the count first ranks higher.
 */

const { pool } = require('../utils/database');
const { db, getActiveCampaign } = require('./inviteSchema');

/** @param {'campaign'|'lifetime'} scope — campaign needs $1 = campaign id */
function countsSql(scope) {
    const campaign = scope === 'campaign';
    return `
        WITH c AS (
            SELECT inviter_id AS id, COUNT(*)::int AS n, MAX(counted_at) AS last_at
              FROM invites
             WHERE status = 'counted' AND in_guild AND inviter_id IS NOT NULL
               ${campaign ? 'AND credited_campaign_id = $1' : ''}
             GROUP BY inviter_id
        ), a AS (
            SELECT inviter_id AS id, SUM(delta)::int AS n, MAX(created_at) AS last_at
              FROM invite_adjustments
             WHERE ${campaign ? `scope IN ('both','campaign') AND campaign_id = $1` : `scope IN ('both','lifetime')`}
             GROUP BY inviter_id
        ), t AS (
            SELECT COALESCE(c.id, a.id) AS id,
                   COALESCE(c.n, 0) + COALESCE(a.n, 0) AS total,
                   GREATEST(c.last_at, a.last_at) AS last_at
              FROM c FULL OUTER JOIN a ON a.id = c.id
        )
        SELECT t.id, t.total, t.last_at
          FROM t
          LEFT JOIN discord_members dm ON dm.discord_id = t.id
         WHERE t.total > 0 AND COALESCE(dm.is_in_guild, TRUE) AND COALESCE(dm.is_bot, FALSE) = FALSE
         ORDER BY t.total DESC, t.last_at ASC NULLS LAST, t.id ASC`;
}

async function rankedRows(scope, campaignId = null) {
    if (!db()) return [];
    if (scope === 'campaign' && !campaignId) return [];
    const { rows } = await pool.query(countsSql(scope), scope === 'campaign' ? [campaignId] : []);
    return rows.map((r, i) => ({ id: String(r.id), total: Number(r.total), lastAt: r.last_at, rank: i + 1 }));
}

async function lastResetAt() {
    if (!db()) return null;
    const { rows } = await pool.query(
        `SELECT ended_at FROM invite_campaigns WHERE status = 'ended' AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`
    );
    return rows[0]?.ended_at || null;
}

/** One page of a leaderboard. */
async function leaderboardPage(scope, page = 0, perPage = 10) {
    const campaign = await getActiveCampaign();
    const rows = await rankedRows(scope, campaign?.id);
    const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
    const p = Math.min(Math.max(0, page), pageCount - 1);
    return {
        scope,
        campaign,
        lastReset: await lastResetAt(),
        page: p,
        pageCount,
        totalInviters: rows.length,
        rows: rows.slice(p * perPage, p * perPage + perPage),
    };
}

/** Everything /invites and the leaderboard "view a person" dropdown show. */
async function personStats(discordId) {
    const id = String(discordId);
    const campaign = await getActiveCampaign();
    const [campRows, lifeRows, lastReset] = await Promise.all([
        rankedRows('campaign', campaign?.id),
        rankedRows('lifetime'),
        lastResetAt(),
    ]);
    const camp = campRows.find((r) => r.id === id);
    const life = lifeRows.find((r) => r.id === id);

    let pending = 0;
    let invitees = [];
    let invitedBy = null;
    if (db()) {
        const [p, c, list, by] = await Promise.all([
            pool.query(`SELECT COUNT(*)::int AS n FROM invites WHERE inviter_id = $1 AND status = 'pending_review' AND in_guild`, [id]),
            pool.query(`SELECT COUNT(*)::int AS n FROM invite_claims WHERE claimer_id = $1 AND status = 'pending'`, [id]),
            pool.query(
                `SELECT invitee_id, credited_campaign_id, counted_at FROM invites
                  WHERE inviter_id = $1 AND status = 'counted' AND in_guild
                  ORDER BY counted_at DESC NULLS LAST LIMIT 15`,
                [id]
            ),
            pool.query(`SELECT inviter_id FROM invites WHERE invitee_id = $1 AND status = 'counted'`, [id]),
        ]);
        pending = (p.rows[0]?.n || 0) + (c.rows[0]?.n || 0);
        invitees = list.rows.map((r) => ({
            id: String(r.invitee_id),
            thisCampaign: !!campaign && r.credited_campaign_id === campaign.id,
            countedAt: r.counted_at,
        }));
        invitedBy = by.rows[0]?.inviter_id || null;
    }

    return {
        id,
        campaign,
        lastReset,
        campaignTotal: camp?.total || 0,
        campaignRank: camp?.rank || null,
        lifetimeTotal: life?.total || 0,
        lifetimeRank: life?.rank || null,
        pending,
        invitees,
        invitedBy,
    };
}

module.exports = { countsSql, rankedRows, leaderboardPage, personStats, lastResetAt };
