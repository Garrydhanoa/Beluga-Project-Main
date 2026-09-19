'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from '../../../components/Avatar'
import PlayerPicker from '../../../components/PlayerPicker'

// ── shared API helper (all under /api/admin) ─────────────────────────────────
async function api(path, method = 'GET', body) {
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch { return { ok: res.ok, status: res.status, data: text } }
}

const STATUS_DOT = {
  OK: 'bg-emerald-400',
  NO_DATA: 'bg-red-500',
  CLOUDFLARE_BLOCKED: 'bg-amber-400',
  ERROR: 'bg-orange-500',
}
const STATUS_LABEL = {
  OK: 'valid', NO_DATA: '404 / invalid', CLOUDFLARE_BLOCKED: 'blocked', ERROR: 'error',
}

function StatusDot({ status }) {
  const s = String(status || '').toUpperCase()
  const cls = STATUS_DOT[s] || 'bg-white/25'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} title={STATUS_LABEL[s] || 'not yet scraped'} />
}

function TrackerPill({ t }) {
  return (
    <a
      href={t.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/40 border border-white/10 hover:border-cyan-400/50 text-[11px] text-white/85"
      title={`${t.platform} · ${STATUS_LABEL[String(t.status || '').toUpperCase()] || 'not yet scraped'}`}
    >
      <StatusDot status={t.status} />
      <span className="uppercase text-[9px] font-bold text-cyan-300/80">{t.platform}</span>
      <span className="font-mono truncate max-w-[180px]">{t.identifier}</span>
    </a>
  )
}

// ── Add-by-Ballchasing-link panel ────────────────────────────────────────────
function AddByLinkPanel({ onLinked, toast }) {
  const [url, setUrl] = useState('')
  const [picked, setPicked] = useState(null)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(null)
  const [err, setErr] = useState('')

  const lookup = async () => {
    setErr(''); setFound(null); setBusy(true)
    try {
      const r = await api('bc-lookup', 'POST', { url })
      if (!r.ok) { setErr(r.data?.error || 'Lookup failed.'); return }
      setFound(r.data)
    } finally { setBusy(false) }
  }

  const confirmLink = async () => {
    if (!found || !picked) return
    setBusy(true); setErr('')
    try {
      const r = await api('stats-tools', 'POST', {
        action: 'link',
        platform: found.platform,
        platformId: found.platformId,
        discordId: picked.discordId,
        name: found.currentName,
      })
      if (!r.ok) { setErr(r.data?.error || 'Link failed.'); return }
      toast(`Linked ${found.currentName} → ${picked.displayName}. Add their tracker below.`)
      setFound(null); setUrl('')
      onLinked(picked.discordId)
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-6">
      <div className="text-sm font-black text-white mb-1">Link a Ballchasing account to a Discord user</div>
      <div className="text-[11px] text-white/45 mb-3">
        Paste a <b>replay link</b> (the player must be the FIRST player in it) or a <b>player profile link</b>
        {' '}(<span className="font-mono">ballchasing.com/player/&lt;platform&gt;/&lt;id&gt;</span>), pick the Discord
        user, then confirm the in-game name.
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-white/60 mb-1">Ballchasing link</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://ballchasing.com/replay/… or /player/epic/…"
            className="w-full px-2.5 py-1.5 bg-black/40 border border-white/10 rounded text-white text-xs focus:border-cyan-400/60 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-white/60 mb-1">Discord user</label>
          {picked ? (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/40 border border-white/10">
              <Avatar src={picked.avatarUrl} name={picked.displayName} size={24} ring={false} />
              <span className="text-xs text-white truncate flex-1">{picked.displayName}</span>
              <button onClick={() => setPicked(null)} className="text-[10px] text-white/40 hover:text-white">change</button>
            </div>
          ) : (
            <PlayerPicker onPick={setPicked} placeholder="Search Discord user…" />
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={lookup}
          disabled={busy || !url.trim()}
          className="px-3 py-1.5 rounded bg-cyan-600/80 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs font-bold"
        >
          {busy ? 'Looking up…' : 'Look up'}
        </button>
        {err && <span className="text-[11px] text-red-400">{err}</span>}
      </div>

      {found && (
        <div className="mt-4 rounded-lg border border-cyan-400/30 bg-cyan-400/[0.04] p-3">
          <div className="text-[11px] text-white/60 mb-1">Found this account:</div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white">
            <span className="uppercase text-[9px] font-bold text-cyan-300/80 px-1.5 py-0.5 rounded bg-black/40">{found.platform}</span>
            <span className="font-mono text-white/70">{found.platformId}</span>
            <span className="text-white/40">→ current name</span>
            <span className="font-bold text-cyan-200">{found.currentName}</span>
          </div>
          {found.pastNames?.length > 1 && (
            <div className="mt-1 text-[10px] text-white/45">
              Names seen: {found.pastNames.slice(0, 8).join(', ')}{found.pastNames.length > 8 ? '…' : ''}
            </div>
          )}
          <div className="mt-3 text-xs text-white/80">
            Is <b className="text-cyan-200">{found.currentName}</b> the in-game name of
            {' '}<b>{picked ? picked.displayName : '(pick a Discord user first)'}</b>?
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={confirmLink}
              disabled={busy || !picked}
              className="px-3 py-1.5 rounded bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold"
            >
              Confirm &amp; link
            </button>
            <button onClick={() => setFound(null)} className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── A single suggestion (add new tracker, optionally delete old) ─────────────
function SuggestionRow({ player, suggestion, onApply, busy }) {
  const [deletes, setDeletes] = useState(() => {
    const init = {}
    for (const o of suggestion.oldTrackers || []) init[o.url] = !!o.deleteSuggested
    return init
  })

  const apply = (label) => {
    const deleteUrls = Object.entries(deletes).filter(([, v]) => v).map(([u]) => u)
    onApply({ suggestion, addLabel: label, deleteUrls })
  }

  return (
    <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/[0.04] p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-white/55">Suggested:</span>
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/40 border border-emerald-400/40 text-white/90">
          <span className="uppercase text-[9px] font-bold text-emerald-300/80">{suggestion.platform}</span>
          <span className="font-mono">{suggestion.newIdentifier}</span>
        </span>
        <span className="text-white/35">add to</span>
        <button onClick={() => apply('main')} disabled={busy} className="px-2 py-0.5 rounded bg-cyan-600/80 hover:bg-cyan-600 disabled:opacity-40 text-white text-[11px] font-bold">Main</button>
        <button onClick={() => apply('alt')} disabled={busy} className="px-2 py-0.5 rounded bg-cyan-600/40 hover:bg-cyan-600/70 disabled:opacity-40 text-white text-[11px] font-bold">Alt</button>
      </div>
      {(suggestion.oldTrackers || []).length > 0 && (
        <div className="mt-2 space-y-1">
          {suggestion.oldTrackers.map((o) => (
            <label key={o.url} className="flex items-center gap-2 text-[11px] text-white/70">
              <input
                type="checkbox"
                checked={!!deletes[o.url]}
                onChange={(e) => setDeletes((d) => ({ ...d, [o.url]: e.target.checked }))}
                className="accent-red-500"
              />
              <span className="text-white/40">delete old</span>
              <StatusDot status={o.status} />
              <span className="font-mono text-white/75">{o.platform}/{o.identifier}</span>
              {o.deleteSuggested
                ? <span className="text-[9px] text-emerald-300/80">(confirmed rename)</span>
                : <span className="text-[9px] text-amber-300/70">(unconfirmed — check only if sure)</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── A board card (one player needing attention) ──────────────────────────────
function BoardCard({ player, onApply, onOpen, busyKey }) {
  const tierBadge = player.tier === 0
    ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">SUGGESTION</span>
    : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">INVALID TRACKER</span>
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center gap-2.5">
        <Avatar src={player.avatarUrl} name={player.displayName || player.name} size={34} ring={false} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate">{player.displayName || player.name || '(unknown)'}</span>
            {tierBadge}
            {player.league && <span className="text-[9px] text-white/40 uppercase">{player.league}</span>}
          </div>
          <div className="text-[9px] font-mono text-white/30">{player.discordId || 'no discord id'}</div>
        </div>
        <button onClick={() => onOpen(player.discordId)} disabled={!player.discordId} className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 text-white/70">Open editor</button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {player.trackers.map((t, i) => <TrackerPill key={`${t.url}-${i}`} t={t} />)}
      </div>

      {player.suggestions?.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {player.suggestions.map((s, i) => (
            <SuggestionRow
              key={`${s.platform}-${s.newIdentifier}-${i}`}
              player={player}
              suggestion={s}
              busy={busyKey === player.discordId}
              onApply={(args) => onApply(player, args)}
            />
          ))}
        </div>
      )}
      {player.tier === 1 && (
        <div className="mt-2 text-[10px] text-amber-300/70">
          Invalid tracker(s) with no auto-suggestion yet — link the account (above) or open the editor to fix manually.
        </div>
      )}
    </div>
  )
}

// ── Editor: one Registrations record per player (main + alt) ──────────────────
function EditorPanel({ discordId, nonce, onClose, toast, onSaved }) {
  const [data, setData] = useState(null)
  const [main, setMain] = useState([])
  const [alt, setAlt] = useState([])
  const [busy, setBusy] = useState(false)
  const [addMain, setAddMain] = useState('')
  const [addAlt, setAddAlt] = useState('')

  const load = useCallback(async () => {
    const r = await api(`tracker-linking/player?discordId=${encodeURIComponent(discordId)}`)
    if (r.ok) {
      setData(r.data)
      setMain((r.data.main || []).map((t) => t.url))
      setAlt((r.data.alt || []).map((t) => t.url))
    }
  }, [discordId])
  useEffect(() => { load() }, [load, nonce])

  const removeUrl = (label, url) => {
    if (label === 'main') setMain((l) => l.filter((u) => u !== url))
    else setAlt((l) => l.filter((u) => u !== url))
  }
  const addUrl = (label) => {
    const v = (label === 'main' ? addMain : addAlt).trim()
    if (!v) return
    if (label === 'main') { setMain((l) => (l.includes(v) ? l : [...l, v])); setAddMain('') }
    else { setAlt((l) => (l.includes(v) ? l : [...l, v])); setAddAlt('') }
  }
  // Apply a suggestion into the local edit state; the operator reviews then Saves.
  const applyLocally = ({ suggestion, addLabel, deleteUrls }) => {
    const del = new Set(deleteUrls || [])
    setMain((l) => {
      let n = l.filter((u) => !del.has(u))
      if (addLabel === 'main' && !n.includes(suggestion.newUrl)) n = [...n, suggestion.newUrl]
      return n
    })
    setAlt((l) => {
      let n = l.filter((u) => !del.has(u))
      if (addLabel === 'alt' && !n.includes(suggestion.newUrl)) n = [...n, suggestion.newUrl]
      return n
    })
  }

  const save = async () => {
    if (!data?.regRow) { toast('This player has no Registrations row to edit.', true); return }
    setBusy(true)
    try {
      const r = await api('tracker-linking/save', 'POST', { discordId, main, alt })
      if (!r.ok) { toast(r.data?.error || 'Save failed.', true); return }
      const n = (r.data?.repull || []).length
      toast(`Saved to Registrations${n ? ` — queued ${n} MMR re-pull(s)` : ''}.`)
      await load()
      onSaved?.()
    } finally { setBusy(false) }
  }

  const baseMain = JSON.stringify((data?.main || []).map((t) => t.url))
  const baseAlt = JSON.stringify((data?.alt || []).map((t) => t.url))
  const dirty = data && (JSON.stringify(main) !== baseMain || JSON.stringify(alt) !== baseAlt)

  const renderList = (label, list, addVal, setAddVal) => (
    <div className="mb-2">
      <div className="text-[10px] font-bold text-white/60 uppercase mb-1">{label}{label === 'main' ? ' (usually 1)' : ''}</div>
      <div className="space-y-1">
        {list.length === 0 && <div className="text-[10px] text-white/25">none</div>}
        {list.map((u) => (
          <div key={u} className="flex items-center gap-2">
            <a href={u} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-cyan-300/80 hover:underline truncate flex-1">{u}</a>
            <button onClick={() => removeUrl(label, u)} className="text-red-400/70 hover:text-red-400 text-xs px-1">✕</button>
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          value={addVal}
          onChange={(e) => setAddVal(e.target.value)}
          placeholder="paste a tracker.network URL…"
          className="flex-1 px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-[11px] focus:border-cyan-400/60 focus:outline-none"
        />
        <button onClick={() => addUrl(label)} className="text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70">+ add</button>
      </div>
    </div>
  )

  return (
    <div className="rounded-xl border border-cyan-400/25 bg-[#0b1220] p-4 mb-6">
      <div className="flex items-center gap-2.5 mb-3">
        <Avatar src={data?.avatarUrl} name={data?.displayName} size={34} ring={false} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white truncate">{data?.displayName || discordId}</div>
          <div className="text-[9px] font-mono text-white/30">{discordId}{data?.regRow ? ` · Registrations row ${data.regRow}` : ''}</div>
        </div>
        <button onClick={onClose} className="text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-white/70">Close</button>
      </div>

      {data?.suggestions?.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <div className="text-[10px] font-bold text-emerald-300/80 uppercase">Suggestions (applied below — review &amp; Save)</div>
          {data.suggestions.map((s, i) => (
            <SuggestionRow
              key={`${s.platform}-${s.newIdentifier}-${i}`}
              player={data}
              suggestion={s}
              busy={busy}
              onApply={applyLocally}
            />
          ))}
        </div>
      )}

      {!data && <div className="text-xs text-white/40">Loading…</div>}
      {data && !data.regRow && <div className="text-xs text-amber-300/70">This Discord user has no Registrations row — they must register first.</div>}
      {data?.regRow && (
        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          {renderList('main', main, addMain, setAddMain)}
          {renderList('alt', alt, addAlt, setAddAlt)}
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="mt-1 px-3 py-1.5 rounded bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold"
          >
            {busy ? 'Saving…' : 'Save to Registrations & re-pull MMR'}
          </button>
          {!dirty && <span className="ml-2 text-[10px] text-white/30">no changes</span>}
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function TrackerLinkingPage() {
  const [board, setBoard] = useState({ players: [], counts: {}, rateLimited: false })
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [offline, setOffline] = useState(false) // scraper service unreachable/timed out
  const [selected, setSelected] = useState(null)
  const [editorNonce, setEditorNonce] = useState(0)
  const [busyKey, setBusyKey] = useState(null)
  const [toastMsg, setToastMsg] = useState(null)
  const [filter, setFilter] = useState('')
  const toastTimer = useRef(null)

  const toast = (msg, isErr = false) => {
    setToastMsg({ msg, isErr })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 5000)
  }

  const refresh = useCallback(async (force = false) => {
    const r = await api(`tracker-linking/board${force ? '?force=1' : ''}`)
    // 502 → the scraper service backing the board is unreachable or timed out.
    setOffline(!r.ok && (r.status === 502 || r.status === 0))
    if (r.ok && r.data && Array.isArray(r.data.players)) {
      setBoard(r.data)
      setLoadedOnce(true)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(() => refresh(false), 8000)
    return () => clearInterval(id)
  }, [refresh])

  // Apply a board suggestion: rebuild main/alt from the player's trackers (label-based),
  // write to Registrations by discord id, then refresh. One write per player.
  const applySuggestion = async (player, { suggestion, addLabel, deleteUrls }) => {
    if (!player.discordId) { toast('No Discord id — link the account first.', true); return }
    setBusyKey(player.discordId)
    try {
      const del = new Set(deleteUrls || [])
      const main = (player.trackers || []).filter((t) => t.label === 'main' && !del.has(t.url)).map((t) => t.url)
      const alt = (player.trackers || []).filter((t) => t.label === 'alt' && !del.has(t.url)).map((t) => t.url)
      const target = addLabel === 'main' ? main : alt
      if (!target.includes(suggestion.newUrl)) target.push(suggestion.newUrl)

      const res = await api('tracker-linking/save', 'POST', { discordId: player.discordId, main, alt })
      if (!res.ok) { toast(res.data?.error || 'Save failed.', true); return }
      const n = (res.data?.repull || []).length
      toast(`Applied to Registrations${n ? ` — queued ${n} MMR re-pull(s)` : ''}.`)
      await refresh(true)
      setEditorNonce((x) => x + 1)
    } finally { setBusyKey(null) }
  }

  const players = board.players.filter((p) => {
    if (!filter.trim()) return true
    const q = filter.trim().toLowerCase()
    return String(p.displayName || p.name || '').toLowerCase().includes(q) || String(p.discordId || '').includes(q)
  })

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-black text-white">Tracker Linking</h1>
        <button
          onClick={() => refresh(true)}
          className="text-[11px] px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70 font-bold"
          title="Force a fresh SalSheet read from Google (uses one read of the shared quota)"
        >
          Refresh sheet
        </button>
      </div>
      <p className="text-xs text-white/45 mb-4">
        Detect renamed / broken trackers from each player's Ballchasing name history and fix the SalSheet.
        Suggestions float to the top; nothing is written to Google until you click Add / Save.
      </p>

      {offline && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-red-400/40 bg-red-500/10 text-[11px] text-red-200">
          ⚠ <span className="font-bold">Scraper service offline.</span> The standalone scraper (separate Railway
          service) isn&apos;t responding, so the board can&apos;t load. This is independent of the website &amp; database —
          restart the <span className="font-mono">rl-scraper</span> service on Railway and this page will recover.
        </div>
      )}

      {board.rateLimited && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-amber-400/40 bg-amber-400/10 text-[11px] text-amber-200">
          ⚠ Google Sheets rate limited — showing the last cached read. Try “Refresh sheet” again shortly.
        </div>
      )}

      {toastMsg && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-[11px] border ${toastMsg.isErr ? 'border-red-400/40 bg-red-400/10 text-red-200' : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'}`}>
          {toastMsg.msg}
        </div>
      )}

      <AddByLinkPanel toast={toast} onLinked={(did) => { setSelected(did); refresh(true) }} />

      {/* Open any player's editor */}
      <div className="mb-4 max-w-sm">
        <label className="block text-[10px] font-bold text-white/60 mb-1">Open a player's tracker editor</label>
        <PlayerPicker onPick={(p) => setSelected(p.discordId)} placeholder="Search any player…" />
      </div>

      {selected && (
        <EditorPanel
          discordId={selected}
          nonce={editorNonce}
          onClose={() => setSelected(null)}
          toast={toast}
          onSaved={() => refresh(true)}
        />
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-black text-white">
          Needs attention
          <span className="ml-2 text-[11px] font-normal text-white/40">
            {board.counts?.suggestions || 0} suggestion(s) · {board.counts?.invalidOnly || 0} invalid-only
          </span>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter list…"
          className="px-2 py-1 bg-black/40 border border-white/10 rounded text-white text-[11px] focus:border-cyan-400/60 focus:outline-none"
        />
      </div>

      {!loadedOnce && (
        <div className="text-xs text-white/40">
          {offline ? 'Scraper offline — start the rl-scraper service on Railway to load the board.' : 'Loading…'}
        </div>
      )}
      {loadedOnce && players.length === 0 && (
        <div className="text-xs text-white/40">Nothing needs attention — all trackers match current names. 🎉</div>
      )}
      <div className="space-y-2.5">
        {players.map((p) => (
          <BoardCard
            key={p.discordId || p.name}
            player={p}
            busyKey={busyKey}
            onApply={applySuggestion}
            onOpen={(did) => setSelected(did)}
          />
        ))}
      </div>
    </div>
  )
}
