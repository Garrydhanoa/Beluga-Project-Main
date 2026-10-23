import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '../../../../lib/adminAuth'
import { withAudit } from '../../../../lib/activityLog'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'
import { isSuperAdminId } from '../../../../lib/adminIds'
import {
  ONLINE_WINDOW_MS, STRIKE_WORDS, banIp, liftBan, revokeAllSessions,
  revokeSession, revokeSessionsForUser,
} from '../../../../lib/security'

export const dynamic = 'force-dynamic'

/**
 * Super-admin security controls (higgenlogs → Security):
 *   GET                       live + recent sessions, active/recent bans, recent strikes
 *   GET ?activity=<discordId> that person's latest audit entries (live activity)
 *   POST { action }           revoke | revoke-user | revoke-all | ban | unban
 * Same deniable 404 as the rest of the audit page.
 */
async function getHandler(request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const url = new URL(request.url)
  const activityFor = url.searchParams.get('activity')
  if (activityFor) {
    const r = await query(
      `SELECT id, occurred_at, event_type, outcome, summary, location, ip
         FROM higgen_logs WHERE source = 'website' AND actor_id = $1
        ORDER BY occurred_at DESC LIMIT 40`,
      [String(activityFor)]
    )
    return NextResponse.json({ activity: r.rows })
  }

  const [sessions, bans, strikes] = await Promise.all([
    query(
      `SELECT sid, discord_id, username, display_name, avatar_url, email, login_intent, gate_passed,
              is_director, is_super_admin, access_granted, ip, country, city, region, isp,
              browser, os, device_type, device_id, fp_hash, created_at, last_seen_at, last_path,
              revoked_at, revoked_by, revoke_reason,
              COALESCE(jsonb_array_length(guilds), 0) AS guild_count
         FROM web_sessions
        WHERE last_seen_at > NOW() - INTERVAL '7 days' OR (revoked_at IS NULL AND is_super_admin)
        ORDER BY last_seen_at DESC LIMIT 300`
    ),
    query(
      `SELECT * FROM ip_bans
        WHERE lifted_at IS NULL OR lifted_at > NOW() - INTERVAL '30 days'
        ORDER BY (lifted_at IS NULL) DESC, created_at DESC LIMIT 200`
    ),
    query(
      `SELECT id, at, ip, kind, path, discord_id, discord_name, detail, voided_at
         FROM security_strikes WHERE at > NOW() - INTERVAL '7 days'
        ORDER BY at DESC LIMIT 200`
    ),
  ])

  const now = Date.now()
  return NextResponse.json({
    onlineWindowSeconds: Math.round(ONLINE_WINDOW_MS / 1000),
    sessions: sessions.rows.map((s) => ({
      ...s,
      online: !s.revoked_at && now - new Date(s.last_seen_at).getTime() < ONLINE_WINDOW_MS,
    })),
    bans: bans.rows,
    strikes: strikes.rows.map((s) => ({ ...s, kindLabel: STRIKE_WORDS[s.kind] || s.kind })),
  })
}

const IP_RE = /^[0-9a-fA-F:.]{3,64}$/

async function postHandler(request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const by = auth.session.discordUsername || 'super admin'

  let body = {}
  try { body = await request.json() } catch { /* empty */ }
  const action = String(body.action || '')

  if (action === 'revoke') {
    const row = await revokeSession(String(body.sid || ''), by, 'Logged out by a super admin')
    if (!row) return NextResponse.json({ error: 'That session is already logged out, or it belongs to a super admin.' }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'revoke-user') {
    const id = String(body.discordId || '')
    if (isSuperAdminId(id)) return NextResponse.json({ error: 'Super admins can’t be logged out.' }, { status: 400 })
    const rows = await revokeSessionsForUser(id, by, 'Logged out everywhere by a super admin')
    return NextResponse.json({ ok: true, revoked: rows.length })
  }

  if (action === 'revoke-all') {
    const rows = await revokeAllSessions(by, 'Everyone logged out by a super admin')
    return NextResponse.json({ ok: true, revoked: rows.length })
  }

  if (action === 'ban') {
    const ip = String(body.ip || '').trim()
    if (!IP_RE.test(ip)) return NextResponse.json({ error: 'That doesn’t look like an IP address.' }, { status: 400 })
    const reason = String(body.reason || '').trim().slice(0, 300) || 'Manual block'
    const ban = await banIp({ ip, reason, by, auto: false })
    return NextResponse.json({ ok: true, ban })
  }

  if (action === 'unban') {
    const lifted = await liftBan({ id: Number(body.id), by, reason: String(body.reason || '').slice(0, 300) || null })
    if (!lifted) return NextResponse.json({ error: 'That block was already lifted.' }, { status: 400 })
    // Clear the strikes behind it so the next typo doesn't re-ban on the spot.
    await query(`UPDATE security_strikes SET voided_at = NOW() WHERE ip = $1 AND voided_at IS NULL`, [lifted.ip]).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export const GET = getHandler
export const POST = withAudit(postHandler, { action: (body) => `security.${body?.action || 'action'}` })
