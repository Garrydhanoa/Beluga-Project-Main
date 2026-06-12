import { NextResponse } from 'next/server'
import { query } from '../../../../../lib/db'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { getActiveSeason } from '../../../../../lib/leagueStore'
import { getMemberMap } from '../../../../../lib/discordMembers'
import { getSalaryMap } from '../../../../../lib/salarySheet'
import { getTeamStatsBundle } from '../../../../../lib/belugaStats'

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
    SELECT t.id, t.name, t.division, t.roster_limit, t.franchise_id, t.slogan,
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
    const [rosterRes, schedRes, statsBundle] = await Promise.all([
      query(`
        SELECT discord_id, discord_username, display_name, role
        FROM team_roster_members
        WHERE team_id = $1 AND season_id = $2 AND is_active = TRUE
        ORDER BY (role = 'gm') DESC, (role = 'captain') DESC, display_name
      `, [t.id, season.id]),
      query(`
        SELECT sm.id, sm.week, sm.home_team_id, sm.away_team_id,
          ht.name AS home, at.name AS away
        FROM schedule_matches sm
        LEFT JOIN teams ht ON ht.id = sm.home_team_id
        LEFT JOIN teams at ON at.id = sm.away_team_id
        WHERE sm.season_id = $1 AND (sm.home_team_id = $2 OR sm.away_team_id = $2)
          AND sm.is_published = TRUE
        ORDER BY sm.week, sm.id
      `, [season.id, t.id]),
      getTeamStatsBundle(season.id, t.id),
    ])

    // Confirmed series results by week (fills schedule scores + the results list).
    const seriesByWeek = new Map()
    for (const s of statsBundle.series) {
      if (s.week != null && !seriesByWeek.has(s.week)) seriesByWeek.set(s.week, s)
    }

    const rec = statsBundle.record
    const capValue = onfieldCaps[t.division]
    byDivision[t.division] = {
      teamId: t.id,
      name: t.name,
      division: t.division,
      rosterLimit: t.roster_limit,
      hasLogo: !!t.has_logo,
      slogan: t.slogan || null,
      onfieldCap: typeof capValue === 'number' ? capValue : (capValue != null && capValue !== '' ? Number(capValue) : null),
      record: {
        wins: Number(rec?.wins || 0),
        losses: Number(rec?.losses || 0),
        gameWins: Number(rec?.gameWins || 0),
        gameLosses: Number(rec?.gameLosses || 0),
        goalsFor: Number(rec?.goalsFor || 0),
        goalsAgainst: Number(rec?.goalsAgainst || 0),
      },
      teamStats: rec
        ? {
            gamesPlayed: rec.gamesPlayed,
            belugaScore: rec.belugaScore,
          }
        : null,
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
      schedule: schedRes.rows.map((r) => {
        const s = seriesByWeek.get(r.week) || null
        const isHome = r.home_team_id === t.id
        return {
          id: r.id,
          week: r.week,
          home: r.home,
          away: r.away,
          isHome,
          homeScore: s ? (isHome ? s.ourScore : s.theirScore) : null,
          awayScore: s ? (isHome ? s.theirScore : s.ourScore) : null,
          status: s ? 'confirmed' : null,
        }
      }),
      playerStats: statsBundle.playerStats.map((p) => {
        const m = memberMap.get(p.discordId) || null
        return {
          ...p,
          playerName: m?.displayName || p.playerName,
        }
      }),
      // Every confirmed series (won/lost + Ballchasing group link) — rendered at
      // the bottom of the team page per the spec.
      results: statsBundle.series,
      // Roster-move history for this division team (same shape as player pages).
      transactions: (await query(`
        SELECT tx.id, tx.type, tx.display_name, tx.discord_username, tx.discord_id, tx.performed_at
        FROM transactions tx
        WHERE tx.team_id = $1
        ORDER BY tx.performed_at DESC, tx.id DESC
        LIMIT 50
      `, [t.id]).catch(() => ({ rows: [] }))).rows.map((r) => ({
        id: r.id,
        type: r.type,
        playerName: r.display_name || r.discord_username || `User ${String(r.discord_id).slice(-4)}`,
        discordId: r.discord_id,
        performedAt: r.performed_at,
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
