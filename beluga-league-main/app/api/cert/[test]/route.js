import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../lib/authOptions'
import { query } from '../../../../lib/db'
import { rateLimit, getClientIp } from '../../../../lib/rateLimit'
import { BAN_MESSAGE, isAccessBlocked, logSecurityEvent } from '../../../../lib/security'
import {
  CERT_TESTS, isCertTest, getApplicantState, startAttempt, saveAnswer,
  touchAttemptEvent, submitAttempt, requestRetake, recordCertEvent,
} from '../../../../lib/certStore'

// Public (link-only) GM / AGM rulebook test. Discord login required for
// everything but the signed-out shell. Grading happens in certStore — this
// route never returns a correct answer.
export const dynamic = 'force-dynamic'

const LOCATION = (test) => `${CERT_TESTS[test].short} rulebook test`

async function context(request, test) {
  const session = await getServerSession(authOptions)
  const ip = getClientIp(request)
  const discordId = session?.discordUserId ? String(session.discordUserId) : null
  const username = session?.discordUsername || null
  const ban = await isAccessBlocked({ ip, discordId, cookieGet: (n) => request.cookies.get(n)?.value })
  return { session, ip, discordId, username, ban, ua: request.headers.get('user-agent'), test }
}

async function inGuild(discordId) {
  const r = await query(`SELECT 1 FROM discord_members WHERE discord_id = $1 AND is_in_guild = TRUE`, [discordId]).catch(() => ({ rows: [] }))
  return r.rows.length > 0
}

function audit(ctx, { action, summary, details = [], outcome = 'success', stream = 'interaction', error = null }) {
  return logSecurityEvent({
    stream, error, eventType: 'test', outcome, action, location: LOCATION(ctx.test),
    actor: { name: ctx.username || 'unknown', tag: ctx.username, discordId: ctx.discordId },
    ip: ctx.ip, userAgent: ctx.ua, summary, details,
  })
}

const errorJson = (err) => NextResponse.json({ error: err.message || 'Something went wrong.' }, { status: err.status || 500 })

export async function GET(request, { params }) {
  const { test } = await params
  if (!isCertTest(test)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ctx = await context(request, test)
  if (ctx.ban) return NextResponse.json({ banned: true, message: BAN_MESSAGE })
  if (!ctx.discordId) return NextResponse.json({ signedIn: false, test: CERT_TESTS[test] })
  if (!(await inGuild(ctx.discordId))) {
    return NextResponse.json({ signedIn: true, username: ctx.username, inGuild: false, test: CERT_TESTS[test] })
  }
  try {
    const state = await getApplicantState({ discordId: ctx.discordId, test })
    return NextResponse.json({ signedIn: true, inGuild: true, username: ctx.username, test: CERT_TESTS[test], ...state })
  } catch (err) {
    return errorJson(err)
  }
}

export async function POST(request, { params }) {
  const { test } = await params
  if (!isCertTest(test)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ctx = await context(request, test)
  if (ctx.ban) return NextResponse.json({ error: BAN_MESSAGE, banned: true }, { status: 403 })
  if (!ctx.discordId) return NextResponse.json({ error: 'Sign in with Discord first.' }, { status: 401 })

  // sendBeacon posts text/plain, so read the raw body.
  let body = {}
  try { body = JSON.parse((await request.text()) || '{}') } catch { body = {} }
  const action = String(body.action || '')

  const limits = { answer: [120, 60_000], event: [40, 60_000], start: [6, 60_000], submit: [6, 60_000], retake: [3, 10 * 60_000] }
  const [limit, windowMs] = limits[action] || [20, 60_000]
  const rl = rateLimit(`cert:${test}:${action}:${ctx.discordId}`, { limit, windowMs })
  if (!rl.ok) return NextResponse.json({ error: 'Slow down a little and try again.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

  if (action !== 'event' && !(await inGuild(ctx.discordId))) {
    return NextResponse.json({ error: 'You must be a member of the Beluga League Discord to take this test.' }, { status: 403 })
  }
  const who = ctx.username || 'Someone'
  const title = CERT_TESTS[test].short

  try {
    if (action === 'start') {
      const res = await startAttempt({ discordId: ctx.discordId, username: ctx.username, test, franchiseId: body.franchiseId, ip: ctx.ip, userAgent: ctx.ua })
      if (!res.resumed) {
        await audit(ctx, {
          action: 'cert.start',
          summary: `${who} started the ${title} rulebook test for ${res.franchiseName}.`,
          details: [['Franchise', res.franchiseName], ['Questions', String(res.total)], ['Attempt', `${res.attemptNo} of ${res.allowed}`], ['Season', `Season ${res.season?.number ?? '—'}`]],
        })
      }
      return NextResponse.json({ ok: true, attemptId: res.attemptId })
    }

    if (action === 'answer') {
      const res = await saveAnswer({ discordId: ctx.discordId, username: ctx.username, test, attemptId: body.attemptId, questionId: body.questionId, choice: body.choice, ip: ctx.ip })
      return NextResponse.json(res)
    }

    if (action === 'event') {
      const event = String(body.event || '')
      const res = await touchAttemptEvent({ discordId: ctx.discordId, username: ctx.username, test, attemptId: body.attemptId, event, ip: ctx.ip })
      if (res.wrote && res.attemptId && (event === 'left' || event === 'returned')) {
        await audit(ctx, {
          action: event === 'left' ? 'cert.left' : 'cert.returned',
          summary: event === 'left'
            ? `${who} left the ${title} rulebook test part-way through.`
            : `${who} came back to the ${title} rulebook test.`,
          details: res.progress ? [['Progress', res.progress]] : [],
        })
      } else if (res.wrote && event === 'opened') {
        await audit(ctx, { action: 'cert.open', summary: `${who} opened the ${title} rulebook test page.` })
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'submit') {
      const res = await submitAttempt({ discordId: ctx.discordId, username: ctx.username, test, attemptId: body.attemptId, signature: body.signature, acknowledged: body.acknowledged, ip: ctx.ip })
      await audit(ctx, {
        action: 'cert.submit',
        outcome: res.passed ? 'success' : 'failed',
        summary: res.passed
          ? `${who} PASSED the ${title} rulebook test for ${res.franchiseName} (${res.score}/${res.total}, ${res.pct}%) — waiting for staff approval.`
          : `${who} did not pass the ${title} rulebook test for ${res.franchiseName} (${res.score}/${res.total}, ${res.pct}%).`,
        details: [['Score', `${res.score} of ${res.total} (${res.pct}%)`], ['Pass mark', `${res.passPct}%`], ['Franchise', res.franchiseName || '—'], ['Signed as', String(body.signature || '').trim().slice(0, 80)]],
      })
      return NextResponse.json({ ok: true, ...res })
    }

    if (action === 'retake') {
      await requestRetake({ discordId: ctx.discordId, username: ctx.username, test, note: body.note, ip: ctx.ip })
      await audit(ctx, {
        action: 'cert.retake-request',
        summary: `${who} asked for another attempt at the ${title} rulebook test.`,
        details: body.note ? [['Their note', String(body.note).slice(0, 300)]] : [],
      })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    if (!err.status || err.status >= 500) {
      await audit(ctx, {
        action: `cert.${action || 'unknown'}`,
        outcome: 'error',
        stream: 'error',
        error: err,
        summary: `${who}'s ${title} rulebook test request (${action || 'unknown'}) failed: ${String(err.message || err).slice(0, 200)}`,
      })
      await recordCertEvent({ discordId: ctx.discordId, username: ctx.username, test, event: 'error', details: [['Action', action || '—'], ['Error', String(err.message || err).slice(0, 300)]], ip: ctx.ip })
    }
    return errorJson(err)
  }
}
