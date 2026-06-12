import { NextResponse } from 'next/server'
import { query } from '../../../lib/db'
import { ensureLeagueSchema } from '../../../lib/leagueSchema'
import { getActiveSeason } from '../../../lib/leagueStore'
import { getSalaryMap } from '../../../lib/salarySheet'
import { getMemberMap } from '../../../lib/discordMembers'

export const dynamic = 'force-dynamic'

/**
 * Public player directory — DB-only, no Google Sheets.
 *
 * Surface every Discord ID the league has ever touched, with current-season
 * roster slot (if any) folded in. Salary / eligibility / IR are intentionally
 * omitted for now per the project plan (will be reintroduced when the
 * website-side salary system lands).
 */
export async function GET() {
  await ensureLeagueSchema()
  const season = await getActiveSeason()
  const activeSeasonId = season?.id || null

  // Identities UNIONed across every place a player might appear in the DB.
  const idsRes = await query(`
    WITH identities AS (
      SELECT discord_id, discord_username, display_name, updated_at AS seen_at
      FROM team_roster_members
      UNION ALL
      SELECT discord_id, discord_username, display_name, performed_at AS seen_at
      FROM transactions
      UNION ALL
      SELECT discord_id, username AS discord_username, username AS display_name, updated_at AS seen_at
      FROM manual_salaries
    )
    SELECT discord_id,
      (ARRAY_REMOVE(ARRAY_AGG(display_name ORDER BY seen_at DESC), NULL))[1] AS display_name,
      (ARRAY_REMOVE(ARRAY_AGG(discord_username ORDER BY seen_at DESC), NULL))[1] AS discord_username,
      MAX(seen_at) AS last_seen,
      COUNT(*)::int AS source_rows
    FROM identities
    GROUP BY discord_id
    ORDER BY last_seen DESC NULLS LAST
  `)

  // Season stat chips (new stats system) for directory cards.
  const statsByDiscord = new Map()
  if (activeSeasonId) {
    const sr = await query(`
      SELECT discord_id, SUM(games)::int AS games, SUM(goals)::int AS goals,
        SUM(assists)::int AS assists, SUM(saves)::int AS saves, SUM(mvps)::int AS mvps
      FROM stats_player_season
      WHERE season_id = $1 AND is_playoff = FALSE
      GROUP BY discord_id
    `, [activeSeasonId]).catch(() => ({ rows: [] }))
    for (const row of sr.rows) {
      statsByDiscord.set(String(row.discord_id), {
        games: Number(row.games || 0), goals: Number(row.goals || 0),
        assists: Number(row.assists || 0), saves: Number(row.saves || 0), mvps: Number(row.mvps || 0),
      })
    }
  }

  // Current rosters for the active season (if any).
  const currentByDiscord = new Map()
  if (activeSeasonId) {
    const r = await query(`
      SELECT rm.discord_id, rm.role, t.id AS team_id, t.name AS team_name, t.division
      FROM team_roster_members rm
      JOIN teams t ON t.id = rm.team_id
      LEFT JOIN team_franchises f ON f.id = t.franchise_id
      WHERE rm.season_id = $1 AND rm.is_active = TRUE AND t.is_active = TRUE
        AND (f.is_active IS DISTINCT FROM FALSE)
    `, [activeSeasonId])
    for (const row of r.rows) {
      currentByDiscord.set(row.discord_id, {
        teamId: row.team_id,
        teamName: row.team_name,
        division: row.division,
        role: row.role,
      })
    }
  }

  // Salary + division enrichment from the league sheet (keyed by Discord ID).
  const salaryMap = await getSalaryMap().catch(() => new Map())
  // Discord identity (display name + avatar) — the single source of names.
  const memberMap = await getMemberMap().catch(() => new Map())

  const byId = new Map()

  // 1) Everyone the DB knows about (roster + transactions + manual_salaries).
  for (const row of idsRes.rows) {
    const current = currentByDiscord.get(row.discord_id) || null
    const sheet = salaryMap.get(String(row.discord_id)) || null
    const member = memberMap.get(String(row.discord_id)) || null
    byId.set(String(row.discord_id), {
      discordId: row.discord_id,
      displayName: member?.displayName || row.display_name || sheet?.displayName || sheet?.nickname || row.discord_username || `User ${String(row.discord_id).slice(-4)}`,
      discordUsername: member?.username || row.discord_username,
      avatarUrl: member?.avatarUrl || null,
      inGuild: member?.isInGuild ?? null,
      lastSeen: row.last_seen,
      currentTeam: current?.teamName || null,
      currentTeamId: current?.teamId || null,
      currentDivision: current?.division || sheet?.league || null,
      role: current?.role || null,
      isFreeAgent: !current,
      salary: sheet?.salary ?? null,
      eligible: sheet?.eligible ?? null,
      inSheet: !!sheet,
    })
  }

  // 2) Every member the salary sheet knows about (the registered-member list),
  //    even if they've never been rostered or had a transaction. This makes the
  //    directory the full member roster, matched to DB data where it exists.
  for (const [discordId, sheet] of salaryMap.entries()) {
    if (byId.has(String(discordId))) continue
    const current = currentByDiscord.get(discordId) || null
    const member = memberMap.get(String(discordId)) || null
    byId.set(String(discordId), {
      discordId,
      displayName: member?.displayName || sheet.displayName || sheet.nickname || `User ${String(discordId).slice(-4)}`,
      discordUsername: member?.username || null,
      avatarUrl: member?.avatarUrl || null,
      inGuild: member?.isInGuild ?? null,
      lastSeen: null,
      currentTeam: current?.teamName || sheet.sheetTeam || null,
      currentTeamId: current?.teamId || null,
      currentDivision: current?.division || sheet.league || null,
      role: current?.role || null,
      isFreeAgent: !current,
      salary: sheet.salary ?? null,
      eligible: sheet.eligible ?? null,
      inSheet: true,
    })
  }

  // Sort: sheet-present members first (by salary desc), then everyone else by name.
  const players = Array.from(byId.values()).sort((a, b) => {
    if (a.inSheet !== b.inSheet) return a.inSheet ? -1 : 1
    if (a.inSheet && b.inSheet) {
      const sa = a.salary ?? -1, sb = b.salary ?? -1
      if (sa !== sb) return sb - sa
    }
    return (a.displayName || '').localeCompare(b.displayName || '')
  })

  const playersWithStats = players.map((p) => ({ ...p, stats: statsByDiscord.get(String(p.discordId)) || null }))

  return NextResponse.json({
    players: playersWithStats,
    seasonId: activeSeasonId,
    season: season || null,
    fromCache: false,
  })
}
