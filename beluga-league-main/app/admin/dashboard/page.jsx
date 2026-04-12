'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'

const QUICK_TILES = [
  { label: 'Notification Bar', href: '/admin/dashboard/notification', desc: 'Edit the homepage banner', icon: '🔔' },
  { label: 'Season Config', href: '/admin/dashboard/season', desc: 'Current season number, status, year', icon: '📅' },
  { label: 'Champions', href: '/admin/dashboard/champions', desc: 'Hall of Fame editor', icon: '🏆' },
  { label: 'Match Results', href: '/admin/dashboard/matches', desc: 'Enter scores after match nights', icon: '⚔️' },
  { label: 'Power Rankings', href: '/admin/dashboard/rankings', desc: 'Weekly team rankings', icon: '📊' },
  { label: 'Rosters', href: '/admin/dashboard/rosters', desc: 'Team lineups and roles', icon: '👥' },
  { label: 'Schedule', href: '/admin/dashboard/schedule', desc: 'Upcoming matches', icon: '⏰' },
  { label: 'Players', href: '/admin/dashboard/players', desc: 'Player directory', icon: '🎮' },
  { label: 'Reports', href: '/admin/dashboard/reports', desc: 'Moderation queue', icon: '⚠️' },
]

export default function DashboardOverview() {
  const { data: session } = useSession()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch('/api/admin/data')
      .then((r) => r.json())
      .then((data) => {
        setStats({
          champions: data.champions?.length || 0,
          matches: data.matches?.length || 0,
          openReports: data.reports?.filter((r) => r.status === 'open').length || 0,
          scheduled: data.matches?.filter((m) => m.status === 'scheduled').length || 0,
          players: data.players?.length || 0,
          season: data.config?.season?.number || 9,
        })
      })
      .catch(() => {})
  }, [])

  return (
    <div className="max-w-6xl">
      <div className="mb-10">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">
          Dashboard
        </div>
        <h1 className="text-4xl font-black text-white mb-2">
          Welcome back, {session?.discordUsername || 'Director'}
        </h1>
        <p className="text-blue-100/60">Manage your league from one place.</p>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-12">
        {stats && [
          { label: 'Current Season', value: `S${stats.season}` },
          { label: 'Champions', value: stats.champions },
          { label: 'Matches', value: stats.matches },
          { label: 'Scheduled', value: stats.scheduled },
          { label: 'Players', value: stats.players },
          { label: 'Open Reports', value: stats.openReports, urgent: stats.openReports > 0 },
        ].map((s) => (
          <div
            key={s.label}
            className={`p-4 rounded-xl border backdrop-blur-sm ${
              s.urgent
                ? 'bg-blue-500/15 border-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.3)]'
                : 'bg-white/[0.03] border-white/10'
            }`}
          >
            <div className="text-2xl font-black text-white">{s.value}</div>
            <div className="text-[10px] tracking-wider uppercase text-blue-300/60 mt-1">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Feature tiles */}
      <div className="mb-4 text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70">
        Quick Actions
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {QUICK_TILES.map((tile) => (
          <Link
            key={tile.href}
            href={tile.href}
            className="group relative p-5 rounded-xl bg-white/[0.03] hover:bg-blue-500/10 border border-white/10 hover:border-blue-400/50 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(59,130,246,0.2)]"
          >
            <div className="text-3xl mb-3">{tile.icon}</div>
            <div className="text-base font-bold text-white mb-0.5 group-hover:text-blue-200 transition-colors">
              {tile.label}
            </div>
            <div className="text-xs text-blue-100/60">{tile.desc}</div>
            <div className="absolute top-5 right-5 text-blue-400/50 group-hover:text-blue-300 group-hover:translate-x-1 transition-all">
              →
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
