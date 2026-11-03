import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../../lib/authOptions'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { withAudit } from '../../../../lib/activityLog'
import { rateLimit, getClientIp } from '../../../../lib/rateLimit'
import { BAN_MESSAGE, isAccessBlocked } from '../../../../lib/security'
import { ModError, getAppealState, submitAppeal } from '../../../../lib/modStore'

export const dynamic = 'force-dynamic'

// The public appeal form. Someone banned from Discord can still log in here, because
// a missing guild membership isn't a login failure. Everything is scoped to the
// signed-in person: nobody can read or file an appeal on someone else's case.

async function getHandler(request) {
  await ensureLeagueSchema()
  const session = await getServerSession(authOptions)
  if (!session?.discordUserId) return NextResponse.json({ signedIn: false, items: [], questions: [] })
  const ban = await isAccessBlocked({
    ip: getClientIp(request), discordId: session.discordUserId,
    cookieGet: (n) => request.cookies.get(n)?.value,
  })
  if (ban) return NextResponse.json({ signedIn: true, items: [], questions: [], blocked: true, message: BAN_MESSAGE })
  const state = await getAppealState(session.discordUserId)
  return NextResponse.json({ signedIn: true, username: session.discordUsername || null, ...state })
}

async function postHandler(request) {
  await ensureLeagueSchema()
  const session = await getServerSession(authOptions)
  if (!session?.discordUserId) return NextResponse.json({ error: 'Sign in with Discord first.' }, { status: 401 })
  const ban = await isAccessBlocked({
    ip: getClientIp(request), discordId: session.discordUserId,
    cookieGet: (n) => request.cookies.get(n)?.value,
  })
  if (ban) return NextResponse.json({ error: BAN_MESSAGE, banned: true }, { status: 403 })

  const rl = rateLimit(`appeal:uid:${session.discordUserId}`, { limit: 5, windowMs: 10 * 60_000 })
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }) }
  try {
    const result = await submitAppeal({
      discordId: session.discordUserId, name: session.discordUsername || null, caseId: body?.caseId, answers: body?.answers,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ModError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[applications/appeal] failed', err)
    return NextResponse.json({ error: 'The appeal could not be saved. Please try again.' }, { status: 500 })
  }
}

export const GET = withAudit(getHandler, { action: 'appeals.view' })
export const POST = withAudit(postHandler, { action: 'appeals.submit' })
