import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { getMemberMap } from '../../../../lib/discordMembers'
import { getSalaryMap } from '../../../../lib/salarySheet'
import { pickPrimaryRoster, primaryDivision } from '../../../../lib/primaryDivision'

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
  //
  // A GM is rostered on ALL THREE of their franchise's teams, so rows are
  // collected per player and then resolved to one. The previous `Map.set` in a
  // loop over an unordered query kept whichever row came back last, which also
  // mis-filed GMs under the `division` filter below.
  const currentByDiscord = new Map()
  if (activeSeasonId) {
    const cur = await query(`
      SELECT rm.discord_id, rm.role, rm.team_id, t.name AS team_name, t.division
      FROM team_roster_members rm
      JOIN teams t ON t.id = rm.team_id
      WHERE rm.season_id = $1 AND rm.is_active = TRUE AND t.is_active = TRUE
    `, [activeSeasonId])

    const statsDivisionByDiscord = new Map()
    const sd = await query(`
      SELECT discord_id, division FROM stats_player_season
      WHERE season_id = $1 AND is_playoff = FALSE
    `, [activeSeasonId]).catch(() => ({ rows: [] }))
    for (const row of sd.rows) statsDivisionByDiscord.set(String(row.discord_id), row.division)

    const sheetMap = await getSalaryMap().catch(() => new Map())
    const rowsByDiscord = new Map()
    for (const row of cur.rows) {
      if (!rowsByDiscord.has(row.discord_id)) rowsByDiscord.set(row.discord_id, [])
      rowsByDiscord.get(row.discord_id).push({
        teamId: row.team_id,
        teamName: row.team_name,
        division: row.division,
        role: row.role,
      })
    }
    for (const [discordId, rows] of rowsByDiscord.entries()) {
      const signals = {
        sheetLeague: sheetMap.get(String(discordId))?.league || null,
        statsDivision: statsDivisionByDiscord.get(String(discordId)) || null,
      }
      const picked = pickPrimaryRoster(rows, signals)
      if (!picked) continue
      // Team pick is always deterministic; the DIVISION can be genuinely unknown
      // for a staff GM who has never played. Keep them distinct so the division
      // filter doesn't file them somewhere arbitrary.
      currentByDiscord.set(discordId, {
        ...picked,
        division: primaryDivision({ ...signals, rosterRows: rows }),
        resolvedDivision: primaryDivision({ ...signals, rosterRows: rows }),
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

  // Fold in EVERY salary-sheet member (the registered-member list), even if they
  // never appear in the DB sources above — so the admin directory matches the
  // public player directory's full ~1200, not just the DB-touched subset.
  const seen = new Set(players.map((p) => String(p.discordId)))
  try {
    const salaryMap = await getSalaryMap()
    for (const [discordId, sheet] of salaryMap.entries()) {
      const id = String(discordId)
      if (seen.has(id)) continue
      seen.add(id)
      const member = memberMap.get(id) || null
      const current = currentByDiscord.get(id) || null
      players.push({
        discordId: id,
        discordUsername: member?.username || null,
        displayName: member?.displayName || sheet.displayName || sheet.nickname || `User ${id.slice(-4)}`,
        avatarUrl: member?.avatarUrl || null,
        inGuild: member?.isInGuild ?? null,
        seasonsPlayed: 0,
        franchisesPlayed: 0,
        lastSeen: null,
        sources: ['sheet'],
        current,
        statusLabel: current ? 'rostered' : 'free_agent',
      })
    }
  } catch { /* sheet optional — DB union still returns the bulk of players */ }

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

  // Raised from 1000: the full directory is ~1200, and the public page returns all.
  return NextResponse.json({
    activeSeasonId,
    total: players.length,
    players: players.slice(0, 2000),
  })
}
