// Invite campaign — reads for the public /invites page + homepage preview, and the
// admin Invites tab's reads and staff actions.
//
// The bot owns tracking (joins, Discord join data, registrations); this module
// records STAFF decisions straight into the DB and queues anything that has to be
// said in Discord onto `invite_actions` (+ NOTIFY) for the bot to post.
//
// MIRRORED with the bot:
//   countsSql()   ⇄ Beluga Bot/src/invites/inviteCounts.js  (the counting rule)
//   endCampaign() ⇄ Beluga Bot/src/invites/inviteCampaign.js (archiveAndReset)
// Keep them byte-identical in behaviour.

import { query, getPool } from './db'
import { getMemberMap } from './discordMembers'

export const DEFAULT_SETTINGS = {
  invite_channel_id: '1563757886176493568',
  staff_channel_id: '1299015210702737429',
  min_account_age_days: '30',
  claim_window_days: '5',
  dm_inviter: 'true',
}
const EDITABLE_SETTINGS = ['live_board_channel_id', 'invite_channel_id', 'staff_channel_id', 'min_account_age_days', 'claim_window_days', 'dm_inviter']

export const FLAG_TEXT = {
  new_account: 'Account is younger than the minimum age',
  rejoiner: 'Has been in the server before',
  self_invite: 'Used their own invite',
  ambiguous: 'The bot could not tell which invite was used',
  inviter_left: 'The inviter is no longer in the server',
  disagreement: "Discord's join data and the bot's invite count disagree",
  unverified: "Discord's join data was unavailable — this is the bot's best guess",
  sheet_only: 'Appeared in the SalSheet without running /register',
}

export const SOURCE_TEXT = {
  invite: 'Personal invite',
  vanity: 'Vanity invite',
  discovery: 'Server Discovery',
  general: 'General link',
  bot_invite: 'Invite made by a bot',
  oauth: 'Added by a bot',
  integration: 'Integration',
  hub: 'Student Hub',
  manual: 'Staff entry',
  manual_verification: 'Member application',
  lobby: 'Linked lobby',
  unknown: 'Unknown',
}

export const STATUS_TEXT = {
  tracked: 'Not registered yet',
  counted: 'Counted',
  pending_review: 'Needs review',
  claimable: 'Claimable',
  unattributed: 'No inviter',
  rejected: 'Rejected',
}

// ── counting (MIRRORED — see header) ──────────────────────────────────────────

export function countsSql(scope) {
  const campaign = scope === 'campaign'
  return `
        WITH c AS (
            SELECT inviter_id AS id, COUNT(*)::int AS n, MAX(counted_at) AS last_at
              FROM invites
             WHERE status = 'counted' AND in_guild AND inviter_id IS NOT NULL
               ${campaign ? 'AND credited_campaign_id = $1' : ''}
             GROUP BY inviter_id
        ), a AS (
            SELECT inviter_id AS id, SUM(delta)::int AS n, MAX(created_at) AS last_at
              FROM invite_adjustments
             WHERE ${campaign ? `scope IN ('both','campaign') AND campaign_id = $1` : `scope IN ('both','lifetime')`}
             GROUP BY inviter_id
        ), t AS (
            SELECT COALESCE(c.id, a.id) AS id,
                   COALESCE(c.n, 0) + COALESCE(a.n, 0) AS total,
                   GREATEST(c.last_at, a.last_at) AS last_at
              FROM c FULL OUTER JOIN a ON a.id = c.id
        )
        SELECT t.id, t.total, t.last_at
          FROM t
          LEFT JOIN discord_members dm ON dm.discord_id = t.id
         WHERE t.total > 0 AND COALESCE(dm.is_in_guild, TRUE) AND COALESCE(dm.is_bot, FALSE) = FALSE
         ORDER BY t.total DESC, t.last_at ASC NULLS LAST, t.id ASC`
}

async function rankedRows(scope, campaignId = null) {
  if (scope === 'campaign' && !campaignId) return []
  const { rows } = await query(countsSql(scope), scope === 'campaign' ? [campaignId] : [])
  return rows.map((r, i) => ({ id: String(r.id), total: Number(r.total), rank: i + 1 }))
}

export async function getActiveCampaign() {
  const { rows } = await query(`SELECT * FROM invite_campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 1`)
  return rows[0] ? campaignOut(rows[0]) : null
}

async function lastResetAt() {
  const { rows } = await query(`SELECT ended_at FROM invite_campaigns WHERE status = 'ended' AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT 1`)
  return rows[0]?.ended_at || null
}

function campaignOut(r) {
  return {
    id: r.id,
    name: r.name,
    prize: r.prize || null,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    endedAt: r.ended_at,
    status: r.status,
    endPingedAt: r.end_pinged_at,
    finalTop: Array.isArray(r.final_top) ? r.final_top : [],
    createdBy: r.created_by,
    endedBy: r.ended_by,
  }
}

function person(map, id) {
  if (!id) return null
  const m = map.get(String(id))
  return {
    discordId: String(id),
    name: m?.displayName || m?.username || `User ${String(id).slice(-4)}`,
    avatarUrl: m?.avatarUrl || null,
    inGuild: m ? m.isInGuild !== false : null,
  }
}

/** `<@123>` in stored history → the member's name, for the admin tab. */
function readable(text, map) {
  return String(text || '').replace(/<@!?(\d+)>/g, (_, id) => `@${person(map, id).name}`)
}

const withPeople = (rows, map) => rows.map((r) => ({ ...r, ...person(map, r.id) }))

// ── public ────────────────────────────────────────────────────────────────────

/** The public /invites page. Counts only — never who invited whom. */
export async function getPublicInvites() {
  const map = await getMemberMap().catch(() => new Map())
  const campaign = await getActiveCampaign()
  const [campaignRows, lifetimeRows, lastReset, past, claimables] = await Promise.all([
    rankedRows('campaign', campaign?.id),
    rankedRows('lifetime'),
    lastResetAt(),
    query(`SELECT * FROM invite_campaigns WHERE status = 'ended' ORDER BY ended_at DESC LIMIT 12`),
    query(`
      SELECT i.invitee_id, i.source_type, i.invite_code, i.claimable_until, c.label,
             EXISTS (SELECT 1 FROM invite_claims k WHERE k.invitee_id = i.invitee_id AND k.status = 'pending') AS claim_pending
        FROM invites i LEFT JOIN invite_codes c ON c.code = i.invite_code
       WHERE i.status = 'claimable' AND i.in_guild AND i.claimable_until > NOW()
       ORDER BY i.claimable_until ASC`),
  ])
  return {
    campaign,
    lastReset,
    campaignTop: withPeople(campaignRows.slice(0, 100), map),
    lifetimeTop: withPeople(lifetimeRows.slice(0, 100), map),
    pastCampaigns: past.rows.map((r) => {
      const c = campaignOut(r)
      return { ...c, finalTop: c.finalTop.slice(0, 10).map((t) => ({ ...t, ...person(map, t.id) })) }
    }),
    claimables: claimables.rows.map((r) => ({
      ...person(map, r.invitee_id),
      source: r.source_type === 'general' && r.label ? `General link: ${r.label}` : (SOURCE_TEXT[r.source_type] || 'Unknown'),
      claimableUntil: r.claimable_until,
      claimPending: r.claim_pending,
    })),
  }
}

/** Homepage "Top Inviters" strip. */
export async function getInvitePreview(limit = 5) {
  const map = await getMemberMap().catch(() => new Map())
  const campaign = await getActiveCampaign()
  const rows = await rankedRows('campaign', campaign?.id)
  return { campaign, top: withPeople(rows.slice(0, limit), map) }
}

// ── admin reads ───────────────────────────────────────────────────────────────

export async function getSettings() {
  const out = { ...DEFAULT_SETTINGS }
  const { rows } = await query('SELECT key, value FROM invite_settings')
  for (const r of rows) if (r.value !== null && r.value !== '') out[r.key] = r.value
  let health = null
  try { health = out.member_search_health ? JSON.parse(out.member_search_health) : null } catch { /* ignore */ }
  return { ...out, health }
}

function inviteOut(r, map) {
  return {
    invitee: person(map, r.invitee_id),
    inviter: person(map, r.inviter_id),
    discordInviter: person(map, r.discord_inviter_id),
    diffInviter: person(map, r.diff_inviter_id),
    status: r.status,
    statusText: STATUS_TEXT[r.status] || r.status,
    source: r.source_type,
    sourceText: r.source_type === 'general' && r.code_label ? `General link: ${r.code_label}` : (SOURCE_TEXT[r.source_type] || r.source_type),
    inviteCode: r.invite_code,
    diffCode: r.diff_code,
    diffResult: r.diff_result,
    verifiedVia: r.verified_via,
    flags: (r.flags || []).map((f) => ({ key: f, text: FLAG_TEXT[f] || f })),
    inGuild: r.in_guild,
    joinedAt: r.joined_at,
    leftAt: r.left_at,
    joinCount: r.join_count,
    accountCreatedAt: r.account_created_at,
    preLaunch: r.pre_launch,
    registeredAt: r.registered_at,
    countedAt: r.counted_at,
    creditedCampaignId: r.credited_campaign_id,
    claimableUntil: r.claimable_until,
    notifiedAt: r.notified_at,
    adminLocked: r.admin_locked,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    pendingClaims: Number(r.pending_claims || 0),
  }
}

const INVITE_SELECT = `
  SELECT i.*, c.label AS code_label,
         (SELECT COUNT(*) FROM invite_claims k WHERE k.invitee_id = i.invitee_id AND k.status = 'pending') AS pending_claims
    FROM invites i LEFT JOIN invite_codes c ON c.code = i.invite_code`

export async function getOverview() {
  const map = await getMemberMap().catch(() => new Map())
  const [settings, campaign, totals, campaignRows, lifetimeRows, lastReset] = await Promise.all([
    getSettings(),
    getActiveCampaign(),
    query(`
      SELECT COUNT(*) FILTER (WHERE status = 'counted' AND in_guild)::int AS counted,
             COUNT(*) FILTER (WHERE status = 'pending_review' AND in_guild)::int AS pending,
             COUNT(*) FILTER (WHERE status = 'claimable' AND in_guild)::int AS claimable,
             COUNT(*) FILTER (WHERE status = 'tracked' AND in_guild)::int AS tracked,
             COUNT(*) FILTER (WHERE status = 'unattributed')::int AS unattributed,
             COUNT(*)::int AS total
        FROM invites`),
    rankedRows('campaign', (await getActiveCampaign())?.id),
    rankedRows('lifetime'),
    lastResetAt(),
  ])
  const claims = await query(`SELECT COUNT(*)::int AS n FROM invite_claims WHERE status = 'pending'`)
  return {
    settings,
    campaign,
    lastReset,
    totals: { ...totals.rows[0], pendingClaims: claims.rows[0].n },
    campaignTop: withPeople(campaignRows.slice(0, 10), map),
    lifetimeTop: withPeople(lifetimeRows.slice(0, 10), map),
  }
}

export async function listQueue() {
  const map = await getMemberMap().catch(() => new Map())
  const { rows } = await query(`${INVITE_SELECT} WHERE i.status = 'pending_review' AND i.in_guild ORDER BY i.registered_at ASC NULLS LAST`)
  const claims = await listClaims('pending')
  return { items: rows.map((r) => inviteOut(r, map)), claims }
}

export async function listInvites({ q = '', status = '', source = '', flag = '', limit = 50, offset = 0 } = {}) {
  const map = await getMemberMap().catch(() => new Map())
  const where = []
  const params = []
  if (status) { params.push(status); where.push(`i.status = $${params.length}`) }
  if (source) { params.push(source); where.push(`i.source_type = $${params.length}`) }
  if (flag) { params.push(flag); where.push(`$${params.length} = ANY(i.flags)`) }
  const needle = String(q || '').trim().toLowerCase()
  if (needle) {
    // Match names through the member mirror, or a raw id / invite code.
    const ids = [...map.values()].filter((m) => (m.displayName || '').toLowerCase().includes(needle) || (m.username || '').toLowerCase().includes(needle)).map((m) => m.discordId).slice(0, 500)
    params.push(ids)
    const idx = params.length
    params.push(needle)
    where.push(`(i.invitee_id = ANY($${idx}::text[]) OR i.inviter_id = ANY($${idx}::text[]) OR i.invitee_id = $${params.length} OR i.inviter_id = $${params.length} OR LOWER(COALESCE(i.invite_code,'')) = $${params.length})`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = await query(`SELECT COUNT(*)::int AS n FROM invites i ${whereSql}`, params)
  params.push(Math.min(200, Math.max(1, Number(limit) || 50)))
  params.push(Math.max(0, Number(offset) || 0))
  const { rows } = await query(
    `${INVITE_SELECT} ${whereSql} ORDER BY COALESCE(i.registered_at, i.joined_at) DESC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )
  return { total: total.rows[0].n, items: rows.map((r) => inviteOut(r, map)) }
}

export async function getInviteDetail(inviteeId) {
  const map = await getMemberMap().catch(() => new Map())
  const { rows } = await query(`${INVITE_SELECT} WHERE i.invitee_id = $1`, [String(inviteeId)])
  const events = await query(`SELECT * FROM invite_events WHERE invitee_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [String(inviteeId)])
  const claims = await query(`SELECT * FROM invite_claims WHERE invitee_id = $1 ORDER BY created_at DESC`, [String(inviteeId)])
  return {
    invite: rows[0] ? inviteOut(rows[0], map) : null,
    events: events.rows.map((e) => ({ id: String(e.id), kind: e.kind, summary: readable(e.summary, map), actor: e.actor_name || null, at: e.created_at })),
    claims: claims.rows.map((c) => claimOut(c, map)),
  }
}

function claimOut(c, map) {
  return {
    id: c.id,
    invitee: person(map, c.invitee_id),
    claimer: person(map, c.claimer_id),
    status: c.status,
    createdAt: c.created_at,
    decidedBy: c.decided_by,
    decidedAt: c.decided_at,
    note: c.note,
  }
}

export async function listClaims(status = 'pending') {
  const map = await getMemberMap().catch(() => new Map())
  const { rows } = status === 'all'
    ? await query(`SELECT * FROM invite_claims ORDER BY created_at DESC LIMIT 200`)
    : await query(`SELECT * FROM invite_claims WHERE status = $1 ORDER BY created_at DESC LIMIT 200`, [status])
  // Attach the invitee's state so staff see if the claim would count right away.
  const inviteRows = rows.length
    ? (await query(`${INVITE_SELECT} WHERE i.invitee_id = ANY($1::text[])`, [[...new Set(rows.map((r) => r.invitee_id))]])).rows
    : []
  const byInvitee = new Map(inviteRows.map((r) => [String(r.invitee_id), inviteOut(r, map)]))
  return rows.map((c) => ({ ...claimOut(c, map), invite: byInvitee.get(String(c.invitee_id)) || null }))
}

export async function listCodes() {
  const map = await getMemberMap().catch(() => new Map())
  const { rows } = await query(`
    SELECT c.*, (SELECT COUNT(*) FROM invites i WHERE i.invite_code = c.code)::int AS tracked_joins
      FROM invite_codes c
     ORDER BY c.deleted_at IS NOT NULL, c.is_vanity DESC, c.uses DESC, c.code
     LIMIT 1000`)
  return rows.map((r) => ({
    code: r.code,
    creator: person(map, r.inviter_id),
    creatorIsBot: r.inviter_is_bot,
    channelId: r.channel_id,
    uses: r.uses,
    maxUses: r.max_uses,
    expiresAt: r.expires_at,
    deletedAt: r.deleted_at,
    isVanity: r.is_vanity,
    isGeneral: r.is_general,
    label: r.label,
    trackedJoins: r.tracked_joins,
  }))
}

export async function listCampaigns() {
  const map = await getMemberMap().catch(() => new Map())
  const { rows } = await query(`SELECT * FROM invite_campaigns ORDER BY id DESC LIMIT 50`)
  return rows.map((r) => {
    const c = campaignOut(r)
    return { ...c, finalTop: c.finalTop.map((t) => ({ ...t, ...person(map, t.id) })) }
  })
}

export async function listAdjustments(limit = 100) {
  const map = await getMemberMap().catch(() => new Map())
  const { rows } = await query(`SELECT * FROM invite_adjustments ORDER BY created_at DESC LIMIT $1`, [limit])
  return rows.map((r) => ({ id: r.id, inviter: person(map, r.inviter_id), delta: r.delta, scope: r.scope, campaignId: r.campaign_id, reason: r.reason, actor: r.actor_name, at: r.created_at }))
}

export async function listTextChannels() {
  const { rows } = await query(
    `SELECT channel_id, name, parent_name FROM discord_channels WHERE type IN (0, 5) ORDER BY parent_name NULLS FIRST, position, name`
  ).catch(() => ({ rows: [] }))
  return rows.map((r) => ({ id: r.channel_id, name: r.name, category: r.parent_name || null }))
}

/** "Invited by X · Invited N" for the admin player panel. */
export async function getPlayerInviteSummary(discordId) {
  const map = await getMemberMap().catch(() => new Map())
  const id = String(discordId)
  const [by, life] = await Promise.all([
    query(`SELECT inviter_id, status, source_type FROM invites WHERE invitee_id = $1`, [id]),
    rankedRows('lifetime'),
  ])
  const row = by.rows[0]
  const me = life.find((r) => r.id === id)
  return {
    invitedBy: row?.inviter_id && row.status !== 'rejected' ? person(map, row.inviter_id) : null,
    joinSource: row ? (SOURCE_TEXT[row.source_type] || row.source_type) : null,
    lifetimeInvites: me?.total || 0,
  }
}

// ── admin actions ─────────────────────────────────────────────────────────────

async function enqueue(action, payload, actor) {
  await query(
    `INSERT INTO invite_actions (action, payload, requested_by_discord_id, requested_by_username) VALUES ($1, $2::jsonb, $3, $4)`,
    [action, JSON.stringify(payload || {}), actor?.discordId || null, actor?.name || null]
  )
  await query('NOTIFY invite_actions').catch(() => {})
}

async function logEvent(client, { inviteeId = null, inviterId = null, kind, summary, actor }) {
  await (client || { query }).query(
    `INSERT INTO invite_events (invitee_id, inviter_id, kind, summary, actor_id, actor_name) VALUES ($1, $2, $3, $4, $5, $6)`,
    [inviteeId, inviterId, kind, String(summary).slice(0, 600), actor?.discordId || null, actor?.name || null]
  )
}

async function getRow(id) {
  const { rows } = await query('SELECT * FROM invites WHERE invitee_id = $1', [String(id)])
  return rows[0] || null
}

/** The campaign a decided invite counts toward: the one it registered in, if still running. */
async function creditCampaignFor(row) {
  const active = await getActiveCampaign()
  if (!active) return null
  if (!row?.credited_campaign_id) return null
  return row.credited_campaign_id === active.id ? active.id : null
}

class InviteError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}
export { InviteError }

function requireId(v, label) {
  const s = String(v || '').trim()
  if (!/^\d{15,22}$/.test(s)) throw new InviteError(`${label} must be a Discord member.`)
  return s
}

/** Approve a queued invite (optionally crediting someone else). */
export async function approveInvite({ inviteeId, inviterId, actor, note }) {
  const id = requireId(inviteeId, 'Invitee')
  const row = await getRow(id)
  if (!row) throw new InviteError('No invite record for that member.', 404)
  const credit = inviterId ? requireId(inviterId, 'Inviter') : row.inviter_id
  if (!credit) throw new InviteError('Pick who gets the credit.')
  if (credit === id) throw new InviteError('A member cannot be credited for inviting themselves.')
  const campaignId = await creditCampaignFor(row)
  const registered = !!row.registered_at
  await query(
    `UPDATE invites SET inviter_id = $2, status = $3, counted_at = CASE WHEN $3 = 'counted' THEN NOW() ELSE counted_at END,
            credited_campaign_id = $4, admin_locked = TRUE, verified_via = 'staff',
            decided_by = $5, decided_at = NOW(), decision_note = $6, updated_at = NOW()
      WHERE invitee_id = $1`,
    [id, credit, registered ? 'counted' : 'tracked', campaignId, actor?.name || null, note || null]
  )
  await logEvent(null, { inviteeId: id, inviterId: credit, kind: 'approved', summary: `Staff approved the invite for <@${credit}>${campaignId ? '' : registered ? ' (lifetime only — its campaign has ended)' : ' — it counts once they register'}.`, actor })
  await rejectOtherClaims(id, null, actor, 'staff credited someone else')
  if (registered) await enqueue('notify_registered', { inviteeId: id }, actor)
  return { ok: true }
}

/** Reject / remove: the invite stops counting (record kept, locked). */
export async function rejectInvite({ inviteeId, actor, note }) {
  const id = requireId(inviteeId, 'Invitee')
  const row = await getRow(id)
  if (!row) throw new InviteError('No invite record for that member.', 404)
  await query(
    `UPDATE invites SET status = 'rejected', admin_locked = TRUE, decided_by = $2, decided_at = NOW(), decision_note = $3, updated_at = NOW()
      WHERE invitee_id = $1`,
    [id, actor?.name || null, note || null]
  )
  await logEvent(null, { inviteeId: id, inviterId: row.inviter_id, kind: 'rejected', summary: `Staff removed this invite${row.inviter_id ? ` from <@${row.inviter_id}>` : ''}${note ? ` — ${note}` : ''}.`, actor })
  await enqueue('refresh_board', {}, actor)
  return { ok: true }
}

/** Close an item with no inviter (e.g. a Discovery join nobody claimed). */
export async function markNoInviter({ inviteeId, actor, note }) {
  const id = requireId(inviteeId, 'Invitee')
  await query(
    `UPDATE invites SET status = 'unattributed', inviter_id = NULL, admin_locked = TRUE, decided_by = $2, decided_at = NOW(), decision_note = $3, updated_at = NOW()
      WHERE invitee_id = $1`,
    [id, actor?.name || null, note || null]
  )
  await logEvent(null, { inviteeId: id, kind: 'no_inviter', summary: `Staff closed this with no inviter${note ? ` — ${note}` : ''}.`, actor })
  await rejectOtherClaims(id, null, actor, 'staff closed it with no inviter')
  return { ok: true }
}

/**
 * Staff credit any member to any inviter — even one already credited to someone
 * else. Admin decisions are final: the row is locked against automation.
 * @param {'both'|'lifetime'} scope  whether it also counts toward the current campaign
 */
export async function assignInvite({ inviteeId, inviterId, scope = 'both', announce = false, actor, note }) {
  const id = requireId(inviteeId, 'Invitee')
  const credit = requireId(inviterId, 'Inviter')
  if (id === credit) throw new InviteError('A member cannot be credited for inviting themselves.')
  const active = await getActiveCampaign()
  const campaignId = scope === 'lifetime' ? null : active?.id || null
  const map = await getMemberMap().catch(() => new Map())
  const inGuild = map.get(id) ? map.get(id).isInGuild !== false : true
  const before = await getRow(id)
  await query(
    `INSERT INTO invites (invitee_id, in_guild, source_type, inviter_id, status, counted_at, credited_campaign_id,
                          admin_locked, verified_via, verified_at, decided_by, decided_at, decision_note, notified_at)
     VALUES ($1, $2, 'manual', $3, 'counted', NOW(), $4, TRUE, 'staff', NOW(), $5, NOW(), $6, CASE WHEN $7 THEN NULL ELSE NOW() END)
     ON CONFLICT (invitee_id) DO UPDATE SET inviter_id = EXCLUDED.inviter_id, status = 'counted', counted_at = NOW(),
        credited_campaign_id = EXCLUDED.credited_campaign_id, admin_locked = TRUE, verified_via = 'staff',
        decided_by = EXCLUDED.decided_by, decided_at = NOW(), decision_note = EXCLUDED.decision_note,
        notified_at = CASE WHEN $7 THEN invites.notified_at ELSE COALESCE(invites.notified_at, NOW()) END, updated_at = NOW()`,
    [id, inGuild, credit, campaignId, actor?.name || null, note || null, !!announce]
  )
  const was = before?.inviter_id && before.inviter_id !== credit && before.status === 'counted' ? ` (moved from <@${before.inviter_id}>)` : ''
  await logEvent(null, { inviteeId: id, inviterId: credit, kind: 'assigned', summary: `Staff credited this member to <@${credit}>${scope === 'lifetime' ? ' (lifetime only)' : ''}${was}${note ? ` — ${note}` : ''}.`, actor })
  await rejectOtherClaims(id, credit, actor, 'staff credited someone else')
  if (announce) await enqueue('notify_registered', { inviteeId: id }, actor)
  await enqueue('refresh_board', {}, actor)
  return { ok: true, warning: inGuild ? null : 'That member is not in the server, so it will not count until they rejoin.' }
}

async function rejectOtherClaims(inviteeId, keepClaimerId, actor, reason) {
  const { rows } = await query(
    `UPDATE invite_claims SET status = 'rejected', decided_by = $3, decided_at = NOW(), note = $4
      WHERE invitee_id = $1 AND status = 'pending' AND ($2::text IS NULL OR claimer_id <> $2)
      RETURNING claimer_id`,
    [inviteeId, keepClaimerId, actor?.name || null, reason]
  )
  for (const r of rows) await enqueue('claim_rejected', { claimerId: r.claimer_id, inviteeId, reason }, actor)
}

export async function approveClaim({ claimId, actor }) {
  const { rows } = await query(`SELECT * FROM invite_claims WHERE id = $1`, [Number(claimId)])
  const claim = rows[0]
  if (!claim) throw new InviteError('Claim not found.', 404)
  if (claim.status !== 'pending') throw new InviteError('That claim was already decided.')
  const row = await getRow(claim.invitee_id)
  if (!row) throw new InviteError('No invite record for that member.', 404)
  await query(`UPDATE invite_claims SET status = 'approved', decided_by = $2, decided_at = NOW() WHERE id = $1`, [claim.id, actor?.name || null])
  const campaignId = await creditCampaignFor(row)
  const registered = !!row.registered_at
  await query(
    `UPDATE invites SET inviter_id = $2, status = $3, counted_at = CASE WHEN $3 = 'counted' THEN NOW() ELSE counted_at END,
            credited_campaign_id = $4, admin_locked = TRUE, verified_via = 'claim',
            decided_by = $5, decided_at = NOW(), updated_at = NOW()
      WHERE invitee_id = $1`,
    [claim.invitee_id, claim.claimer_id, registered ? 'counted' : 'tracked', campaignId, actor?.name || null]
  )
  await logEvent(null, { inviteeId: claim.invitee_id, inviterId: claim.claimer_id, kind: 'claim_approved', summary: `Staff approved <@${claim.claimer_id}>'s claim${registered ? '' : ' — it counts once they register'}.`, actor })
  await rejectOtherClaims(claim.invitee_id, claim.claimer_id, actor, 'another claim was approved')
  if (registered) await enqueue('notify_registered', { inviteeId: claim.invitee_id }, actor)
  return { ok: true }
}

export async function rejectClaim({ claimId, actor, note }) {
  const { rows } = await query(
    `UPDATE invite_claims SET status = 'rejected', decided_by = $2, decided_at = NOW(), note = $3 WHERE id = $1 AND status = 'pending' RETURNING *`,
    [Number(claimId), actor?.name || null, note || null]
  )
  const claim = rows[0]
  if (!claim) throw new InviteError('That claim was already decided or does not exist.')
  await logEvent(null, { inviteeId: claim.invitee_id, inviterId: claim.claimer_id, kind: 'claim_rejected', summary: `Staff rejected <@${claim.claimer_id}>'s claim${note ? ` — ${note}` : ''}.`, actor })
  await enqueue('claim_rejected', { claimerId: claim.claimer_id, inviteeId: claim.invitee_id, reason: note || null }, actor)
  return { ok: true }
}

export async function addAdjustment({ inviterId, delta, scope = 'both', reason, actor }) {
  const id = requireId(inviterId, 'Member')
  const n = parseInt(delta, 10)
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 1000) throw new InviteError('Enter a non-zero amount between -1000 and 1000.')
  if (!['both', 'lifetime', 'campaign'].includes(scope)) throw new InviteError('Pick what the adjustment affects.')
  const why = String(reason || '').trim()
  if (why.length < 3) throw new InviteError('A reason is required.')
  const active = await getActiveCampaign()
  if (scope !== 'lifetime' && !active) throw new InviteError('There is no active campaign to adjust.')
  await query(
    `INSERT INTO invite_adjustments (inviter_id, delta, scope, campaign_id, reason, actor_id, actor_name) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, n, scope, scope === 'lifetime' ? null : active.id, why.slice(0, 300), actor?.discordId || null, actor?.name || null]
  )
  const scopeText = { both: 'campaign and lifetime', lifetime: 'lifetime', campaign: 'campaign' }[scope]
  await logEvent(null, { inviterId: id, kind: 'adjustment', summary: `Staff adjusted <@${id}>'s ${scopeText} invites by ${n > 0 ? '+' : ''}${n} — ${why}.`, actor })
  await enqueue('refresh_board', {}, actor)
  return { ok: true }
}

export async function tagCode({ code, isGeneral, label, actor }) {
  const c = String(code || '').trim()
  if (!c) throw new InviteError('Pick an invite code.')
  const { rowCount } = await query(
    `UPDATE invite_codes SET is_general = $2, label = $3 WHERE code = $1`,
    [c, !!isGeneral, isGeneral ? (String(label || '').trim().slice(0, 60) || null) : null]
  )
  if (!rowCount) throw new InviteError('That invite code is not in the list.', 404)
  await logEvent(null, { kind: 'code_tag', summary: isGeneral ? `Staff tagged invite ${c} as a general link${label ? ` ("${label}")` : ''}. New joins through it will be claimable instead of crediting its creator.` : `Staff untagged invite ${c}; it credits its creator again.`, actor })
  return { ok: true }
}

export async function updateCampaign({ name, prize, endsAt, actor }) {
  const active = await getActiveCampaign()
  if (!active) throw new InviteError('There is no active campaign.')
  const n = String(name || '').trim().slice(0, 80)
  if (!n) throw new InviteError('The campaign needs a name.')
  let ends = null
  if (endsAt) {
    ends = new Date(endsAt)
    if (Number.isNaN(ends.getTime())) throw new InviteError('That end date is not valid.')
  }
  const endChanged = String(ends?.toISOString() || '') !== String(active.endsAt ? new Date(active.endsAt).toISOString() : '')
  await query(
    `UPDATE invite_campaigns SET name = $2, prize = $3, ends_at = $4, end_pinged_at = CASE WHEN $5 THEN NULL ELSE end_pinged_at END WHERE id = $1`,
    [active.id, n, String(prize || '').trim().slice(0, 200) || null, ends, endChanged]
  )
  await logEvent(null, { kind: 'campaign_update', summary: `Staff updated the campaign: "${n}"${prize ? `, prize "${prize}"` : ''}${ends ? `, ending ${ends.toUTCString()}` : ', no end date'}.`, actor })
  await enqueue('refresh_board', {}, actor)
  return { ok: true }
}

/** End & archive (MIRRORED with the bot's archiveAndReset). Typed-name confirm. */
export async function endCampaign({ expectId, confirmName, actor }) {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query(`SELECT * FROM invite_campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 1 FOR UPDATE`)
    const active = cur.rows[0]
    if (!active) throw new InviteError('There is no active campaign.')
    if (expectId && Number(expectId) !== active.id) throw new InviteError(`That campaign was already ended — the current one is ${active.name}.`, 409)
    if (String(confirmName || '').trim() !== active.name) throw new InviteError(`Type the campaign name exactly ("${active.name}") to confirm.`)
    const top = await client.query(`${countsSql('campaign')} LIMIT 10`, [active.id])
    const finalTop = top.rows.map((r, i) => ({ rank: i + 1, id: String(r.id), total: Number(r.total) }))
    await client.query(
      `UPDATE invite_campaigns SET status = 'ended', ended_at = NOW(), final_top = $2::jsonb, ended_by = $3 WHERE id = $1`,
      [active.id, JSON.stringify(finalTop), actor?.name || actor?.discordId || null]
    )
    const count = await client.query('SELECT COUNT(*)::int AS n FROM invite_campaigns')
    const next = await client.query(`INSERT INTO invite_campaigns (name, created_by) VALUES ($1, $2) RETURNING *`, [`Campaign ${count.rows[0].n + 1}`, actor?.name || null])
    await logEvent(client, { kind: 'campaign_end', summary: `${active.name} ended and was archived; ${next.rows[0].name} started.`, actor })
    await client.query('COMMIT')
    await enqueue('campaign_ended', { campaignId: active.id }, actor)
    return { ok: true, ended: active.name, next: next.rows[0].name }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function saveSettings({ values, actor }) {
  const before = await getSettings()
  const changed = []
  for (const key of EDITABLE_SETTINGS) {
    if (!(key in (values || {}))) continue
    let v = values[key]
    if (v === null || v === undefined) v = ''
    v = String(v).trim()
    if (['min_account_age_days', 'claim_window_days'].includes(key)) {
      const n = parseInt(v, 10)
      if (!Number.isFinite(n) || n < 0 || n > 365) throw new InviteError('Day values must be between 0 and 365.')
      v = String(n)
    }
    if (key.endsWith('_channel_id') && v && !/^\d{15,22}$/.test(v)) throw new InviteError('Pick a channel from the list.')
    if (key === 'dm_inviter') v = v === 'false' ? 'false' : 'true'
    if (String(before[key] ?? '') === v) continue
    await query(
      `INSERT INTO invite_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, v || null]
    )
    changed.push(key)
  }
  if (changed.length) {
    await logEvent(null, { kind: 'settings', summary: `Staff changed invite settings: ${changed.join(', ')}.`, actor })
    if (changed.includes('live_board_channel_id')) await enqueue('refresh_board', {}, actor)
  }
  return { ok: true, changed }
}

export async function requestCodeRefresh({ actor }) {
  await enqueue('refresh_codes', {}, actor)
  return { ok: true }
}
