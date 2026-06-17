import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

const parseRoles = (v) => String(v || '').split(/[\s,]+/).filter(Boolean)

export async function GET(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const url = new URL(request.url)
  const formId = url.searchParams.get('formId')

  const forms = await query(`SELECT * FROM app_forms ORDER BY id DESC`)
  const params = []
  let where = ''
  if (formId) { params.push(Number(formId)); where = `WHERE s.form_id = $1` }
  const submissions = await query(`
    SELECT s.id, s.form_id, s.discord_id, s.username, s.display_name, s.answers, s.status,
      s.votes, s.message_id, s.post_failed, s.decided_by, s.decided_at, s.created_at,
      f.name AS form_name,
      (SELECT COUNT(*)::int FROM app_files af WHERE af.submission_id = s.id) AS file_count,
      (SELECT COUNT(*)::int FROM app_files af WHERE af.submission_id = s.id AND af.data IS NOT NULL) AS stored_file_count
    FROM app_submissions s JOIN app_forms f ON f.id = s.form_id
    ${where}
    ORDER BY s.id DESC LIMIT 200
  `, params)
  const logins = await query(`SELECT discord_id, username, context, logged_at FROM site_logins ORDER BY id DESC LIMIT 50`).catch(() => ({ rows: [] }))
  return NextResponse.json({ forms: forms.rows, submissions: submissions.rows, logins: logins.rows })
}

// POST { action: save-form | delete-form | decide | delete-submission }
async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.action === 'save-form') {
    const f = body.form || {}
    if (!f.name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const questions = (Array.isArray(f.questions) ? f.questions : [])
      .slice(0, 25)
      .map((q) => ({ label: String(q.label || '').slice(0, 200), type: q.type === 'paragraph' ? 'paragraph' : 'short', required: q.required !== false }))
      .filter((q) => q.label)
    const vals = [
      f.name, f.description || null, f.channelId ? String(f.channelId).trim() : null,
      f.requireInServer !== false, f.allowVotes !== false,
      parseRoles(f.voteRoleIds), parseRoles(f.decisionRoleIds), parseRoles(f.pingRoleIds),
      f.dmOnDecision !== false, f.acceptMessage || null, f.denyMessage || null,
      JSON.stringify(questions), f.isActive !== false,
    ]
    if (f.id) {
      await query(`
        UPDATE app_forms SET name=$1, description=$2, channel_id=$3, require_in_server=$4, allow_votes=$5,
          vote_role_ids=$6, decision_role_ids=$7, ping_role_ids=$8, dm_on_decision=$9,
          accept_message=$10, deny_message=$11, questions=$12::jsonb, is_active=$13
        WHERE id=$14`, [...vals, Number(f.id)])
    } else {
      await query(`
        INSERT INTO app_forms (name, description, channel_id, require_in_server, allow_votes,
          vote_role_ids, decision_role_ids, ping_role_ids, dm_on_decision, accept_message, deny_message, questions, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`, vals)
    }
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete-form') {
    await query(`DELETE FROM app_forms WHERE id = $1`, [Number(body.id)])
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'decide') {
    const status = body.status === 'accepted' ? 'accepted' : 'denied'
    await query(
      `UPDATE app_submissions SET status=$1, decided_at=CURRENT_TIMESTAMP, decided_by=$2 WHERE id=$3 AND status='pending'`,
      [status, auth.session?.discordUserId || 'admin', Number(body.id)]
    )
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'delete-submission') {
    await query(`DELETE FROM app_submissions WHERE id = $1`, [Number(body.id)]) // cascades to app_files
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// Audit every write (actor + body + status -> /higgenlogs).
export const POST = withAudit(postHandler, { action: 'applications.post' })
