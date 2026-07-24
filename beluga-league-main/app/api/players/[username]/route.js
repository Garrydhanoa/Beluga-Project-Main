import { NextResponse } from 'next/server'
import { query } from '../../../../lib/db'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { getSalaryMap } from '../../../../lib/salarySheet'
import { getMemberMap } from '../../../../lib/discordMembers'
import { getPlayerStatsBundle } from '../../../../lib/belugaStats'
import { getActiveSeason } from '../../../../lib/leagueStore'

export const dynamic = 'force-dynamic'

/**
 * Public player profile — DB-only.
 * Accepts EITHER a discord_id OR a display-name match (case-insensitive,
 * exact match against the most-recent display_name).
 */
export async function GET(_request, { params }) {
  await ensureLeagueSchema()
  const { username } = await params
  const lookup = decodeURIComponent(username || '').trim()
  if (!lookup) return NextResponse.json({ error: 'username required' }, { status: 400 })

  // Identity source: union of roster + transactions + manual_salaries so a
  // player who only ever appears in a transaction or salary row still resolves.
  const IDENTITIES_CTE = `
    WITH identities AS (
      SELECT discord_id, display_name, discord_username, updated_at AS seen_at
      FROM team_roster_members
      UNION ALL
      SELECT discord_id, display_name, discord_username, performed_at AS seen_at
      FROM transactions
      UNION ALL
      SELECT discord_id, username AS display_name, username AS discord_username, updated_at AS seen_at
      FROM manual_salaries
    ),
    summary AS (
      SELECT discord_id,
        (ARRAY_REMOVE(ARRAY_AGG(display_name ORDER BY seen_at DESC), NULL))[1] AS display_name,
        (ARRAY_REMOVE(ARRAY_AGG(discord_username ORDER BY seen_at DESC), NULL))[1] AS discord_username,
        MAX(seen_at) AS last_seen
      FROM identities GROUP BY discord_id
    )
  `

  // Step 1: Resolve to a discord_id.
  let discordId = null
  if (/^\d{16,20}$/.test(lookup)) {
    discordId = lookup
  } else {
    const r = await query(`
      ${IDENTITIES_CTE}
      SELECT discord_id FROM summary
      WHERE LOWER(display_name) = LOWER($1) OR LOWER(discord_username) = LOWER($1)
      LIMIT 1
    `, [lookup])
    discordId = r.rows[0]?.discord_id || null

    // Fall back to the Discord member directory (a player known to the guild but
    // not yet in roster/transaction/salary history still resolves by name).
    if (!discordId) {
      const m = await query(`
        SELECT discord_id FROM discord_members
        WHERE LOWER(display_name) = LOWER($1) OR LOWER(username) = LOWER($1)
        ORDER BY is_in_guild DESC
        LIMIT 1
      `, [lookup]).catch(() => ({ rows: [] }))
      discordId = m.rows[0]?.discord_id || null
    }
  }

  if (!discordId) return NextResponse.json({ player: null }, { status: 404 })

  // Step 2: Identity + most-recent display name.
  const idRow = await query(`
    ${IDENTITIES_CTE}
    SELECT discord_id, display_name, discord_username, last_seen
    FROM summary WHERE discord_id = $1
  `, [discordId])
  const identity = idRow.rows[0]

  // Step 3: Roster history.
  const rosterRes = await query(`
    SELECT rm.season_id, s.season_number, s.year, s.status AS season_status,
      rm.team_id, t.name AS team_name, t.division, t.is_active AS team_active,
      rm.role, rm.is_active AS roster_active
    FROM team_roster_members rm
    JOIN teams t ON t.id = rm.team_id
    LEFT JOIN seasons s ON s.id = rm.season_id
    WHERE rm.discord_id = $1
    ORDER BY s.season_number DESC NULLS LAST, t.division, rm.updated_at DESC
  `, [discordId])

  // Step 4: Per-season stats — new Ballchasing-based stats system (keyed by
  // discord id). Falls back to legacy player_records if the player has no new
  // stats yet.
  const belugaStats = await getPlayerStatsBundle(discordId)
  let legacyStats = { rows: [] }
  if (!belugaStats.seasons.length) {
    legacyStats = await query(`
      SELECT pr.id, pr.season_id, s.season_number, pr.division,
        pr.team_id, t.name AS team_name,
        pr.player_name, pr.platform, pr.platform_id,
        pr.games_played, pr.goals, pr.assists, pr.saves, pr.shots, pr.score
      FROM player_records pr
      LEFT JOIN seasons s ON s.id = pr.season_id
      LEFT JOIN teams t ON t.id = pr.team_id
      WHERE pr.platform_id = $1
      ORDER BY s.season_number DESC NULLS LAST
    `, [discordId]).catch(() => ({ rows: [] }))
  }

  // Transaction history for this player (public-safe fields only).
  const txRes = await query(`
    SELECT tx.id, tx.type, tx.team_name_snapshot, tx.paired_team_name_snapshot,
      tx.performed_at, s.season_number,
      t.name AS team_name_resolved, pt.name AS paired_team_name_resolved
    FROM transactions tx
    LEFT JOIN seasons s ON s.id = tx.season_id
    LEFT JOIN teams t ON t.id = tx.team_id
    LEFT JOIN teams pt ON pt.id = tx.paired_team_id
    WHERE tx.discord_id = $1
    ORDER BY tx.performed_at DESC, tx.id DESC
    LIMIT 100
  `, [discordId]).catch(() => ({ rows: [] }))

  // Salary + division from the league sheet.
  const salaryMap = await getSalaryMap().catch(() => new Map())
  const sheet = salaryMap.get(String(discordId)) || null
  // Discord identity (display name + avatar) — the authoritative name source.
  const memberMap = await getMemberMap().catch(() => new Map())
  const member = memberMap.get(String(discordId)) || null
  // "Current team" must match the player DIRECTORY exactly: an ACTIVE roster slot
  // in the ACTIVE season on an ACTIVE team. A lingering inactive / past-season row
  // is NOT a current team — falling back to the most-recent stint was the "shows
  // old team while actually a free agent" bug (a dropped player kept their team).
  const activeSeason = await getActiveSeason()
  const activeSeasonId = activeSeason?.id || null
  const currentRoster = (rosterRes.rows || []).find(
    (r) => r.roster_active && r.season_id === activeSeasonId && r.team_active !== false
  ) || null
  // Most-recent stint of any season — used ONLY for last-known division display.
  const lastStint = (rosterRes.rows || [])[0] || null

  const resolvedName =
    member?.displayName ||
    identity?.display_name ||
    sheet?.displayName ||
    sheet?.nickname ||
    identity?.discord_username ||
    member?.username ||
    `User ${String(discordId).slice(-4)}`

  return NextResponse.json({
    player: {
      discordId,
      displayName: resolvedName,
      discordUsername: member?.username || identity?.discord_username || null,
      avatarUrl: member?.avatarUrl || null,
      inGuild: member?.isInGuild ?? null,
      lastSeen: identity?.last_seen || null,
      salary: sheet?.salary ?? null,
      division: currentRoster?.division || lastStint?.division || sheet?.league || null,
      eligible: sheet?.eligible ?? null,
      currentTeam: currentRoster?.team_name || null,
      currentTeamId: currentRoster?.team_id || null,
      isFreeAgent: !currentRoster,
      role: currentRoster?.role || null,
    },
    transactions: txRes.rows.map((r) => ({
      id: r.id,
      type: r.type,
      teamName: r.team_name_resolved || r.team_name_snapshot,
      pairedTeamName: r.paired_team_name_resolved || r.paired_team_name_snapshot,
      seasonNumber: r.season_number,
      performedAt: r.performed_at,
    })),
    rosterHistory: rosterRes.rows.map((r) => ({
      seasonNumber: r.season_number,
      year: r.year,
      teamId: r.team_id,
      teamName: r.team_name,
      division: r.division,
      role: r.role,
      rosterActive: r.roster_active,
      seasonStatus: r.season_status,
    })),
    stats: belugaStats.seasons.length
      ? belugaStats.seasons
          .filter((s) => !s.isPlayoff)
          .map((s) => ({
            seasonNumber: s.seasonNumber,
            division: s.division,
            teamName: s.teamName,
            gamesPlayed: s.totals.games,
            goals: s.totals.goals,
            assists: s.totals.assists,
            saves: s.totals.saves,
            shots: s.totals.shots,
            score: s.totals.score,
            mvps: s.totals.mvps,
            demosInflicted: s.totals.demosInflicted,
            demosTaken: s.totals.demosTaken,
            belugaScore: s.totals.belugaScore,
            perGame: s.perGame,
          }))
      : legacyStats.rows.map((r) => ({
          seasonNumber: r.season_number,
          division: r.division,
          teamName: r.team_name,
          gamesPlayed: Number(r.games_played || 0),
          goals: Number(r.goals || 0),
          assists: Number(r.assists || 0),
          saves: Number(r.saves || 0),
          shots: Number(r.shots || 0),
          score: Number(r.score || 0),
        })),
    // Full new-stats bundle: lifetime totals + per-game + per-season averages,
    // playoff splits, name/account history, and recent game-by-game lines.
    belugaStats,
    // Admin-configured award roles this player holds (bot-synced snapshot).
    awards: await (async () => {
      try {
        const cfg = await query(`SELECT value FROM app_config WHERE key = 'award_roles'`)
        const list = JSON.parse(cfg.rows[0]?.value || '[]')
        if (!list.length) return []
        const held = await query(`SELECT role_id FROM award_role_holders WHERE discord_id = $1`, [discordId])
        const heldSet = new Set(held.rows.map((r) => r.role_id))
        return list.filter((r) => heldSet.has(r.roleId)).map((r) => ({ roleId: r.roleId, label: r.label }))
      } catch { return [] }
    })(),
    // Championships: seasons where this player was on the champion team's roster.
    championships: (await query(`
      SELECT DISTINCT s.season_number, sc.division, t.name AS team_name
      FROM season_champions sc
      JOIN teams t ON t.id = sc.team_id
      JOIN team_roster_members rm ON rm.team_id = sc.team_id AND rm.season_id = sc.season_id
      LEFT JOIN seasons s ON s.id = sc.season_id
      WHERE rm.discord_id = $1
      ORDER BY s.season_number DESC
    `, [discordId]).catch(() => ({ rows: [] }))).rows.map((r) => ({
      seasonNumber: r.season_number,
      division: r.division,
      teamName: r.team_name,
    })),
    matches: belugaStats.recentGames.map((g) => {
      // Everything from the PLAYER's perspective (their team vs the opponent),
      // so the page never has to guess which side they were on.
      const playerIsHome = g.playerTeam && g.playerTeam === g.home
      const opponent = playerIsHome ? g.away : g.home
      const ourScore = playerIsHome ? g.homeGoals : g.awayGoals
      const oppScore = playerIsHome ? g.awayGoals : g.homeGoals
      return {
        week: g.week,
        isPlayoff: g.isPlayoff,
        division: g.division,
        home: g.home,
        away: g.away,
        playerTeam: g.playerTeam,
        opponent,
        ourScore: Number(ourScore || 0),
        oppScore: Number(oppScore || 0),
        result: Number(ourScore || 0) > Number(oppScore || 0) ? 'W' : Number(ourScore || 0) < Number(oppScore || 0) ? 'L' : 'T',
        homeScore: g.homeGoals,
        awayScore: g.awayGoals,
        stats: {
          score: g.score, goals: g.goals, assists: g.assists, saves: g.saves,
          shots: g.shots, mvp: g.mvp, demosInflicted: g.demosInflicted, demosTaken: g.demosTaken,
        },
        replayUrl: g.replayUrl,
        createdAt: g.playedAt,
      }
    }),
  })
}
