import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { query } from '../../../../lib/db'
import {
  listWeekThreads,
  computeWeekNumber,
  mondayForWeek,
  materializeWeekFromSchedule,
  createManualWeekThread,
} from '../../../../lib/weekThreadStore'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const { searchParams } = new URL(request.url)
  let seasonId = searchParams.get('seasonId')
  let season = null
  if (!seasonId || seasonId === 'active') {
    season = await getActiveSeason()
    seasonId = season?.id || null
  } else {
    seasonId = Number(seasonId)
    if (!Number.isInteger(seasonId)) seasonId = null
  }

  const threads = seasonId ? await listWeekThreads({ seasonId, scope: 'season' }) : []

  // Cross-season list: every open thread regardless of season. The user wants
  // these always visible because the bot pre-creates future-week threads that
  // span across seasons and they need to be tracked.
  const openCrossSeason = await listWeekThreads({ scope: 'open_all' })

  // Closed/deleted threads: the live week_threads rows are gone after a delete,
  // so the saved transcripts live in thread_archives. Surface them so the admin
  // can still open the final transcript.
  let archives = []
  try {
    const arcRes = await query(`
      SELECT ta.thread_id, ta.season_id, ta.week_number, ta.division, ta.team1, ta.team2,
        ta.match_number, ta.closed_by_username, ta.closed_at, ta.message_count,
        s.season_number
      FROM thread_archives ta
      LEFT JOIN seasons s ON s.id = ta.season_id
      ${seasonId ? 'WHERE ta.season_id = $1' : ''}
      ORDER BY ta.closed_at DESC
      LIMIT 200
    `, seasonId ? [seasonId] : [])
    archives = arcRes.rows.map((r) => ({
      threadId: r.thread_id,
      seasonId: r.season_id,
      seasonNumber: r.season_number,
      weekNumber: r.week_number,
      division: r.division,
      team1: r.team1,
      team2: r.team2,
      matchNumber: r.match_number,
      closedByUsername: r.closed_by_username,
      closedAt: r.closed_at,
      messageCount: r.message_count,
    }))
  } catch { /* table may not exist yet */ }

  // Compute "current week" based on season start date.
  let startDate = null
  let currentWeek = null
  let nextMondayIso = null
  if (seasonId && !season) {
    // re-fetch full season to get startDate
    const { getSeasonById } = await import('../../../../lib/leagueStore')
    season = await getSeasonById(seasonId)
  }
  if (season?.startDate) {
    startDate = season.startDate
    currentWeek = computeWeekNumber(startDate, new Date())
    if (currentWeek) {
      const nextMonday = mondayForWeek(startDate, currentWeek + 1)
      nextMondayIso = nextMonday.toISOString().slice(0, 10)
    }
  }

  return NextResponse.json({
    season,
    seasonId,
    startDate,
    currentWeek,
    nextMondayIso,
    threads,
    openCrossSeason,
    archives,
  })
}

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  await ensureLeagueSchema()

  const seasonId = Number(body.seasonId)
  if (!Number.isInteger(seasonId)) return badRequest('seasonId required')

  // Mode 1: materialize all matchups from the schedule for a given week.
  if (body.action === 'materialize_week') {
    const weekNumber = Number(body.weekNumber)
    if (!Number.isInteger(weekNumber) || weekNumber < 1) return badRequest('weekNumber required')
    const replace = Boolean(body.replace)
    const inserted = await materializeWeekFromSchedule({ seasonId, weekNumber, replace })
    return NextResponse.json({ ok: true, inserted, weekNumber })
  }

  // Mode 2: materialize a RANGE of weeks (e.g. from start_date until current week).
  if (body.action === 'materialize_range') {
    const from = Number(body.fromWeek) || 1
    const to = Number(body.toWeek)
    if (!Number.isInteger(to) || to < from) return badRequest('toWeek required (>= fromWeek)')
    const replace = Boolean(body.replace)
    let total = 0
    const perWeek = {}
    for (let w = from; w <= to; w += 1) {
      const n = await materializeWeekFromSchedule({ seasonId, weekNumber: w, replace })
      total += n
      perWeek[w] = n
    }
    return NextResponse.json({ ok: true, total, perWeek })
  }

  // Mode 3: delete an entire week's threads — queue a bot action so the bot runs
  // the SAME flow as /week-thread delete (deletes the Discord thread(s) AND saves
  // each transcript on the website). No DB-only deletion here: the bot is the
  // single actor that mutates Discord + week_threads, then archives the transcript.
  if (body.action === 'delete_week') {
    const weekNumber = Number(body.weekNumber)
    if (!Number.isInteger(weekNumber) || weekNumber < 1) return badRequest('weekNumber required')
    const r = await query(
      `INSERT INTO week_thread_actions (action, season_id, week_number, requested_by_discord_id, requested_by_username)
       VALUES ('delete', $1, $2, $3, $4)
       RETURNING id`,
      [seasonId, weekNumber, auth.session?.discordUserId || null, auth.session?.discordUsername || null]
    )
    return NextResponse.json({ ok: true, queued: true, actionId: r.rows[0].id })
  }

  // Mode 4: create one manual thread row
  if (body.action === 'create_one') {
    const weekNumber = Number(body.weekNumber)
    const division = String(body.division || '').trim()
    const team1 = String(body.team1 || '').trim()
    const team2 = String(body.team2 || '').trim()
    if (!Number.isInteger(weekNumber) || !division || !team1 || !team2) return badRequest('weekNumber/division/team1/team2 required')
    const id = await createManualWeekThread({ seasonId, weekNumber, division, team1, team2 })
    return NextResponse.json({ ok: true, id })
  }

  return badRequest('Unknown action')
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'week-threads.post' })
