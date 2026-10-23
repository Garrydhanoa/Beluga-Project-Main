'use client'

/**
 * MMR Updater → "Lifetime wins requirement".
 *
 * Adds a second eligibility condition on top of 25 games in both 2s and 3s: the
 * MAIN tracker's lifetime Wins (TRN overview, never summed across alts) must reach
 * the minimum for the player's division. The division comes from their salary in
 * column O — or, for a new player with no salary yet, from column N right after the
 * MMR is written — mapped through column R's own formula, so a new season's ranges
 * are picked up automatically. If the division or the wins can't be read, the
 * scraper falls back to the games rule and pings Salary Crew.
 *
 * The toggle saves immediately; the three minimums save with the Save button.
 * "Check impact" previews what the rule would do with the numbers typed in, using
 * the latest pull — nothing is written.
 */

import { useCallback, useEffect, useState } from 'react'

const DIVS = [
  { key: 'wins_min_aa', label: 'AA', q: 'aa' },
  { key: 'wins_min_aaa', label: 'AAA', q: 'aaa' },
  { key: 'wins_min_majors', label: 'Majors', q: 'majors' },
]

const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString())

function Toggle({ on, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0 border transition disabled:opacity-40 ${on ? 'bg-emerald-500/70 border-emerald-300/60' : 'bg-white/10 border-white/20'}`}
    >
      <span className={`absolute left-0 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
    </button>
  )
}

function PreviewList({ title, items, tone = 'red', note }) {
  if (!items?.length) return null
  const toneCls = tone === 'red' ? 'text-red-200' : tone === 'amber' ? 'text-amber-200' : 'text-white/70'
  return (
    <details className="mt-2">
      <summary className={`text-[11px] font-bold cursor-pointer ${toneCls}`}>{title} ({items.length}{items.length >= 60 ? '+' : ''})</summary>
      {note && <div className="text-[10px] text-white/40 mt-1">{note}</div>}
      <div className="mt-1 max-h-60 overflow-auto rounded-lg border border-white/10 divide-y divide-white/5">
        {items.map((x) => (
          <div key={x.row} className="px-2 py-1 text-[11px] text-white/75 flex gap-2 flex-wrap">
            <span className="text-white/40">row {x.row}</span>
            <span className="font-bold text-white/90">{x.name}</span>
            {x.division && <span>{x.division}{x.source === 'N' ? ' (projected)' : ''}</span>}
            {x.wins != null && <span>wins {fmt(x.wins)}{x.min ? ` / ${fmt(x.min)}` : ''}</span>}
            {x.need ? <span className="text-red-300">needs {fmt(x.need)} more</span> : null}
            {x.detail && <span className="text-amber-200/80">{x.detail}</span>}
          </div>
        ))}
      </div>
    </details>
  )
}

export default function WinsRulePanel({ config, onChanged, offline }) {
  const enabled = config?.wins_rule_enabled === '1'
  const [mins, setMins] = useState({ wins_min_aa: '', wins_min_aaa: '', wins_min_majors: '' })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)

  // Mirror the saved values into the inputs unless the operator is mid-edit.
  useEffect(() => {
    if (dirty) return
    setMins({
      wins_min_aa: config?.wins_min_aa || '',
      wins_min_aaa: config?.wins_min_aaa || '',
      wins_min_majors: config?.wins_min_majors || '',
    })
  }, [config?.wins_min_aa, config?.wins_min_aaa, config?.wins_min_majors, dirty])

  const runPreview = useCallback(async (values) => {
    setPreviewing(true)
    try {
      const qs = DIVS.map((d) => `${d.q}=${encodeURIComponent(String(values[d.key] || 0).replace(/,/g, ''))}`).join('&')
      const r = await fetch(`/api/admin/mmr/eligibility/preview?${qs}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      setPreview(r.ok ? j : { error: j.error || 'The scraper could not build the preview.' })
    } catch {
      setPreview({ error: 'The scraper is unreachable — the preview needs it.' })
    }
    setPreviewing(false)
  }, [])

  // First look: ranges from column R + impact with the saved numbers.
  useEffect(() => {
    if (offline) return
    runPreview({
      wins_min_aa: config?.wins_min_aa || 0,
      wins_min_aaa: config?.wins_min_aaa || 0,
      wins_min_majors: config?.wins_min_majors || 0,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline])

  async function save(body, okText) {
    setMsg(null)
    const r = await fetch('/api/admin/mmr-db/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMsg({ bad: true, text: j.error || 'Saving failed.' })
      return false
    }
    setMsg({ bad: false, text: okText })
    await onChanged?.()
    return true
  }

  async function saveMins() {
    setBusy('mins')
    const ok = await save({ ...mins }, 'Minimums saved.')
    if (ok) setDirty(false)
    setBusy('')
  }

  async function toggle(next) {
    if (next) {
      if (dirty) { setMsg({ bad: true, text: 'Save the minimums first, then turn the check on.' }); return }
      const c = preview?.counts
      const impact = c ? `\n\nWith the saved minimums: ${c.yes_short} currently-eligible player(s) would go to staff review, and ${c.no_games_ok_short} would get a "you need more wins" ping.` : ''
      if (!confirm(`Turn the lifetime-wins check ON? It applies from the next MMR pull.${impact}`)) return
    } else if (!confirm('Turn the lifetime-wins check OFF? Eligibility goes back to the 25-games rule only.')) {
      return
    }
    setBusy('toggle')
    await save({ wins_rule_enabled: next ? '1' : '0' }, next ? 'Lifetime-wins check is ON.' : 'Lifetime-wins check is OFF.')
    setBusy('')
  }

  const c = preview?.counts
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4" data-log-section="mmr-wins-rule">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white">Lifetime wins requirement</div>
          <div className="text-[11px] text-white/45 mt-0.5 max-w-2xl">
            On top of 25 games in both 2s and 3s, a player&apos;s <b>main account</b> needs this many lifetime wins
            (TRN profile &ldquo;Wins&rdquo;, never added across alts) for their division. Division comes from their salary in
            column O, or — for a new player — from column N right after their MMR is written, using column R&apos;s ranges.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold ${enabled ? 'text-emerald-300' : 'text-white/45'}`}>{enabled ? 'ON' : 'OFF'}</span>
          <Toggle on={enabled} onChange={toggle} disabled={!!busy} label="Turn the lifetime-wins check on or off" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
        {DIVS.map((d) => (
          <label key={d.key} className="block">
            <span className="text-[11px] text-white/50">{d.label} minimum lifetime wins</span>
            <input
              inputMode="numeric"
              value={mins[d.key]}
              onChange={(e) => { setDirty(true); setMins({ ...mins, [d.key]: e.target.value.replace(/[^\d]/g, '') }) }}
              placeholder="e.g. 3000"
              aria-label={`${d.label} minimum lifetime wins`}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-black/30 border border-white/15 text-white text-sm"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <button onClick={saveMins} disabled={!dirty || !!busy}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 disabled:opacity-40">
          {busy === 'mins' ? 'Saving…' : 'Save minimums'}
        </button>
        <button onClick={() => runPreview(mins)} disabled={previewing || offline}
                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/5 text-white/75 border border-white/15 disabled:opacity-40">
          {previewing ? 'Checking…' : 'Check impact'}
        </button>
        {dirty && <span className="text-[11px] text-amber-200/80">unsaved changes</span>}
        {msg && <span className={`text-[11px] ${msg.bad ? 'text-red-300' : 'text-emerald-300'}`}>{msg.text}</span>}
      </div>

      <div className="mt-3 pt-3 border-t border-white/10">
        {offline ? (
          <div className="text-[11px] text-white/40">The scraper is offline — the ranges and impact preview need it.</div>
        ) : !preview ? (
          <div className="text-[11px] text-white/40">Reading column R and the latest pull…</div>
        ) : preview.error ? (
          <div className="text-[11px] text-red-300">{preview.error}</div>
        ) : preview.formula_error ? (
          <div className="text-[11px] text-red-300">Column R&apos;s division formula can&apos;t be read: {preview.formula_error}. While this is broken the check falls back to the games rule and pings Salary Crew.</div>
        ) : (
          <>
            <div className="text-[11px] text-white/60">
              Division ranges from column R: <b className="text-white/85">{preview.ranges}</b>
              <span className="text-white/35"> · checked against column R for {preview.self_check?.checked} players: {preview.self_check?.mismatches?.length ? <span className="text-red-300">{preview.self_check.mismatches.length} mismatch(es)</span> : 'all match'}</span>
            </div>
            {c && (
              <div className="text-[11px] text-white/60 mt-1.5">
                Impact with these minimums, from the latest pull:{' '}
                <b className="text-red-200">{c.yes_short}</b> currently-eligible would go to staff review ·{' '}
                <b className="text-amber-200">{c.no_games_ok_short}</b> ineligible with the games would get a wins ping ·{' '}
                <b className="text-white/80">{c.passes}</b> meet it ·{' '}
                <span className="text-white/40">{c.not_pulled} not in the latest pull</span>
              </div>
            )}
            <PreviewList title="Currently eligible but below the minimum (staff review, once each)" items={preview.lists?.yes_short} />
            <PreviewList title="Ineligible, have the games, short on wins (pinged once)" items={preview.lists?.no_games_ok_short} tone="amber" />
            <PreviewList title="New players short on wins" items={preview.lists?.new_short} tone="amber" />
            <PreviewList title="Division can't be worked out (games rule + Salary Crew ping)" items={preview.lists?.division_unknown} tone="slate" />
          </>
        )}
      </div>
    </div>
  )
}
