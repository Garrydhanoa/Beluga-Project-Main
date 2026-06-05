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
    txCount,
    recentTx,
  ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM seasons`),
    season ? query(`SELECT COUNT(*)::int AS n FROM teams WHERE season_id = $1 AND is_active = TRUE`, [season.id]) : Promise.resolve({ rows: [{ n: 0 }] }),
    query(`SELECT COUNT(*)::int AS n FROM team_franchises WHERE is_active = TRUE`),
    season ? query(`SELECT COUNT(DISTINCT discord_id)::int AS n FROM team_roster_members WHERE season_id = $1 AND is_active = TRUE`, [season.id]) : Promise.resolve({ rows: [{ n: 0 }] }),
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
  ])

  return NextResponse.json({
    season,
    counts: {
      seasons: seasonsCount.rows[0].n,
      activeTeams: activeTeamsCount.rows[0].n,
      franchises: franchisesCount.rows[0].n,
      roster: rosterCount.rows[0].n,
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
  })
}
