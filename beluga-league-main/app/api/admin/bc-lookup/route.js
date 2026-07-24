import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { withAudit } from '../../../../lib/activityLog'
import { query } from '../../../../lib/db'
import { buildUrl, canonicalPlatform } from '../../../../lib/trackerSuggest'

export const dynamic = 'force-dynamic'

// Parse a pasted Ballchasing link → the player's { platform, platformId, currentName,
// pastNames } so the operator can link that account to a Discord id (Tracker Linking
// tab). Two link shapes are accepted:
//   • a REPLAY link  (…/replay/<id>)            → the FIRST player in that replay
//   • a PROFILE link (…/player/<platform>/<id>) → that exact player
// Reads only (Ballchasing API). platform is kept in Ballchasing's native spelling
// (matches what the bot stores in stats_player_accounts); the tracker URL uses the
// TRN spelling via canonicalPlatform.

const BC_BASE = 'https://ballchasing.com/api'

function getKey() {
  const k = process.env.BALLCHASING_API_KEY
  return k && String(k).trim() ? String(k).trim() : null
}

async function bcGet(path, key) {
  return fetch(`${BC_BASE}${path}`, {
    headers: { Authorization: key, Accept: 'application/json' },
    cache: 'no-store',
  })
}

function parseInput(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  let url
  try { url = new URL(s) } catch { return null }
  if (!/(^|\.)ballchasing\.com$/i.test(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const r = parts.indexOf('replay')
  if (r !== -1 && parts[r + 1]) return { type: 'replay', replayId: parts[r + 1] }
  const p = parts.indexOf('player')
  if (p !== -1 && parts[p + 1] && parts[p + 2]) {
    return { type: 'player', platform: parts[p + 1].toLowerCase(), platformId: decodeURIComponent(parts[p + 2]) }
  }
  return null
}

function firstPlayerOf(replay) {
  const blue = (replay && replay.blue && replay.blue.players) || []
  const orange = (replay && replay.orange && replay.orange.players) || []
  const pl = blue[0] || orange[0]
  if (!pl) return null
  return {
    platform: String((pl.id && pl.id.platform) || '').toLowerCase(),
    platformId: String((pl.id && pl.id.id) || ''),
    name: pl.name || '',
  }
}

// Scan a player's recent replays for every distinct name they've used (newest first).
async function namesFromReplays(platform, platformId, key) {
  const q = `/replays?player-id=${encodeURIComponent(`${platform}:${platformId}`)}&sort-by=replay-date&sort-dir=desc&count=50`
  const res = await bcGet(q, key)
  if (!res.ok) return { names: [], status: res.status }
  const data = await res.json().catch(() => ({}))
  const seen = new Set()
  const names = []
  for (const rep of data.list || []) {
    for (const team of ['blue', 'orange']) {
      for (const pl of (rep && rep[team] && rep[team].players) || []) {
        const pp = String((pl.id && pl.id.platform) || '').toLowerCase()
        const pid = String((pl.id && pl.id.id) || '')
        if (pp === platform && pid === String(platformId) && pl.name) {
          const lk = pl.name.toLowerCase()
          if (!seen.has(lk)) { seen.add(lk); names.push(pl.name) }
        }
      }
    }
  }
  return { names, status: 200 }
}

async function dbNames(platform, platformId) {
  const out = []
  const acct = await query(
    `SELECT current_name FROM stats_player_accounts WHERE platform = $1 AND platform_id = $2`,
    [platform, platformId]
  ).catch(() => ({ rows: [] }))
  const currentName = acct.rows[0]?.current_name || null
  const hist = await query(
    `SELECT DISTINCT name FROM stats_name_history
     WHERE platform = $1 AND platform_id = $2 AND name IS NOT NULL AND name <> ''`,
    [platform, platformId]
  ).catch(() => ({ rows: [] }))
  for (const r of hist.rows) out.push(r.name)
  return { currentName, histNames: out }
}

function statusMessage(s) {
  if (s === 401) return 'Ballchasing rejected the API key (401). Check BALLCHASING_API_KEY.'
  if (s === 404) return 'Not found on Ballchasing (404) — the replay/player may be private or the link is wrong.'
  if (s === 429) return 'Ballchasing rate limited (429). Wait a few seconds and try again.'
  return `Ballchasing request failed (HTTP ${s}).`
}

async function postHandler(request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const key = getKey()
  if (!key) {
    return NextResponse.json(
      { error: 'BALLCHASING_API_KEY is not set on the website service. Add it in Railway env.' },
      { status: 500 }
    )
  }

  let body
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const parsed = parseInput(body.url)
  if (!parsed) {
    return NextResponse.json(
      { error: 'Paste a ballchasing.com replay link (…/replay/<id>) or player profile link (…/player/<platform>/<id>).' },
      { status: 400 }
    )
  }

  let platform, platformId, sourceName
  try {
    if (parsed.type === 'replay') {
      const res = await bcGet(`/replays/${encodeURIComponent(parsed.replayId)}`, key)
      if (!res.ok) return NextResponse.json({ error: statusMessage(res.status) }, { status: 502 })
      const replay = await res.json().catch(() => ({}))
      const first = firstPlayerOf(replay)
      if (!first || !first.platform || !first.platformId) {
        return NextResponse.json({ error: 'Could not read the first player from that replay.' }, { status: 422 })
      }
      platform = first.platform
      platformId = first.platformId
      sourceName = first.name
    } else {
      platform = parsed.platform
      platformId = parsed.platformId
      sourceName = ''
    }

    // Gather names from Ballchasing replays + our own DB history, newest-first-ish.
    const fromReplays = await namesFromReplays(platform, platformId, key)
    const fromDb = await dbNames(platform, platformId)

    const ordered = []
    const seen = new Set()
    const push = (n) => {
      if (!n) return
      const lk = String(n).toLowerCase()
      if (!seen.has(lk)) { seen.add(lk); ordered.push(n) }
    }
    push(sourceName)
    fromReplays.names.forEach(push)
    push(fromDb.currentName)
    fromDb.histNames.forEach(push)

    const currentName = sourceName || fromReplays.names[0] || fromDb.currentName || ''
    if (!currentName) {
      return NextResponse.json(
        { error: 'Found the account but could not determine an in-game name (no recent public replays).', platform, platformId },
        { status: 422 }
      )
    }

    const canon = canonicalPlatform(platform)
    const trackerIdent = canon === 'steam' ? platformId : currentName
    const suggestedTrackerUrl = buildUrl(canon, trackerIdent)

    return NextResponse.json({
      ok: true,
      type: parsed.type,
      platform,                 // Ballchasing-native (for the identity link)
      platformId,
      trnPlatform: canon,       // TRN spelling (for the tracker URL)
      currentName,
      pastNames: ordered,
      suggestedTrackerUrl,
      rateLimited: fromReplays.status === 429,
    })
  } catch (err) {
    return NextResponse.json({ error: `Lookup failed: ${err?.message || err}` }, { status: 500 })
  }
}

// Audit the manual Ballchasing lookups (they precede an account link) on this sensitive tab.
export const POST = withAudit(postHandler, { action: 'tracker.bc-lookup' })
