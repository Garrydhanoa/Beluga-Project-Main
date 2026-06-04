import { NextResponse } from 'next/server'
import { query } from '../../../../../lib/db'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { getActiveSeason } from '../../../../../lib/leagueStore'
import { getMemberMap } from '../../../../../lib/discordMembers'
import { getSalaryMap } from '../../../../../lib/salarySheet'

export const dynamic = 'force-dynamic'

const DIV_ORDER = { Majors: 0, AAA: 1, AA: 2 }

export async function GET(_request, { params }) {
  await ensureLeagueSchema()
  const { name } = await params
  const teamName = decodeURIComponent(name || '').trim()
  if (!teamName) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const season = await getActiveSeason()
  if (!season) return NextResponse.json({ season: null, name: teamName, divisions: [], byDivision: {} })

  // Find every active-season team row matching this name (one per division it plays in),
  // honoring the franchise active flag.
  const teamsRes = await query(`
    SELECT t.id, t.name, t.division, t.roster_limit, t.franchise_id,
      (t.logo_data IS NOT NULL OR f.logo_data IS NOT NULL) AS has_logo
    FROM teams t
    LEFT JOIN team_franchises f ON f.id = t.franchise_id
    WHERE t.season_id = $1 AND LOWER(t.name) = LOWER($2)
      AND t.is_active = TRUE
      AND (f.is_active IS DISTINCT FROM FALSE)
    ORDER BY t.division
  `, [season.id, teamName])

  if (!teamsRes.rows.length) {
    return NextResponse.json({ season, name: teamName, divisions: [], byDivision: {} })
  }

  // Discord identity (names + avatars) for everyone on the roster.
  const memberMap = await getMemberMap().catch(() => new Map())
  // Salary sheet (per-player salaries) + per-division on-field caps for the
  // roster page's 3v3 on-field combination calculator.
  const salaryMap = await getSalaryMap().catch(() => new Map())
  let onfieldCaps = {}
  try {
    const capRes = await query('SELECT onfield_caps FROM season_config WHERE season_id = $1', [season.id])
    onfieldCaps = capRes.rows[0]?.onfield_caps || {}
  } catch { /* column may not exist yet */ }

  const byDivision = {}
  for (const t of teamsRes.rows) {
    const [rosterRes, recordRes, schedRes, statsRes] = await Promise.all([
      query(`
        SELECT discord_id, discord_username, display_name, role
        FROM team_roster_members
        WHERE team_id = $1 AND season_id = $2 AND is_active = TRUE
        ORDER BY (role = 'gm') DESC, (role = 'captain') DESC, display_name
      `, [t.id, season.id]),
      query(`SELECT * FROM team_records WHERE team_id = $1 AND season_id = $2 LIMIT 1`, [t.id, season.id]),
      query(`
        SELECT sm.id, sm.week, sm.home_team_id, sm.away_team_id,
          ht.name AS home, at.name AS away,
          ms.home_score, ms.away_score, ms.status AS series_status
        FROM schedule_matches sm
        LEFT JOIN teams ht ON ht.id = sm.home_team_id
        LEFT JOIN teams at ON at.id = sm.away_team_id
        LEFT JOIN match_series ms ON ms.schedule_match_id = sm.id
        WHERE sm.season_id = $1 AND (sm.home_team_id = $2 OR sm.away_team_id = $2)
          AND sm.is_published = TRUE
        ORDER BY sm.week, sm.id
      `, [season.id, t.id]),
      query(`
        SELECT player_name, platform_id, games_played, goals, assists, saves, shots, score
        FROM player_records
        WHERE team_id = $1 AND season_id = $2
        ORDER BY score DESC
      `, [t.id, season.id]),
    ])

    const rec = recordRes.rows[0]
    const capValue = onfieldCaps[t.division]
    byDivision[t.division] = {
      teamId: t.id,
      name: t.name,
      division: t.division,
      rosterLimit: t.roster_limit,
      hasLogo: !!t.has_logo,
      onfieldCap: typeof capValue === 'number' ? capValue : (capValue != null && capValue !== '' ? Number(capValue) : null),
      record: {
        wins: Number(rec?.wins || 0),
        losses: Number(rec?.losses || 0),
        gameWins: Number(rec?.game_wins || 0),
        gameLosses: Number(rec?.game_losses || 0),
        goalsFor: Number(rec?.goals_for || 0),
        goalsAgainst: Number(rec?.goals_against || 0),
      },
      roster: rosterRes.rows.map((r) => {
        const m = memberMap.get(String(r.discord_id)) || null
        const sheet = salaryMap.get(String(r.discord_id)) || null
        return {
          discordId: r.discord_id,
          discordUsername: m?.username || r.discord_username,
          displayName: m?.displayName || r.display_name || r.discord_username || `User ${String(r.discord_id).slice(-4)}`,
          avatarUrl: m?.avatarUrl || null,
          role: r.role,
          salary: sheet?.salary ?? null,
        }
      }),
      schedule: schedRes.rows.map((r) => ({
        id: r.id,
        week: r.week,
        home: r.home,
        away: r.away,
        isHome: r.home_team_id === t.id,
        homeScore: r.home_score,
        awayScore: r.away_score,
        status: r.series_status,
      })),
      playerStats: statsRes.rows.map((r) => ({
        playerName: r.player_name,
        platformId: r.platform_id,
        gamesPlayed: Number(r.games_played || 0),
        goals: Number(r.goals || 0),
        assists: Number(r.assists || 0),
        saves: Number(r.saves || 0),
        shots: Number(r.shots || 0),
        score: Number(r.score || 0),
      })),
    }
  }

  const divisions = Object.keys(byDivision).sort((a, b) => (DIV_ORDER[a] ?? 9) - (DIV_ORDER[b] ?? 9))

  return NextResponse.json({
    season,
    name: teamsRes.rows[0].name,
    hasLogo: teamsRes.rows.some((t) => t.has_logo),
    divisions,
    byDivision,
  })
}
