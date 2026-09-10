import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { createSeries, queueImport, logAudit } from '../../../../lib/belugaStatsAdmin'

export const dynamic = 'force-dynamic'

// List reported series (new stats system) with filters.
export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const url = new URL(request.url)
  let seasonId = url.searchParams.get('seasonId')
  if (!seasonId) {
    const season = await getActiveSeason()
    seasonId = season?.id || null
  }
  const division = url.searchParams.get('division')
  const week = url.searchParams.get('week')
  const status = url.searchParams.get('status')

  const params = []
  const where = []
  if (seasonId) { params.push(seasonId); where.push(`s.season_id = $${params.length}`) }
  if (division) { params.push(division); where.push(`s.division = $${params.length}`) }
  if (week) { params.push(Number(week)); where.push(`s.week = $${params.length}`) }
  if (status) { params.push(status); where.push(`s.status = $${params.length}`) }

  const r = await query(
    `SELECT s.id, s.division, s.week, s.is_playoff, s.is_forfeit, s.forfeit_kind, s.home_score, s.away_score,
        s.status, s.format, s.reported_via, s.reported_by_discord_id, s.manual_override,
        s.ballchasing_group_url, s.confirmed_at, s.created_at,
        ht.name AS home_team, at.name AS away_team,
        (SELECT COUNT(*)::int FROM stats_games g WHERE g.series_id = s.id) AS game_count
     FROM stats_series s
     LEFT JOIN teams ht ON ht.id = s.home_team_id
     LEFT JOIN teams at ON at.id = s.away_team_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.created_at DESC, s.id DESC
     LIMIT 300`,
    params
  )

  return NextResponse.json({
    seasonId,
    series: r.rows.map((row) => ({
      id: row.id,
      division: row.division,
      week: row.week,
      isPlayoff: row.is_playoff,
      isForfeit: row.is_forfeit,
      forfeitKind: row.forfeit_kind,
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      homeScore: row.home_score,
      awayScore: row.away_score,
      status: row.status,
      format: row.format,
      reportedVia: row.reported_via,
      reportedBy: row.reported_by_discord_id,
      manualOverride: row.manual_override,
      replayGroupUrl: row.ballchasing_group_url,
      gameCount: row.game_count,
      confirmedAt: row.confirmed_at,
      createdAt: row.created_at,
    })),
  })
}

// Report a series BY HAND — the admin "Report a series" tool. Everything the bot's
// captain flow demands (a complete, parseable Ballchasing group) is optional here:
// staff may be recording a series that never had a group at all. If any Ballchasing
// links are attached, a job is queued for the bot to pull the real stats in.
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const isDoubleFF = body.forfeitKind === 'double'
  const isForfeit = Boolean(body.isForfeit) || isDoubleFF

  // A week-less series is invisible to the unreported-week check (it matches on
  // s.week = wt.week_number), which would leave the matchup permanently
  // "unreported" and block that week from ever being closed. So: required.
  const week = body.week === '' || body.week == null ? null : Number(body.week)
  if (!Number.isFinite(week)) {
    return NextResponse.json({ error: 'A week number is required — without one this series can never be matched to its week thread, and that week could never be closed.' }, { status: 400 })
  }

  let seasonId = body.seasonId
  if (!seasonId) seasonId = (await getActiveSeason())?.id
  if (!seasonId) return NextResponse.json({ error: 'No active season.' }, { status: 400 })

  const games = Array.isArray(body.games) ? body.games : []

  try {
    const created = await createSeries({
      seasonId,
      division: body.division,
      week,
      isPlayoff: Boolean(body.isPlayoff),
      format: body.format === 'bo7' ? 'bo7' : 'bo5',
      homeTeamId: Number(body.homeTeamId),
      awayTeamId: Number(body.awayTeamId),
      // Forfeits carry a fixed score: full FF = 1-0, double FF = 0-0 with no winner
      // and no game rows (recomputeTeamSeason charges both teams a 0-1 loss).
      homeScore: isDoubleFF ? 0 : body.isForfeit ? 1 : body.homeScore ?? null,
      awayScore: isForfeit ? 0 : body.awayScore ?? null,
      isForfeit,
      forfeitKind: isForfeit ? (isDoubleFF ? 'double' : 'full') : null,
      scheduleMatchId: body.scheduleMatchId ? Number(body.scheduleMatchId) : null,
      groupUrl: body.groupUrl || null,
      games: isForfeit
        ? (isDoubleFF ? [] : [{ gameNumber: 1, homeGoals: 1, awayGoals: 0, isForfeit: true }])
        : games,
      reportedBy: { discordId: auth.session?.discordUserId || null },
      allowDuplicate: Boolean(body.allowDuplicate),
    })

    // Queue the Ballchasing pull if there is anything to pull from.
    const hasLinks = Boolean(body.groupUrl) || games.some((g) => g.replayUrl)
    let importJobId = null
    if (hasLinks && !isForfeit) {
      importJobId = await queueImport(created.seriesId, {
        discordId: auth.session?.discordUserId || null,
        username: auth.session?.discordUsername || auth.session?.user?.name || 'admin',
      })
    }

    await logAudit({
      seriesId: created.seriesId,
      action: 'series_reported',
      actor: { discordId: auth.session?.discordUserId, name: auth.session?.discordUsername || auth.session?.user?.name || 'admin' },
      detail: {
        division: body.division, week, forfeitKind: isForfeit ? (isDoubleFF ? 'double' : 'full') : null,
        score: `${created.homeScore}-${created.awayScore}`, games: games.length, queuedImport: Boolean(importJobId),
      },
    })

    return NextResponse.json({ ok: true, ...created, importJobId })
  } catch (e) {
    const status = e.code === 'DUPLICATE' ? 409 : e.code === 'GROUP_TAKEN' || e.code === 'SCHEDULE_TAKEN' ? 409 : 400
    return NextResponse.json({ error: e.message || 'Could not report the series', code: e.code || null, seriesId: e.seriesId || null }, { status })
  }
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'stats-series.create' })
