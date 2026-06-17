'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Avatar from '../../../components/Avatar'
import PlayerPicker from '../../../components/PlayerPicker'

const DIVISIONS = ['all', 'Majors', 'AAA', 'AA']
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

export default function PlayersAdminPage() {
  const [filters, setFilters] = useState({ search: '', status: 'all', division: 'all' })
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.search) params.set('search', filters.search)
      if (filters.status !== 'all') params.set('status', filters.status)
      if (filters.division !== 'all') params.set('division', filters.division)
      const r = await fetch(`/api/admin/players?${params}`, { cache: 'no-store' })
      const d = await r.json()
      setPlayers(d.players || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { reload() }, [reload])

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">League</div>
        <h1 className="text-3xl font-black text-white mb-2">Players</h1>
        <p className="text-blue-100/60 text-sm">
          Every Discord ID that has ever appeared in a team roster. Click a player to see full history, stats, and transactions.
        </p>
      </div>

      {/* Unlinked in-game players — stats with no Discord ID (skipped, unmatched, or
          unlinked). Their stats are preserved here until linked; linking moves every
          matching game row to that Discord user. Shown at the TOP so they never get lost. */}
      <UnlinkedPlayersPanel onLinked={reload} />

      <div className="mb-4 flex flex-wrap gap-2 items-center p-3 rounded-xl bg-white/[0.03] border border-white/10">
        <input
          type="text"
          placeholder="Search by name, username, or Discord ID…"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="flex-1 min-w-[200px] px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm"
        />
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          <option value="all">All players</option>
          <option value="rostered">Rostered (active season)</option>
          <option value="free_agent">Free agents</option>
        </select>
        <select value={filters.division} onChange={(e) => setFilters({ ...filters, division: e.target.value })}
          className="px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-white text-sm">
          {DIVISIONS.map((d) => <option key={d} value={d}>{d === 'all' ? 'All divisions' : d}</option>)}
        </select>
        <span className="text-xs text-white/50 ml-auto">{players.length} player{players.length === 1 ? '' : 's'}</span>
      </div>

      {error && <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}

      {loading ? (
        <div className="text-blue-200/60">Loading…</div>
      ) : players.length === 0 ? (
        <div className="p-8 rounded-2xl border border-dashed border-white/15 text-center text-white/50">
          No players match this filter.
        </div>
      ) : (
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="bg-black/30">
              <tr className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold">
                <th className="px-3 py-2 text-left">Player</th>
                <th className="px-3 py-2 text-left">Current Team</th>
                <th className="px-3 py-2 text-left">Division</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-center">Seasons</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.discordId} className="border-t border-white/5 hover:bg-white/[0.04] cursor-pointer" onClick={() => setSelected(p.discordId)}>
                  <td className="px-3 py-2 text-white">
                    <div className="flex items-center gap-2.5">
                      <Avatar src={p.avatarUrl} name={p.displayName} size={32} ring={false} className="flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium truncate max-w-[180px]">{p.displayName}</div>
                        {p.discordUsername && <div className="text-[10px] text-white/40 truncate max-w-[180px]">@{p.discordUsername}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-white/80">{p.current?.teamName || <span className="text-white/30 italic">none</span>}</td>
                  <td className="px-3 py-2 text-blue-200/70">{p.current?.division || '—'}</td>
                  <td className="px-3 py-2 text-white/60 uppercase text-[10px]">{p.current?.role || '—'}</td>
                  <td className="px-3 py-2 text-center text-white/70">{p.seasonsPlayed}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ${
                      p.statusLabel === 'rostered' ? 'bg-green-500/15 text-green-300 border-green-400/30' : 'bg-white/5 text-white/50 border-white/10'
                    }`}>{p.statusLabel === 'rostered' ? 'Rostered' : 'Free Agent'}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); setSelected(p.discordId) }} className="text-[10px] uppercase font-bold text-blue-200 hover:text-white px-2 py-1 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-400/30 rounded">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <PlayerDetailModal discordId={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// Unlinked in-game players: stat rows with no Discord ID. Each is relinkable to a
// Discord user via the existing stats-tools `link` action (which moves every
// matching game row to that user and recomputes). Stats are never lost — they wait
// here. Collapsed when empty so it doesn't clutter the page.
function UnlinkedPlayersPanel({ onLinked }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState(null)
  const [msg, setMsg] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/players/unlinked', { cache: 'no-store' })
      const d = await r.json()
      setRows(d.unlinked || [])
    } catch (e) {
      setMsg(`Failed to load unlinked players: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  async function linkTo(u, player) {
    if (!u.platform || !u.platformId) {
      setMsg('❌ This in-game player has no account id (platform/platform_id) to link.')
      return
    }
    if (!confirm(`Link "${u.ingameName}" (${u.platform}) to ${player.displayName}? Their ${u.games} game${u.games === 1 ? '' : 's'} of stats will move to that player.`)) return
    const key = `${u.platform}:${u.platformId}`
    setBusyKey(key)
    setMsg('Linking…')
    try {
      const r = await fetch('/api/admin/stats-tools', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link', platform: u.platform, platformId: u.platformId, discordId: player.discordId }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setMsg(`❌ ${d.error || 'Link failed'}`); return }
      setMsg(`✓ Linked "${u.ingameName}" → ${player.displayName} (${d.movedRows ?? 0} game rows moved)`)
      await reload()
      if (onLinked) onLinked()
    } catch (e) {
      setMsg(`❌ ${e.message}`)
    } finally {
      setBusyKey(null)
    }
  }

  // Nothing to show and nothing loading → render a quiet zero-state (so the operator
  // knows the feature exists but it isn't in the way).
  if (!loading && rows.length === 0) {
    return (
      <div className="mb-4 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/10 text-[11px] text-white/40">
        ✓ No unlinked in-game players — every recorded stat line is attached to a Discord ID.
      </div>
    )
  }

  // No overflow-hidden on the wrapper: each row's "Link to →" PlayerPicker dropdown is
  // absolutely positioned and must be able to overflow below the panel (otherwise the
  // LAST row's dropdown is clipped and unselectable). Top corners are rounded on the
  // header instead so the panel still looks clipped at the top.
  return (
    <div className="mb-5 rounded-xl bg-amber-500/[0.06] border border-amber-400/25">
      <div className="px-4 py-2.5 flex items-center justify-between gap-2 border-b border-amber-400/15 rounded-t-xl">
        <div>
          <div className="text-xs font-black uppercase tracking-wider text-amber-200">Unlinked Players</div>
          <div className="text-[10px] text-amber-100/60">In-game stats with no Discord ID — link each to a player so their stats count. Stats are never lost.</div>
        </div>
        <span className="text-[10px] font-bold text-amber-200/80 bg-amber-500/15 border border-amber-400/30 px-2 py-0.5 rounded">{rows.length}</span>
      </div>
      {msg && <div className="px-4 py-1.5 text-[11px] text-amber-100/80 border-b border-amber-400/10">{msg}</div>}
      {loading ? (
        <div className="px-4 py-3 text-[11px] text-amber-100/60">Loading…</div>
      ) : (
        <div className="divide-y divide-amber-400/10">
          {rows.map((u) => {
            const key = `${u.platform}:${u.platformId}`
            return (
              <div key={key} className="px-4 py-2.5 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex items-center gap-2.5 min-w-0 md:w-[42%]">
                  {u.teamId ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={`/api/teams/logo?teamId=${u.teamId}`} alt="" className="w-7 h-7 object-contain flex-shrink-0" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  ) : <div className="w-7 h-7 flex-shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{u.ingameName}</div>
                    <div className="text-[10px] text-white/40 truncate">
                      {u.platform || 'unknown'}{u.teamName ? ` · ${u.teamName}` : ''} · {u.games}G {u.goals}g {u.assists}a {u.saves}sv
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 md:flex-1">
                  <span className="text-[10px] uppercase tracking-wider text-amber-200/60 flex-shrink-0">Link to →</span>
                  <div className="flex-1 min-w-0">
                    <PlayerPicker
                      onPick={(player) => linkTo(u, player)}
                      placeholder={busyKey === key ? 'Linking…' : 'Search a player by name…'}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// In-game identity (Ballchasing accounts + name history) and the player's
// per-season stats from the new stats system — every cell editable (saving
// locks the row with manual_override so recomputes keep staff numbers).
// Identity tools (remap an account to another player / merge this profile into
// another) use a name+avatar picker over the full directory — no raw IDs.
function IdentityStatsPanel({ discordId, data, onChanged }) {
  const accounts = data.statsAccounts || []
  const names = data.statsNameHistory || []
  const seasons = data.statsSeasons || []
  const games = data.statsRecentGames || []
  const player = data.player || {}
  const [edits, setEdits] = useState({})
  const [msg, setMsg] = useState('')

  // --- identity tool state ---
  const [identMsg, setIdentMsg] = useState('')
  const [identBusy, setIdentBusy] = useState(false)
  const [mergeTarget, setMergeTarget] = useState(null)

  async function postTool(payload, successText) {
    setIdentBusy(true)
    setIdentMsg('Working…')
    try {
      const r = await fetch('/api/admin/stats-tools', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        // Always show how many game rows actually moved/detached so unlink/link/remap
        // never look like a no-op when the count is 0 (the "unlink does nothing"
        // confusion — the account WAS removed even when it had no attached stats).
        const n = d.movedRows ?? d.detachedRows
        const count = n != null ? ` (${n} game row${n === 1 ? '' : 's'} ${payload.action === 'unlink' ? 'detached' : 'moved'})` : ''
        setIdentMsg(`${successText || '✓ done'}${count}`)
        onChanged?.()
      } else {
        // Surface the REAL server error (the unlink branch returns `{error:'unlink failed: …'}`)
        // instead of a silent success.
        setIdentMsg(`❌ ${d.error || `failed (HTTP ${r.status})`}`)
      }
    } catch (e) {
      setIdentMsg(`❌ ${e.message}`)
    } finally {
      setIdentBusy(false)
      setTimeout(() => setIdentMsg(''), 5000)
    }
  }

  function remapAccount(acc, target) {
    if (!target) return
    if (!confirm(`Move the ${acc.platform} account "${acc.current_name || acc.platform_id}" from ${player.displayName || discordId} to ${target.displayName}? All game rows under this account move with it.`)) return
    postTool({ action: 'remap', platform: acc.platform, platformId: acc.platform_id, discordId: target.discordId },
      `✓ "${acc.current_name || acc.platform}" re-mapped to ${target.displayName}`)
  }

  function unlinkAccount(acc) {
    if (!confirm(`Unlink the ${acc.platform} account "${acc.current_name || acc.platform_id}" from ${player.displayName || discordId}? Its game rows are detached and leave this player's totals until re-linked. This does not delete the games.`)) return
    postTool({ action: 'unlink', platform: acc.platform, platformId: acc.platform_id },
      `✓ "${acc.current_name || acc.platform}" unlinked`)
  }

  // Attach a typed-in in-game account to THIS player.
  function linkAccount(platform, platformId) {
    const pid = String(platformId || '').trim()
    if (!platform || !pid) { setIdentMsg('❌ pick a platform and enter the account id'); return }
    if (!confirm(`Link the ${platform} account "${pid}" to ${player.displayName || discordId}? Any game rows recorded under that account move to this player.`)) return
    postTool({ action: 'link', platform, platformId: pid, discordId },
      `✓ ${platform} "${pid}" linked to ${player.displayName || 'this player'}`)
  }

  function doMerge() {
    if (!mergeTarget) return
    if (!confirm(`Merge ALL of ${player.displayName || discordId}'s accounts, name history and stats INTO ${mergeTarget.displayName}? ${player.displayName || 'This profile'} will be emptied. This cannot be undone.`)) return
    postTool({ action: 'merge', fromDiscordId: discordId, toDiscordId: mergeTarget.discordId },
      `✓ merged into ${mergeTarget.displayName}`)
    setMergeTarget(null)
  }

  async function saveRow(row) {
    const e = edits[`${row.season_id}|${row.division}|${row.is_playoff}`] || {}
    setMsg('Saving…')
    const r = await fetch(`/api/admin/players/${encodeURIComponent(discordId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonStat: { seasonId: row.season_id, division: row.division, isPlayoff: row.is_playoff, ...e } }),
    })
    setMsg(r.ok ? '✓ saved (row locked with manual override)' : '❌ failed')
    setTimeout(() => setMsg(''), 2500)
    onChanged?.()
  }

  const setCell = (row, key, value) => {
    const k = `${row.season_id}|${row.division}|${row.is_playoff}`
    setEdits({ ...edits, [k]: { ...edits[k], [key]: value } })
  }
  const COLS = [['games', 'GP'], ['score', 'Score'], ['goals', 'G'], ['assists', 'A'], ['saves', 'SV'], ['shots', 'SH'], ['mvps', 'MVP']]
  const DB = { games: 'games', score: 'score', goals: 'goals', assists: 'assists', saves: 'saves', shots: 'shots', mvps: 'mvps' }

  const knownNames = [...new Set(names.map((n) => n.name).filter(Boolean))]

  if (!accounts.length && !seasons.length && !knownNames.length) {
    // Still expose merge for an empty/duplicate profile staff may want to fold away.
    return (
      <Section title="Player Identity">
        <IdentityToolsBox
          accounts={accounts} knownNames={knownNames} player={player} discordId={discordId}
          identMsg={identMsg} identBusy={identBusy} mergeTarget={mergeTarget} setMergeTarget={setMergeTarget}
          remapAccount={remapAccount} unlinkAccount={unlinkAccount} linkAccount={linkAccount} doMerge={doMerge}
        />
      </Section>
    )
  }
  return (
    <Section title="Stats & Identity (new stats system)">
      {msg && <div className="text-[11px] text-green-300 mb-2">{msg}</div>}
      <IdentityToolsBox
        accounts={accounts} knownNames={knownNames} player={player} discordId={discordId}
        identMsg={identMsg} identBusy={identBusy} mergeTarget={mergeTarget} setMergeTarget={setMergeTarget}
        remapAccount={remapAccount} unlinkAccount={unlinkAccount} linkAccount={linkAccount} doMerge={doMerge}
      />
      {seasons.length > 0 && <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1 mt-3">Per-season stats (editable)</div>}
      {seasons.length > 0 && (
        <div className="overflow-x-auto mb-2">
        <table className="w-full text-[11px] min-w-[520px]">
          <thead><tr className="text-[9px] uppercase tracking-wider text-white/40">
            <th className="text-left py-1">Season</th>{COLS.map(([k, l]) => <th key={k} className="text-right py-1">{l}</th>)}<th />
          </tr></thead>
          <tbody>
            {seasons.map((row) => (
              <tr key={`${row.season_id}-${row.division}-${row.is_playoff}`} className="border-t border-white/5">
                <td className="py-1 text-white">
                  S{row.season_number} {row.division}{row.is_playoff ? ' (PO)' : ''}
                  {row.manual_override && <span className="ml-1 text-[8px] text-yellow-300" title="Manually overridden — recompute keeps these numbers">🔒</span>}
                </td>
                {COLS.map(([k]) => (
                  <td key={k} className="py-1 text-right">
                    <input type="number" defaultValue={row[DB[k]] ?? 0}
                      onChange={(e) => setCell(row, k, e.target.value)}
                      className="w-12 px-1 py-0.5 bg-black/40 border border-white/10 rounded text-white text-right text-[11px]" />
                  </td>
                ))}
                <td className="py-1 text-right">
                  <button onClick={() => saveRow(row)} className="px-2 py-0.5 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 rounded">Save</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {games.length > 0 && (
        <div className="text-[10px] text-white/40">
          {games.length} recent game line(s) recorded — edit individual games in <span className="text-blue-300">Match Results</span> (per-cell editing there).
        </div>
      )}
    </Section>
  )
}

// Identity tools: linked game accounts (with the Discord ID each is linked to),
// a per-account "re-map to another player" picker + an Unlink button, a "link an
// in-game account to this player" form, known-as name history, and a "merge this
// profile into another" picker. All pickers search the FULL directory by name +
// avatar (no raw IDs).
const LINK_PLATFORMS = ['epic', 'steam', 'xbox', 'ps4', 'switch']

function IdentityToolsBox({ accounts, knownNames, player, discordId, identMsg, identBusy, mergeTarget, setMergeTarget, remapAccount, unlinkAccount, linkAccount, doMerge }) {
  const [linkPlatform, setLinkPlatform] = useState('epic')
  const [linkId, setLinkId] = useState('')

  return (
    <div className="rounded-lg bg-black/20 border border-white/10 p-3 space-y-3">
      {identMsg && (
        <div className={`text-[11px] ${identMsg.startsWith('❌') ? 'text-red-300' : 'text-green-300'}`}>{identMsg}</div>
      )}

      {/* Linked game accounts → which Discord ID, + re-map / unlink */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1.5">
          Linked game accounts → Discord ID
        </div>
        {accounts.length === 0 ? (
          <div className="text-[11px] text-white/40 italic">No game accounts linked yet (linked automatically when matched in a score report, or link one below).</div>
        ) : (
          <div className="space-y-2">
            {accounts.map((a, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2 rounded bg-white/[0.03] border border-white/10">
                <div className="flex-1 min-w-0">
                  <div>
                    <span className="inline-block px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-200 text-[9px] font-bold uppercase tracking-wider mr-1.5">{a.platform}</span>
                    <span className="text-white text-xs font-medium">{a.current_name || '(no name)'}</span>
                    <span className="text-[9px] font-mono text-white/30 ml-1.5">{String(a.platform_id).slice(0, 20)}</span>
                  </div>
                  <div className="text-[9px] text-white/40 mt-0.5">
                    linked to <span className="font-semibold text-blue-200/80">{player.displayName || 'this player'}</span>
                    <span className="font-mono text-white/30"> · {discordId}</span>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <div className="sm:w-48">
                    <div className="text-[9px] uppercase tracking-wider text-white/40 mb-0.5">Re-map to…</div>
                    <PlayerPicker
                      exclude={[discordId]}
                      placeholder="another player…"
                      onPick={(target) => remapAccount(a, target)}
                    />
                  </div>
                  <button
                    onClick={() => unlinkAccount(a)}
                    disabled={identBusy}
                    title="Detach this account from the player"
                    className="px-2.5 py-1.5 text-[10px] font-bold text-red-200 bg-red-500/15 hover:bg-red-500/30 border border-red-400/30 disabled:opacity-40 rounded">
                    Unlink
                  </button>
                </div>
              </div>
            ))}
            <div className="text-[10px] text-white/30">Re-map moves the account (and its game rows) to another player. Unlink detaches it — the rows leave this player's totals but the games aren't deleted.</div>
          </div>
        )}
      </div>

      {/* Link an in-game account to this player (Discord ID → account) */}
      <div className="pt-1 border-t border-white/5">
        <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1.5">Link an in-game account to this player</div>
        <div className="flex gap-2 flex-wrap items-center">
          <select
            value={linkPlatform}
            onChange={(e) => setLinkPlatform(e.target.value)}
            className="px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-[11px]">
            {LINK_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            placeholder="account / platform id (e.g. epic id)"
            className="flex-1 min-w-[160px] px-2 py-1.5 bg-black/40 border border-white/10 rounded text-white text-[11px]" />
          <button
            onClick={() => { linkAccount(linkPlatform, linkId); setLinkId('') }}
            disabled={identBusy}
            className="px-2.5 py-1.5 text-[10px] font-bold text-white bg-blue-500 hover:bg-blue-400 disabled:opacity-40 rounded">
            Link
          </button>
        </div>
        <div className="text-[10px] text-white/30 mt-1">Attaches that account to {player.displayName || 'this player'}; any game rows under it move here. (Same as re-mapping, but onto this player.)</div>
      </div>

      {/* Known-as name history */}
      {knownNames.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1">In-game name history</div>
          <div className="flex flex-wrap gap-1">
            {knownNames.slice(0, 16).map((n, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/70 text-[10px]">{n}</span>
            ))}
          </div>
        </div>
      )}

      {/* Merge this profile into another */}
      <div className="pt-1 border-t border-white/5">
        <div className="text-[10px] uppercase tracking-wider text-amber-300/70 font-bold mb-1.5">Merge this profile into another player</div>
        {mergeTarget ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Avatar src={mergeTarget.avatarUrl} name={mergeTarget.displayName} size={24} ring={false} />
            <span className="text-xs text-white">{mergeTarget.displayName}</span>
            <button onClick={doMerge} disabled={identBusy}
              className="px-2.5 py-1 text-[10px] font-bold text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-40 rounded">
              Merge {player.displayName ? player.displayName : 'this profile'} → {mergeTarget.displayName}
            </button>
            <button onClick={() => setMergeTarget(null)} className="text-[10px] text-white/50 hover:text-white">cancel</button>
          </div>
        ) : (
          <PlayerPicker
            exclude={[discordId]}
            placeholder="pick the player to keep…"
            onPick={(target) => setMergeTarget(target)}
          />
        )}
        <div className="text-[10px] text-white/30 mt-1">Use when the same person has two profiles. All accounts, name history and stats move to the kept player; this one is emptied. Cannot be undone.</div>
      </div>
    </div>
  )
}

function PlayerDetailModal({ discordId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/admin/players/${encodeURIComponent(discordId)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [discordId])

  return (
    <Modal onClose={onClose} title={data?.player?.displayName || discordId}>
      {loading && <div className="text-blue-200/60 text-sm">Loading…</div>}
      {error && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}
      {data?.player && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-3">
            <Avatar src={data.player.avatarUrl} name={data.player.displayName} size={48} className="flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm text-white">
                <span className="font-bold text-lg">{data.player.displayName}</span>
                {data.player.discordUsername && data.player.discordUsername !== data.player.displayName && (
                  <span className="text-white/60 ml-2">@{data.player.discordUsername}</span>
                )}
                {data.player.inGuild === false && (
                  <span className="ml-2 text-[9px] uppercase tracking-wider text-amber-300/80 border border-amber-400/30 rounded px-1.5 py-0.5">left server</span>
                )}
              </div>
              <div className="text-[10px] font-mono text-white/40 mt-1">ID: {data.player.discordId}</div>
              {data.player.lastSeen && (
                <div className="text-[10px] text-white/40">Last seen: {new Date(data.player.lastSeen).toLocaleString()}</div>
              )}
            </div>
          </div>

          <IdentityStatsPanel discordId={discordId} data={data} onChanged={() => {
            fetch(`/api/admin/players/${encodeURIComponent(discordId)}`, { cache: 'no-store' }).then((r) => r.json()).then(setData)
          }} />

          <Section title={`Roster History (${data.rosterHistory.length})`}>
            {data.rosterHistory.length === 0 ? (
              <div className="text-xs text-white/40 italic">Never on a roster.</div>
            ) : (
              <ul className="space-y-1">
                {data.rosterHistory.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.03] text-xs">
                    <span className="text-blue-200/80 font-bold w-12">S{r.seasonNumber}</span>
                    <span className="text-white/60 w-12">{r.division}</span>
                    <span className="text-white truncate flex-1">{r.teamName}</span>
                    {r.role && r.role !== 'player' && (
                      <span className="text-[9px] uppercase font-bold tracking-wider text-blue-300">{r.role}</span>
                    )}
                    {!r.rosterActive && <span className="text-[9px] uppercase text-white/40">inactive</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Stats (${data.stats.length})`}>
            {data.stats.length === 0 ? (
              <div className="text-xs text-white/40 italic">No stats recorded.</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[560px]">
                <thead>
                  <tr className="text-[9px] uppercase tracking-wider text-white/40">
                    <th className="text-left py-0.5">Season</th>
                    <th className="text-left py-0.5">Div</th>
                    <th className="text-left py-0.5">Team</th>
                    <th className="text-right py-0.5">GP</th>
                    <th className="text-right py-0.5">G</th>
                    <th className="text-right py-0.5">A</th>
                    <th className="text-right py-0.5">Sv</th>
                    <th className="text-right py-0.5">Sh</th>
                    <th className="text-right py-0.5">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stats.map((s) => (
                    <tr key={s.id} className="border-t border-white/5">
                      <td className="py-0.5 text-blue-200/80">S{s.seasonNumber}</td>
                      <td className="py-0.5 text-white/60">{s.division}</td>
                      <td className="py-0.5 text-white truncate max-w-[120px]">{s.teamName || '—'}</td>
                      <td className="py-0.5 text-right text-white/80">{s.gamesPlayed}</td>
                      <td className="py-0.5 text-right text-white/80">{s.goals}</td>
                      <td className="py-0.5 text-right text-white/80">{s.assists}</td>
                      <td className="py-0.5 text-right text-white/80">{s.saves}</td>
                      <td className="py-0.5 text-right text-white/80">{s.shots}</td>
                      <td className="py-0.5 text-right text-white font-bold">{s.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Section>

          <Section title={`Transactions (${data.transactions.length})`}>
            {data.transactions.length === 0 ? (
              <div className="text-xs text-white/40 italic">No transactions logged yet.</div>
            ) : (
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {data.transactions.map((tx) => (
                  <li key={tx.id} className="flex items-center gap-2 px-2 py-1.5 rounded text-xs bg-white/[0.02] border border-white/5">
                    <span className="text-blue-300/80 font-bold w-24 uppercase text-[10px]">{TX_LABELS[tx.type] || tx.type}</span>
                    <span className="text-white truncate flex-1">
                      {tx.teamName || '—'}
                      {tx.pairedTeamName && <span className="text-white/40"> ↔ {tx.pairedTeamName}</span>}
                    </span>
                    <span className="text-white/40 text-[10px]">S{tx.seasonNumber || '—'}</span>
                    <span className="text-white/30 text-[10px]">{new Date(tx.performedAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Modal>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-2">{title}</div>
      {children}
    </div>
  )
}

function Modal({ children, onClose, title }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-[#0b1220] border border-white/10 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-white/10 flex items-center justify-between sticky top-0 bg-[#0b1220] z-10">
          <h2 className="text-lg font-black text-white truncate">{title}</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
