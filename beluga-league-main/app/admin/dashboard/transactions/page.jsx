'use client'

import { useEffect, useState, useCallback } from 'react'

const TX_TYPES = [
  'sign', 'drop', 'release', 'trade_in', 'trade_out',
  'ir_place', 'ir_return', 'suspend', 'reinstate',
  'rfa', 'role_change', 'rename',
  'gm_assign', 'gm_remove', 'captain_assign', 'captain_remove',
  'esub', 'other',
]

const TX_LABELS = {
  sign: 'Signed', drop: 'Dropped', release: 'Released',
  trade_in: 'Traded in', trade_out: 'Traded out',
  ir_place: 'Placed on IR', ir_return: 'Returned from IR',
  suspend: 'Suspended', reinstate: 'Reinstated',
  rfa: 'RFA', role_change: 'Role change', rename: 'Renamed',
  gm_assign: 'GM assigned', gm_remove: 'GM removed',
  captain_assign: 'Captain assigned', captain_remove: 'Captain removed',
  esub: 'Emergency sub', other: 'Other',
}

export default function TransactionsAdminPage() {
  const [filters, setFilters] = useState({ discordId: '', seasonId: '', type: '' })
  const [seasons, setSeasons] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    fetch('/api/admin/seasons', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSeasons(d.seasons || []))
      .catch(() => {})
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.discordId) params.set('discordId', filters.discordId)
      if (filters.seasonId) params.set('seasonId', filters.seasonId)
      const r = await fetch(`/api/admin/transactions?${params}`, { cache: 'no-store' })
      const d = await r.json()
      let list = d.transactions || []
      if (filters.type) list = list.filter((t) => t.type === filters.type)
      setItems(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { reload() }, [reload])

  async function deleteTx(id) {
    if (!confirm('Delete this transaction? Historical record will be lost.')) return
    await fetch(`/api/admin/transactions/${id}`, { method: 'DELETE', cache: 'no-store' })
    reload()
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
          <h1 className="text-3xl font-black text-white mb-2">Transactions</h1>
          <p className="text-blue-100/60 text-sm">
            Roster movement log. Most entries come from the bot's slash commands. You can manually add or delete entries here.
          </p>
        </div>
        <button onClick={() => setShowAdd(true)} className="px-4 py-2 text-sm font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/30 rounded-lg">
          + Manual entry
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <input
          type="text" placeholder="Discord ID"
          value={filters.discordId}
          onChange={(e) => setFilters({ ...filters, discordId: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm font-mono w-48"
        />
        <select value={filters.seasonId} onChange={(e) => setFilters({ ...filters, seasonId: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="">All seasons</option>
          {seasons.map((s) => <option key={s.id} value={s.id}>S{s.seasonNumber}</option>)}
        </select>
        <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="">All types</option>
          {TX_TYPES.map((t) => <option key={t} value={t}>{TX_LABELS[t]}</option>)}
        </select>
        <span className="text-xs text-white/50 ml-auto">{items.length} entr{items.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : items.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
          No transactions match this filter.
        </div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-black/30">
              <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Season</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-3 py-2 text-left">Team</th>
                <th className="px-3 py-2 text-left">By</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((tx) => (
                <tr key={tx.id} className="border-t border-white/5 hover:bg-white/[0.04]">
                  <td className="px-3 py-1.5 text-white/40 text-[10px] whitespace-nowrap">{new Date(tx.performedAt).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-blue-200/70">{tx.seasonNumber ? `S${tx.seasonNumber}` : '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-300 border border-blue-400/30">{TX_LABELS[tx.type] || tx.type}</span>
                  </td>
                  <td className="px-3 py-1.5 text-white">
                    <div className="truncate max-w-[180px]">{tx.displayName || tx.discordUsername || tx.discordId}</div>
                  </td>
                  <td className="px-3 py-1.5 text-white/80">
                    {tx.teamName || '—'}
                    {tx.pairedTeamName && <span className="text-white/40 mx-1">↔</span>}
                    {tx.pairedTeamName}
                  </td>
                  <td className="px-3 py-1.5 text-white/60 text-[11px]">{tx.performedByUsername || (tx.source === 'bot' ? 'bot' : '—')}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => deleteTx(tx.id)} className="text-[10px] uppercase font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-2 py-1 rounded">Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddTransactionModal seasons={seasons} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); reload() }} />}
    </div>
  )
}

function AddTransactionModal({ seasons, onClose, onCreated }) {
  const [form, setForm] = useState({
    discordId: '', displayName: '',
    seasonId: '', type: 'sign',
    teamId: '', pairedTeamId: '',
    detailsText: '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit() {
    setBusy(true); setErr(null)
    try {
      let details = {}
      if (form.detailsText.trim()) {
        try { details = JSON.parse(form.detailsText) } catch { throw new Error('Details must be valid JSON') }
      }
      const r = await fetch('/api/admin/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          discordId: form.discordId.trim(),
          displayName: form.displayName.trim() || null,
          seasonId: form.seasonId || null,
          type: form.type,
          teamId: form.teamId || null,
          pairedTeamId: form.pairedTeamId || null,
          details,
          source: 'admin-panel',
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      onCreated()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} title="New transaction">
      <div className="space-y-3">
        {err && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{err}</div>}
        <Field label="Discord ID *">
          <input type="text" value={form.discordId} onChange={(e) => setForm({ ...form, discordId: e.target.value })}
            placeholder="e.g. 123456789012345678" className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-sm" />
        </Field>
        <Field label="Display Name (optional)">
          <input type="text" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm">
              {TX_TYPES.map((t) => <option key={t} value={t}>{TX_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Season">
            <select value={form.seasonId} onChange={(e) => setForm({ ...form, seasonId: e.target.value })} className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm">
              <option value="">— None —</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>S{s.seasonNumber}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Team ID (optional)">
            <input type="number" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
          </Field>
          <Field label="Paired Team ID (trades)">
            <input type="number" value={form.pairedTeamId} onChange={(e) => setForm({ ...form, pairedTeamId: e.target.value })}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white text-sm" />
          </Field>
        </div>
        <Field label="Details (JSON, optional)">
          <textarea value={form.detailsText} onChange={(e) => setForm({ ...form, detailsText: e.target.value })}
            placeholder='{"salary": 5.0, "note": "manual entry"}'
            rows={3}
            className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded text-white font-mono text-xs" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-white/70 bg-white/5 rounded">Cancel</button>
          <button onClick={submit} disabled={busy || !form.discordId.trim()} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-50 rounded">{busy ? 'Saving…' : 'Log transaction'}</button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-bold tracking-wider uppercase text-blue-300/70 mb-1">{label}</label>
      {children}
    </div>
  )
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
