'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

const QUICK_LINKS = [
  { label: 'Seasons', href: '/admin/dashboard/seasons', desc: 'Lifecycle, champions, teams' },
  { label: 'Teams & Franchises', href: '/admin/dashboard/teams', desc: 'Active teams + franchise registry' },
  { label: 'Schedule', href: '/admin/dashboard/schedule', desc: 'Generate + edit matchups' },
  { label: 'Match Results', href: '/admin/dashboard/matches', desc: 'Reported series + stat edits' },
  { label: 'Players', href: '/admin/dashboard/players', desc: 'Everyone who has ever played' },
]

function Tile({ value, label, sub, href }) {
  const content = (
    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-blue-400/40 transition group">
      <div className="text-3xl font-black text-white">{value}</div>
      <div className="text-xs font-bold tracking-wider uppercase text-blue-300/70 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  )
  return href ? <Link href={href} className="block">{content}</Link> : content
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function txLabel(type) {
  const map = {
    sign: 'Signed', drop: 'Dropped', release: 'Released',
    trade_in: 'Traded in', trade_out: 'Traded out',
    ir_place: 'Placed on IR', ir_return: 'Returned from IR',
    suspend: 'Suspended', reinstate: 'Reinstated',
    rfa: 'RFA', role_change: 'Role change', rename: 'Renamed',
    gm_assign: 'GM assigned', gm_remove: 'GM removed',
    captain_assign: 'Captain assigned', captain_remove: 'Captain removed',
    esub: 'Emergency sub', other: 'Other',
  }
  return map[type] || type
}

export default function DashboardOverview() {
  const { data: session } = useSession()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/admin/overview', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch((e) => setError(e.message || 'Failed to load'))
  }, [])

  if (error) return <div className="text-red-300">Error: {error}</div>
  if (!data) return <div className="text-blue-200/60">Loading…</div>

  const { season, counts, recentTransactions } = data

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Dashboard</div>
        <h1 className="text-3xl font-black text-white mb-2">
          Welcome back{session?.discordUsername ? `, ${session.discordUsername}` : ''}
        </h1>
        <p className="text-blue-100/60 text-sm">
          {season
            ? `Active: Season ${season.seasonNumber}${season.name ? ` · ${season.name}` : ''}`
            : 'No active season — start one in the Seasons tab.'}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Tile value={season?.seasonNumber ?? '—'} label="Active Season" sub={`${counts.seasons} total`} href="/admin/dashboard/seasons" />
        <Tile value={counts.activeTeams} label="Active Teams" sub={`${counts.franchises} franchises`} href="/admin/dashboard/teams" />
        <Tile value={counts.roster} label="Roster Size" sub="distinct discord IDs" href="/admin/dashboard/players" />
        <Tile value={counts.transactions} label="Transactions" sub="all-time" href="/admin/dashboard/transactions" />
      </div>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <section className="p-5 rounded-2xl bg-white/[0.02] border border-white/10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-black text-white tracking-wide">Recent Transactions</h2>
            <Link href="/admin/dashboard/transactions" className="text-[11px] text-blue-300 hover:text-blue-200">View all →</Link>
          </div>
          {recentTransactions.length === 0 ? (
            <div className="text-xs text-white/40 italic py-4 text-center">No transactions yet. The bot will populate these as roster moves happen.</div>
          ) : (
            <ul className="space-y-1.5">
              {recentTransactions.map((tx) => (
                <li key={tx.id} className="flex items-center gap-3 text-xs px-2 py-1.5 rounded hover:bg-white/[0.03]">
                  <span className="text-blue-300/80 font-bold w-24 truncate">{txLabel(tx.type)}</span>
                  <span className="text-white truncate flex-1">{tx.displayName}</span>
                  {tx.teamName && <span className="text-white/50 truncate">→ {tx.teamName}</span>}
                  <span className="text-white/30 text-[10px] whitespace-nowrap">{fmtTime(tx.performedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section>
        <h2 className="text-sm font-black text-white tracking-wide mb-3">Quick Links</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {QUICK_LINKS.map((link) => (
            <Link key={link.href} href={link.href}
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/10 hover:border-blue-400/30 transition group"
            >
              <div className="text-sm font-bold text-white">{link.label}</div>
              <div className="text-[11px] text-blue-100/50 mt-0.5">{link.desc}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
