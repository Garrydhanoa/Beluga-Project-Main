import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const [reasons, panels] = await Promise.all([
    query(`SELECT * FROM ticket_reasons ORDER BY sort_order, id`),
    query(`SELECT * FROM ticket_panels ORDER BY id`),
  ])
  return NextResponse.json({ reasons: reasons.rows, panels: panels.rows })
}

// POST { action: save-reason | delete-reason | send-panel | delete-panel, ... }
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action === 'save-reason') {
    const r = body.reason || {}
    const roles = String(r.staffRoleIds || '').split(/[\s,]+/).filter(Boolean)
    const questions = Array.isArray(r.questions) ? r.questions.slice(0, 5) : []
    if (!r.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    if (r.id) {
      await query(
        `UPDATE ticket_reasons SET name=$1, emoji=$2, description=$3, welcome_message=$4,
            staff_role_ids=$5, questions=$6::jsonb, max_open_per_user=$7, is_active=$8 WHERE id=$9`,
        [r.name, r.emoji || null, r.description || null, r.welcomeMessage || null,
         roles, JSON.stringify(questions), Number(r.maxOpenPerUser) || 1, r.isActive !== false, Number(r.id)]
      )
    } else {
      await query(
        `INSERT INTO ticket_reasons (name, emoji, description, welcome_message, staff_role_ids, questions, max_open_per_user)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [r.name, r.emoji || null, r.description || null, r.welcomeMessage || null,
         roles, JSON.stringify(questions), Number(r.maxOpenPerUser) || 1]
      )
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete-reason') {
    await query(`DELETE FROM ticket_reasons WHERE id = $1`, [Number(body.id)])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'send-panel') {
    if (!body.channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })
    await query(
      `INSERT INTO ticket_panels (channel_id, title, description) VALUES ($1, $2, $3)`,
      [String(body.channelId).trim(), body.title || 'Open a ticket', body.description || null]
    )
    return NextResponse.json({ ok: true, note: 'The bot posts the panel within ~60 seconds.' })
  }

  if (body.action === 'delete-panel') {
    await query(`UPDATE ticket_panels SET is_active = FALSE WHERE id = $1`, [Number(body.id)])
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'ticket-config.post' })
