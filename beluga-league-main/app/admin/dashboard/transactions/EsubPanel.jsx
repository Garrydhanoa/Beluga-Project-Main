'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * E-sub (one-day sub) usage for a season, one row per team, grouped by division.
 *
 * Counts are stored in `team_esubs` keyed by (season_id, team_id), which is what
 * makes them reset on their own when a new season starts — a new season has new
 * team rows, so every team reads 0. Nothing here is carried over.
 */

const DIVISIONS = ['Majors', 'AAA', 'AA']

export default function EsubPanel({ seasons }) {
  const [seasonId, setSeasonId] = useState('')
  const [limit, setLimit] = useState(3)
  const [limitDraft, setLimitDraft] = useState('3')
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(true)

  const apply = useCallback((data) => {
    // Array-guard: a malformed response must not blow up the list render.
    setTeams(Array.isArray(data?.teams) ? data.teams : [])
    const n = Number(data?.limit)
    if (Number.isFinite(n)) { setLimit(n); setLimitDraft(String(n)) }
    if (data?.seasonId && !seasonId) setSeasonId(String(data.seasonId))
  }, [seasonId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = seasonId ? `?seasonId=${seasonId}` : ''
      const r = await fetch(`/api/admin/esubs${qs}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to load e-subs')
      apply(d)
    } catch (e) {
      setError(e.message)
      setTeams([])
    } finally {
      setLoading(false)
    }
  }, [seasonId, apply])

  useEffect(() => { load() }, [load])

  async function post(body, key) {
    setSaving(key)
    setError(null)
    try {
      const r = await fetch('/api/admin/esubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ seasonId: seasonId || undefined, ...body }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      apply(d)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(null)
    }
  }

  const setUsed = (teamId, used) => post({ teamId, used }, `t${teamId}`)

  async function saveLimit() {
    const n = Number(limitDraft)
    if (!Number.isFinite(n) || n < 0 || n > 99) { setError('Allowance must be 0-99'); return }
    await post({ limit: n }, 'limit')
  }

  async function resetAll() {
    if (!confirm('Set every team\'s e-sub count for this season back to 0?')) return
    await post({ action: 'reset' }, 'reset')
  }

  const byDivision = DIVISIONS
    .map((d) => ({ division: d, rows: teams.filter((t) => t.division === d) }))
    .filter((g) => g.rows.length > 0)

  return (
    <section className="mb-8 rounded-2xl bg-white/[0.02] border border-white/10">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-black text-white">E-Sub Usage</span>
        <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-400/30">
          {limit} per team
        </span>
        <span className="text-white/40 text-xs ml-auto">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          <p className="text-blue-100/60 text-xs mb-4 max-w-3xl">
            One-day subs used per team, per division. The bot writes these from{' '}
            <span className="font-mono text-blue-200/80">/esub</span> and{' '}
            <span className="font-mono text-blue-200/80">/adminesub</span>. Counts are stored per
            season, so starting a new season resets every team back to 0 automatically — the reset
            button below is only for correcting things mid-season.
          </p>

          <div className="mb-4 flex flex-wrap gap-2 items-center">
            <select
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
              className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>S{s.seasonNumber}{s.status === 'active' ? ' (active)' : ''}</option>
              ))}
            </select>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/40 border border-white/10">
              <span className="text-[10px] uppercase tracking-wider font-bold text-blue-300/70">Allowance</span>
              <input
                type="number" min="0" max="99"
                value={limitDraft}
                onChange={(e) => setLimitDraft(e.target.value)}
                className="w-14 px-2 py-1 bg-black/50 border border-white/10 rounded text-white text-sm text-center"
              />
              <button
                onClick={saveLimit}
                disabled={saving === 'limit' || String(limit) === limitDraft}
                className="text-[10px] uppercase font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 disabled:opacity-40 border border-blue-400/30 px-2 py-1 rounded"
              >
                {saving === 'limit' ? '…' : 'Save'}
              </button>
            </div>

            <button
              onClick={resetAll}
              disabled={saving === 'reset'}
              className="ml-auto text-[10px] uppercase font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 border border-red-500/30 px-3 py-2 rounded-lg"
            >
              {saving === 'reset' ? 'Resetting…' : 'Reset all to 0'}
            </button>
          </div>

          {error && (
            <div className="mb-3 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>
          )}

          {loading ? (
            <div className="text-blue-200/60 text-sm">Loading…</div>
          ) : byDivision.length === 0 ? (
            <div className="p-6 rounded-xl border border-dashed border-white/15 text-center text-white/50 text-sm">
              No active teams in this season.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {byDivision.map((group) => (
                <div key={group.division} className="rounded-xl bg-black/20 border border-white/10 overflow-hidden">
                  <div className="px-3 py-2 bg-black/30 text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                    {group.division}
                  </div>
                  <div className="divide-y divide-white/5">
                    {group.rows.map((t) => (
                      <EsubRow
                        key={t.teamId}
                        team={t}
                        limit={limit}
                        busy={saving === `t${t.teamId}`}
                        onSave={(used) => setUsed(t.teamId, used)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function EsubRow({ team, limit, busy, onSave }) {
  const [draft, setDraft] = useState(String(team.used))

  // Follow the server value whenever it changes underneath us (save, reset,
  // season switch) so the input never shows a stale number.
  useEffect(() => { setDraft(String(team.used)) }, [team.used])

  const dirty = String(team.used) !== draft
  const atLimit = team.used >= limit

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-sm text-white truncate flex-1 min-w-0">{team.name}</span>
      <span className={`text-[10px] font-bold tabular-nums ${atLimit ? 'text-red-300' : 'text-white/40'}`}>
        {team.used}/{limit}
      </span>
      <input
        type="number" min="0" max="99"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="w-14 px-2 py-1 bg-black/50 border border-white/10 rounded text-white text-sm text-center"
      />
      <button
        onClick={() => onSave(Number(draft))}
        disabled={busy || !dirty}
        className="text-[10px] uppercase font-bold text-blue-200 bg-blue-500/15 hover:bg-blue-500/25 disabled:opacity-30 border border-blue-400/30 px-2 py-1 rounded"
      >
        {busy ? '…' : 'Set'}
      </button>
    </div>
  )
}
