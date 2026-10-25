import { NextResponse } from 'next/server'
import { withAudit } from '../../../../lib/activityLog'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import {
  InviteError, getOverview, listQueue, listInvites, getInviteDetail, listClaims, listCodes,
  listCampaigns, listAdjustments, getSettings, listTextChannels,
  approveInvite, rejectInvite, markNoInviter, assignInvite, approveClaim, rejectClaim,
  addAdjustment, tagCode, updateCampaign, endCampaign, saveSettings, requestCodeRefresh,
} from '../../../../lib/inviteStore'

export const dynamic = 'force-dynamic'

// Admin Invites tab. GET ?view=… for reads; POST { action, … } for staff actions.
// Every action is a separate audit slug (invites.<action>) — see PHRASES.

async function getHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  await ensureLeagueSchema()
  const sp = new URL(request.url).searchParams
  const view = sp.get('view') || 'overview'
  try {
    switch (view) {
      case 'overview': return NextResponse.json(await getOverview())
      case 'queue': return NextResponse.json(await listQueue())
      case 'invites': return NextResponse.json(await listInvites({
        q: sp.get('q') || '', status: sp.get('status') || '', source: sp.get('source') || '', flag: sp.get('flag') || '',
        limit: sp.get('limit') || 50, offset: sp.get('offset') || 0,
      }))
      case 'detail': return NextResponse.json(await getInviteDetail(sp.get('id')))
      case 'claims': return NextResponse.json({ claims: await listClaims(sp.get('status') || 'pending') })
      case 'codes': return NextResponse.json({ codes: await listCodes() })
      case 'campaigns': return NextResponse.json({ campaigns: await listCampaigns(), adjustments: await listAdjustments() })
      case 'settings': return NextResponse.json({ settings: await getSettings(), channels: await listTextChannels() })
      default: return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
    }
  } catch (err) {
    console.error('[admin/invites] GET failed', err)
    return NextResponse.json({ error: err.message || 'Failed to load invites' }, { status: 500 })
  }
}

const ACTIONS = {
  approve: (b, actor) => approveInvite({ inviteeId: b.inviteeId, inviterId: b.inviterId, note: b.note, actor }),
  reject: (b, actor) => rejectInvite({ inviteeId: b.inviteeId, note: b.note, actor }),
  'no-inviter': (b, actor) => markNoInviter({ inviteeId: b.inviteeId, note: b.note, actor }),
  assign: (b, actor) => assignInvite({ inviteeId: b.inviteeId, inviterId: b.inviterId, scope: b.scope, announce: !!b.announce, note: b.note, actor }),
  'claim-approve': (b, actor) => approveClaim({ claimId: b.claimId, actor }),
  'claim-reject': (b, actor) => rejectClaim({ claimId: b.claimId, note: b.note, actor }),
  adjust: (b, actor) => addAdjustment({ inviterId: b.inviterId, delta: b.delta, scope: b.scope, reason: b.reason, actor }),
  'tag-code': (b, actor) => tagCode({ code: b.code, isGeneral: !!b.isGeneral, label: b.label, actor }),
  'refresh-codes': (b, actor) => requestCodeRefresh({ actor }),
  'campaign-update': (b, actor) => updateCampaign({ name: b.name, prize: b.prize, endsAt: b.endsAt, actor }),
  'campaign-end': (b, actor) => endCampaign({ expectId: b.campaignId, confirmName: b.confirmName, actor }),
  settings: (b, actor) => saveSettings({ values: b.values, actor }),
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
    const result = await run(body, actor)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof InviteError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[admin/invites] action failed', body?.action, err)
    return NextResponse.json({ error: 'The action failed — nothing was changed.' }, { status: 500 })
  }
}

export const GET = withAudit(getHandler, { action: 'invites.view' })
export const POST = withAudit(postHandler, { action: (body) => `invites.${body?.action || 'unknown'}` })
