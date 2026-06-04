import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const seasonsRes = await query(`SELECT id, season_number, name, status, created_at FROM seasons ORDER BY season_number DESC NULLS LAST`)
  const teamsRes = await query(`
    SELECT t.season_id, t.division, COUNT(*) FILTER (WHERE t.is_active = TRUE)::int AS active_count,
      COUNT(*)::int AS total_count
    FROM teams t
    GROUP BY t.season_id, t.division
    ORDER BY t.season_id DESC, t.division
  `)
  const teamRows = await query(`
    SELECT t.id, t.season_id, t.division, t.name, t.is_active, t.franchise_id,
      f.name AS franchise_name
    FROM teams t
    LEFT JOIN team_franchises f ON f.id = t.franchise_id
    ORDER BY t.season_id DESC, t.division, t.name
  `)
  const franchisesRes = await query(`SELECT id, name, default_division, is_active, created_at FROM team_franchises ORDER BY id`)
  const matchesRes = await query(`
    SELECT season_id, division, COUNT(*)::int AS count,
      SUM(CASE WHEN is_published THEN 1 ELSE 0 END)::int AS published_count
    FROM schedule_matches
    GROUP BY season_id, division
    ORDER BY season_id DESC, division
  `)
  const configRes = await query(`SELECT * FROM season_config ORDER BY season_id DESC`)
  const orphanedTeams = await query(`SELECT id, season_id, division, name FROM teams WHERE franchise_id IS NULL`)

  return NextResponse.json({
    seasons: seasonsRes.rows,
    teamCountsBySeasonDivision: teamsRes.rows,
    teams: teamRows.rows,
    franchises: franchisesRes.rows,
    matchCountsBySeasonDivision: matchesRes.rows,
    seasonConfig: configRes.rows,
    orphanedTeamsWithoutFranchise: orphanedTeams.rows,
  })
}
