import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

export const TRANSACTION_TYPES = Object.freeze({
  SIGN: 'sign',
  DROP: 'drop',
  RELEASE: 'release',
  TRADE_IN: 'trade_in',
  TRADE_OUT: 'trade_out',
  IR_PLACE: 'ir_place',
  IR_RETURN: 'ir_return',
  SUSPEND: 'suspend',
  REINSTATE: 'reinstate',
  RFA: 'rfa',
  ROLE_CHANGE: 'role_change',
  RENAME: 'rename',
  GM_ASSIGN: 'gm_assign',
  GM_REMOVE: 'gm_remove',
  CAPTAIN_ASSIGN: 'captain_assign',
  CAPTAIN_REMOVE: 'captain_remove',
  ESUB: 'esub',
  OTHER: 'other',
})

function map(row) {
  if (!row) return null
  return {
    id: row.id,
    seasonId: row.season_id,
    seasonNumber: row.season_number ?? null,
    discordId: row.discord_id,
    // Names: prefer the snapshot stored at log time, then fall back to the live
    // discord_members directory (so historical rows logged before name-stamping,
    // or rows from a caller that didn't pass a name, still show a real name).
    discordUsername: row.discord_username ?? row.member_username ?? null,
    displayName: row.display_name ?? row.member_display_name ?? row.member_username ?? null,
    teamId: row.team_id,
    teamName: row.team_name ?? row.team_name_snapshot,
    teamNameSnapshot: row.team_name_snapshot,
    franchiseId: row.franchise_id,
    franchiseName: row.franchise_name ?? null,
    pairedTeamId: row.paired_team_id,
    pairedTeamName: row.paired_team_name ?? row.paired_team_name_snapshot,
    pairedTeamNameSnapshot: row.paired_team_name_snapshot,
    type: row.type,
    details: row.details || {},
    performedByDiscordId: row.performed_by_discord_id,
    performedByUsername: row.performed_by_username,
    source: row.source,
    performedAt: row.performed_at,
  }
}

const SELECT_BASE = `
  SELECT t.*,
    s.season_number,
    tm.name AS team_name,
    pt.name AS paired_team_name,
    f.name AS franchise_name,
    dm.username AS member_username,
    dm.display_name AS member_display_name
  FROM transactions t
  LEFT JOIN seasons s ON s.id = t.season_id
  LEFT JOIN teams tm ON tm.id = t.team_id
  LEFT JOIN teams pt ON pt.id = t.paired_team_id
  LEFT JOIN team_franchises f ON f.id = t.franchise_id
  LEFT JOIN discord_members dm ON dm.discord_id = t.discord_id
`

export async function logTransaction(input) {
  await ensureLeagueSchema()
  const {
    seasonId = null,
    discordId,
    discordUsername = null,
    displayName = null,
    teamId = null,
    teamNameSnapshot = null,
    franchiseId = null,
    pairedTeamId = null,
    pairedTeamNameSnapshot = null,
    type,
    details = {},
    performedByDiscordId = null,
    performedByUsername = null,
    source = null,
  } = input

  if (!discordId) throw new Error('logTransaction: discordId required')
  if (!type) throw new Error('logTransaction: type required')

  // Always stamp a human-readable name so the admin Transactions list never shows
  // a bare Discord ID. Fall back to the bot-populated discord_members directory
  // when the caller didn't pass a name (the source of names site-wide).
  let resolvedDisplayName = displayName
  let resolvedUsername = discordUsername
  if (!resolvedDisplayName || !resolvedUsername) {
    const m = await query(
      'SELECT display_name, username FROM discord_members WHERE discord_id = $1',
      [String(discordId)]
    ).catch(() => ({ rows: [] }))
    if (m.rows.length) {
      if (!resolvedDisplayName) resolvedDisplayName = m.rows[0].display_name || m.rows[0].username || null
      if (!resolvedUsername) resolvedUsername = m.rows[0].username || null
    }
  }

  let resolvedTeamSnapshot = teamNameSnapshot
  if (teamId && !resolvedTeamSnapshot) {
    const r = await query('SELECT name FROM teams WHERE id = $1', [teamId])
    if (r.rows.length) resolvedTeamSnapshot = r.rows[0].name
  }
  let resolvedPairedSnapshot = pairedTeamNameSnapshot
  if (pairedTeamId && !resolvedPairedSnapshot) {
    const r = await query('SELECT name FROM teams WHERE id = $1', [pairedTeamId])
    if (r.rows.length) resolvedPairedSnapshot = r.rows[0].name
  }
  let resolvedFranchiseId = franchiseId
  if (teamId && !resolvedFranchiseId) {
    const r = await query('SELECT franchise_id FROM teams WHERE id = $1', [teamId])
    if (r.rows.length) resolvedFranchiseId = r.rows[0].franchise_id
  }

  const result = await query(`
    INSERT INTO transactions (
      season_id, discord_id, discord_username, display_name,
      team_id, team_name_snapshot, franchise_id,
      paired_team_id, paired_team_name_snapshot,
      type, details, performed_by_discord_id, performed_by_username, source
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
    RETURNING *
  `, [
    seasonId, String(discordId), resolvedUsername, resolvedDisplayName,
    teamId, resolvedTeamSnapshot, resolvedFranchiseId,
    pairedTeamId, resolvedPairedSnapshot,
    type, JSON.stringify(details || {}), performedByDiscordId, performedByUsername, source,
  ])
  return map(result.rows[0])
}

export async function listTransactions({ discordId = null, teamId = null, franchiseId = null, seasonId = null, limit = 100, offset = 0 } = {}) {
  await ensureLeagueSchema()
  const conds = []
  const params = []
  if (discordId) { params.push(String(discordId)); conds.push(`t.discord_id = $${params.length}`) }
  if (teamId) { params.push(teamId); conds.push(`(t.team_id = $${params.length} OR t.paired_team_id = $${params.length})`) }
  if (franchiseId) { params.push(franchiseId); conds.push(`t.franchise_id = $${params.length}`) }
  if (seasonId) { params.push(seasonId); conds.push(`t.season_id = $${params.length}`) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500))
  params.push(Math.max(Number(offset) || 0, 0))
  const result = await query(`
    ${SELECT_BASE}
    ${where}
    ORDER BY t.performed_at DESC, t.id DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params)
  return result.rows.map(map)
}

export async function getTransaction(id) {
  await ensureLeagueSchema()
  const r = await query(`${SELECT_BASE} WHERE t.id = $1 LIMIT 1`, [id])
  return r.rows.length ? map(r.rows[0]) : null
}

export async function deleteTransaction(id) {
  await ensureLeagueSchema()
  await query('DELETE FROM transactions WHERE id = $1', [id])
}
