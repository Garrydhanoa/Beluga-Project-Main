import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '../../../../../lib/adminAuth'
import { withAudit } from '../../../../../lib/activityLog'
import {
  getAdminOverview, getAttemptDetail, decideRequest, grantAttempts, dismissRetake,
  saveQuestion, setQuestionFlags, moveQuestion, deleteQuestion, listQuestions, saveCertSettings,
} from '../../../../../lib/certStore'

export const dynamic = 'force-dynamic'

/**
 * GM / AGM rulebook test administration — the Tests tab inside higgenlogs.
 * requireSuperAdmin (ADMIN_DISCORD_IDS), NOT the director role: many directors
 * are GMs, and this route exposes every correct answer. 404s for anyone else.
 * Reads are polled (and in withAudit's READ_NOISE via the /higgenlogs prefix);
 * every write is audited.
 */

const actorOf = (session) => ({
  discordId: session?.discordUserId ? String(session.discordUserId) : null,
  name: session?.discordUsername || 'super admin',
})

const errorJson = (err) => NextResponse.json({ error: err.message || 'Something went wrong.' }, { status: err.status || 500 })

async function getHandler(request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response
  const url = new URL(request.url)
  try {
    const attemptId = url.searchParams.get('attemptId')
    if (attemptId) return NextResponse.json({ attempt: await getAttemptDetail(attemptId) })
    const overview = await getAdminOverview({ seasonId: url.searchParams.get('seasonId') })
    return NextResponse.json({
      settings: overview.settings,
      seasons: overview.seasons,
      seasonId: overview.seasonId,
      requests: overview.requests,
      attempts: overview.attempts,
      retakes: overview.retakes,
      grants: overview.grants,
      events: overview.events,
      questions: overview.questions,
    })
  } catch (err) {
    return errorJson(err)
  }
}

async function postHandler(request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const actor = actorOf(auth.session)
  try {
    switch (body.action) {
      case 'decide':
        return NextResponse.json({ ok: true, request: await decideRequest({ requestId: body.requestId, decision: body.decision, note: body.note, actor }) })
      case 'grant':
        return NextResponse.json(await grantAttempts({
          seasonId: body.seasonId, discordId: body.discordId, test: body.test, extra: body.extra,
          reason: body.reason, actor, retakeRequestId: body.retakeRequestId || null,
        }))
      case 'dismiss-retake':
        return NextResponse.json({ ok: true, retake: await dismissRetake({ retakeRequestId: body.retakeRequestId, actor }) })
      case 'question-save':
        return NextResponse.json({ ok: true, question: await saveQuestion(body.question || {}, actor) })
      case 'question-flags':
        return NextResponse.json({ ok: true, question: await setQuestionFlags(body.id, body.flags || {}, actor) })
      case 'question-move':
        return NextResponse.json({ ok: true, questions: await moveQuestion(body.id, body.direction) })
      case 'question-delete':
        await deleteQuestion(body.id)
        return NextResponse.json({ ok: true, questions: await listQuestions() })
      case 'settings':
        return NextResponse.json({ ok: true, settings: await saveCertSettings(body.settings || {}) })
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
  } catch (err) {
    return errorJson(err)
  }
}

const ACTIONS = {
  decide: 'cert.decide',
  grant: 'cert.grant',
  'dismiss-retake': 'cert.retake-dismiss',
  'question-save': 'cert.question-save',
  'question-flags': 'cert.question-save',
  'question-move': 'cert.question-reorder',
  'question-delete': 'cert.question-delete',
  settings: 'cert.settings',
}

export const GET = withAudit(getHandler, { action: 'cert.read' })
export const POST = withAudit(postHandler, { action: (body) => ACTIONS[body?.action] || 'cert.unknown' })
