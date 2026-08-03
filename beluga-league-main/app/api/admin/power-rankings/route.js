import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { getRankingsForSeason, replaceRankings } from '../../../../lib/powerRankingsStore'
import { recalcPowerRankings, recalcAllWeeks } from '../../../../lib/powerRankingsAuto'
import { resolveRankingWeek, listPlayedWeeks, countUnweekedSeries } from '../../../../lib/rankingWeek'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

/** A week query/body value, or null for "let the server decide". */
function parseWeek(raw) {
  if (raw == null || raw === '' || raw === 'latest') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 ? n : null
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  let seasonId = searchParams.get('seasonId')
  if (!seasonId || seasonId === 'active') {
    const s = await getActiveSeason()
    seasonId = s?.id || null
  } else {
    seasonId = Number(seasonId)
    if (!Number.isInteger(seasonId)) seasonId = null
  }

  if (!seasonId) {
    return NextResponse.json({
      seasonId: null, rankings: null, seasonTeams: [],
      week: null, weeks: [], playedWeeks: [], defaultWeek: null, unweekedSeries: 0,
    })
  }

  const rankings = await getRankingsForSeason(seasonId, parseWeek(searchParams.get('week')))
  const playedWeeks = await listPlayedWeeks(seasonId)
  const defaultWeek = await resolveRankingWeek(seasonId)
  const unweekedSeries = await countUnweekedSeries(seasonId)

  // Teams of this season (for the team picker), grouped by division.
  const teamRes = await query(`
    SELECT t.id, t.name, t.division
    FROM teams t
    LEFT JOIN team_franchises f ON f.id = t.franchise_id
    WHERE t.season_id = $1 AND t.is_active = TRUE AND (f.is_active IS DISTINCT FROM FALSE)
    ORDER BY t.division, t.name
  `, [seasonId])
  const seasonTeams = teamRes.rows.map((r) => ({ id: r.id, name: r.name, division: r.division }))

  // Keys listed explicitly, never spread — a spread once replaced a list with a
  // count and white-screened the DM Center.
  return NextResponse.json({
    seasonId,
    rankings,
    seasonTeams,
    week: rankings.week,
    weeks: rankings.weeks,
    playedWeeks,
    defaultWeek,
    unweekedSeries,
  })
}

// POST { action, seasonId?, week? }
//   'recalc'        → regenerate ONE week's auto rankings (teams+players, all
//                     divisions). Only that week's rows are replaced. Omitting
//                     week targets the latest week that has results.
//   'backfill' → rebuild every week that has results, oldest first, so
//                     trend arrows chain correctly across the whole season.
// Same formula as the bot's /power-rankings + week-close refresh.
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  let body
  try { body = await request.json() } catch { body = {} }
  const action = body.action === 'backfill' ? 'backfill' : body.action === 'recalc' ? 'recalc' : null
  if (!action) return badRequest('Unknown action')

  let seasonId = body.seasonId
  if (!seasonId || seasonId === 'active') {
    const s = await getActiveSeason()
    seasonId = s?.id || null
  } else {
    seasonId = Number(seasonId)
    if (!Number.isInteger(seasonId)) seasonId = null
  }
  if (!seasonId) return badRequest('No season')

  try {
    if (action === 'backfill') {
      const res = await recalcAllWeeks(seasonId)
      const rankings = await getRankingsForSeason(seasonId)
      return NextResponse.json({
        ok: true, action, seasonId,
        weeksRebuilt: res.weeks, teamCount: res.teamCount, playerCount: res.playerCount,
        week: rankings.week, weeks: rankings.weeks, rankings,
      })
    }
    const res = await recalcPowerRankings(seasonId, parseWeek(body.week))
    const rankings = await getRankingsForSeason(seasonId, res.week)
    return NextResponse.json({
      ok: true, action, seasonId,
      teamCount: res.teamCount, playerCount: res.playerCount,
      week: res.week, weeks: rankings.weeks, rankings,
    })
  } catch (err) {
    return badRequest(err.message || 'recalc failed')
  }
}

async function putHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const seasonId = Number(body.seasonId)
  if (!Number.isInteger(seasonId)) return badRequest('seasonId required')
  const entityType = String(body.entityType || '')
  const division = String(body.division || '')
  if (!Array.isArray(body.entries)) return badRequest('entries array required')

  try {
    const rankings = await replaceRankings({
      seasonId,
      entityType,
      division,
      week: parseWeek(body.week),
      entries: body.entries,
      updatedByUsername: auth.session?.discordUsername || null,
    })
    return NextResponse.json({ ok: true, rankings, week: rankings.week, weeks: rankings.weeks })
  } catch (err) {
    return badRequest(err.message || 'failed')
  }
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'power-rankings.post' })
export const PUT = withAudit(putHandler, { action: 'power-rankings.put' })
