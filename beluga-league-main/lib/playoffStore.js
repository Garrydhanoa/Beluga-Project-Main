/**
 * Playoff reads and targeted writes.
 *
 * Replaces `getPlayoffMatchups` / `replacePlayoffBrackets` in leagueStore.js.
 * Those were a name-keyed bulk replace that DELETED every bracket in the season
 * (all three divisions) and rebuilt it from team names — which, now that a
 * matchup carries seeds, scores, a winner and graph wiring, would destroy all of
 * it on every save. It also omitted the NOT NULL `round_order`, so it 500'd on
 * every attempt and had literally never worked.
 *
 * Everything here is targeted: one matchup, one round, one bracket.
 */

import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'
import {
  loadBracket,
  recomputeBracket,
  ensureBracketGraph,
  weekForRound,
  shortRoundName,
} from './playoffBracket'

export const DIVISIONS = ['Majors', 'AAA', 'AA']

export function isValidDivision(division) {
  return DIVISIONS.some((d) => d.toLowerCase() === String(division || '').toLowerCase())
}

/** Canonical casing — divisions are capitalized everywhere in the DB. */
export function normalizeDivision(division) {
  return DIVISIONS.find((d) => d.toLowerCase() === String(division || '').toLowerCase()) || null
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/**
 * One division's bracket, shaped for the UI.
 *
 * Carries team IDs (so TeamLogo can use `teamId=`, not the ambiguous `name=`
 * lookup that picks `ORDER BY t.id DESC` across divisions), seeds, scores,
 * winners, best-of, franchise colour, and the Discord thread for each matchup.
 */
export async function getBracket(seasonId, division, { client = null } = {}) {
  await ensureLeagueSchema()
  const div = normalizeDivision(division)
  if (!div) return null
  // `client` lets a caller read inside an open transaction (used by the admin
  // preview harness, and by anything that wants wire+recompute+read atomically).
  const run = client ? (t, p) => client.query(t, p) : query

  const bracket = await loadBracket(seasonId, div, client)
  if (!bracket) return null

  // Franchise colour + logo presence per team, for accents on the public page.
  const teamIds = bracket.rounds
    .flatMap((r) => r.matchups)
    .flatMap((m) => [m.home_team_id, m.away_team_id, m.winner_team_id])
    .filter(Boolean)

  const teamMeta = new Map()
  if (teamIds.length) {
    const tm = await run(
      `SELECT t.id, t.name, f.color, (t.logo_data IS NOT NULL OR f.logo_data IS NOT NULL) AS has_logo
         FROM teams t
         LEFT JOIN team_franchises f ON f.id = t.franchise_id
        WHERE t.id = ANY($1::int[])`,
      [[...new Set(teamIds)]]
    )
    for (const row of tm.rows) teamMeta.set(row.id, row)
  }

  // Threads, matched the same way the bot matches them: case-insensitive names
  // in either order, on the round's week.
  const threads = await run(
    `SELECT id, week_number, division, team1, team2, thread_id, is_closed, match_number
       FROM week_threads
      WHERE season_id = $1 AND LOWER(division) = LOWER($2) AND week_number >= 90`,
    [seasonId, div]
  )

  const threadFor = (weekNumber, homeName, awayName) => {
    if (!homeName || !awayName) return null
    const h = homeName.toLowerCase()
    const a = awayName.toLowerCase()
    return threads.rows.find((t) =>
      t.week_number === weekNumber &&
      ((t.team1?.toLowerCase() === h && t.team2?.toLowerCase() === a) ||
        (t.team1?.toLowerCase() === a && t.team2?.toLowerCase() === h))) || null
  }

  const teamOf = (id, name) => {
    if (!id) return null
    const meta = teamMeta.get(id)
    return {
      id,
      name: name || meta?.name || null,
      color: meta?.color || null,
      hasLogo: Boolean(meta?.has_logo),
    }
  }

  return {
    id: bracket.id,
    seasonId: bracket.season_id,
    division: bracket.division,
    name: bracket.name,
    isPublished: bracket.is_published,
    qualifierCount: bracket.qualifier_count,
    totalRounds: bracket.totalRounds,
    rounds: bracket.rounds.map((r) => ({
      id: r.id,
      roundNumber: r.round_number,
      name: r.name,
      shortName: shortRoundName(r.name),
      isFinals: r.is_finals,
      bestOf: r.best_of,
      week: weekForRound(r.round_number),
      matchups: r.matchups.map((m) => {
        const thread = threadFor(weekForRound(r.round_number), m.home_team_name, m.away_team_name)
        return {
          id: m.id,
          order: m.order_index,
          home: teamOf(m.home_team_id, m.home_team_name),
          away: teamOf(m.away_team_id, m.away_team_name),
          homeSeed: m.home_seed,
          awaySeed: m.away_seed,
          homeScore: m.home_score,
          awayScore: m.away_score,
          winnerTeamId: m.winner_team_id,
          winnerName: m.winner_team_name,
          resultKind: m.result_kind,
          seriesId: m.series_id,
          bestOf: m.best_of,
          isBye: m.is_bye,
          manualOverride: m.manual_override,
          thread: thread
            ? { id: thread.id, discordId: thread.thread_id, isClosed: thread.is_closed }
            : null,
        }
      }),
    })),
  }
}

/** Every division's bracket for a season. Used by the admin tab and the public page. */
export async function getAllBrackets(seasonId, { publishedOnly = false, client = null } = {}) {
  const out = []
  for (const division of DIVISIONS) {
    const bracket = await getBracket(seasonId, division, { client })
    if (!bracket) continue
    if (publishedOnly && !bracket.isPublished) continue
    out.push(bracket)
  }
  return out
}

// ---------------------------------------------------------------------------
// Targeted writes
// ---------------------------------------------------------------------------

async function matchupContext(matchupId) {
  const r = await query(
    `SELECT pm.id, pr.round_number, pb.season_id, pb.division
       FROM playoff_matchups pm
       JOIN playoff_rounds pr ON pr.id = pm.round_id
       JOIN playoff_brackets pb ON pb.id = pr.bracket_id
      WHERE pm.id = $1`,
    [matchupId]
  )
  if (!r.rows.length) throw new Error(`Matchup ${matchupId} not found`)
  return r.rows[0]
}

/**
 * Set (or clear) a matchup's teams by hand.
 *
 * Flags manual_override so a recompute keeps the staff choice instead of
 * overwriting it with whatever the feeder rounds say.
 */
export async function setMatchupTeams(matchupId, { homeTeamId = null, awayTeamId = null }) {
  await ensureLeagueSchema()
  const ctx = await matchupContext(matchupId)
  if (homeTeamId && awayTeamId && Number(homeTeamId) === Number(awayTeamId)) {
    throw new Error('A matchup needs two different teams.')
  }
  await query(
    `UPDATE playoff_matchups
        SET home_team_id = $2, away_team_id = $3, manual_override = TRUE,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [matchupId, homeTeamId || null, awayTeamId || null]
  )
  return recomputeBracket(ctx.season_id, ctx.division)
}

/**
 * Record a result by hand: a corrected score, a forfeit, or just "this team won".
 * Always a manual override — staff intent beats derivation.
 */
export async function setMatchupResult(matchupId, { homeScore = null, awayScore = null, winnerTeamId = null, resultKind = 'series' }) {
  await ensureLeagueSchema()
  const ctx = await matchupContext(matchupId)

  const current = await query(
    `SELECT home_team_id, away_team_id FROM playoff_matchups WHERE id = $1`, [matchupId]
  )
  const row = current.rows[0]
  if (winnerTeamId && row && ![row.home_team_id, row.away_team_id].includes(Number(winnerTeamId))) {
    throw new Error('The winner must be one of the two teams in this matchup.')
  }

  await query(
    `UPDATE playoff_matchups
        SET home_score = $2, away_score = $3, winner_team_id = $4, result_kind = $5,
            manual_override = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [matchupId, homeScore, awayScore, winnerTeamId || null, resultKind || 'series']
  )
  return recomputeBracket(ctx.season_id, ctx.division)
}

/**
 * Drop a manual result and hand the matchup back to the engine, which will
 * re-derive it from confirmed series on the next recompute.
 */
export async function clearMatchupResult(matchupId) {
  await ensureLeagueSchema()
  const ctx = await matchupContext(matchupId)
  await query(
    `UPDATE playoff_matchups
        SET home_score = NULL, away_score = NULL, winner_team_id = NULL,
            result_kind = NULL, series_id = NULL, manual_override = FALSE,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [matchupId]
  )
  return recomputeBracket(ctx.season_id, ctx.division)
}

/** Per-round best-of, e.g. Bo5 quarters into Bo7 finals. */
export async function setRoundBestOf(roundId, bestOf) {
  await ensureLeagueSchema()
  const n = Math.max(1, Math.min(99, Number(bestOf) || 7))
  await query(`UPDATE playoff_rounds SET best_of = $2 WHERE id = $1`, [roundId, n])
  await query(
    `UPDATE playoff_matchups SET best_of = $2 WHERE round_id = $1 AND winner_team_id IS NULL`,
    [roundId, n]
  )
  return n
}

export async function setBracketPublished(bracketId, isPublished) {
  await ensureLeagueSchema()
  await query(
    `UPDATE playoff_brackets SET is_published = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [bracketId, Boolean(isPublished)]
  )
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/**
 * Materialize week_threads rows for one round. The bot's watcher turns them into
 * real Discord threads within ~60s.
 *
 * Unlike the old route this sets `match_number`, so playoff threads stop all
 * reporting themselves as "Match: 1", and it skips matchups that already have a
 * thread OR are already decided.
 */
export async function createRoundThreads(seasonId, division, roundNumber) {
  await ensureLeagueSchema()
  const div = normalizeDivision(division)
  if (!div) throw new Error('Unknown division')

  const bracket = await getBracket(seasonId, div)
  if (!bracket) throw new Error(`No ${div} bracket for this season yet.`)

  const round = bracket.rounds.find((r) => r.roundNumber === Number(roundNumber))
  if (!round) throw new Error(`That bracket has no round ${roundNumber}.`)

  const ready = round.matchups.filter((m) => m.home?.name && m.away?.name)
  if (!ready.length) {
    throw new Error(`${round.name} has no filled-in matchups yet — the previous round has to finish first.`)
  }

  let created = 0
  const skipped = []
  for (const m of ready) {
    if (m.thread) { skipped.push(`${m.home.name} vs ${m.away.name} (already has a thread)`); continue }
    if (m.winnerTeamId) { skipped.push(`${m.home.name} vs ${m.away.name} (already decided)`); continue }
    await query(
      `INSERT INTO week_threads (season_id, week_number, division, team1, team2, match_number)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [seasonId, round.week, div, m.home.name, m.away.name, m.order]
    )
    created += 1
  }

  return { created, skipped, round: round.name, week: round.week }
}

/**
 * Queue the bot to delete ONE matchup's thread (transcript saved, same flow as a
 * week delete). The bot is the only actor that touches Discord.
 */
export async function queueMatchupThreadDelete(weekThreadId, { requestedByDiscordId, requestedByUsername }) {
  await ensureLeagueSchema()
  const t = await query(`SELECT id, season_id, week_number FROM week_threads WHERE id = $1`, [weekThreadId])
  if (!t.rows.length) throw new Error('That thread record no longer exists.')
  const row = t.rows[0]

  await query(
    `INSERT INTO week_thread_actions
       (action, season_id, week_number, week_thread_id, requested_by_discord_id, requested_by_username)
     VALUES ('delete_matchup', $1, $2, $3, $4, $5)`,
    [row.season_id, row.week_number, row.id, requestedByDiscordId || null, requestedByUsername || null]
  )
  return { queued: true, weekThreadId: row.id }
}

// ---------------------------------------------------------------------------
// Generate / repair
// ---------------------------------------------------------------------------

export { recomputeBracket, ensureBracketGraph }

/**
 * Seed a division from the standings. Destructive for that division only.
 * `standings` comes from getStatsStandings (lib/belugaStats.js).
 */
export async function generateFromStandings(seasonId, division, standings, options = {}) {
  const div = normalizeDivision(division)
  if (!div) throw new Error('Unknown division')
  const { generateBracket } = await import('./playoffBracket')
  return generateBracket(seasonId, div, standings, options)
}

/**
 * Walk every division: wire legacy brackets, then recompute. Cheap and
 * idempotent, so routes can call it before rendering to self-heal.
 */
export async function refreshAllBrackets(seasonId) {
  const results = []
  for (const division of DIVISIONS) {
    try {
      const wire = await ensureBracketGraph(seasonId, division)
      const recompute = await recomputeBracket(seasonId, division)
      results.push({ division, ...wire, ...recompute })
    } catch (err) {
      results.push({ division, error: err.message })
    }
  }
  return results
}
