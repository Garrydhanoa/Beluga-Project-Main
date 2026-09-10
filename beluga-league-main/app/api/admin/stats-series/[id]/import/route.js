import { NextResponse } from 'next/server'
import { withAudit } from '../../../../../../lib/activityLog'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { query } from '../../../../../../lib/db'
import { queueImport } from '../../../../../../lib/belugaStatsAdmin'

export const dynamic = 'force-dynamic'

// Latest import job for this series — the admin panel polls this after queueing.
export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const { id } = await params
  const r = await query(
    `SELECT id, status, source, result, error, requested_at, started_at, finished_at
       FROM stats_import_jobs WHERE series_id = $1 ORDER BY id DESC LIMIT 1`,
    [Number(id)]
  )
  return NextResponse.json({ job: r.rows[0] || null })
}

// Queue the bot to fetch this series' Ballchasing data and write the real stats.
// The website has no Ballchasing key, no rate limiter and no parser — the bot owns
// all three — so this hands the work over rather than doing it here.
async function postHandler(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const { id } = await params
  const seriesId = Number(id)

  const s = await query(
    `SELECT s.id, s.manual_override, s.ballchasing_group_url,
        (SELECT COUNT(*)::int FROM stats_games g
          WHERE g.series_id = s.id AND g.ballchasing_replay_url IS NOT NULL) AS linked_games
       FROM stats_series s WHERE s.id = $1`,
    [seriesId]
  )
  const series = s.rows[0]
  if (!series) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (series.manual_override) {
    return NextResponse.json({ error: 'This series is locked (manual override). Unlock it before importing.' }, { status: 400 })
  }
  if (!series.ballchasing_group_url && !series.linked_games) {
    return NextResponse.json({
      error: 'Nothing to import — add a Ballchasing group link for the series, or a replay link on at least one game.',
    }, { status: 400 })
  }

  // Don't stack jobs: if one is already waiting or running, report that one back.
  const open = await query(
    `SELECT id FROM stats_import_jobs WHERE series_id = $1 AND status IN ('pending','running') ORDER BY id DESC LIMIT 1`,
    [seriesId]
  )
  if (open.rows.length) {
    return NextResponse.json({ ok: true, jobId: open.rows[0].id, alreadyQueued: true })
  }

  const jobId = await queueImport(seriesId, {
    discordId: auth.session?.discordUserId || null,
    username: auth.session?.discordUsername || auth.session?.user?.name || 'admin',
  })

  return NextResponse.json({
    ok: true,
    jobId,
    source: series.linked_games ? 'replays' : 'group',
  })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'stats-series.import' })
