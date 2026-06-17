import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { getActiveSeason } from '../../../../lib/leagueStore'
import { recomputeAllForSeason, recomputePlayer, logAudit } from '../../../../lib/belugaStatsAdmin'

export const dynamic = 'force-dynamic'

// Staff tools for the stats system. POST { action, ...params }:
//   recalc  { seasonId? }                        → rebuild all aggregates from game rows
//   remap   { platform, platformId, discordId }  → point a Ballchasing account at the right Discord user
//   link    { platform, platformId, discordId }  → attach an in-game account to a Discord user (alias of remap)
//   unlink  { platform, platformId }             → detach an account; its game rows leave that player's totals
//   merge   { fromDiscordId, toDiscordId }       → merge one player profile into another
async function postHandler(request) {
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

  // link is just an explicit-verb alias of remap (attach account → Discord user).
  if (body.action === 'remap' || body.action === 'link') {
    const { platform, platformId, discordId } = body
    if (!platform || !platformId || !discordId) {
      return NextResponse.json({ error: 'platform, platformId, discordId required' }, { status: 400 })
    }
    const prev = await query(
      `SELECT discord_id, current_name FROM stats_player_accounts WHERE platform = $1 AND platform_id = $2`,
      [platform, platformId]
    )
    const prevDiscordId = prev.rows[0]?.discord_id || null

    // Recover the in-game name so a re-link (esp. after unlink, which deletes the
    // account row) doesn't leave current_name NULL — otherwise the identity box
    // shows "(no name)" + the raw platform id. Prefer the existing account name,
    // else the most-recent game-row ingame_name (the same name the Unlinked Players
    // panel displayed before linking).
    const nameRow = await query(
      `SELECT ingame_name FROM stats_game_players
       WHERE platform = $1 AND platform_id = $2 AND ingame_name IS NOT NULL AND ingame_name <> ''
       ORDER BY created_at DESC NULLS LAST LIMIT 1`,
      [platform, platformId]
    ).catch(() => ({ rows: [] }))
    const resolvedName = prev.rows[0]?.current_name || nameRow.rows[0]?.ingame_name || null

    await query(
      `INSERT INTO stats_player_accounts (discord_id, platform, platform_id, current_name, linked_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (platform, platform_id)
       DO UPDATE SET discord_id = EXCLUDED.discord_id,
                     current_name = COALESCE(EXCLUDED.current_name, stats_player_accounts.current_name),
                     last_seen = CURRENT_TIMESTAMP`,
      [String(discordId), platform, platformId, resolvedName, actor.name]
    )
    // Move every game row recorded under this account, then rebuild both players.
    const moved = await query(
      `UPDATE stats_game_players SET discord_id = $1 WHERE platform = $2 AND platform_id = $3 RETURNING id`,
      [String(discordId), platform, platformId]
    )
    if (prevDiscordId && prevDiscordId !== String(discordId)) await recomputePlayer(prevDiscordId)
    await recomputePlayer(String(discordId))
    await logAudit({ action: body.action === 'link' ? 'account_linked' : 'account_remapped', actor, detail: { platform, platformId, from: prevDiscordId, to: String(discordId), movedRows: moved.rows.length } })
    return NextResponse.json({ ok: true, movedRows: moved.rows.length, previousDiscordId: prevDiscordId })
  }

  if (body.action === 'unlink') {
    const { platform, platformId } = body
    if (!platform || !platformId) {
      return NextResponse.json({ error: 'platform, platformId required' }, { status: 400 })
    }
    try {
      const prev = await query(
        `SELECT discord_id FROM stats_player_accounts WHERE platform = $1 AND platform_id = $2`,
        [platform, platformId]
      )
      const prevDiscordId = prev.rows[0]?.discord_id || null
      // Drop the account mapping, and detach its game rows so they leave the
      // player's totals (they become unassigned until re-linked/re-mapped).
      await query(`DELETE FROM stats_player_accounts WHERE platform = $1 AND platform_id = $2`, [platform, platformId])
      const moved = await query(
        `UPDATE stats_game_players SET discord_id = NULL WHERE platform = $1 AND platform_id = $2 RETURNING id`,
        [platform, platformId]
      )
      // Rebuild the player's aggregates from their remaining game rows so the
      // detached games leave their totals immediately.
      if (prevDiscordId) await recomputePlayer(prevDiscordId)
      await logAudit({ action: 'account_unlinked', actor, detail: { platform, platformId, from: prevDiscordId, detachedRows: moved.rows.length } })
      // Return `movedRows` too so the client's shared success message (which reads
      // movedRows) shows the count just like remap/link.
      return NextResponse.json({ ok: true, movedRows: moved.rows.length, detachedRows: moved.rows.length, previousDiscordId: prevDiscordId })
    } catch (e) {
      // Surface the real DB error instead of a bare 500 HTML page (the client
      // parses JSON; a non-JSON 500 looked like "nothing happened").
      return NextResponse.json({ error: `unlink failed: ${e?.message || e}` }, { status: 500 })
    }
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

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'stats-tools.post' })
