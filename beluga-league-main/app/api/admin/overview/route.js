import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()
  const season = await getActiveSeason()

  const [
    seasonsCount,
    activeTeamsCount,
    franchisesCount,
    rosterCount,
    matchesCount,
    pendingMatchesCount,
    txCount,
    recentTx,
    recentMatches,
  ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM seasons`),
    season ? query(`SELECT COUNT(*)::int AS n FROM teams WHERE season_id = $1 AND is_active = TRUE`, [season.id]) : Promise.resolve({ rows: [{ n: 0 }] }),
    query(`SELECT COUNT(*)::int AS n FROM team_franchises WHERE is_active = TRUE`),
    season ? query(`SELECT COUNT(DISTINCT discord_id)::int AS n FROM team_roster_members WHERE season_id = $1 AND is_active = TRUE`, [season.id]) : Promise.resolve({ rows: [{ n: 0 }] }),
    season ? query(`SELECT COUNT(*)::int AS n FROM match_series WHERE season_id = $1`, [season.id]) : Promise.resolve({ rows: [{ n: 0 }] }),
    season ? query(`SELECT COUNT(*)::int AS n FROM match_series WHERE season_id = $1 AND status NOT IN ('completed','rejected','final')`, [season.id]) : Promise.resolve({ rows: [{ n: 0 }] }),
    query(`SELECT COUNT(*)::int AS n FROM transactions`),
    query(`
      SELECT t.id, t.type, t.discord_id, t.discord_username, t.display_name,
        t.team_name_snapshot, t.paired_team_name_snapshot, t.performed_at,
        s.season_number
      FROM transactions t
      LEFT JOIN seasons s ON s.id = t.season_id
      ORDER BY t.performed_at DESC, t.id DESC
      LIMIT 8
    `),
    season ? query(`
      SELECT ms.id, ms.division, ms.week, ms.home_score, ms.away_score, ms.status, ms.is_forfeit, ms.created_at,
        ht.name AS home_team, at.name AS away_team
      FROM match_series ms
      LEFT JOIN teams ht ON ht.id = ms.home_team_id
      LEFT JOIN teams at ON at.id = ms.away_team_id
      WHERE ms.season_id = $1
      ORDER BY ms.created_at DESC, ms.id DESC
      LIMIT 8
    `, [season.id]) : Promise.resolve({ rows: [] }),
  ])

  return NextResponse.json({
    season,
    counts: {
      seasons: seasonsCount.rows[0].n,
      activeTeams: activeTeamsCount.rows[0].n,
      franchises: franchisesCount.rows[0].n,
      roster: rosterCount.rows[0].n,
      matches: matchesCount.rows[0].n,
      pendingMatches: pendingMatchesCount.rows[0].n,
      transactions: txCount.rows[0].n,
    },
    recentTransactions: recentTx.rows.map((r) => ({
      id: r.id,
      type: r.type,
      discordId: r.discord_id,
      displayName: r.display_name || r.discord_username || r.discord_id,
      teamName: r.team_name_snapshot,
      pairedTeamName: r.paired_team_name_snapshot,
      seasonNumber: r.season_number,
      performedAt: r.performed_at,
    })),
    recentMatches: recentMatches.rows.map((r) => ({
      id: r.id,
      division: r.division,
      week: r.week,
      home: r.home_team,
      away: r.away_team,
      homeScore: r.home_score,
      awayScore: r.away_score,
      status: r.status,
      isForfeit: r.is_forfeit,
      createdAt: r.created_at,
    })),
  })
}
