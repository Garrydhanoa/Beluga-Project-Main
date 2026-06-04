import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { getPool, query } from '../../../../../../lib/db'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { getSeasonConfig } from '../../../../../../lib/franchiseStore'

export const dynamic = 'force-dynamic'

function badRequest(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  await ensureLeagueSchema()

  const [matchesRes, teamsRes, config] = await Promise.all([
    query(`
      SELECT sm.id, sm.division, sm.week, sm.is_published, sm.match_order, sm.status,
        sm.home_team_id, sm.away_team_id,
        ht.name AS home_name, at.name AS away_name
      FROM schedule_matches sm
      LEFT JOIN teams ht ON ht.id = sm.home_team_id
      LEFT JOIN teams at ON at.id = sm.away_team_id
      WHERE sm.season_id = $1
      ORDER BY sm.is_published DESC, sm.week, sm.division, sm.match_order, sm.id
    `, [seasonId]),
    query(`
      SELECT id, name, division, is_active
      FROM teams
      WHERE season_id = $1
      ORDER BY division, name
    `, [seasonId]),
    getSeasonConfig(seasonId),
  ])

  const matches = matchesRes.rows.map((r) => ({
    id: r.id,
    division: r.division,
    week: r.week,
    isPublished: r.is_published,
    status: r.status,
    matchOrder: r.match_order,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeTeam: r.home_name,
    awayTeam: r.away_name,
  }))

  const teamsByDivision = {}
  for (const t of teamsRes.rows) {
    if (!teamsByDivision[t.division]) teamsByDivision[t.division] = []
    teamsByDivision[t.division].push({
      id: t.id,
      name: t.name,
      division: t.division,
      isActive: t.is_active,
    })
  }

  return NextResponse.json({
    matches,
    teamsByDivision,
    locked: !!(config && config.scheduleGeneratedAt),
    generatedAt: config?.scheduleGeneratedAt || null,
    weeksConfigured: config?.weeks || null,
  })
}

// Reset all schedule_matches for the season AND clear the schedule_generated_at lock,
// allowing a fresh generation. Manual edits to individual matches do NOT trigger this.
export async function DELETE(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  await ensureLeagueSchema()

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM schedule_matches WHERE season_id = $1`, [seasonId])
    await client.query(`
      UPDATE season_config
      SET schedule_generated_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE season_id = $1
    `, [seasonId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    return NextResponse.json({ error: err.message || 'Failed to reset schedule' }, { status: 500 })
  } finally {
    client.release()
  }

  return NextResponse.json({ ok: true })
}

// Manual: add a single match to the schedule (does NOT touch the lock).
export async function POST(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const division = (body.division || '').trim()
  const week = Number(body.week)
  const homeTeamId = Number(body.homeTeamId)
  const awayTeamId = Number(body.awayTeamId)
  const publish = body.publish === undefined ? true : Boolean(body.publish)

  if (!division) return badRequest('division required')
  if (!Number.isInteger(week) || week < 1) return badRequest('week required (>=1)')
  if (!Number.isInteger(homeTeamId) || !Number.isInteger(awayTeamId)) return badRequest('homeTeamId and awayTeamId required')
  if (homeTeamId === awayTeamId) return badRequest('home and away must differ')

  await ensureLeagueSchema()

  // Get next match_order in this week+division
  const orderRes = await query(
    `SELECT COALESCE(MAX(match_order), -1) + 1 AS next_order
     FROM schedule_matches WHERE season_id = $1 AND division = $2 AND week = $3`,
    [seasonId, division, week]
  )
  const matchOrder = Number(orderRes.rows[0].next_order) || 0

  const result = await query(
    `INSERT INTO schedule_matches (season_id, division, week, home_team_id, away_team_id, is_published, match_order, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [seasonId, division, week, homeTeamId, awayTeamId, publish, matchOrder, publish ? 'published' : 'draft']
  )
  return NextResponse.json({ ok: true, matchId: result.rows[0].id })
}
