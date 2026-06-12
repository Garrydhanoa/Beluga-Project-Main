'use client'

import { useEffect, useState, useCallback } from 'react'
import Avatar from '../../../components/Avatar'

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
        <div className="rounded-2xl bg-white/[0.02] border border-white/10 overflow-hidden">
          <table className="w-full text-sm">
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

// In-game identity (Ballchasing accounts + name history) and the player's
// per-season stats from the new stats system — every cell editable (saving
// locks the row with manual_override so recomputes keep staff numbers).
function IdentityStatsPanel({ discordId, data, onChanged }) {
  const accounts = data.statsAccounts || []
  const names = data.statsNameHistory || []
  const seasons = data.statsSeasons || []
  const games = data.statsRecentGames || []
  const [edits, setEdits] = useState({})
  const [msg, setMsg] = useState('')

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

  if (!accounts.length && !seasons.length) return null
  return (
    <Section title="Stats & Identity (new stats system)">
      {msg && <div className="text-[11px] text-green-300 mb-2">{msg}</div>}
      {accounts.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] uppercase tracking-wider text-blue-300/70 font-bold mb-1">Linked game accounts</div>
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a, i) => (
              <span key={i} className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-white/80 text-[11px] font-mono">
                {a.platform}:{String(a.platform_id).slice(0, 14)}…{a.current_name ? ` · ${a.current_name}` : ''}
              </span>
            ))}
          </div>
          {names.length > 0 && (
            <div className="text-[10px] text-white/40 mt-1">Known as: {[...new Set(names.map((n) => n.name).filter(Boolean))].slice(0, 8).join(', ')}</div>
          )}
          <div className="text-[10px] text-white/30 mt-0.5">Wrong link? Fix it in Match Results → Player identity tools (re-map / merge).</div>
        </div>
      )}
      {seasons.length > 0 && (
        <table className="w-full text-[11px] mb-2">
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
      )}
      {games.length > 0 && (
        <div className="text-[10px] text-white/40">
          {games.length} recent game line(s) recorded — edit individual games in <span className="text-blue-300">Match Results</span> (per-cell editing there).
        </div>
      )}
    </Section>
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
              <table className="w-full text-xs">
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
