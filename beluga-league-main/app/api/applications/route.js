import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../lib/authOptions'
import { ensureLeagueSchema } from '../../../lib/leagueSchema'
import { query } from '../../../lib/db'
import { rateLimit, getClientIp } from '../../../lib/rateLimit'
import { BAN_MESSAGE, isAccessBlocked, logSecurityEvent } from '../../../lib/security'

export const dynamic = 'force-dynamic'

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_FILES = 3

// Public: list active forms (+ whether the visitor is signed in). A blocked IP gets
// the ban notice instead (ban scope = logins, admin, applications).
export async function GET(request) {
  await ensureLeagueSchema()
  const session = await getServerSession(authOptions)
  const ban = await isAccessBlocked({
    ip: getClientIp(request), discordId: session?.discordUserId || null,
    cookieGet: (n) => request.cookies.get(n)?.value,
  })
  if (ban) {
    return NextResponse.json({ forms: [], signedIn: false, username: null, banned: true, message: BAN_MESSAGE })
  }
  const forms = await query(
    `SELECT id, name, description, require_in_server, questions, max_file_mb FROM app_forms WHERE is_active = TRUE ORDER BY id DESC`
  ).catch(() => ({ rows: [] }))
  return NextResponse.json({
    forms: forms.rows,
    signedIn: Boolean(session?.discordUserId),
    username: session?.discordUsername || null,
  })
}

// Public: submit a form (Discord login required). multipart/form-data:
//   formId, answers (JSON [{label,value}]), files[] (≤8MB each, max 3)
export async function POST(request) {
  await ensureLeagueSchema()
  const session = await getServerSession(authOptions)
  if (!session?.discordUserId) {
    return NextResponse.json({ error: 'Sign in with Discord first.' }, { status: 401 })
  }
  const ban = await isAccessBlocked({
    ip: getClientIp(request), discordId: session.discordUserId,
    cookieGet: (n) => request.cookies.get(n)?.value,
  })
  if (ban) return NextResponse.json({ error: BAN_MESSAGE, banned: true }, { status: 403 })

  // Throttle submissions (each stores up to 3×8MB in Postgres): 5 per 10 min per user
  // and per IP, to prevent storage-exhaustion abuse.
  const uid = String(session.discordUserId)
  const ip = getClientIp(request)
  for (const key of [`apply:uid:${uid}`, `apply:ip:${ip}`]) {
    const rl = rateLimit(key, { limit: 5, windowMs: 10 * 60_000 })
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many submissions. Please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }
  }

  const formData = await request.formData()
  const formId = Number(formData.get('formId'))
  let answers
  try { answers = JSON.parse(String(formData.get('answers') || '[]')) } catch { answers = [] }

  const formRes = await query(`SELECT * FROM app_forms WHERE id = $1 AND is_active = TRUE`, [formId])
  const form = formRes.rows[0]
  if (!form) return NextResponse.json({ error: 'Form not found or closed.' }, { status: 404 })

  // "Must be in server" check via the bot-populated member directory.
  if (form.require_in_server) {
    const m = await query(
      `SELECT 1 FROM discord_members WHERE discord_id = $1 AND is_in_guild = TRUE`,
      [String(session.discordUserId)]
    ).catch(() => ({ rows: [] }))
    if (!m.rows.length) {
      return NextResponse.json({ error: 'You must be a member of the Beluga League Discord to submit this form.' }, { status: 403 })
    }
  }

  // Validate required questions.
  const questions = Array.isArray(form.questions) ? form.questions : []
  for (const q of questions) {
    if (q.required !== false) {
      const a = answers.find((x) => x.label === q.label)
      if (!a || !String(a.value || '').trim()) {
        return NextResponse.json({ error: `"${q.label}" is required.` }, { status: 400 })
      }
    }
  }

  // Files: ≤8MB each (configurable down per form), max 3. Stored in the DB so
  // the bot can FORWARD them to Discord; bytes are pruned after a successful
  // post (last-10 retention) — kept forever only if the post fails.
  const cap = Math.min(Number(form.max_file_mb || 8), 8) * 1024 * 1024
  const files = formData.getAll('files').filter((f) => f && typeof f.arrayBuffer === 'function').slice(0, MAX_FILES)
  const fileBuffers = []
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer())
    if (buf.byteLength > Math.min(cap, MAX_FILE_BYTES)) {
      return NextResponse.json({ error: `"${f.name}" is too large (max ${Math.round(Math.min(cap, MAX_FILE_BYTES) / 1024 / 1024)}MB). Use a link instead.` }, { status: 400 })
    }
    if (buf.byteLength > 0) fileBuffers.push({ name: f.name, mime: f.type || 'application/octet-stream', buf })
  }

  const sub = await query(
    `INSERT INTO app_submissions (form_id, discord_id, username, display_name, answers)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [formId, String(session.discordUserId), session.discordUsername || null, session.discordUsername || null,
     JSON.stringify(answers.slice(0, 30).map((a) => ({ label: String(a.label).slice(0, 200), value: String(a.value).slice(0, 1500) })))]
  )
  const submissionId = sub.rows[0].id
  for (const f of fileBuffers) {
    await query(
      `INSERT INTO app_files (submission_id, name, mime, size, data) VALUES ($1, $2, $3, $4, $5)`,
      [submissionId, f.name, f.mime, f.buf.byteLength, f.buf]
    )
  }

  // Login/activity history.
  await query(
    `INSERT INTO site_logins (discord_id, username, context) VALUES ($1, $2, $3)`,
    [String(session.discordUserId), session.discordUsername || null, `submitted form #${formId}`]
  ).catch(() => {})
  await logSecurityEvent({
    eventType: 'submit', outcome: 'success', action: 'applications.submit', location: 'Applications',
    actor: { name: session.discordUsername || 'unknown', tag: session.discordUsername, discordId: session.discordUserId },
    ip, userAgent: request.headers.get('user-agent'),
    summary: `${session.discordUsername || 'Someone'} submitted the “${form.name}” application.`,
    details: [
      ['Form', form.name],
      ['Submission #', String(submissionId)],
      ['Answers', String(answers.length)],
      ['Files attached', fileBuffers.length ? fileBuffers.map((f) => f.name).join(', ') : 'None'],
    ],
  })

  return NextResponse.json({ ok: true, submissionId, note: 'Submitted — staff will see it in Discord shortly.' })
}
