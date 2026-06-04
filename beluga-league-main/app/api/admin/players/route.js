import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { getMemberMap } from '../../../../lib/discordMembers'

export const dynamic = 'force-dynamic'

/**
 * Returns every Discord ID the league has ever touched, unioned from:
 *   - team_roster_members (current + historical rosters)
 *   - transactions (sign/drop/trade/IR/etc.)
 *   - manual_salaries (salary crew has registered a salary for them)
 *
 * Each player is labeled by current status:
 *   - "rostered"   — on an active-season team's roster right now
 *   - "free agent" — appeared in any of the above but NOT on the active-season roster
 *
 * Optional filters:
 *   - search: substring match on display name / username / discord id
 *   - status: 'rostered' | 'free_agent' | 'all'
 *   - division: only people currently rostered in this division
 */
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  const search = (searchParams.get('search') || '').trim().toLowerCase()
  const status = searchParams.get('status') || 'all'
  const division = searchParams.get('division') || null

  const activeSeason = await getActiveSeason()
  const activeSeasonId = activeSeason?.id || null

  // UNION across all three identity sources so anyone the league has touched shows up.
  // `last_seen` is the most recent timestamp from any source. Display name & username
  // pick from the most recent non-null occurrence.
  const result = await query(`
    WITH identities AS (
      -- Source 1: every roster appearance (current and historical)
      SELECT discord_id, discord_username, display_name, updated_at AS seen_at, 'roster' AS src
      FROM team_roster_members

      UNION ALL

      -- Source 2: every transaction log entry
      SELECT discord_id, discord_username, display_name, performed_at AS seen_at, 'tx' AS src
      FROM transactions

      UNION ALL

      -- Source 3: salary crew has registered a salary (bot's manual_salaries table)
      SELECT discord_id,
             username AS discord_username,
             username AS display_name,
             updated_at AS seen_at,
             'salary' AS src
      FROM manual_salaries
    ),
    summary AS (
      SELECT
        discord_id,
        MAX(seen_at) AS last_seen,
        -- prefer the most recent non-null display_name
        (ARRAY_REMOVE(ARRAY_AGG(display_name ORDER BY seen_at DESC), NULL))[1] AS display_name,
        (ARRAY_REMOVE(ARRAY_AGG(discord_username ORDER BY seen_at DESC), NULL))[1] AS discord_username,
        ARRAY_AGG(DISTINCT src) AS sources
      FROM identities
      GROUP BY discord_id
    ),
    season_count AS (
      SELECT discord_id, COUNT(DISTINCT season_id)::int AS seasons_played
      FROM team_roster_members
      GROUP BY discord_id
    ),
    franchise_count AS (
      SELECT rm.discord_id, COUNT(DISTINCT t.franchise_id)::int AS franchises_played
      FROM team_roster_members rm
      JOIN teams t ON t.id = rm.team_id
      GROUP BY rm.discord_id
    )
    SELECT
      s.discord_id,
      s.display_name,
      s.discord_username,
      s.last_seen,
      s.sources,
      COALESCE(sc.seasons_played, 0) AS seasons_played,
      COALESCE(fc.franchises_played, 0) AS franchises_played
    FROM summary s
    LEFT JOIN season_count sc ON sc.discord_id = s.discord_id
    LEFT JOIN franchise_count fc ON fc.discord_id = s.discord_id
    ORDER BY s.last_seen DESC NULLS LAST
  `)

  // Look up current roster slot (if any) for each player.
  const currentByDiscord = new Map()
  if (activeSeasonId) {
    const cur = await query(`
      SELECT rm.discord_id, rm.role, rm.team_id, t.name AS team_name, t.division
      FROM team_roster_members rm
      JOIN teams t ON t.id = rm.team_id
      WHERE rm.season_id = $1 AND rm.is_active = TRUE AND t.is_active = TRUE
    `, [activeSeasonId])
    for (const row of cur.rows) {
      currentByDiscord.set(row.discord_id, {
        teamId: row.team_id,
        teamName: row.team_name,
        division: row.division,
        role: row.role,
      })
    }
  }

  // Discord identity (names + avatars) — authoritative name source.
  const memberMap = await getMemberMap().catch(() => new Map())

  let players = result.rows.map((r) => {
    const current = currentByDiscord.get(r.discord_id) || null
    const member = memberMap.get(String(r.discord_id)) || null
    return {
      discordId: r.discord_id,
      discordUsername: member?.username || r.discord_username,
      displayName: member?.displayName || r.display_name || r.discord_username || `User ${String(r.discord_id).slice(-4)}`,
      avatarUrl: member?.avatarUrl || null,
      inGuild: member?.isInGuild ?? null,
      seasonsPlayed: Number(r.seasons_played) || 0,
      franchisesPlayed: Number(r.franchises_played) || 0,
      lastSeen: r.last_seen,
      sources: r.sources || [],
      current,
      statusLabel: current ? 'rostered' : 'free_agent',
    }
  })

  if (search) {
    players = players.filter((p) =>
      (p.displayName || '').toLowerCase().includes(search) ||
      (p.discordUsername || '').toLowerCase().includes(search) ||
      (p.discordId || '').includes(search)
    )
  }
  if (status === 'rostered') players = players.filter((p) => p.current)
  if (status === 'free_agent') players = players.filter((p) => !p.current)
  if (division && division !== 'all') players = players.filter((p) => p.current?.division === division)

  return NextResponse.json({
    activeSeasonId,
    total: players.length,
    players: players.slice(0, 1000),
  })
}
