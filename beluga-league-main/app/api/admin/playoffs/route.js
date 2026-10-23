import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { resolveSeason, getActiveSeason } from '../../../../lib/leagueStore'
import { getStatsStandings } from '../../../../lib/belugaStats'
import { getSiteConfig, setSiteConfig } from '../../../../lib/siteConfigStore'
import { query } from '../../../../lib/db'
import {
  DIVISIONS,
  normalizeDivision,
  getAllBrackets,
  getBracket,
  setMatchupTeams,
  setMatchupResult,
  clearMatchupResult,
  setRoundBestOf,
  setBracketPublished,
  createRoundThreads,
  queueMatchupThreadDelete,
  generateFromStandings,
  refreshAllBrackets,
  recomputeBracket,
} from '../../../../lib/playoffStore'

export const dynamic = 'force-dynamic'

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const seasonParam = new URL(request.url).searchParams.get('season')
  const season = seasonParam ? await resolveSeason(seasonParam) : await getActiveSeason()
  if (!season) {
    return NextResponse.json({ seasonId: null, brackets: [], settings: {}, teams: {} })
  }

  // Self-heal on read: wire any legacy bracket (no seeds / no graph) and pull in
  // results reported since the last visit. Both are idempotent and cheap.
  await refreshAllBrackets(season.id).catch(() => {})

  const [brackets, settings] = await Promise.all([
    getAllBrackets(season.id),
    getSiteConfig('playoffs'),
  ])

  // Team list per division, for the manual "set teams" pickers.
  const teamRows = await query(
    `SELECT id, name, division FROM teams
      WHERE season_id = $1 AND is_active = TRUE ORDER BY division, name`,
    [season.id]
  )
  const teams = {}
  for (const division of DIVISIONS) {
    teams[division] = teamRows.rows
      .filter((t) => String(t.division).toLowerCase() === division.toLowerCase())
      .map((t) => ({ id: t.id, name: t.name }))
  }

  return NextResponse.json({ seasonId: season.id, seasonNumber: season.seasonNumber, brackets, settings, teams })
}

/**
 * One action per request. The old handler was a single POST that did three very
 * different things and logged all of them as `did "playoffs post"`; each branch
 * now names itself in the audit log.
 */
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const season = await getActiveSeason()
  if (!season) return badRequest('No active season found')

  const action = String(body.action || '')
  const division = normalizeDivision(body.division)

  try {
    switch (action) {
      // --- seed a division from the standings ------------------------------
      case 'generate': {
        if (!division) return badRequest('division required')
        const qualifierCount = Math.max(2, Number(body.qualifierCount) || 8)
        const standings = await getStatsStandings(season.id, division)
        if (standings.length < qualifierCount) {
          return badRequest(`Need at least ${qualifierCount} teams with results in ${division} (have ${standings.length}).`)
        }
        const result = await generateFromStandings(season.id, division, standings, {
          qualifierCount,
          bestOfByRound: body.bestOfByRound || {},
        })
        const seeded = standings.slice(0, qualifierCount).map((s, i) => `${s.team || s.teamName} (${i + 1})`)
        return NextResponse.json({ ok: true, seeded, ...result })
      }

      // --- set a matchup's teams by hand -----------------------------------
      case 'set-teams': {
        if (!body.matchupId) return badRequest('matchupId required')
        const result = await setMatchupTeams(Number(body.matchupId), {
          homeTeamId: body.homeTeamId ? Number(body.homeTeamId) : null,
          awayTeamId: body.awayTeamId ? Number(body.awayTeamId) : null,
        })
        return NextResponse.json({ ok: true, ...result })
      }

      // --- record / correct a result by hand -------------------------------
      case 'set-result': {
        if (!body.matchupId) return badRequest('matchupId required')
        const result = await setMatchupResult(Number(body.matchupId), {
          homeScore: body.homeScore == null || body.homeScore === '' ? null : Number(body.homeScore),
          awayScore: body.awayScore == null || body.awayScore === '' ? null : Number(body.awayScore),
          winnerTeamId: body.winnerTeamId ? Number(body.winnerTeamId) : null,
          resultKind: body.resultKind || 'series',
        })
        return NextResponse.json({ ok: true, ...result })
      }

      // --- hand a matchup back to the engine -------------------------------
      case 'clear-result': {
        if (!body.matchupId) return badRequest('matchupId required')
        const result = await clearMatchupResult(Number(body.matchupId))
        return NextResponse.json({ ok: true, ...result })
      }

      // --- per-round best-of ------------------------------------------------
      case 'set-best-of': {
        if (!body.roundId) return badRequest('roundId required')
        const bestOf = await setRoundBestOf(Number(body.roundId), body.bestOf)
        if (division) await recomputeBracket(season.id, division)
        return NextResponse.json({ ok: true, bestOf })
      }

      // --- publish one division's bracket ----------------------------------
      case 'set-published': {
        if (!body.bracketId) return badRequest('bracketId required')
        await setBracketPublished(Number(body.bracketId), body.isPublished)
        return NextResponse.json({ ok: true })
      }

      // --- create a round's Discord threads --------------------------------
      case 'create-threads': {
        if (!division) return badRequest('division required')
        const roundNumber = Number(body.roundNumber)
        if (!roundNumber) return badRequest('roundNumber required')
        const result = await createRoundThreads(season.id, division, roundNumber)
        return NextResponse.json({
          ok: true,
          ...result,
          note: result.created
            ? `Bot creates ${result.created} thread(s) within ~60s.`
            : 'Nothing to create — every matchup in that round already has a thread or is decided.',
        })
      }

      // --- delete ONE matchup's thread -------------------------------------
      case 'delete-thread': {
        if (!body.weekThreadId) return badRequest('weekThreadId required')
        const result = await queueMatchupThreadDelete(Number(body.weekThreadId), {
          requestedByDiscordId: auth.session?.discordUserId || null,
          requestedByUsername: auth.session?.discordUsername || auth.session?.user?.name || 'Website Admin',
        })
        return NextResponse.json({
          ok: true,
          ...result,
          note: 'Queued — the bot saves the transcript and deletes the thread within ~60s.',
        })
      }

      // --- re-derive everything --------------------------------------------
      case 'refresh': {
        if (division) {
          const result = await recomputeBracket(season.id, division)
          return NextResponse.json({ ok: true, results: [{ division, ...result }] })
        }
        const results = await refreshAllBrackets(season.id)
        return NextResponse.json({ ok: true, results })
      }

      // --- automation + visibility switches ---------------------------------
      case 'settings': {
        const current = await getSiteConfig('playoffs')
        const next = { ...current }
        for (const key of ['enabled', 'autoAdvance', 'autoThreads', 'autoChampion', 'autoAnnounce']) {
          if (key in (body.settings || {})) next[key] = Boolean(body.settings[key])
        }
        const saved = await setSiteConfig('playoffs', next)
        return NextResponse.json({ ok: true, settings: saved })
      }

      default:
        return badRequest(`Unknown action "${action || '(none)'}"`)
    }
  } catch (err) {
    // Surface the REAL reason. This route used to let a throw become an opaque
    // 500, so a NOT NULL violation reached the operator as "Failed to save
    // playoffs" and the actual Postgres message was only visible in higgenlogs.
    return NextResponse.json({ error: err.message || 'Playoff action failed' }, { status: 500 })
  }
}

// Audit every write. The slug names the specific action, so higgenlogs reads as
// "auto-seeded a playoff bracket" rather than a generic `playoffs post`.
export const POST = withAudit(postHandler, {
  action: (body) => `playoffs.${body?.action || 'unknown'}`,
})
