import { query, getPool } from './db'
import { ensureLeagueSchema } from './leagueSchema'
import { getMemberMap } from './discordMembers'

const DIVISIONS = ['Majors', 'AAA', 'AA']
const ENTITY_TYPES = ['team', 'player']

/**
 * Power rankings are DB-backed, season-scoped, and admin-editable for BOTH teams
 * and players. No seeded/fake data — rows exist only when an admin creates them.
 */

/**
 * Read all rankings for a season, resolved with team names/logos and player
 * names/avatars, grouped by entity type + division.
 */
export async function getRankingsForSeason(seasonId) {
  await ensureLeagueSchema()
  if (!seasonId) return { team: emptyByDivision(), player: emptyByDivision() }

  const r = await query(`
    SELECT pr.id, pr.entity_type, pr.division, pr.rank, pr.team_id, pr.franchise_id,
      pr.player_discord_id, pr.label, pr.note, pr.trend,
      t.name AS team_name,
      (t.logo_data IS NOT NULL OR f.logo_data IS NOT NULL) AS has_logo,
      f.name AS franchise_name
    FROM power_rankings pr
    LEFT JOIN teams t ON t.id = pr.team_id
    LEFT JOIN team_franchises f ON f.id = COALESCE(pr.franchise_id, t.franchise_id)
    WHERE pr.season_id = $1
    ORDER BY pr.entity_type, pr.division, pr.rank
  `, [seasonId])

  const memberMap = await getMemberMap().catch(() => new Map())

  const out = { team: emptyByDivision(), player: emptyByDivision() }
  for (const row of r.rows) {
    const bucket = out[row.entity_type]
    if (!bucket || !bucket[row.division]) continue
    if (row.entity_type === 'player') {
      const m = memberMap.get(String(row.player_discord_id)) || null
      bucket[row.division].push({
        id: row.id,
        rank: row.rank,
        discordId: row.player_discord_id,
        name: m?.displayName || row.label || (row.player_discord_id ? `User ${String(row.player_discord_id).slice(-4)}` : 'Unknown'),
        avatarUrl: m?.avatarUrl || null,
        note: row.note || null,
        trend: row.trend || null,
      })
    } else {
      bucket[row.division].push({
        id: row.id,
        rank: row.rank,
        teamId: row.team_id,
        name: row.team_name || row.franchise_name || row.label || 'Unknown',
        hasLogo: !!row.has_logo,
        note: row.note || null,
        trend: row.trend || null,
      })
    }
  }
  return out
}

/**
 * Replace the ranking list for a single (season, entityType, division). Entries
 * are an ordered array; rank is assigned by position (1-based).
 */
export async function replaceRankings({ seasonId, entityType, division, entries, updatedByUsername = null }) {
  await ensureLeagueSchema()
  if (!ENTITY_TYPES.includes(entityType)) throw new Error('invalid entityType')
  if (!DIVISIONS.includes(division)) throw new Error('invalid division')

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM power_rankings WHERE season_id = $1 AND entity_type = $2 AND division = $3`,
      [seasonId, entityType, division]
    )
    let rank = 1
    for (const e of entries || []) {
      if (entityType === 'team') {
        const teamId = e.teamId != null ? Number(e.teamId) : null
        if (!teamId) continue
        await client.query(
          `INSERT INTO power_rankings (season_id, entity_type, division, rank, team_id, label, note, trend, updated_by_username, updated_at)
           VALUES ($1,'team',$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)`,
          [seasonId, division, rank, teamId, e.label || null, e.note || null, e.trend || null, updatedByUsername]
        )
      } else {
        const discordId = e.discordId ? String(e.discordId) : null
        if (!discordId) continue
        await client.query(
          `INSERT INTO power_rankings (season_id, entity_type, division, rank, player_discord_id, label, note, trend, updated_by_username, updated_at)
           VALUES ($1,'player',$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP)`,
          [seasonId, division, rank, discordId, e.label || null, e.note || null, e.trend || null, updatedByUsername]
        )
      }
      rank += 1
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return getRankingsForSeason(seasonId)
}

function emptyByDivision() {
  return { Majors: [], AAA: [], AA: [] }
}

export { DIVISIONS, ENTITY_TYPES }
