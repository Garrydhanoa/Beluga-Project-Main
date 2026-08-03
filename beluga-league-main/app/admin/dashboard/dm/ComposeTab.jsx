'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cx, DIVISIONS, MAX_LEN, CONFIRM_THRESHOLD, TOKENS,
  renderPreview, Panel, Toggle, SearchPicker, MultiSelect,
} from './dmUi'

/**
 * Compose tab — send one message to any slice of the server.
 *
 * The body is passed through byte-for-byte so Discord formatting survives
 * exactly as typed. Channel/user/role tags are inserted as raw Discord tokens
 * (<#id>, <@id>, <@&id>) at the cursor; the preview resolves them into chips.
 *
 * Nothing is sent from here — the job is queued and the bot delivers it.
 */

export default function ComposeTab() {
  // targets
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [franchises, setFranchises] = useState([])
  const [teams, setTeams] = useState([])
  const [divisions, setDivisions] = useState([])
  const [everyone, setEveryone] = useState(false)
  const [freeAgents, setFreeAgents] = useState(false)
  const [excludeUsers, setExcludeUsers] = useState([])
  const [excludeRoles, setExcludeRoles] = useState([])
  const [showExclude, setShowExclude] = useState(false)

  // options
  const [options, setOptions] = useState({ franchises: [], teams: [], divisions: DIVISIONS, channels: [], season: null })

  // message
  const [defaultText, setDefaultText] = useState('')
  const [includeDefault, setIncludeDefault] = useState(true)
  const [editingDefault, setEditingDefault] = useState(false)
  const [savedDefault, setSavedDefault] = useState(false)
  const [body, setBody] = useState('')
  const bodyRef = useRef(null)

  // insert pickers
  const [insertOpen, setInsertOpen] = useState(null) // 'channel' | 'user' | 'role' | null
  const [insertQ, setInsertQ] = useState('')
  const [insertResults, setInsertResults] = useState([])

  // send
  const [resolved, setResolved] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [confirmCount, setConfirmCount] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)

  // job tracking
  const [activeJob, setActiveJob] = useState(null)
  const [history, setHistory] = useState([])

  // ---- load ------------------------------------------------------------
  useEffect(() => {
    fetch('/api/admin/dm/targets', { cache: 'no-store' })
      .then((r) => r.json()).then((j) => setOptions((o) => ({ ...o, ...j }))).catch(() => {})
    fetch('/api/admin/dm/default', { cache: 'no-store' })
      .then((r) => r.json()).then((j) => setDefaultText(j.text || '')).catch(() => {})
    loadHistory()
  }, [])

  const loadHistory = useCallback(() => {
    fetch('/api/admin/dm/jobs', { cache: 'no-store' })
      .then((r) => r.json()).then((j) => setHistory(j.jobs || [])).catch(() => {})
  }, [])

  // Poll the running job so the progress bar moves.
  useEffect(() => {
    if (!activeJob?.job?.id) return undefined
    const status = activeJob.job.status
    if (status === 'done' || status === 'cancelled' || status === 'failed') return undefined
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/dm/jobs/${activeJob.job.id}`, { cache: 'no-store' })
        const j = await res.json()
        if (j.job) {
          setActiveJob(j)
          if (['done', 'cancelled', 'failed'].includes(j.job.status)) loadHistory()
        }
      } catch { /* transient */ }
    }, 2000)
    return () => clearInterval(t)
  }, [activeJob, loadHistory])

  // ---- target payload --------------------------------------------------
  const targets = useMemo(() => ({
    users: users.map((u) => u.id),
    roles: roles.map((r) => r.id),
    franchises,
    teams,
    divisions,
    everyone,
    freeAgents,
    excludeUsers: excludeUsers.map((u) => u.id),
    excludeRoles: excludeRoles.map((r) => r.id),
  }), [users, roles, franchises, teams, divisions, everyone, freeAgents, excludeUsers, excludeRoles])

  const hasTargets = users.length || roles.length || franchises.length || teams.length
    || divisions.length || everyone || freeAgents

  // Any target change invalidates a previous resolve.
  useEffect(() => { setResolved(null); setNeedsConfirm(false); setConfirmCount('') }, [targets])

  // ---- chip add/remove -------------------------------------------------
  const toggleChip = (setter) => (item, remove) => {
    setter((prev) => {
      if (remove || prev.some((p) => p.id === item.id)) return prev.filter((p) => p.id !== item.id)
      return [...prev, {
        id: item.id,
        label: item.displayName || item.name,
        dot: item.color || undefined,
      }]
    })
  }
  const toggleId = (setter) => (id) =>
    setter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  // ---- insert at cursor ------------------------------------------------
  function insertAtCursor(text) {
    const el = bodyRef.current
    if (!el) { setBody((b) => b + text); return }
    const start = el.selectionStart ?? body.length
    const end = el.selectionEnd ?? body.length
    const next = body.slice(0, start) + text + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  useEffect(() => {
    if (!insertOpen || insertOpen === 'channel') return undefined
    if (!insertQ.trim()) { setInsertResults([]); return undefined }
    let alive = true
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/discord?kind=${insertOpen}&q=${encodeURIComponent(insertQ)}`, { cache: 'no-store' })
        const j = await res.json()
        if (alive) setInsertResults(j.results || [])
      } catch { if (alive) setInsertResults([]) }
    }, 200)
    return () => { alive = false; clearTimeout(t) }
  }, [insertQ, insertOpen])

  const channelResults = useMemo(() => {
    const q = insertQ.trim().toLowerCase()
    const all = options.channels || []
    return (q ? all.filter((c) => (c.name || '').toLowerCase().includes(q)) : all).slice(0, 60)
  }, [insertQ, options.channels])

  // ---- preview ---------------------------------------------------------
  const composed = useMemo(() => {
    const parts = []
    if (includeDefault && defaultText.trim()) parts.push(defaultText.trim())
    if (body.trim()) parts.push(body.trim())
    return parts.join('\n\n')
  }, [includeDefault, defaultText, body])

  const previewHtml = useMemo(() => renderPreview(composed, {
    channels: options.channels,
    users: [...users, ...excludeUsers].map((u) => ({ id: u.id, displayName: u.label })),
    roles: [...roles, ...excludeRoles].map((r) => ({ id: r.id, name: r.label })),
  }), [composed, options.channels, users, roles, excludeUsers, excludeRoles])

  const overLimit = composed.length > MAX_LEN

  // ---- actions ---------------------------------------------------------
  async function saveDefault() {
    setSavedDefault(false)
    try {
      const res = await fetch('/api/admin/dm/default', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: defaultText }),
      })
      if (res.ok) { setSavedDefault(true); setEditingDefault(false); setTimeout(() => setSavedDefault(false), 2500) }
    } catch { /* ignore */ }
  }

  async function resolve() {
    setResolving(true); setError(null); setNotice(null)
    try {
      const res = await fetch('/api/admin/dm/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ targets }),
      })
      const j = await res.json()
      if (!res.ok) { setError(j.error || 'Could not resolve recipients.'); return }
      setResolved(j)
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setResolving(false)
    }
  }

  async function send({ testOnly = false } = {}) {
    setSending(true); setError(null); setNotice(null)
    try {
      const payload = { targets, body, includeDefault, testOnly }
      if (needsConfirm) payload.confirmCount = Number(confirmCount)
      const res = await fetch('/api/admin/dm/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(payload),
      })
      const j = await res.json()

      if (res.status === 409 && j.needsConfirmation) {
        setNeedsConfirm(true)
        setResolved((r) => ({ ...(r || {}), count: j.count }))
        setError(j.message)
        return
      }
      if (!res.ok) { setError(j.error || 'Send failed.'); return }

      setNeedsConfirm(false); setConfirmCount('')
      setNotice(testOnly
        ? 'Test DM queued — check your DMs in a moment.'
        : `Queued ${j.count} DM${j.count === 1 ? '' : 's'}. The bot is sending now.`)
      const detail = await fetch(`/api/admin/dm/jobs/${j.jobId}`, { cache: 'no-store' }).then((r) => r.json())
      setActiveJob(detail)
      loadHistory()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSending(false)
    }
  }

  async function cancelJob() {
    if (!activeJob?.job?.id) return
    await fetch(`/api/admin/dm/jobs/${activeJob.job.id}/cancel`, { method: 'POST' }).catch(() => {})
  }

  async function retryJob(id) {
    const res = await fetch(`/api/admin/dm/jobs/${id}/retry`, { method: 'POST' })
    const j = await res.json()
    if (!res.ok) { setError(j.error || 'Retry failed.'); return }
    setNotice(`Re-queued ${j.count} failed DM${j.count === 1 ? '' : 's'}.`)
    const detail = await fetch(`/api/admin/dm/jobs/${j.jobId}`, { cache: 'no-store' }).then((r) => r.json())
    setActiveJob(detail)
    loadHistory()
  }

  function duplicate(job) {
    setBody(job.body || '')
    setIncludeDefault(job.include_default)
    const t = job.targets || {}
    setFranchises(t.franchises || [])
    setTeams(t.teams || [])
    setDivisions(t.divisions || [])
    setEveryone(Boolean(t.everyone))
    setFreeAgents(Boolean(t.freeAgents))
    setNotice('Loaded that send into the composer. People/role chips need re-picking by name.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---- render ----------------------------------------------------------
  const jobCounts = activeJob?.counts || {}
  const jobTotal = activeJob?.job?.total || 0
  const jobDone = (jobCounts.sent || 0) + (jobCounts.failed || 0) + (jobCounts.skipped || 0)
  const jobPct = jobTotal ? Math.round((jobDone / jobTotal) * 100) : 0
  const jobRunning = activeJob && ['queued', 'sending'].includes(activeJob.job?.status)

  return (
    <div>
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200">{error}</div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-200">{notice}</div>
      )}

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* ------------------------------------------------ RECIPIENTS */}
        <Panel title="Recipients" hint="Pick as many as you like — overlaps are merged automatically.">
          <div className="space-y-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">People</div>
              <SearchPicker kind="user" placeholder="Search a member by name…" selected={users} onAdd={toggleChip(setUsers)} color="blue" />
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">Roles</div>
              <SearchPicker kind="role" placeholder="Search a role by name…" selected={roles} onAdd={toggleChip(setRoles)} color="amber" />
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">Franchises</div>
              <MultiSelect options={options.franchises} selected={franchises} onToggle={toggleId(setFranchises)} empty="No franchises found." />
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">Teams (this season)</div>
              <MultiSelect options={options.teams} selected={teams} onToggle={toggleId(setTeams)} empty="No active season teams." />
            </div>

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">Divisions</div>
              <div className="flex flex-wrap gap-1.5">
                {DIVISIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => toggleId(setDivisions)(d)}
                    className={cx('px-3 py-1 rounded-full border text-xs font-semibold transition',
                      divisions.includes(d)
                        ? 'bg-blue-500/25 border-blue-400/60 text-blue-100'
                        : 'bg-white/[0.03] border-white/10 text-white/60 hover:border-white/25 hover:text-white')}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-px bg-white/10" />

            <Toggle on={freeAgents} onChange={setFreeAgents}
              label="Free agents only" hint="Everyone in the server not on an active roster this season" />
            <Toggle on={everyone} onChange={setEveryone} danger
              label="Everyone in the server" hint="Every non-bot member currently in the guild" />

            <div className="h-px bg-white/10" />

            <button onClick={() => setShowExclude((v) => !v)} className="text-xs font-bold text-blue-300 hover:text-blue-200">
              {showExclude ? '− Hide exclusions' : '+ Add exclusions'}
              {(excludeUsers.length + excludeRoles.length) > 0 && (
                <span className="ml-2 text-red-300">({excludeUsers.length + excludeRoles.length} excluded)</span>
              )}
            </button>
            {showExclude && (
              <div className="space-y-3 p-3 rounded-lg bg-red-500/[0.05] border border-red-500/20">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-red-200/70 mb-1.5">Exclude people</div>
                  <SearchPicker kind="user" placeholder="Search a member to exclude…" selected={excludeUsers} onAdd={toggleChip(setExcludeUsers)} color="red" />
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-red-200/70 mb-1.5">Exclude roles</div>
                  <SearchPicker kind="role" placeholder="Search a role to exclude…" selected={excludeRoles} onAdd={toggleChip(setExcludeRoles)} color="red" />
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* ------------------------------------------------ MESSAGE */}
        <Panel
          title="Message"
          hint="Typed exactly as Discord receives it. Markdown, line breaks and tags are preserved."
          right={
            <span className={cx('text-[11px] font-mono tabular-nums px-2 py-1 rounded',
              overLimit ? 'bg-red-500/20 text-red-200' : 'bg-white/5 text-white/45')}>
              {composed.length}/{MAX_LEN}
            </span>
          }
        >
          <div className="space-y-4">
            {/* default header */}
            <div className="p-3 rounded-lg bg-black/25 border border-white/10">
              <Toggle on={includeDefault} onChange={setIncludeDefault}
                label="Include default header" hint="Prepended above your message" />
              {editingDefault ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={defaultText}
                    onChange={(e) => setDefaultText(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-black/50 border border-white/10 focus:border-blue-400/60 rounded text-white text-xs font-mono focus:outline-none"
                  />
                  <div className="flex gap-2">
                    <button onClick={saveDefault} className="px-3 py-1.5 rounded bg-blue-500 hover:bg-blue-400 text-white text-xs font-bold">Save default</button>
                    <button onClick={() => setEditingDefault(false)} className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/70 text-xs font-bold">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-start gap-2">
                  <div className={cx('flex-1 text-xs font-mono whitespace-pre-wrap break-words',
                    includeDefault ? 'text-white/70' : 'text-white/25 line-through')}>
                    {defaultText || <span className="italic text-white/30">No default set</span>}
                  </div>
                  <button onClick={() => setEditingDefault(true)} className="text-[11px] font-bold text-blue-300 hover:text-blue-200 shrink-0">Edit</button>
                </div>
              )}
              {savedDefault && <div className="text-[11px] text-emerald-300 mt-1">Default saved</div>}
            </div>

            {/* insert toolbar */}
            <div className="flex flex-wrap gap-1.5">
              {[['channel', '# Channel'], ['user', '@ Person'], ['role', '@ Role']].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setInsertOpen(insertOpen === k ? null : k); setInsertQ(''); setInsertResults([]) }}
                  className={cx('px-2.5 py-1 rounded border text-[11px] font-bold transition',
                    insertOpen === k
                      ? 'bg-blue-500/25 border-blue-400/60 text-blue-100'
                      : 'bg-white/[0.03] border-white/10 text-white/60 hover:text-white hover:border-white/25')}
                >
                  {label}
                </button>
              ))}
              <span className="w-px bg-white/10 mx-1" />
              {TOKENS.map((t) => (
                <button
                  key={t}
                  onClick={() => insertAtCursor(`{${t}}`)}
                  title={`Replaced per recipient with their ${t}`}
                  className="px-2.5 py-1 rounded border border-emerald-400/25 bg-emerald-500/10 text-emerald-200/80 hover:text-emerald-100 text-[11px] font-mono font-bold transition"
                >
                  {`{${t}}`}
                </button>
              ))}
            </div>

            {insertOpen && (
              <div className="p-2 rounded-lg bg-black/40 border border-white/15">
                <input
                  autoFocus
                  value={insertQ}
                  onChange={(e) => setInsertQ(e.target.value)}
                  placeholder={insertOpen === 'channel' ? 'Filter channels…' : `Search ${insertOpen}s by name…`}
                  className="w-full px-2.5 py-1.5 bg-black/50 border border-white/10 focus:border-blue-400/60 rounded text-white text-xs focus:outline-none mb-1.5"
                />
                <div className="max-h-44 overflow-y-auto">
                  {(insertOpen === 'channel' ? channelResults : insertResults).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        const token = insertOpen === 'channel' ? `<#${r.id}>`
                          : insertOpen === 'role' ? `<@&${r.id}>` : `<@${r.id}>`
                        insertAtCursor(token)
                        setInsertOpen(null); setInsertQ('')
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded hover:bg-white/10"
                    >
                      <span className="text-xs text-white truncate flex-1">
                        {insertOpen === 'channel' ? `#${r.name}` : (r.displayName || r.name)}
                      </span>
                      {insertOpen === 'channel' && r.category && (
                        <span className="text-[10px] text-white/35 shrink-0">{r.category}</span>
                      )}
                    </button>
                  ))}
                  {insertOpen === 'channel' && !channelResults.length && (
                    <div className="px-2 py-2 text-[11px] text-white/40">
                      No channels mirrored yet — the bot fills this on its next member pull.
                    </div>
                  )}
                </div>
              </div>
            )}

            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              placeholder={'Write your message…\n\n**Bold**, *italic*, lists and line breaks all work.\nUse the buttons above to tag a channel or person.'}
              className="w-full px-3 py-2.5 bg-black/45 border border-white/10 focus:border-blue-400/60 rounded-lg text-white text-sm font-mono leading-relaxed focus:outline-none transition resize-y"
            />

            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-white/50 mb-1.5">Preview</div>
              <div className="rounded-lg border border-white/10 bg-[#0d1117] p-3 min-h-[80px]">
                {composed.trim() ? (
                  <div className="text-sm text-white/90 leading-relaxed break-words"
                    dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                  <div className="text-xs text-white/30 italic">Nothing to preview yet.</div>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ------------------------------------------------ SEND */}
      <div className="mt-5">
        <Panel title="Send" hint="Resolve first to see exactly who this reaches.">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={resolve}
              disabled={!hasTargets || resolving}
              className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/15 text-white text-sm font-bold transition"
            >
              {resolving ? 'Resolving…' : 'Resolve recipients'}
            </button>
            <button
              onClick={() => send({ testOnly: true })}
              disabled={!body.trim() || sending}
              className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 border border-white/15 text-white text-sm font-bold transition"
            >
              Send test DM to me
            </button>

            {needsConfirm && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30">
                <span className="text-xs text-red-200">Type <b>{resolved?.count}</b> to confirm:</span>
                <input
                  value={confirmCount}
                  onChange={(e) => setConfirmCount(e.target.value.replace(/\D/g, ''))}
                  className="w-24 px-2 py-1 bg-black/50 border border-white/15 rounded text-white text-xs font-mono focus:outline-none"
                />
              </div>
            )}

            <button
              onClick={() => send()}
              disabled={!hasTargets || !body.trim() || sending || overLimit
                || (needsConfirm && Number(confirmCount) !== resolved?.count)}
              className="px-5 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-400 disabled:bg-blue-500/30 disabled:text-white/40 text-white text-sm font-bold shadow-[0_0_25px_rgba(59,130,246,0.35)] transition"
            >
              {sending ? 'Queueing…' : resolved ? `Send to ${resolved.count}` : 'Send'}
            </button>

            {overLimit && (
              <span className="text-xs text-red-300">
                Over Discord&apos;s {MAX_LEN}-character limit — trim {composed.length - MAX_LEN} characters.
              </span>
            )}
          </div>

          {resolved && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-white">{resolved.count} recipient{resolved.count === 1 ? '' : 's'}</span>
                {resolved.totalMatched > resolved.count && (
                  <span className="text-[11px] text-white/40">({resolved.totalMatched - resolved.count} skipped — no longer in the server)</span>
                )}
                {resolved.count > CONFIRM_THRESHOLD && (
                  <span className="text-[11px] text-amber-300">· large send, confirmation required</span>
                )}
              </div>
              {(resolved.warnings || []).map((w, i) => (
                <div key={i} className="text-[11px] text-amber-200/80 mb-1">{w}</div>
              ))}
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 rounded-lg bg-black/25 border border-white/10">
                {resolved.recipients.map((r) => (
                  <span key={r.discordId} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] text-white/80">
                    {r.avatarUrl
                      ? <img src={r.avatarUrl} alt="" className="w-4 h-4 rounded-full" />
                      : <span className="w-4 h-4 rounded-full bg-white/10" />}
                    {r.displayName}
                  </span>
                ))}
                {resolved.truncated && <span className="text-[11px] text-white/40 self-center">…and more</span>}
                {!resolved.recipients.length && <span className="text-[11px] text-white/40">Nobody matched.</span>}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------ PROGRESS */}
      {activeJob?.job && (
        <div className="mt-5">
          <Panel
            title={`Job #${activeJob.job.id}`}
            hint={activeJob.job.test_only ? 'Test send (you only)' : null}
            right={jobRunning && (
              <button onClick={cancelJob} className="px-3 py-1.5 rounded bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-200 text-xs font-bold">
                Cancel
              </button>
            )}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${jobPct}%` }} />
              </div>
              <span className="text-xs font-mono tabular-nums text-white/70 shrink-0">{jobDone}/{jobTotal}</span>
              <span className={cx('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0',
                activeJob.job.status === 'done' ? 'bg-emerald-500/20 text-emerald-200'
                  : activeJob.job.status === 'sending' ? 'bg-blue-500/20 text-blue-200'
                    : activeJob.job.status === 'cancelled' ? 'bg-amber-500/20 text-amber-200'
                      : activeJob.job.status === 'failed' ? 'bg-red-500/20 text-red-200'
                        : 'bg-white/10 text-white/60')}>
                {activeJob.job.status}
              </span>
            </div>

            <div className="flex flex-wrap gap-4 text-xs mb-3">
              <span className="text-emerald-300">✓ {jobCounts.sent || 0} sent</span>
              <span className="text-red-300">✗ {jobCounts.failed || 0} failed</span>
              <span className="text-white/40">– {jobCounts.skipped || 0} skipped</span>
              <span className="text-white/40">⋯ {jobCounts.pending || 0} pending</span>
              {(jobCounts.failed || 0) > 0 && !jobRunning && (
                <button onClick={() => retryJob(activeJob.job.id)} className="text-blue-300 hover:text-blue-200 font-bold">
                  Retry failed
                </button>
              )}
            </div>

            {activeJob.targets.some((t) => t.status === 'failed' || t.status === 'skipped') && (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-black/25">
                {activeJob.targets.filter((t) => t.status === 'failed' || t.status === 'skipped').map((t) => (
                  <div key={t.discord_id} className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 last:border-0">
                    <span className={cx('text-[10px] font-bold uppercase w-14 shrink-0',
                      t.status === 'failed' ? 'text-red-300' : 'text-white/40')}>{t.status}</span>
                    <span className="text-xs text-white/80 truncate flex-1">{t.display_name || t.discord_id}</span>
                    <span className="text-[11px] text-white/40 truncate max-w-[240px]">{t.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ------------------------------------------------ HISTORY */}
      <div className="mt-5">
        <Panel title="History" hint="Every blast is also audit-logged.">
          {!history.length ? (
            <div className="text-xs text-white/35 italic">No DMs sent yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]">
                <thead>
                  <tr className="text-left text-white/40 border-b border-white/10">
                    <th className="py-2 pr-3 font-bold">#</th>
                    <th className="py-2 pr-3 font-bold">Sent by</th>
                    <th className="py-2 pr-3 font-bold">Message</th>
                    <th className="py-2 pr-3 font-bold">Results</th>
                    <th className="py-2 pr-3 font-bold">When</th>
                    <th className="py-2 font-bold" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((j) => (
                    <tr key={j.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 text-white/50 font-mono">{j.id}</td>
                      <td className="py-2 pr-3 text-white/80 truncate max-w-[120px]">{j.created_by_name || '—'}</td>
                      <td className="py-2 pr-3 text-white/60 truncate max-w-[240px]">
                        {j.test_only && <span className="text-[10px] text-amber-300 mr-1">TEST</span>}
                        {(j.body || '').replace(/\n/g, ' ').slice(0, 70)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className="text-emerald-300">{j.sent_count}</span>
                        <span className="text-white/25"> / </span>
                        <span className="text-red-300">{j.failed_count}</span>
                        <span className="text-white/25"> / {j.total}</span>
                      </td>
                      <td className="py-2 pr-3 text-white/40 whitespace-nowrap">
                        {j.created_at ? new Date(j.created_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <button
                          onClick={() => fetch(`/api/admin/dm/jobs/${j.id}`, { cache: 'no-store' })
                            .then((r) => r.json()).then(setActiveJob).catch(() => {})}
                          className="text-blue-300 hover:text-blue-200 font-bold mr-3"
                        >
                          View
                        </button>
                        <button onClick={() => duplicate(j)} className="text-white/50 hover:text-white font-bold">
                          Duplicate
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
