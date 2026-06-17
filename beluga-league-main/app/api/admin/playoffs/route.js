import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import {
  getActiveSeason,
  getPlayoffMatchups,
  replacePlayoffBrackets,
} from '../../../../lib/leagueStore'
import { getStatsStandings } from '../../../../lib/belugaStats'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const season = await getActiveSeason()
  if (!season) {
    return NextResponse.json({ seasonId: null, brackets: [] })
  }

  const brackets = await getPlayoffMatchups(season.id)
  return NextResponse.json({ seasonId: season.id, brackets })
}

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
  if (!season) {
    return badRequest('No active season found')
  }

  // ---- Auto-bracket: seed ONE division's bracket from the live standings
  // (top 8: 1v8, 4v5, 2v7, 3v6 + empty Semis/Finals rounds to fill as results
  // come in). Other divisions' brackets are untouched.
  if (body.action === 'auto-bracket') {
    const division = String(body.division || '')
    if (!['Majors', 'AAA', 'AA'].includes(division)) return badRequest('division required')
    const standings = await getStatsStandings(season.id, division)
    if (standings.length < 8) {
      return badRequest(`Need at least 8 teams with results in ${division} (have ${standings.length}).`)
    }
    const seed = (n) => standings[n - 1]
    const qf = [[1, 8], [4, 5], [2, 7], [3, 6]]

    await query(`DELETE FROM playoff_brackets WHERE season_id = $1 AND division = $2`, [season.id, division])
    const br = await query(
      `INSERT INTO playoff_brackets (season_id, division, name, is_published, display_order)
       VALUES ($1, $2, $3, TRUE, 0) RETURNING id`,
      [season.id, division, `${division} Playoffs`]
    )
    const bracketId = br.rows[0].id
    const rounds = [
      { n: 1, name: 'Quarter-Finals', isFinals: false, matchups: qf.map(([a, b]) => [seed(a), seed(b)]) },
      { n: 2, name: 'Semi-Finals', isFinals: false, matchups: [] },
      { n: 3, name: 'Finals', isFinals: true, matchups: [] },
    ]
    for (const r of rounds) {
      const rr = await query(
        `INSERT INTO playoff_rounds (bracket_id, round_number, round_order, name, is_finals)
         VALUES ($1, $2, $2, $3, $4) RETURNING id`,
        [bracketId, r.n, r.name, r.isFinals]
      )
      for (let m = 0; m < r.matchups.length; m += 1) {
        const [home, away] = r.matchups[m]
        await query(
          `INSERT INTO playoff_matchups (round_id, home_team_id, away_team_id, best_of, order_index, match_order)
           VALUES ($1, $2, $3, 7, $4, $4)`,
          [rr.rows[0].id, home.teamId, away.teamId, m + 1]
        )
      }
    }
    return NextResponse.json({
      ok: true,
      seeded: qf.map(([a, b]) => `${seed(a).team} (${a}) vs ${seed(b).team} (${b})`),
    })
  }

  // ---- Create playoff week threads for a bracket round: materializes
  // week_threads rows with week_number = 90 + round; the bot creates the
  // Discord threads (named "Playoffs …") on its next tick.
  if (body.action === 'create-threads') {
    const division = String(body.division || '')
    const roundNumber = Number(body.roundNumber)
    if (!['Majors', 'AAA', 'AA'].includes(division) || !roundNumber) return badRequest('division + roundNumber required')
    const ms = await query(`
      SELECT ht.name AS home, at.name AS away
      FROM playoff_matchups pm
      JOIN playoff_rounds pr ON pr.id = pm.round_id
      JOIN playoff_brackets pb ON pb.id = pr.bracket_id
      LEFT JOIN teams ht ON ht.id = pm.home_team_id
      LEFT JOIN teams at ON at.id = pm.away_team_id
      WHERE pb.season_id = $1 AND pb.division = $2 AND pr.round_number = $3
      ORDER BY pm.order_index
    `, [season.id, division, roundNumber])
    const pairs = ms.rows.filter((m) => m.home && m.away)
    if (!pairs.length) return badRequest('That round has no filled-in matchups yet.')
    const weekNumber = 90 + roundNumber
    let created = 0
    for (const m of pairs) {
      const dupe = await query(
        `SELECT 1 FROM week_threads WHERE season_id = $1 AND week_number = $2 AND division = $3
           AND ((team1 = $4 AND team2 = $5) OR (team1 = $5 AND team2 = $4))`,
        [season.id, weekNumber, division, m.home, m.away]
      )
      if (dupe.rows.length) continue
      await query(
        `INSERT INTO week_threads (season_id, week_number, division, team1, team2) VALUES ($1, $2, $3, $4, $5)`,
        [season.id, weekNumber, division, m.home, m.away]
      )
      created += 1
    }
    return NextResponse.json({ ok: true, created, note: `Bot creates ${created} playoff thread(s) within ~60s.` })
  }

  const { brackets } = body || {}
  if (!Array.isArray(brackets)) {
    return badRequest('brackets must be an array')
  }

  await replacePlayoffBrackets(season.id, brackets, { published: true })
  return NextResponse.json({ ok: true })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'playoffs.post' })
