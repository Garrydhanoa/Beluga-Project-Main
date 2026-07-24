import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

// Site content + settings: app_config (stats channel), quotes, montage links.
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  const [config, quotes, montage] = await Promise.all([
    query(`SELECT key, value FROM app_config`).catch(() => ({ rows: [] })),
    query(`
      SELECT q.*, m.display_name AS author_name, m.username AS author_username
      FROM site_quotes q
      LEFT JOIN discord_members m ON m.discord_id = q.author_discord_id
      ORDER BY q.id DESC
    `).catch(() => ({ rows: [] })),
    query(`SELECT * FROM site_montage ORDER BY display_order, id`).catch(() => ({ rows: [] })),
  ])

  return NextResponse.json({
    config: Object.fromEntries(config.rows.map((r) => [r.key, r.value])),
    quotes: quotes.rows,
    montage: montage.rows,
  })
}

// POST { action, ... }:
//   set-config   { key, value }
//   add-quote    { text, authorDiscordId, playerDiscordId? }
//   delete-quote { id }
//   add-montage  { youtubeUrl, title? }
//   delete-montage { id }
//   toggle-montage { id, isActive }
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action === 'set-config') {
    if (!body.key) return NextResponse.json({ error: 'key required' }, { status: 400 })
    await query(
      `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [String(body.key), body.value == null || body.value === '' ? null : String(body.value)]
    )
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'add-quote') {
    if (!body.text || !body.authorDiscordId) return NextResponse.json({ error: 'text + authorDiscordId required' }, { status: 400 })
    // Author must be a known Discord member.
    const m = await query(`SELECT discord_id FROM discord_members WHERE discord_id = $1`, [String(body.authorDiscordId)])
    if (!m.rows.length) return NextResponse.json({ error: 'Author must be a Discord member (use their Discord ID)' }, { status: 400 })
    await query(
      `INSERT INTO site_quotes (text, author_discord_id, player_discord_id) VALUES ($1, $2, $3)`,
      [String(body.text).slice(0, 300), String(body.authorDiscordId), body.playerDiscordId ? String(body.playerDiscordId) : null]
    )
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete-quote') {
    await query(`DELETE FROM site_quotes WHERE id = $1`, [Number(body.id)])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'add-montage') {
    const url = String(body.youtubeUrl || '')
    if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) {
      return NextResponse.json({ error: 'Must be a YouTube link' }, { status: 400 })
    }
    await query(`INSERT INTO site_montage (youtube_url, title) VALUES ($1, $2)`, [url, body.title || null])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete-montage') {
    await query(`DELETE FROM site_montage WHERE id = $1`, [Number(body.id)])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'toggle-montage') {
    await query(`UPDATE site_montage SET is_active = $1 WHERE id = $2`, [Boolean(body.isActive), Number(body.id)])
    return NextResponse.json({ ok: true })
  }

  // Award roles: admin provides a role ID; the label auto-resolves from the
  // bot-synced discord_roles mirror. Stored as app_config.award_roles JSON.
  if (body.action === 'add-award-role') {
    const roleId = String(body.roleId || '').trim()
    if (!/^\d{16,20}$/.test(roleId)) return NextResponse.json({ error: 'Provide a valid role ID' }, { status: 400 })
    const role = await query(`SELECT name FROM discord_roles WHERE role_id = $1`, [roleId]).catch(() => ({ rows: [] }))
    const label = role.rows[0]?.name || body.label || `Role ${roleId.slice(-4)}`
    const cur = await query(`SELECT value FROM app_config WHERE key = 'award_roles'`)
    let list = []
    try { list = JSON.parse(cur.rows[0]?.value || '[]') } catch { list = [] }
    if (!list.some((r) => r.roleId === roleId)) list.push({ roleId, label })
    await query(
      `INSERT INTO app_config (key, value, updated_at) VALUES ('award_roles', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(list)]
    )
    return NextResponse.json({ ok: true, label, detected: Boolean(role.rows[0]?.name) })
  }

  if (body.action === 'remove-award-role') {
    const cur = await query(`SELECT value FROM app_config WHERE key = 'award_roles'`)
    let list = []
    try { list = JSON.parse(cur.rows[0]?.value || '[]') } catch { list = [] }
    list = list.filter((r) => r.roleId !== String(body.roleId))
    await query(`UPDATE app_config SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = 'award_roles'`, [JSON.stringify(list)])
    await query(`DELETE FROM award_role_holders WHERE role_id = $1`, [String(body.roleId)]).catch(() => {})
    // Also purge durable award-role memory so a de-configured role is never
    // re-granted to a member on rejoin.
    await query(`DELETE FROM award_role_memory WHERE role_id = $1`, [String(body.roleId)]).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'site-content.post' })
