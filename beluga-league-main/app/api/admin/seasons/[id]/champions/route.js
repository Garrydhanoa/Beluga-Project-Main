import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { listChampions, setChampion, clearChampion, getChampion } from '../../../../../../lib/championStore'
import { query } from '../../../../../../lib/db'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  await ensureLeagueSchema()
  const champions = await listChampions({ seasonId, includeFuture: true })

  // Also return the teams available in this season (for the picker)
  const teamsRes = await query(`
    SELECT id, name, division, is_active
    FROM teams
    WHERE season_id = $1
    ORDER BY division, name
  `, [seasonId])

  return NextResponse.json({
    champions,
    teams: teamsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      division: r.division,
      isActive: r.is_active,
    })),
  })
}

async function putHandler(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  // Auto-determine: read each division's playoff FINALS matchup teams, then tally
  // the confirmed series winner between them — same logic the bot uses on a
  // reported finals (maybeRecordChampion). Returns SUGGESTIONS only (does not
  // overwrite); the operator reviews and clicks Set Champion. No `division`
  // required for this action.
  if (body.autofill) {
    const finalsRes = await query(`
      SELECT pb.division, pm.home_team_id, pm.away_team_id,
             ht.name AS home_name, at.name AS away_name
      FROM playoff_matchups pm
      JOIN playoff_rounds pr ON pr.id = pm.round_id
      JOIN playoff_brackets pb ON pb.id = pr.bracket_id
      LEFT JOIN teams ht ON ht.id = pm.home_team_id
      LEFT JOIN teams at ON at.id = pm.away_team_id
      WHERE pb.season_id = $1 AND pr.is_finals = TRUE
    `, [seasonId]).catch(() => ({ rows: [] }))

    const suggestions = []
    for (const f of finalsRes.rows) {
      if (!f.home_team_id || !f.away_team_id) continue
      // Tally confirmed series wins between the two finalists for this division.
      const seriesRes = await query(`
        SELECT winner_team_id
        FROM stats_series
        WHERE season_id = $1 AND division = $2 AND status = 'confirmed'
          AND ((home_team_id = $3 AND away_team_id = $4)
            OR (home_team_id = $4 AND away_team_id = $3))
      `, [seasonId, f.division, f.home_team_id, f.away_team_id]).catch(() => ({ rows: [] }))
      let homeWins = 0; let awayWins = 0
      for (const s of seriesRes.rows) {
        if (s.winner_team_id === f.home_team_id) homeWins += 1
        else if (s.winner_team_id === f.away_team_id) awayWins += 1
      }
      if (homeWins === 0 && awayWins === 0) continue // finals not yet decided
      const winnerTeamId = homeWins >= awayWins ? f.home_team_id : f.away_team_id
      const winnerName = homeWins >= awayWins ? f.home_name : f.away_name
      const existing = await getChampion(seasonId, f.division)
      suggestions.push({
        division: f.division,
        teamId: winnerTeamId,
        teamName: winnerName,
        homeWins,
        awayWins,
        alreadySet: !!existing,
        currentTeamId: existing?.teamId ?? null,
      })
    }
    return NextResponse.json({ ok: true, suggestions })
  }

  const division = (body.division || '').trim()
  if (!division) return badRequest('division required')

  if (body.clear) {
    await clearChampion(seasonId, division)
    return NextResponse.json({ ok: true, cleared: true })
  }

  const teamId = body.teamId != null ? Number(body.teamId) : null
  if (teamId != null && !Number.isInteger(teamId)) return badRequest('Invalid teamId')

  const champion = await setChampion({
    seasonId,
    division,
    teamId,
    gmDiscordId: body.gmDiscordId || null,
    gmDisplayName: body.gmDisplayName || null,
    notes: body.notes || null,
  })
  return NextResponse.json({ ok: true, champion })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const PUT = withAudit(putHandler, { action: 'seasons.champions.put' })
