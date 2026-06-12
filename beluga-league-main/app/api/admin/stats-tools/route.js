import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { recomputeAllForSeason, recomputePlayer, logAudit } from '../../../../lib/belugaStatsAdmin'

export const dynamic = 'force-dynamic'

// Staff tools for the stats system. POST { action, ...params }:
//   recalc  { seasonId? }                        → rebuild all aggregates from game rows
//   remap   { platform, platformId, discordId }  → point a Ballchasing account at the right Discord user
//   merge   { fromDiscordId, toDiscordId }       → merge one player profile into another
export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const actor = { name: auth.session?.discordUsername || auth.session?.user?.name || 'admin' }

  if (body.action === 'recalc') {
    let seasonId = body.seasonId
    if (!seasonId) {
      const season = await getActiveSeason()
      seasonId = season?.id
    }
    if (!seasonId) return NextResponse.json({ error: 'No season' }, { status: 400 })
    await recomputeAllForSeason(seasonId)
    await logAudit({ action: 'recalc_all', actor, detail: { seasonId } })
    return NextResponse.json({ ok: true, seasonId })
  }

  if (body.action === 'remap') {
    const { platform, platformId, discordId } = body
    if (!platform || !platformId || !discordId) {
      return NextResponse.json({ error: 'platform, platformId, discordId required' }, { status: 400 })
    }
    const prev = await query(
      `SELECT discord_id FROM stats_player_accounts WHERE platform = $1 AND platform_id = $2`,
      [platform, platformId]
    )
    const prevDiscordId = prev.rows[0]?.discord_id || null

    await query(
      `INSERT INTO stats_player_accounts (discord_id, platform, platform_id, linked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (platform, platform_id)
       DO UPDATE SET discord_id = EXCLUDED.discord_id, last_seen = CURRENT_TIMESTAMP`,
      [String(discordId), platform, platformId, actor.name]
    )
    // Move every game row recorded under this account, then rebuild both players.
    const moved = await query(
      `UPDATE stats_game_players SET discord_id = $1 WHERE platform = $2 AND platform_id = $3 RETURNING id`,
      [String(discordId), platform, platformId]
    )
    if (prevDiscordId && prevDiscordId !== String(discordId)) await recomputePlayer(prevDiscordId)
    await recomputePlayer(String(discordId))
    await logAudit({ action: 'account_remapped', actor, detail: { platform, platformId, from: prevDiscordId, to: String(discordId), movedRows: moved.rows.length } })
    return NextResponse.json({ ok: true, movedRows: moved.rows.length, previousDiscordId: prevDiscordId })
  }

  if (body.action === 'merge') {
    const { fromDiscordId, toDiscordId } = body
    if (!fromDiscordId || !toDiscordId || fromDiscordId === toDiscordId) {
      return NextResponse.json({ error: 'fromDiscordId and toDiscordId (different) required' }, { status: 400 })
    }
    await query(`UPDATE stats_player_accounts SET discord_id = $1 WHERE discord_id = $2`, [String(toDiscordId), String(fromDiscordId)])
    await query(`UPDATE stats_name_history SET discord_id = $1 WHERE discord_id = $2`, [String(toDiscordId), String(fromDiscordId)])
    const moved = await query(
      `UPDATE stats_game_players SET discord_id = $1 WHERE discord_id = $2 RETURNING id`,
      [String(toDiscordId), String(fromDiscordId)]
    )
    await query(`DELETE FROM stats_player_season WHERE discord_id = $1`, [String(fromDiscordId)])
    await query(`DELETE FROM stats_player_lifetime WHERE discord_id = $1`, [String(fromDiscordId)])
    await recomputePlayer(String(toDiscordId))
    await logAudit({ action: 'players_merged', actor, detail: { from: String(fromDiscordId), to: String(toDiscordId), movedRows: moved.rows.length } })
    return NextResponse.json({ ok: true, movedRows: moved.rows.length })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
