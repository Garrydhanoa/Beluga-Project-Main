'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import TeamLogo from '../../../components/TeamLogo'

/**
 * Playoffs control room.
 *
 * The old page was a flat list of <select> pairs — a form, not a bracket — with
 * no seeds, no scores, no winners, no thread state, and a single always-blue
 * status line that reported "Failed to save playoffs" in the same calm tone as a
 * success. It also could not do the one thing it existed for: saving a round.
 *
 * This shows the bracket AS a bracket and drives it through targeted actions.
 * Automation runs the normal case; every matchup can be overridden by hand.
 */

const DIVISIONS = ['Majors', 'AAA', 'AA']
const QUALIFIER_CHOICES = [4, 6, 8, 10, 12, 16]

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------

/**
 * `p-0` on the button and `left-0` on the knob are both required: a button's
 * default padding offsets an absolutely-positioned child, and without them the
 * knob escapes the track when ON.
 */
function Toggle({ checked, onChange, label, hint, disabled = false }) {
  return (
    <label className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <div className="min-w-0">
        <div className="text-sm font-bold text-white">{label}</div>
        {hint && <div className="text-xs text-blue-100/50 mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        aria-pressed={checked}
        aria-label={label}
        className={`relative shrink-0 w-12 h-6 p-0 rounded-full transition-colors ${
          checked ? 'bg-blue-500' : 'bg-white/10'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        <span
          className={`absolute top-0.5 left-0 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

/** Errors must not look like successes. The old page rendered both in blue. */
function Banner({ tone, children, onDismiss }) {
  if (!children) return null
  const tones = {
    error: 'border-red-400/40 bg-red-400/10 text-red-200',
    ok: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200',
    warn: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
    info: 'border-blue-400/40 bg-blue-500/10 text-blue-100',
  }
  return (
    <div className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-start gap-3 ${tones[tone] || tones.info}`}>
      <div className="flex-1 whitespace-pre-wrap">{children}</div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="text-white/40 hover:text-white/80 text-xs font-bold px-1"
      >
        ✕
      </button>
    </div>
  )
}

function SeedChip({ seed }) {
  if (!seed) return <span className="w-6 shrink-0" aria-hidden="true" />
  return (
    <span
      className="w-6 h-6 shrink-0 rounded-md bg-blue-500/15 border border-blue-400/30 text-blue-200
                 text-[11px] font-black flex items-center justify-center tabular-nums"
      title={`Seed ${seed}`}
    >
      {seed}
    </span>
  )
}

function ResultTag({ kind }) {
  if (!kind || kind === 'series') return null
  const map = {
    ffw: ['FF', 'bg-orange-500/15 text-orange-300 border-orange-400/30'],
    double_ff: ['DOUBLE FF', 'bg-red-500/15 text-red-300 border-red-400/30'],
    bye: ['BYE', 'bg-white/10 text-white/60 border-white/20'],
  }
  const [text, cls] = map[kind] || [kind, 'bg-white/10 text-white/60 border-white/20']
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider border ${cls}`}>{text}</span>
}

// ---------------------------------------------------------------------------
// Matchup
// ---------------------------------------------------------------------------

function TeamRow({ team, seed, score, isWinner, decided }) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
        isWinner ? 'bg-emerald-400/10' : decided ? 'opacity-50' : ''
      }`}
    >
      <SeedChip seed={seed} />
      <div className="w-6 h-6 shrink-0 flex items-center justify-center">
        {team?.name
          ? <TeamLogo name={team.name} teamId={team.id} className="w-full h-full" imgClassName="w-full h-full object-contain" />
          : <span className="w-3 h-3 rounded-full border border-dashed border-white/25" aria-hidden="true" />}
      </div>
      <span className={`flex-1 truncate text-sm ${team?.name ? 'text-white' : 'text-white/30 italic'} ${isWinner ? 'font-black' : 'font-semibold'}`}>
        {team?.name || 'TBD'}
      </span>
      <span className={`text-sm font-black tabular-nums ${isWinner ? 'text-emerald-300' : 'text-white/50'}`}>
        {score == null ? '–' : score}
      </span>
    </div>
  )
}

function MatchupCard({ matchup, isSelected, onSelect }) {
  const decided = Boolean(matchup.winnerTeamId)
  const live = Boolean(matchup.thread && !matchup.thread.isClosed && !decided)

  return (
    <button
      type="button"
      onClick={() => onSelect(matchup)}
      aria-label={`Edit matchup ${matchup.home?.name || 'TBD'} versus ${matchup.away?.name || 'TBD'}`}
      className={`w-full text-left rounded-xl border p-2 transition-all ${
        isSelected
          ? 'border-cyan-400/60 bg-cyan-400/[0.07] shadow-[0_0_20px_rgba(34,211,238,0.15)]'
          : 'border-white/10 bg-white/[0.03] hover:border-blue-400/40 hover:bg-white/[0.06]'
      }`}
    >
      <div className="flex items-center gap-2 px-2 pb-1">
        <span className="text-[9px] font-black tracking-[0.2em] uppercase text-white/30">
          M{matchup.order}
        </span>
        <ResultTag kind={matchup.resultKind} />
        {matchup.manualOverride && (
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider border bg-purple-500/15 text-purple-300 border-purple-400/30"
            title="Set by hand — automatic recalculation will not overwrite it"
          >
            MANUAL
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          {live && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />}
          <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">
            {matchup.thread ? (matchup.thread.isClosed ? 'closed' : 'thread') : 'no thread'}
          </span>
        </span>
      </div>
      <TeamRow
        team={matchup.home} seed={matchup.homeSeed} score={matchup.homeScore}
        isWinner={decided && matchup.winnerTeamId === matchup.home?.id} decided={decided}
      />
      <TeamRow
        team={matchup.away} seed={matchup.awaySeed} score={matchup.awayScore}
        isWinner={decided && matchup.winnerTeamId === matchup.away?.id} decided={decided}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Matchup editor
// ---------------------------------------------------------------------------

function MatchupEditor({ matchup, teams, busy, onAction, onClose }) {
  const [homeScore, setHomeScore] = useState(matchup.homeScore ?? '')
  const [awayScore, setAwayScore] = useState(matchup.awayScore ?? '')
  const [homeTeamId, setHomeTeamId] = useState(matchup.home?.id ?? '')
  const [awayTeamId, setAwayTeamId] = useState(matchup.away?.id ?? '')

  useEffect(() => {
    setHomeScore(matchup.homeScore ?? '')
    setAwayScore(matchup.awayScore ?? '')
    setHomeTeamId(matchup.home?.id ?? '')
    setAwayTeamId(matchup.away?.id ?? '')
  }, [matchup])

  const both = matchup.home?.id && matchup.away?.id

  return (
    <div className="rounded-2xl border border-cyan-400/25 bg-[#0b1220] p-4 space-y-4" data-log-section="playoff-matchup-editor">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-cyan-300/70">Editing matchup</div>
          <div className="text-lg font-black text-white mt-1">
            {matchup.home?.name || 'TBD'} <span className="text-white/30">vs</span> {matchup.away?.name || 'TBD'}
          </div>
          <div className="text-xs text-blue-100/50 mt-0.5">
            Best of {matchup.bestOf}
            {matchup.seriesId ? ` · linked to series #${matchup.seriesId}` : ''}
            {matchup.manualOverride ? ' · set by hand' : ''}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close matchup editor" className="text-white/40 hover:text-white text-sm font-bold px-2">✕</button>
      </div>

      <div className="h-px bg-white/10" />

      {/* Teams */}
      <div>
        <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40 mb-2">Teams</div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <select
            value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)} aria-label="Home team"
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:border-blue-400/60 focus:outline-none"
          >
            <option value="">— TBD —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <span className="text-[10px] font-black uppercase text-white/30">vs</span>
          <select
            value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)} aria-label="Away team"
            className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm focus:border-blue-400/60 focus:outline-none"
          >
            <option value="">— TBD —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <button
          disabled={busy}
          onClick={() => onAction('set-teams', { matchupId: matchup.id, homeTeamId: homeTeamId || null, awayTeamId: awayTeamId || null })}
          className="mt-2 px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 rounded disabled:opacity-40"
        >
          Set teams
        </button>
      </div>

      <div className="h-px bg-white/10" />

      {/* Result */}
      <div>
        <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40 mb-2">Result</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number" min="0" value={homeScore} onChange={(e) => setHomeScore(e.target.value)}
            aria-label={`${matchup.home?.name || 'Home'} games won`} placeholder="0"
            className="w-16 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm text-center tabular-nums focus:border-blue-400/60 focus:outline-none"
          />
          <span className="text-white/30 text-sm">–</span>
          <input
            type="number" min="0" value={awayScore} onChange={(e) => setAwayScore(e.target.value)}
            aria-label={`${matchup.away?.name || 'Away'} games won`} placeholder="0"
            className="w-16 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm text-center tabular-nums focus:border-blue-400/60 focus:outline-none"
          />
          <button
            disabled={busy || !both}
            onClick={() => {
              const h = Number(homeScore || 0)
              const a = Number(awayScore || 0)
              if (h === a) { onAction('__error', 'A series cannot end level — one team has to win it.'); return }
              onAction('set-result', {
                matchupId: matchup.id, homeScore: h, awayScore: a,
                winnerTeamId: h > a ? matchup.home.id : matchup.away.id, resultKind: 'series',
              })
            }}
            className="px-3 py-2 text-xs font-bold bg-blue-500 hover:bg-blue-400 text-white rounded disabled:opacity-40"
          >
            Save score
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/30">Forfeit</span>
          <button
            disabled={busy || !both}
            onClick={() => onAction('set-result', {
              matchupId: matchup.id, homeScore: 1, awayScore: 0,
              winnerTeamId: matchup.home.id, resultKind: 'ffw',
            })}
            className="px-2.5 py-1.5 text-xs font-bold bg-orange-500/15 hover:bg-orange-500/25 border border-orange-400/30 text-orange-200 rounded disabled:opacity-40"
          >
            {matchup.home?.name || 'Home'} wins by FF
          </button>
          <button
            disabled={busy || !both}
            onClick={() => onAction('set-result', {
              matchupId: matchup.id, homeScore: 0, awayScore: 1,
              winnerTeamId: matchup.away.id, resultKind: 'ffw',
            })}
            className="px-2.5 py-1.5 text-xs font-bold bg-orange-500/15 hover:bg-orange-500/25 border border-orange-400/30 text-orange-200 rounded disabled:opacity-40"
          >
            {matchup.away?.name || 'Away'} wins by FF
          </button>
          <button
            disabled={busy || !both}
            onClick={() => {
              if (!confirm('Double forfeit: NEITHER team advances.\n\nThe bracket will stall here until you set a winner by hand. Continue?')) return
              onAction('set-result', {
                matchupId: matchup.id, homeScore: 0, awayScore: 0, winnerTeamId: null, resultKind: 'double_ff',
              })
            }}
            className="px-2.5 py-1.5 text-xs font-bold bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 rounded disabled:opacity-40"
          >
            Double FF
          </button>
        </div>

        {matchup.winnerTeamId || matchup.manualOverride ? (
          <button
            disabled={busy}
            onClick={() => onAction('clear-result', { matchupId: matchup.id })}
            className="mt-3 px-3 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 rounded disabled:opacity-40"
          >
            Clear result — hand it back to automatic
          </button>
        ) : null}
      </div>

      {/* Thread */}
      {matchup.thread && (
        <>
          <div className="h-px bg-white/10" />
          <div>
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/40 mb-2">Discord thread</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-white/50">
                {matchup.thread.isClosed ? 'Closed' : 'Open'}
                {matchup.thread.discordId ? ` · ${matchup.thread.discordId}` : ' · not created yet'}
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  if (!confirm(`Delete the Discord thread for ${matchup.home?.name} vs ${matchup.away?.name}?\n\nThe transcript is saved first, exactly like a week delete. This removes ONLY this matchup's thread.`)) return
                  onAction('delete-thread', { weekThreadId: matchup.thread.id })
                }}
                className="ml-auto px-2.5 py-1.5 text-xs font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded disabled:opacity-40"
              >
                Delete this thread
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Round column
// ---------------------------------------------------------------------------

function RoundColumn({ round, selectedId, onSelect, onAction, busy }) {
  const decided = round.matchups.filter((m) => m.winnerTeamId).length
  const ready = round.matchups.filter((m) => m.home?.name && m.away?.name)
  const withoutThread = ready.filter((m) => !m.thread && !m.winnerTeamId)
  const complete = round.matchups.length > 0 && decided === round.matchups.length

  return (
    <div className="min-w-[280px] flex-1 flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] font-black tracking-[0.2em] uppercase text-blue-300/70">{round.name}</span>
        {complete && <span className="text-[9px] font-black text-emerald-300">✓</span>}
        <span className="ml-auto text-[10px] text-white/35 tabular-nums">
          {decided}/{round.matchups.length} decided
        </span>
      </div>

      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] text-white/30">Week {round.week} · Bo{round.bestOf}</span>
        <select
          value={round.bestOf}
          onChange={(e) => onAction('set-best-of', { roundId: round.id, bestOf: Number(e.target.value) })}
          aria-label={`Series length for ${round.name}`}
          className="ml-auto px-2 py-0.5 bg-black/40 border border-white/10 rounded text-white/70 text-[10px] focus:border-blue-400/60 focus:outline-none"
        >
          {[3, 5, 7, 9].map((n) => <option key={n} value={n}>Bo{n}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {round.matchups.map((m) => (
          <MatchupCard key={m.id} matchup={m} isSelected={selectedId === m.id} onSelect={onSelect} />
        ))}
        {round.matchups.length === 0 && (
          <div className="p-6 rounded-xl border border-dashed border-white/15 text-center text-xs text-white/35">
            No matchups yet
          </div>
        )}
      </div>

      {withoutThread.length > 0 && (
        <button
          disabled={busy}
          onClick={() => onAction('create-threads', { roundNumber: round.roundNumber })}
          className="mt-1 px-3 py-2 text-xs font-bold bg-blue-500/15 hover:bg-blue-500/25 border border-blue-400/40 text-blue-100 rounded-lg disabled:opacity-40"
        >
          Create {withoutThread.length} {round.name} thread{withoutThread.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlayoffsAdminPage() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [division, setDivision] = useState('Majors')
  const [brackets, setBrackets] = useState([])
  const [settings, setSettings] = useState({})
  const [teams, setTeams] = useState({})
  const [seasonNumber, setSeasonNumber] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [qualifierCount, setQualifierCount] = useState(8)
  const [banner, setBanner] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/playoffs', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) { setBanner({ tone: 'error', text: data.error || 'Could not load the playoffs.' }); return }
      setBrackets(Array.isArray(data.brackets) ? data.brackets : [])
      setSettings(data.settings || {})
      setTeams(data.teams || {})
      setSeasonNumber(data.seasonNumber ?? null)
    } catch (err) {
      setBanner({ tone: 'error', text: `Could not load the playoffs: ${err.message}` })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const bracket = useMemo(
    () => brackets.find((b) => String(b.division).toLowerCase() === division.toLowerCase()) || null,
    [brackets, division]
  )

  useEffect(() => { setQualifierCount(bracket?.qualifierCount || 8) }, [bracket])

  const selected = useMemo(() => {
    if (!bracket || !selectedId) return null
    for (const round of bracket.rounds) {
      const found = round.matchups.find((m) => m.id === selectedId)
      if (found) return found
    }
    return null
  }, [bracket, selectedId])

  async function post(action, payload = {}) {
    // The editor uses a pseudo-action to surface a client-side validation error
    // through the same banner as everything else.
    if (action === '__error') { setBanner({ tone: 'error', text: payload }); return }

    setBusy(true)
    setBanner(null)
    try {
      const res = await fetch('/api/admin/playoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, division, ...payload }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The REAL reason, not a generic string. The old page could only ever
        // say "Failed to save playoffs" because the route threw a bare 500.
        setBanner({ tone: 'error', text: data.error || `Request failed (HTTP ${res.status}).` })
        return
      }
      if (data.note) setBanner({ tone: 'ok', text: data.note })
      else if (data.seeded) setBanner({ tone: 'ok', text: `Seeded ${division}: ${data.seeded.join(', ')}` })
      else setBanner({ tone: 'ok', text: 'Done.' })
      if (Array.isArray(data.skipped) && data.skipped.length) {
        setBanner({ tone: 'warn', text: `${data.note || 'Done.'}\nSkipped: ${data.skipped.join('; ')}` })
      }
      await load()
    } catch (err) {
      setBanner({ tone: 'error', text: `Request failed: ${err.message}` })
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings(patch) {
    const next = { ...settings, ...patch }
    setSettings(next)
    await post('settings', { settings: next })
  }

  const automationOn = settings.autoAdvance || settings.autoThreads || settings.autoChampion

  return (
    <div className="max-w-[1400px]" data-log-section="playoffs">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Brackets</div>
          <h1 className="text-3xl font-black text-white mb-2">Playoffs</h1>
          <p className="text-blue-100/60 text-sm max-w-2xl">
            Seed a division once. After that, a confirmed series fills in the score, advances the winner,
            and opens the next round&apos;s threads on its own — unless you switch that off below.
            {seasonNumber ? ` Season ${seasonNumber}.` : ''}
          </p>
        </div>
        <button
          onClick={() => post('refresh')}
          disabled={busy}
          className="px-4 py-2 text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/20 text-white rounded-lg disabled:opacity-40"
        >
          ⟳ Recalculate brackets
        </button>
      </div>

      <Banner tone={banner?.tone} onDismiss={() => setBanner(null)}>{banner?.text}</Banner>

      {/* Automation + visibility */}
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">Automation</span>
            <span className={`ml-auto px-2 py-0.5 rounded text-[9px] font-black tracking-wider border ${
              automationOn
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                : 'bg-white/10 text-white/50 border-white/20'
            }`}>
              {automationOn ? 'RUNNING' : 'ALL MANUAL'}
            </span>
          </div>
          <Toggle
            checked={Boolean(settings.autoAdvance)} onChange={(v) => saveSettings({ autoAdvance: v })}
            label="Advance winners"
            hint="A confirmed series fills the score and moves the winner into the next round."
          />
          <Toggle
            checked={Boolean(settings.autoThreads)} onChange={(v) => saveSettings({ autoThreads: v })}
            label="Open the next round's threads"
            hint="When every matchup in a round is decided, the next round's threads are created."
          />
          <Toggle
            checked={Boolean(settings.autoChampion)} onChange={(v) => saveSettings({ autoChampion: v })}
            label="Record the season champion"
            hint="A confirmed Finals sets that division's champion. A champion you set by hand is never overwritten."
          />
          <Toggle
            checked={Boolean(settings.autoAnnounce)} onChange={(v) => saveSettings({ autoAnnounce: v })}
            label="Post the bracket to Discord"
            hint="The bot posts an updated bracket image when a round finishes."
          />
          <div className="pt-1 text-[11px] text-white/35 leading-relaxed">
            Switching these off changes nothing that has already happened — every matchup can still be
            driven by hand below, and anything you set by hand survives a recalculation.
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-4">
          <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">Public website</div>
          <Toggle
            checked={Boolean(settings.enabled)} onChange={(v) => saveSettings({ enabled: v })}
            label="Show the Playoffs tab"
            hint="Adds Playoffs to the site navigation and publishes the bracket page."
          />
          <div className="rounded-lg bg-black/30 border border-white/10 px-3 py-2.5 text-xs">
            {settings.enabled ? (
              <span className="text-emerald-300">
                Live at <span className="font-mono">belugaleague.com/playoffs</span> — anyone can see it.
              </span>
            ) : (
              <span className="text-white/45">
                Hidden. The nav link is gone and the page redirects home.
                Past seasons&apos; brackets stay readable from the Seasons page either way.
              </span>
            )}
          </div>
          {bracket && (
            <Toggle
              checked={Boolean(bracket.isPublished)}
              onChange={(v) => post('set-published', { bracketId: bracket.id, isPublished: v })}
              label={`Publish the ${division} bracket`}
              hint="Reveal one division at a time while the others are still being seeded."
              disabled={!settings.enabled}
            />
          )}
        </div>
      </div>

      {/* Division + setup */}
      <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <div className="flex gap-1">
          {DIVISIONS.map((d) => (
            <button
              key={d}
              onClick={() => { setDivision(d); setSelectedId(null) }}
              aria-pressed={division === d}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors ${
                division === d
                  ? 'bg-blue-500/20 border-blue-400/50 text-blue-100'
                  : 'bg-white/5 border-white/10 text-white/60 hover:text-blue-200'
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <label className="text-[10px] font-bold uppercase tracking-wider text-white/40" htmlFor="qualifiers">
            Teams
          </label>
          <select
            id="qualifiers" value={qualifierCount} onChange={(e) => setQualifierCount(Number(e.target.value))}
            className="px-2 py-1.5 bg-black/40 border border-white/10 rounded-lg text-white text-xs focus:border-blue-400/60 focus:outline-none"
          >
            {QUALIFIER_CHOICES.map((n) => <option key={n} value={n}>Top {n}</option>)}
          </select>
          <button
            disabled={busy}
            onClick={() => {
              const existing = bracket
                ? `\n\nThis REPLACES the existing ${division} bracket — every result and thread link in it is discarded.`
                : ''
              if (!confirm(
                `Seed the ${division} bracket from the current standings?\n\n` +
                `Top ${qualifierCount} by the live standings, paired 1v${qualifierCount}, 2v${qualifierCount - 1} and so on.` +
                existing +
                '\n\nOther divisions are not touched.'
              )) return
              post('generate', { qualifierCount })
            }}
            className="px-3 py-1.5 text-xs font-bold bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/40 text-purple-100 rounded-lg disabled:opacity-40"
          >
            ⚡ Seed from standings
          </button>
        </div>
      </div>

      {/* Bracket */}
      {loading ? (
        <div className="text-blue-200/60 py-20 text-center">Loading…</div>
      ) : !bracket ? (
        <div className="p-12 rounded-2xl border border-dashed border-white/15 text-center">
          <div className="text-white/50 text-sm mb-1">No {division} bracket yet.</div>
          <div className="text-white/30 text-xs">Use “Seed from standings” above to draw it.</div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px] items-start">
          <div className="rounded-2xl bg-white/[0.02] border border-white/10 p-4 overflow-x-auto">
            <div className="flex gap-4 min-w-[720px]">
              {bracket.rounds.map((round) => (
                <RoundColumn
                  key={round.id}
                  round={round}
                  selectedId={selectedId}
                  onSelect={(m) => setSelectedId(m.id === selectedId ? null : m.id)}
                  onAction={post}
                  busy={busy}
                />
              ))}
            </div>
          </div>

          <div className="lg:sticky lg:top-6">
            {selected ? (
              <MatchupEditor
                matchup={selected}
                teams={teams[division] || []}
                busy={busy}
                onAction={post}
                onClose={() => setSelectedId(null)}
              />
            ) : (
              <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-sm text-white/40">
                Pick a matchup to set its teams, correct a score, record a forfeit,
                or delete just that thread.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
