import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { query } from '../../../../../lib/db'
import { getActiveSeason } from '../../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

/**
 * Unlinked in-game players: stat rows in stats_game_players with NO Discord ID
 * (a captain skipped them, the bot couldn't match them, or an admin unlinked the
 * account). Their stats are NEVER lost — they live here until an admin links them
 * to a Discord ID (the stats-tools `link` action moves every matching game row to
 * that Discord user and recomputes). Grouped by (platform, platform_id, ingame_name)
 * with accumulated totals for the active season so the operator sees who they are.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()
  const activeSeason = await getActiveSeason()
  const seasonId = activeSeason?.id || null

  // Group the orphaned (NULL-discord) game rows. Keyed by platform+platform_id when
  // we have one (the durable identity), else by the in-game name. team_id/name come
  // from the most-recent row so the operator can see who they played for.
  const params = []
  let seasonWhere = ''
  if (seasonId) { params.push(seasonId); seasonWhere = `AND gp.season_id = $${params.length}` }

  const result = await query(`
    WITH orphan AS (
      SELECT
        gp.platform,
        gp.platform_id,
        gp.ingame_name,
        gp.team_id,
        gp.season_id,
        gp.goals, gp.assists, gp.saves, gp.shots, gp.score,
        gp.demos_inflicted, gp.demos_taken, gp.mvp,
        gp.created_at
      FROM stats_game_players gp
      WHERE gp.discord_id IS NULL
        ${seasonWhere}
    )
    SELECT
      COALESCE(o.platform, '') AS platform,
      COALESCE(o.platform_id, '') AS platform_id,
      -- the most-recently-seen in-game name for this identity
      (ARRAY_REMOVE(ARRAY_AGG(o.ingame_name ORDER BY o.created_at DESC), NULL))[1] AS ingame_name,
      (ARRAY_AGG(o.team_id ORDER BY o.created_at DESC))[1] AS team_id,
      COUNT(*)::int AS games,
      SUM(o.goals)::int AS goals,
      SUM(o.assists)::int AS assists,
      SUM(o.saves)::int AS saves,
      SUM(o.shots)::int AS shots,
      SUM(o.score)::int AS score,
      SUM(o.demos_inflicted)::int AS demos_inflicted,
      SUM(o.demos_taken)::int AS demos_taken,
      SUM(CASE WHEN o.mvp THEN 1 ELSE 0 END)::int AS mvps,
      MAX(o.created_at) AS last_seen
    FROM orphan o
    GROUP BY o.platform, o.platform_id
    ORDER BY games DESC, ingame_name ASC
  `, params)

  // Attach the team name (logos resolve from teamId on the client).
  const teamIds = [...new Set(result.rows.map((r) => r.team_id).filter((v) => v != null))]
  const teamNames = new Map()
  if (teamIds.length) {
    const t = await query(`SELECT id, name FROM teams WHERE id = ANY($1::int[])`, [teamIds]).catch(() => ({ rows: [] }))
    for (const row of t.rows) teamNames.set(row.id, row.name)
  }

  const unlinked = result.rows.map((r) => ({
    platform: r.platform || null,
    platformId: r.platform_id || null,
    ingameName: r.ingame_name || '(unknown)',
    teamId: r.team_id ?? null,
    teamName: r.team_id != null ? (teamNames.get(r.team_id) || null) : null,
    games: r.games,
    goals: r.goals,
    assists: r.assists,
    saves: r.saves,
    shots: r.shots,
    score: r.score,
    demosInflicted: r.demos_inflicted,
    demosTaken: r.demos_taken,
    mvps: r.mvps,
    lastSeen: r.last_seen,
  }))

  return NextResponse.json({ activeSeasonId: seasonId, count: unlinked.length, unlinked })
}
