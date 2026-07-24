// Server-side helpers for the Tracker Linking admin tab.
//
// The SCRAPER owns the SalSheet (trackers + last-run status); the WEBSITE owns
// identity (discord_members) + the Ballchasing accounts/name-history tables. These
// helpers call the scraper over HTTP and join its data with our Postgres BY
// DISCORD ID, then run the pure suggestion logic in lib/trackerSuggest.js.

import { query } from './db'
import { getMemberMap } from './discordMembers'
import { computeSuggestions } from './trackerSuggest'

export const SCRAPER_URL = (process.env.TRN_SCRAPER_URL || 'https://rl-scraper-production.up.railway.app').replace(/\/$/, '')
const SCRAPER_TOKEN = process.env.TRN_SCRAPER_TOKEN || ''
const authHeaders = () => (SCRAPER_TOKEN ? { 'X-Auth-Token': SCRAPER_TOKEN } : {})

export async function scraperGet(path) {
  // Time-bound so a dead scraper surfaces a fast error (→ 502 on the board route)
  // instead of hanging the Tracker Linking page on its spinner indefinitely.
  const res = await fetch(`${SCRAPER_URL}${path}`, {
    cache: 'no-store',
    headers: authHeaders(),
    signal: AbortSignal.timeout(12000),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

export async function scraperPost(path, body) {
  const res = await fetch(`${SCRAPER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(12000),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: res.ok, status: res.status, data }
}

// One read of the bot-owned identity tables, grouped by discord_id.
export async function loadIdentity() {
  const accountsByDiscord = new Map()
  const historyByDiscord = new Map()
  try {
    const a = await query(
      `SELECT discord_id, platform, platform_id, current_name FROM stats_player_accounts`
    )
    for (const r of a.rows) {
      const k = String(r.discord_id)
      if (!accountsByDiscord.has(k)) accountsByDiscord.set(k, [])
      accountsByDiscord.get(k).push({
        platform: r.platform, platformId: r.platform_id, currentName: r.current_name,
      })
    }
  } catch { /* table may not exist yet */ }
  try {
    const h = await query(
      `SELECT discord_id, platform, platform_id, name FROM stats_name_history
       WHERE name IS NOT NULL AND name <> ''`
    )
    for (const r of h.rows) {
      const k = String(r.discord_id)
      if (!historyByDiscord.has(k)) historyByDiscord.set(k, [])
      historyByDiscord.get(k).push({
        platform: r.platform, platformId: r.platform_id, name: r.name,
      })
    }
  } catch { /* table may not exist yet */ }
  return { accountsByDiscord, historyByDiscord }
}

// Build the global "needs attention" board: group the scraper's per-row overview by
// discord_id, attach identity + suggestions, and keep only players that have a
// suggestion (tier 0) or an invalid tracker with no suggestion (tier 1).
export async function assembleBoard(force = false) {
  const ov = await scraperGet(`/tracker-overview${force ? '?force=1' : ''}`)
  const payload = ov.data && typeof ov.data === 'object' ? ov.data : {}
  const rawPlayers = Array.isArray(payload.players) ? payload.players : []
  const rateLimited = Boolean(payload.rate_limited)

  const { accountsByDiscord, historyByDiscord } = await loadIdentity()
  const memberMap = await getMemberMap()

  // Group rows by discord_id (or a synthetic key for unlinked rows so their invalid
  // trackers still surface).
  const groups = new Map()
  for (const p of rawPlayers) {
    const did = p.discord_id ? String(p.discord_id) : ''
    const key = did || `row:${p.row_index}`
    if (!groups.has(key)) {
      groups.set(key, { discordId: did || null, name: p.name, league: p.league, trackers: [] })
    }
    const g = groups.get(key)
    if (!g.name && p.name) g.name = p.name
    for (const t of p.trackers || []) g.trackers.push({ ...t, rowIndex: p.row_index })
  }

  const players = []
  for (const g of groups.values()) {
    const accounts = g.discordId ? accountsByDiscord.get(g.discordId) || [] : []
    const nameHistory = g.discordId ? historyByDiscord.get(g.discordId) || [] : []
    const sug = computeSuggestions({ trackers: g.trackers, accounts, nameHistory })
    if (sug.tier >= 2) continue // not on the needs-attention board
    const member = g.discordId ? memberMap.get(g.discordId) || null : null
    players.push({
      discordId: g.discordId,
      name: g.name,
      league: g.league,
      displayName: member?.displayName || g.name || null,
      avatarUrl: member?.avatarUrl || null,
      username: member?.username || null,
      trackers: g.trackers,
      ...sug,
    })
  }

  players.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier
    if (a.invalidTrackers.length !== b.invalidTrackers.length) return b.invalidTrackers.length - a.invalidTrackers.length
    return String(a.displayName || '').localeCompare(String(b.displayName || ''))
  })

  return {
    rateLimited,
    counts: {
      suggestions: players.filter((p) => p.tier === 0).length,
      invalidOnly: players.filter((p) => p.tier === 1).length,
    },
    players,
  }
}

// Single-player view for the editor: the player's Registrations record (one editable
// main/alt set) + identity + suggestions. Trackers live in Registrations, keyed by
// discord id (one row), so there are no per-SalSheet-row cards.
export async function assemblePlayer(discordId) {
  const did = String(discordId || '')
  const res = await scraperGet(`/tracker-rows?discord_id=${encodeURIComponent(did)}`)
  const data = res.data && typeof res.data === 'object' ? res.data : {}
  const main = Array.isArray(data.main) ? data.main : []
  const alt = Array.isArray(data.alt) ? data.alt : []
  const salRows = Array.isArray(data.sal_rows) ? data.sal_rows : []

  const { accountsByDiscord, historyByDiscord } = await loadIdentity()
  const accounts = accountsByDiscord.get(did) || []
  const nameHistory = historyByDiscord.get(did) || []
  const memberMap = await getMemberMap()
  const member = memberMap.get(did) || null

  // Flat tracker list (label main/alt) for suggestion computation.
  const trackers = [
    ...main.map((t) => ({ ...t, label: 'main' })),
    ...alt.map((t) => ({ ...t, label: 'alt' })),
  ]
  const sug = computeSuggestions({ trackers, accounts, nameHistory })

  return {
    discordId: did,
    displayName: member?.displayName || data.name || null,
    avatarUrl: member?.avatarUrl || null,
    username: member?.username || null,
    regRow: data.reg_row || null,
    name: data.name || null,
    main,
    alt,
    salRows,
    trackers,
    accounts,
    nameHistory,
    ...sug,
  }
}
