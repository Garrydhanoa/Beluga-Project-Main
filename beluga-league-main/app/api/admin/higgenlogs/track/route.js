import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { buildRow, writeMany } from '../../../../../lib/activityLog'

export const dynamic = 'force-dynamic'

/**
 * Ingest for the admin panel's client-side activity tracker.
 *
 * The tracker batches clicks / dropdown changes / form submits / page views and
 * beacons them here. This is what makes "every click" real: an API audit alone
 * only sees the things that reached the server, so switching a tab, ticking a box
 * before saving, or opening a panel would otherwise leave no trace.
 *
 * Gated on requireAdmin (not requireSuperAdmin) ON PURPOSE: everybody with admin
 * access has their actions RECORDED here; only the super admins can READ them back
 * on /admin/dashboard/higgenlogs.
 *
 * The client never supplies the summary sentence — it sends structured fields and
 * this route composes the prose, so a tampered payload can't forge a plausible
 * log entry about someone else.
 */

const MAX_EVENTS = 60
const MAX_LEN = 200

function clean(v, n = MAX_LEN) {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

/** Names the click-target type in words rather than as a tag name. */
const KIND_WORDS = {
  button: 'button',
  link: 'link',
  tab: 'tab',
  checkbox: 'checkbox',
  radio: 'option',
  select: 'dropdown',
  toggle: 'toggle',
  form: 'form',
}

function composeSummary(actorName, e) {
  const where = [
    e.section ? `in the ${e.section} section` : null,
    e.pageName ? `on the ${e.pageName} page` : null,
  ].filter(Boolean).join(' ')

  switch (e.t) {
    case 'page_view':
      return `${actorName} opened the ${e.pageName || e.page} page.`
    case 'change':
      return `${actorName} set the “${e.label || 'unnamed'}” ${KIND_WORDS[e.kind] || 'field'} to “${e.value ?? '(blank)'}” ${where}.`.replace(/\s+\./, '.')
    case 'submit':
      return `${actorName} submitted the “${e.label || 'unnamed'}” form ${where}.`.replace(/\s+\./, '.')
    case 'client_error':
      return `${actorName}'s browser hit an error on the ${e.pageName || e.page} page: ${e.message || 'unknown error'}`
    case 'click':
    default:
      return `${actorName} clicked the “${e.label || 'unlabelled'}” ${KIND_WORDS[e.kind] || 'control'} ${where}.`.replace(/\s+\./, '.')
  }
}

export async function POST(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let payload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad payload' }, { status: 400 })
  }

  const events = Array.isArray(payload?.events) ? payload.events.slice(0, MAX_EVENTS) : []
  if (events.length === 0) return NextResponse.json({ ok: true, recorded: 0 })

  const actor = {
    name: auth.session.discordUsername || 'admin',
    tag: auth.session.discordUsername || null,
    discordId: auth.session.discordUserId || null,
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = request.headers.get('user-agent') || null
  const now = Date.now()

  const rows = events.map((raw) => {
    const e = {
      t: clean(raw?.t, 20) || 'click',
      kind: clean(raw?.kind, 20),
      label: clean(raw?.label),
      section: clean(raw?.section, 120),
      page: clean(raw?.page, 200),
      pageName: clean(raw?.pageName, 120),
      value: clean(raw?.value, 200),
      href: clean(raw?.href, 300),
      message: clean(raw?.message, 300),
      stack: clean(raw?.stack, 4000),
    }
    // Client sends how long ago the event happened rather than an absolute clock
    // reading, so a wrong browser clock can't scramble the ordering.
    const ageMs = Number(raw?.age)
    const occurredAt = Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 10 * 60 * 1000
      ? new Date(now - ageMs)
      : new Date(now)

    // Page / IP have their own columns and appear in the page's header block.
    const details = [
      ['What', `${KIND_WORDS[e.kind] || 'control'}${e.label ? ` — “${e.label}”` : ''}`],
      e.section ? ['Section', e.section] : null,
      e.value ? ['Set to', e.value] : null,
      e.href ? ['Goes to', e.href] : null,
    ].filter(Boolean)

    const isError = e.t === 'client_error'
    return buildRow({
      stream: isError ? 'error' : 'interaction',
      eventType: isError ? 'client_error' : e.t,
      actor,
      action: isError ? 'browser.error' : `ui.${e.t}`,
      target: e.label || e.page,
      location: e.pageName ? `${e.pageName} (${e.page})` : e.page,
      outcome: isError ? 'failed' : 'success',
      summary: composeSummary(actor.name, e),
      details,
      error: isError ? { message: e.message, stack: e.stack } : null,
      ip,
      userAgent,
      occurredAt,
    })
  })

  const recorded = await writeMany(rows)
  return NextResponse.json({ ok: true, recorded })
}
