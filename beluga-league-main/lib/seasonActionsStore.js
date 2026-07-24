import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

// Store for the director-gated season lifecycle queue (season_action_requests).
// The admin panel inserts a request; the bot posts the approval embed, collects 3
// Director ✅ reactions, then executes. The website only inserts + polls status.

function map(row) {
  if (!row) return null
  return {
    id: row.id,
    action: row.action,
    seasonId: row.season_id,
    payload: row.payload || {},
    initiatedByDiscordId: row.initiated_by_discord_id,
    initiatedByUsername: row.initiated_by_username,
    verifyString: row.verify_string,
    status: row.status,
    approvalChannelId: row.approval_channel_id,
    approvalMessageId: row.approval_message_id,
    approverIds: Array.isArray(row.approver_ids) ? row.approver_ids : [],
    declinedBy: row.declined_by,
    expiresAt: row.expires_at,
    result: row.result,
    createdAt: row.created_at,
    postedAt: row.posted_at,
    executedAt: row.executed_at,
  }
}

// A single request may be open at a time (avoids duplicate embeds / racing resets).
export async function getOpenSeasonActionRequest() {
  await ensureLeagueSchema()
  const r = await query(
    `SELECT * FROM season_action_requests
     WHERE status IN ('pending_post', 'awaiting_approval')
     ORDER BY id DESC LIMIT 1`
  )
  return r.rows.length ? map(r.rows[0]) : null
}

export async function createSeasonActionRequest({
  action, seasonId = null, payload = {},
  initiatedByDiscordId = null, initiatedByUsername = null, verifyString = null,
}) {
  await ensureLeagueSchema()
  const r = await query(
    `INSERT INTO season_action_requests
       (action, season_id, payload, initiated_by_discord_id, initiated_by_username, verify_string, status)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, 'pending_post')
     RETURNING *`,
    [action, seasonId, JSON.stringify(payload || {}), initiatedByDiscordId, initiatedByUsername, verifyString]
  )
  return map(r.rows[0])
}

export async function getSeasonActionRequest(id) {
  await ensureLeagueSchema()
  const r = await query('SELECT * FROM season_action_requests WHERE id = $1', [Number(id)])
  return r.rows.length ? map(r.rows[0]) : null
}
