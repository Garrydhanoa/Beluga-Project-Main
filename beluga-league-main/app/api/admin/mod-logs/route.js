import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import {
  ModError, RULES, getOverview, listCases, getPerson, getCaseDetail, listActive, listAppeals, listFlags, listRequests,
  getFilterData, runAction, voidCase, changeReason, releasePlayer, unfreezeStaff, importHistory, testFilter,
  decideAppeal, saveSettings, addWord, setWord, deleteWord, addAllowed, deleteAllowed, setClaudeBalance,
} from '../../../../lib/modStore'

export const dynamic = 'force-dynamic'

// Admin Mod Logs tab. GET ?view=… for reads; POST { action, … } for staff actions.
// Each action is its own audit slug (mod-logs.<action>), see PHRASES. Anything that
// touches Discord is queued for the bot, and the page follows it through /action.

async function getHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const sp = new URL(request.url).searchParams
  const view = sp.get('view') || 'overview'
  try {
    switch (view) {
      case 'overview': return NextResponse.json({ ...(await getOverview()), rules: RULES })
      case 'cases': return NextResponse.json(await listCases({
        q: sp.get('q') || '', kind: sp.get('kind') || '', source: sp.get('source') || '',
        includeOld: sp.get('old') === '1', limit: sp.get('limit') || 50, offset: sp.get('offset') || 0,
      }))
      case 'person': return NextResponse.json(await getPerson(sp.get('id')))
      case 'case': return NextResponse.json(await getCaseDetail(sp.get('id')))
      case 'active': return NextResponse.json(await listActive())
      case 'appeals': return NextResponse.json(await listAppeals())
      case 'flags': return NextResponse.json(await listFlags(sp.get('status') || 'open'))
      case 'requests': return NextResponse.json(await listRequests())
      case 'filter': return NextResponse.json(await getFilterData())
      default: return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
    }
  } catch (err) {
    if (err instanceof ModError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[admin/mod-logs] GET failed', err)
    return NextResponse.json({ error: err.message || 'Failed to load mod logs' }, { status: 500 })
  }
}

const ACTIONS = {
  run: (b, actor) => runAction(b, actor),
  void: (b, actor) => voidCase({ caseId: b.caseId, reason: b.reason, actor }),
  reason: (b, actor) => changeReason({ caseId: b.caseId, reason: b.reason, actor }),
  release: (b, actor) => releasePlayer({ targetId: b.targetId, targetName: b.targetName, suspensionId: b.suspensionId, reason: b.reason, actor }),
  unfreeze: (b, actor) => unfreezeStaff({ staffId: b.staffId, actor }),
  'import-history': (b, actor) => importHistory({ actor }),
  'filter-test': (b, actor) => testFilter({ text: b.text, actor }),
  'appeal-decide': (b, actor) => decideAppeal({ appealId: b.appealId, verdict: b.verdict, note: b.note, actor }),
  settings: (b, actor) => saveSettings({ values: b.values, actor }),
  'word-add': (b, actor) => addWord({ word: b.word, tier: b.tier, actor }),
  'word-set': (b, actor) => setWord({ id: b.id, enabled: b.enabled, actor }),
  'word-delete': (b, actor) => deleteWord({ id: b.id, actor }),
  'allow-add': (b, actor) => addAllowed({ phrase: b.phrase, actor }),
  'allow-delete': (b, actor) => deleteAllowed({ id: b.id, actor }),
  'claude-balance': (b, actor) => setClaudeBalance({ amount: b.amount, actor }),
}

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const run = ACTIONS[body?.action]
  if (!run) return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const actor = { name: auth.session.discordUsername || 'admin', discordId: auth.session.discordUserId || null }
  try {
    return NextResponse.json(await run(body, actor))
  } catch (err) {
    if (err instanceof ModError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[admin/mod-logs] action failed', body?.action, err)
    return NextResponse.json({ error: 'The action failed, so nothing was changed.' }, { status: 500 })
  }
}

function actionSlug(body) {
  if (body?.action === 'run') return `mod-logs.run-${body?.kind || 'unknown'}`
  return `mod-logs.${body?.action || 'unknown'}`
}

export const GET = withAudit(getHandler, { action: 'mod-logs.view' })
export const POST = withAudit(postHandler, { action: actionSlug })
