'use client'

// Public invite leaderboards: the current campaign, lifetime, members who can
// still be claimed, and past campaign winners. Counts only — this page never
// shows who invited whom. Not in the top nav on purpose; reached from the
// homepage "Top Inviters" strip, /leaderboards and the bot's embeds.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Avatar from '../components/Avatar'

const MEDAL = ['🥇', '🥈', '🥉']
const rankColor = (i) =>
  i === 0 ? 'text-yellow-300' : i === 1 ? 'text-slate-200' : i === 2 ? 'text-amber-500' : 'text-white/40'

function fmtDate(d, withTime = false) {
  if (!d) return '—'
  const opts = withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' }
  return new Date(d).toLocaleString('en-US', opts)
}

function Board({ rows, query, emptyText }) {
  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows
  if (!rows.length) return <div className="text-sm text-white/40 italic py-8 text-center">{emptyText}</div>
  if (!shown.length) return <div className="text-sm text-white/40 italic py-8 text-center">Nobody matches “{query}”.</div>
  return (
    <ol className="divide-y divide-white/5">
      {shown.map((r) => (
        <li key={r.discordId} className={`flex items-center gap-3 px-3 sm:px-4 py-2.5 ${r.rank <= 3 ? 'bg-cyan-500/[0.04]' : ''}`}>
          <span className={`w-7 text-center font-black ${rankColor(r.rank - 1)}`}>{r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
          <Avatar src={r.avatarUrl} name={r.name} size={32} />
          <Link href={`/players/${encodeURIComponent(r.discordId)}`} className="flex-1 min-w-0 truncate text-blue-50 hover:text-white font-semibold">
            {r.name}
          </Link>
          <span className="font-mono font-black text-lg text-cyan-200">{r.total}</span>
        </li>
      ))}
    </ol>
  )
}

export default function InvitesPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [scope, setScope] = useState('campaign')
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch('/api/public/invites', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (d?.error) setError(d.error); else setData(d) })
      .catch((e) => setError(e.message || 'Failed to load'))
  }, [])

  const campaign = data?.campaign
  const rows = useMemo(() => {
    const list = scope === 'campaign' ? data?.campaignTop : data?.lifetimeTop
    return Array.isArray(list) ? list : []
  }, [data, scope])
  const claimables = Array.isArray(data?.claimables) ? data.claimables : []
  const past = Array.isArray(data?.pastCampaigns) ? data.pastCampaigns : []

  return (
    <main className="relative min-h-screen px-4 py-10 sm:py-12 max-w-5xl mx-auto">
      <div className="mb-8 text-center sm:text-left">
        <div className="text-[11px] font-bold tracking-[0.3em] uppercase text-cyan-300/70 mb-2">Beluga League</div>
        <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 mb-2">
          Invite Leaderboard
        </h1>
        <p className="text-blue-100/60 text-sm max-w-2xl mx-auto sm:mx-0">
          Invite friends to the Discord — an invite counts once they register for the league and stay in the server.
          Use <span className="font-mono text-cyan-200">/invites</span> in Discord to see your own count.
        </p>
      </div>

      {error && <div className="mb-6 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-200 text-sm">{error}</div>}
      {!data && !error && <div className="text-center py-20 text-blue-200/60">Loading invites…</div>}

      {data && (
        <div className="space-y-10">
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2 rounded-2xl p-4 bg-gradient-to-br from-cyan-500/[0.12] to-blue-600/[0.06] border border-cyan-400/30">
              <div className="text-[11px] uppercase tracking-wider font-bold text-cyan-200/80">Current campaign</div>
              <div className="text-xl font-black text-white mt-1 truncate">{campaign?.name || 'No active campaign'}</div>
              {campaign?.prize && <div className="text-sm text-cyan-100/80 mt-1">Prize: {campaign.prize}</div>}
            </div>
            <div className="rounded-2xl p-4 bg-white/[0.03] border border-white/10">
              <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70">{campaign?.endsAt ? 'Ends' : 'Started'}</div>
              <div className="text-base font-bold text-white mt-1">{fmtDate(campaign?.endsAt || campaign?.startsAt)}</div>
            </div>
            <div className="rounded-2xl p-4 bg-white/[0.03] border border-white/10">
              <div className="text-[11px] uppercase tracking-wider font-bold text-blue-300/70">Last reset</div>
              <div className="text-base font-bold text-white mt-1">{data.lastReset ? fmtDate(data.lastReset) : 'Never'}</div>
            </div>
          </section>

          <section>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
              <div className="inline-flex self-center sm:self-auto rounded-xl overflow-hidden border border-white/10 bg-black/30">
                {[['campaign', 'Current campaign'], ['lifetime', 'Lifetime']].map(([k, label]) => (
                  <button key={k} onClick={() => setScope(k)}
                    className={`px-5 py-2 text-sm font-bold transition ${scope === k ? 'bg-blue-500 text-white' : 'text-white/60 hover:text-white'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find yourself…"
                aria-label="Search inviters"
                className="sm:ml-auto w-full sm:w-64 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-sm text-white placeholder-white/30 focus:outline-none focus:border-cyan-400/50"
              />
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden" data-dense>
              <Board rows={rows} query={query} emptyText={scope === 'campaign' ? 'No invites counted this campaign yet.' : 'No invites counted yet.'} />
            </div>
          </section>

          {claimables.length > 0 && (
            <section>
              <h2 className="text-2xl font-black text-white mb-1">Claimable players</h2>
              <p className="text-sm text-blue-100/60 mb-4">
                These players registered after joining through a general link, so nobody has the credit yet.
                If you invited one of them, run <span className="font-mono text-cyan-200">/claim-invite</span> in Discord before the deadline.
              </p>
              <div className="grid sm:grid-cols-2 gap-2" data-dense>
                {claimables.map((c) => (
                  <div key={c.discordId} className="min-w-0 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10">
                    <Avatar src={c.avatarUrl} name={c.name} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white truncate">{c.name}</div>
                      <div className="text-xs text-white/50 truncate">{c.source} · claimable until {fmtDate(c.claimableUntil, true)}</div>
                    </div>
                    {c.claimPending && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/15 text-amber-200 border border-amber-400/30 whitespace-nowrap">
                        Claim pending
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="text-2xl font-black text-white mb-4">Past campaigns</h2>
              <div className="grid sm:grid-cols-2 gap-3" data-dense>
                {past.map((c) => (
                  <div key={c.id} className="min-w-0 rounded-2xl p-4 bg-white/[0.02] border border-white/10">
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <div className="font-black text-white truncate">{c.name}</div>
                      <div className="text-xs text-white/40 whitespace-nowrap">{fmtDate(c.startsAt)} – {fmtDate(c.endedAt)}</div>
                    </div>
                    {c.prize && <div className="text-xs text-cyan-100/70 mb-2">Prize: {c.prize}</div>}
                    {c.finalTop.length === 0 ? (
                      <div className="text-xs text-white/40 italic">No invites were counted.</div>
                    ) : (
                      <ol className="space-y-1">
                        {c.finalTop.slice(0, 5).map((t, i) => (
                          <li key={t.id} className="flex items-center gap-2 text-sm">
                            <span className={`w-5 text-center font-bold ${rankColor(i)}`}>{i < 3 ? MEDAL[i] : t.rank}</span>
                            <span className="flex-1 truncate text-blue-50">{t.name}</span>
                            <span className="font-mono font-bold text-white">{t.total}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  )
}
