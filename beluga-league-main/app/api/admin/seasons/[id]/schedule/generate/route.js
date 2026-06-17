import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../../lib/adminAuth'
import { getPool, query } from '../../../../../../../lib/db'
import { ensureLeagueSchema } from '../../../../../../../lib/leagueSchema'
import { getTeamsForSeasonGrouped } from '../../../../../../../lib/leagueStore'
import { getSeasonConfig, markScheduleGenerated } from '../../../../../../../lib/franchiseStore'
import { generateSeasonSchedule } from '../../../../../../../lib/scheduleGenerator'

export const dynamic = 'force-dynamic'

function badRequest(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

async function postHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body = {}
  try { body = await request.json() } catch { /* empty body OK */ }

  await ensureLeagueSchema()

  const config = await getSeasonConfig(seasonId)

  // Lock: if already generated, refuse unless caller explicitly says force=true.
  if (config?.scheduleGeneratedAt && !body.force) {
    return NextResponse.json({
      error: 'schedule_locked',
      message: `Schedule for this season was already generated on ${new Date(config.scheduleGeneratedAt).toLocaleString()}. Manually edit individual matches, or reset the schedule first to regenerate.`,
      generatedAt: config.scheduleGeneratedAt,
    }, { status: 409 })
  }

  const grouped = await getTeamsForSeasonGrouped(seasonId)
  const weeks = Number(body.weeks) || config?.weeks || 8
  const publish = Boolean(body.publish)

  const matches = generateSeasonSchedule(grouped, weeks)
  if (matches.length === 0) {
    return badRequest('Not enough teams to generate a schedule (need at least 2 active per division).')
  }

  // Verify every division has at least one match (user requirement: all 3 divisions need a schedule)
  const perDivision = matches.reduce((acc, m) => { acc[m.division] = (acc[m.division] || 0) + 1; return acc }, {})
  const requiredDivisions = Object.keys(grouped).filter((d) => (grouped[d] || []).filter((t) => t.isActive !== false).length >= 2)
  const missingDivisions = requiredDivisions.filter((d) => !perDivision[d])
  if (missingDivisions.length > 0) {
    return badRequest(`Generator failed to produce matches for: ${missingDivisions.join(', ')}`)
  }

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM schedule_matches WHERE season_id = $1`,
      [seasonId]
    )
    let order = 0
    for (const m of matches) {
      await client.query(
        `INSERT INTO schedule_matches (season_id, division, week, home_team_id, away_team_id, is_published, match_order, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [seasonId, m.division, m.week, m.homeTeamId, m.awayTeamId, publish, order++, publish ? 'published' : 'draft']
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: err.message || 'Failed to write schedule' }, { status: 500 })
  } finally {
    client.release()
  }

  await markScheduleGenerated(seasonId)
  const counts = perDivision
  return NextResponse.json({ ok: true, count: matches.length, weeks, publish, perDivision: counts })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'seasons.schedule.generate.post' })
