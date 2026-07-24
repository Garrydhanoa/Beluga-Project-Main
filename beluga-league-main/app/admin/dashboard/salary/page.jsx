'use client'

import { useCallback, useEffect, useState } from 'react'
import Avatar from '../../../components/Avatar'
import PlayerPicker from '../../../components/PlayerPicker'

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const text = await res.text()
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) } }
  catch { return { ok: res.ok, status: res.status, data: text } }
}

const fmt = (v) => (v == null || v === '' ? '—' : String(v))

function StateBadge({ state, delta }) {
  if (state === 'should_move_up') {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-200 border border-green-400/30">▲ should move up{delta != null ? ` +${delta}` : ''}</span>
  }
  if (state === 'locked_above') {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-200 border border-amber-400/30">locked above calc{delta != null ? ` ${delta}` : ''}</span>
  }
  if (state === 'no_calc') {
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/10 text-white/50 border border-white/15">no auto-calc</span>
  }
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/15 text-blue-200 border border-blue-400/25">in sync</span>
}

function DivPill({ division }) {
  if (!division) return null
  const map = { Majors: 'bg-yellow-500/15 text-yellow-200 border-yellow-400/30', AAA: 'bg-cyan-500/15 text-cyan-200 border-cyan-400/30', AA: 'bg-white/10 text-white/60 border-white/20' }
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${map[division] || map.AA}`}>{division}</span>
}

function LockedRow({ p, member, onAdjust, onUnlock, busy }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(p.locked != null ? String(p.locked) : '')
  const name = member?.displayName || p.name || p.discordId
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar src={member?.avatarUrl} name={name} size={32} ring={false} className="flex-shrink-0" />
          <div className="min-w-0">
            <div className="font-bold text-white truncate flex items-center gap-2">{name} <DivPill division={p.division} /></div>
            <div className="text-[11px] text-white/40 truncate font-mono">{p.discordId}</div>
          </div>
        </div>
        <StateBadge state={p.state} delta={p.delta} />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2 mb-2">
        <div className="px-2 py-1 rounded bg-white/5">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Locked (O)</div>
          <div className="text-sm font-bold text-white">{fmt(p.locked)}</div>
        </div>
        <div className={`px-2 py-1 rounded ${p.state === 'should_move_up' ? 'bg-green-500/15 border border-green-400/30' : 'bg-white/5'}`}>
          <div className="text-[10px] uppercase tracking-wider text-white/40">Auto-calc (N)</div>
          <div className="text-sm font-bold text-white">{fmt(p.calc)}</div>
        </div>
      </div>

      <div className="text-[10px] text-white/35 mb-2">
        locked by {p.lockedBy || '—'}{p.lockedAt ? ` · ${new Date(p.lockedAt).toLocaleDateString()}` : ''}
      </div>

      {!editing ? (
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => { setVal(p.locked != null ? String(p.locked) : ''); setEditing(true) }}
                  className="px-3 py-1 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 text-xs font-bold disabled:opacity-40">Adjust</button>
          <button disabled={busy} onClick={() => onUnlock(p)}
                  className="px-3 py-1 rounded bg-white/5 text-white/70 border border-white/15 text-xs font-bold disabled:opacity-40">Unlock (sync to N)</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input type="number" step="0.25" min="0" value={val} onChange={(e) => setVal(e.target.value)}
                 className="w-24 px-2 py-1 rounded bg-black/40 border border-white/15 text-white text-sm" />
          <button disabled={busy || val === ''} onClick={() => { onAdjust(p.discordId, val); setEditing(false) }}
                  className="px-3 py-1 rounded bg-green-500/20 text-green-200 border border-green-400/40 text-xs font-bold disabled:opacity-40">Save lock</button>
          <button disabled={busy} onClick={() => setEditing(false)} className="text-xs text-white/40">cancel</button>
        </div>
      )}
    </div>
  )
}

export default function SalaryPage() {
  const [board, setBoard] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [memberMap, setMemberMap] = useState({})

  // Adjust-anyone state.
  const [picked, setPicked] = useState(null)
  const [pickVal, setPickVal] = useState('')

  const refresh = useCallback(async () => {
    const r = await api('/api/admin/salary')
    if (r.ok && r.data && Array.isArray(r.data.board)) {
      setBoard(r.data.board); setCounts(r.data.counts || {}); setError(null)
    } else {
      setError(r.data?.error || 'Failed to load salary board')
    }
    setLoading(false)
  }, [])

  const loadMembers = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/players', { cache: 'no-store' })
      const d = await r.json()
      const map = {}
      for (const pl of d.players || []) map[String(pl.discordId)] = pl
      setMemberMap(map)
    } catch { /* avatars optional */ }
  }, [])

  useEffect(() => { refresh(); loadMembers() }, [refresh, loadMembers])

  const flash = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500) }

  const doAdjust = async (discordId, salary) => {
    setBusy(true)
    const r = await api('/api/admin/salary/adjust', 'POST', { discordId, salary: Number(salary) })
    setBusy(false)
    if (r.ok && r.data?.ok) { flash(`Locked ${r.data.name || discordId} at ${salary}`); await refresh() }
    else flash(r.data?.error || 'Adjust failed', false)
  }

  const doUnlock = async (p) => {
    if (!confirm(`Remove ${p.name || p.discordId}'s salary lock and sync to the auto-calc?`)) return
    setBusy(true)
    const r = await api('/api/admin/salary/unlock', 'POST', { discordId: p.discordId })
    setBusy(false)
    if (r.ok && r.data?.ok) { flash(`Unlocked ${p.name || p.discordId}`); await refresh() }
    else flash(r.data?.error || 'Unlock failed', false)
  }

  const shouldMoveUp = board.filter((p) => p.state === 'should_move_up')

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">Salary</h1>
          <p className="text-sm text-white/50">Manage locked salaries (col O) — see who is locked at what and who the auto-calc (col N) says should move up. Adjusting locks the player; unlocking resumes auto-updates. <span className="text-red-300/80">Writes the live sheet + lock table.</span></p>
        </div>
        <button onClick={() => { setLoading(true); refresh() }} disabled={busy}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 disabled:opacity-40">↻ Refresh</button>
      </div>

      {toast && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-sm border ${toast.ok ? 'bg-green-500/10 border-green-400/30 text-green-200' : 'bg-red-500/10 border-red-400/30 text-red-200'}`}>{toast.msg}</div>
      )}
      {error && <div className="mb-4 px-3 py-2 rounded-lg text-sm bg-red-500/10 border border-red-400/30 text-red-200">{error}</div>}

      {/* Adjust anyone */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-6">
        <div className="text-sm font-bold text-white mb-2">Lock / adjust a player&apos;s salary</div>
        {!picked ? (
          <PlayerPicker onPick={(p) => { setPicked(p); setPickVal('') }} placeholder="Search any player by name…" />
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar src={picked.avatarUrl} name={picked.displayName} size={28} ring={false} className="flex-shrink-0" />
              <span className="text-sm text-white truncate">{picked.displayName}</span>
            </div>
            <input type="number" step="0.25" min="0" value={pickVal} onChange={(e) => setPickVal(e.target.value)} placeholder="salary"
                   className="w-24 px-2 py-1 rounded bg-black/40 border border-white/15 text-white text-sm" />
            <button disabled={busy || pickVal === ''} onClick={() => doAdjust(picked.discordId, pickVal)}
                    className="px-3 py-1 rounded bg-green-500/20 text-green-200 border border-green-400/40 text-xs font-bold disabled:opacity-40">Lock salary</button>
            <button disabled={busy} onClick={() => setPicked(null)} className="text-xs text-white/40">change player</button>
          </div>
        )}
      </div>

      {/* Should move up */}
      {shouldMoveUp.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
            <span className="w-1.5 h-5 rounded-full bg-green-400" /> Should move up ({shouldMoveUp.length})
            <span className="text-[11px] font-normal text-white/40">locked below what the auto-calc now says</span>
          </h2>
          <div className="grid md:grid-cols-2 gap-3">
            {shouldMoveUp.map((p) => (
              <LockedRow key={p.discordId} p={p} member={memberMap[String(p.discordId)]} onAdjust={doAdjust} onUnlock={doUnlock} busy={busy} />
            ))}
          </div>
        </div>
      )}

      {/* All locked */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-bold text-white">Locked salaries ({board.length})</h2>
        <div className="text-[11px] text-white/40">{counts.shouldMoveUp || 0} should move up · {counts.lockedAbove || 0} above calc</div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {board.map((p) => (
          <LockedRow key={p.discordId} p={p} member={memberMap[String(p.discordId)]} onAdjust={doAdjust} onUnlock={doUnlock} busy={busy} />
        ))}
        {board.length === 0 && (
          <div className="text-white/40 text-sm py-8 text-center col-span-2">{loading ? 'Loading…' : 'No players have a locked salary.'}</div>
        )}
      </div>
    </div>
  )
}
