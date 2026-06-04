import { NextResponse } from 'next/server'
import { query } from '../../../../lib/db'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { getSalaryMap } from '../../../../lib/salarySheet'
import { getGuildMemberCount } from '../../../../lib/discordMembers'

export const dynamic = 'force-dynamic'

/**
 * Public-facing snapshot of the league:
 *   - Active season (or null if none active)
 *   - Active teams grouped by division (excluding disabled franchises)
 *   - Past champions across all archived/completed seasons
 *   - Overview counters used by the home page stats strip
 */
export async function GET() {
  await ensureLeagueSchema()
  let season = await getActiveSeason()
  // If no season is flagged 'active', fall back to the latest real season so the
  // homepage still shows the correct Season # (and current teams) instead of "1".
  if (!season) {
    try {
      const r = await query(`
        SELECT * FROM seasons
        WHERE status <> 'draft'
        ORDER BY season_number DESC
        LIMIT 1
      `)
      if (r.rows.length) {
        const row = r.rows[0]
        season = {
          id: row.id,
          seasonNumber: row.season_number,
          name: row.name,
          status: row.status,
          year: row.year ?? null,
          statusLabel: row.status_label ?? null,
          startDate: row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : null,
          season_number: row.season_number,
        }
      }
    } catch { /* no seasons yet */ }
  }

  let teamsByDivision = { Majors: [], AAA: [], AA: [] }
  if (season) {
    const teamsRes = await query(`
      SELECT t.id, t.name, t.division, t.is_active, t.roster_limit,
        t.franchise_id, f.is_active AS franchise_active,
        (t.logo_data IS NOT NULL) AS has_team_logo,
        (f.logo_data IS NOT NULL) AS has_franchise_logo
      FROM teams t
      LEFT JOIN team_franchises f ON f.id = t.franchise_id
      WHERE t.season_id = $1
        AND t.is_active = TRUE
        AND (f.is_active IS DISTINCT FROM FALSE)
      ORDER BY t.division, t.name
    `, [season.id])

    for (const row of teamsRes.rows) {
      if (!teamsByDivision[row.division]) teamsByDivision[row.division] = []
      teamsByDivision[row.division].push({
        id: row.id,
        name: row.name,
        division: row.division,
        hasLogo: !!(row.has_team_logo || row.has_franchise_logo),
        rosterLimit: row.roster_limit,
      })
    }
  }

  // Past champions: one row per (season, division). Group by season for the
  // homepage "past champions" carousel.
  const champRes = await query(`
    SELECT c.season_id, c.division, c.team_id, c.gm_display_name, c.gm_discord_id, c.notes,
      s.season_number, s.year, s.name AS season_name, s.status AS season_status,
      t.name AS team_name, f.name AS franchise_name,
      (t.logo_data IS NOT NULL OR f.logo_data IS NOT NULL) AS has_logo
    FROM season_champions c
    JOIN seasons s ON s.id = c.season_id
    LEFT JOIN teams t ON t.id = c.team_id
    LEFT JOIN team_franchises f ON f.id = c.franchise_id
    WHERE s.status <> 'draft'
    ORDER BY s.season_number DESC NULLS LAST, c.division
  `).catch(() => ({ rows: [] }))

  const championsBySeason = {}
  for (const row of champRes.rows) {
    const key = row.season_number
    if (!championsBySeason[key]) {
      championsBySeason[key] = {
        seasonId: row.season_id,
        seasonNumber: row.season_number,
        year: row.year,
        seasonName: row.season_name,
        seasonStatus: row.season_status,
        byDivision: {},
      }
    }
    championsBySeason[key].byDivision[row.division] = {
      teamId: row.team_id,
      teamName: row.team_name || row.franchise_name,
      franchiseName: row.franchise_name,
      gmDisplayName: row.gm_display_name,
      gmDiscordId: row.gm_discord_id,
      notes: row.notes,
      hasLogo: !!row.has_logo,
    }
  }
  const pastChampions = Object.values(championsBySeason)

  // Counters (used by the homepage stats strip).
  const [seasonsCt, franchisesCt, playersCt] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM seasons WHERE status <> 'draft'`),
    query(`SELECT COUNT(*)::int AS n FROM team_franchises WHERE is_active = TRUE`),
    query(`SELECT COUNT(DISTINCT discord_id)::int AS n FROM team_roster_members`),
  ])

  // Active players = EXACT count of everyone with roster, transaction, or match
  // history, OR present in the salary sheet. Distinct Discord IDs across all
  // those sources (the salary sheet is unioned in JS since it lives in Sheets).
  const activeIds = new Set()
  try {
    const r = await query(`
      SELECT DISTINCT id FROM (
        SELECT discord_id AS id FROM team_roster_members
        UNION SELECT discord_id FROM transactions
        UNION SELECT discord_id FROM manual_salaries
        UNION SELECT platform_id FROM match_replay_players WHERE platform_id IS NOT NULL
      ) u
      WHERE id IS NOT NULL
    `)
    for (const row of r.rows) activeIds.add(String(row.id))
  } catch { /* tables may be empty */ }
  try {
    const salaryMap = await getSalaryMap()
    for (const id of salaryMap.keys()) activeIds.add(String(id))
  } catch { /* sheet optional */ }
  const activePlayers = activeIds.size

  // Exact count of real (non-bot) members currently in the Discord (null if the
  // bot hasn't done its first member pull yet).
  const discordMemberCount = await getGuildMemberCount().catch(() => null)

  // Distinct franchise/team names across divisions (one franchise counts once).
  const distinctNames = new Set()
  for (const arr of Object.values(teamsByDivision)) {
    for (const t of arr) distinctNames.add((t.name || '').toLowerCase())
  }
  const totalTeams = distinctNames.size

  return NextResponse.json({
    season,
    teamsByDivision,
    totals: {
      teams: totalTeams,
      seasons: seasonsCt.rows[0].n,
      franchises: franchisesCt.rows[0].n,
      players: playersCt.rows[0].n,
      activePlayers,
      discordMemberCount,
      divisions: Object.keys(teamsByDivision).filter((d) => teamsByDivision[d].length > 0).length,
    },
    pastChampions,
  })
}
