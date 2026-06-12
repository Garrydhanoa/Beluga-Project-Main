import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

// Hall of Fame: franchises + players with the most championships (all-time),
// derived from season_champions × team rosters at the time.
export async function GET() {
  await ensureLeagueSchema()

  const [franchises, players] = await Promise.all([
    query(`
      SELECT COALESCE(f.name, t.name) AS name, COUNT(*)::int AS titles,
        ARRAY_AGG('S' || s.season_number || ' ' || sc.division ORDER BY s.season_number) AS title_list
      FROM season_champions sc
      JOIN teams t ON t.id = sc.team_id
      LEFT JOIN team_franchises f ON f.id = t.franchise_id
      LEFT JOIN seasons s ON s.id = sc.season_id
      GROUP BY COALESCE(f.name, t.name)
      ORDER BY COUNT(*) DESC, COALESCE(f.name, t.name)
      LIMIT 5
    `).catch(() => ({ rows: [] })),
    query(`
      SELECT rm.discord_id, COUNT(DISTINCT sc.id)::int AS titles,
        (ARRAY_AGG(COALESCE(m.display_name, rm.display_name, rm.discord_username)))[1] AS name
      FROM season_champions sc
      JOIN team_roster_members rm ON rm.team_id = sc.team_id AND rm.season_id = sc.season_id
      LEFT JOIN discord_members m ON m.discord_id = rm.discord_id
      GROUP BY rm.discord_id
      ORDER BY COUNT(DISTINCT sc.id) DESC
      LIMIT 5
    `).catch(() => ({ rows: [] })),
  ])

  return NextResponse.json({
    franchises: franchises.rows.map((r, i) => ({ rank: i + 1, name: r.name, titles: r.titles, titleList: r.title_list || [] })),
    players: players.rows.map((r, i) => ({ rank: i + 1, discordId: r.discord_id, name: r.name || `User ${String(r.discord_id).slice(-4)}`, titles: r.titles })),
  })
}
