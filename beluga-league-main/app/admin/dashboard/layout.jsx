'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'

const NAV = [
  { label: 'Overview', href: '/admin/dashboard', icon: 'grid', exact: true },
  { label: 'Seasons', href: '/admin/dashboard/seasons', icon: 'calendar' },
  { label: 'Teams & Franchises', href: '/admin/dashboard/teams', icon: 'flag' },
  { label: 'Schedule', href: '/admin/dashboard/schedule', icon: 'clock' },
  { label: 'Playoffs', href: '/admin/dashboard/playoffs', icon: 'trophy' },
  { label: 'Match Results', href: '/admin/dashboard/matches', icon: 'swords' },
  { label: 'Players', href: '/admin/dashboard/players', icon: 'user' },
  { label: 'Transactions', href: '/admin/dashboard/transactions', icon: 'arrows' },
  { label: 'Power Rankings', href: '/admin/dashboard/rankings', icon: 'trending' },
  { label: 'MMR Updater', href: '/admin/dashboard/mmr', icon: 'trending' },
  { label: 'Site Content', href: '/admin/dashboard/site-content', icon: 'grid' },
  { label: 'Ticket Setup', href: '/admin/dashboard/ticket-setup', icon: 'alert' },
  { label: 'Applications', href: '/admin/dashboard/applications', icon: 'user' },
  { label: 'Week Threads', href: '/admin/dashboard/weeks', icon: 'thread' },
  { label: 'Notification', href: '/admin/dashboard/notification', icon: 'bell' },
  { label: 'Tickets', href: '/admin/dashboard/tickets', icon: 'alert' },
  { label: 'Logs', href: '/admin/dashboard/logs', icon: 'chart' },
]

const ICON_PATHS = {
  grid: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z',
  calendar: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  flag: 'M7 21V3h9l1 4h4v10h-5l-1-4H7',
  clock: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  swords: 'M13 10V3L4 14h7v7l9-11h-7z',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  arrows: 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  trending: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  trophy: 'M8 21h8m-4-4v4m-5-16h10v3a5 5 0 01-10 0V5zM7 5H4v2a3 3 0 003 3m10-5h3v2a3 3 0 01-3 3',
  thread: 'M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z',
  bell: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
  alert: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
}

function Icon({ name, className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[name] || ICON_PATHS.grid} />
    </svg>
  )
}

function isActive(pathname, item) {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(item.href + '/')
}

export default function DashboardLayout({ children }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileNavOpen(false) }, [pathname])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/admin')
    } else if (status === 'authenticated' && !session?.isDirector) {
      router.push('/admin/denied')
    }
  }, [status, session, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 mt-4">Verifying access…</p>
        </div>
      </div>
    )
  }

  if (!session?.isDirector) return null

  return (
    <div className="min-h-screen flex">
      {/* Mobile top bar with hamburger (hidden on lg+) */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 z-50 flex items-center gap-3 px-4 border-b border-blue-500/20 bg-black/80 backdrop-blur-xl">
        <button
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
          className="p-2 -ml-1 rounded-lg text-white/80 hover:bg-white/10"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Link href="/admin/dashboard" className="text-sm font-black text-white tracking-tight">BELUGA LEAGUE</Link>
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-blue-300/60">Admin</span>
      </div>

      {/* Backdrop when the mobile drawer is open */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
      )}

      <aside className={`fixed left-0 top-0 bottom-0 w-64 border-r border-blue-500/20 bg-black/80 lg:bg-black/60 backdrop-blur-xl flex flex-col z-50 transition-transform duration-200 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <Link href="/admin/dashboard" className="block">
            <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/70">
              Admin Panel
            </div>
            <div className="text-lg font-black text-white mt-1 tracking-tight">BELUGA LEAGUE</div>
          </Link>
          <button onClick={() => setMobileNavOpen(false)} aria-label="Close menu" className="lg:hidden p-1.5 rounded text-white/60 hover:bg-white/10">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV.map((item) => {
            const active = isActive(pathname, item)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                  active
                    ? 'bg-blue-500/15 text-blue-200 border border-blue-400/40'
                    : 'text-white/70 hover:bg-white/5 hover:text-blue-200 border border-transparent'
                }`}
              >
                <Icon name={item.icon} className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {active && <span className="w-1 h-1 rounded-full bg-blue-400" />}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="text-[10px] text-blue-300/50 tracking-wider uppercase mb-1">Signed in as</div>
          <div className="text-sm font-bold text-white truncate mb-1">
            {session?.discordUsername || 'Director'}
          </div>
          {session?.viaBypass && (
            <div className="text-[10px] text-yellow-300/80 mb-2">via {session.viaBypass}</div>
          )}
          <div className="flex gap-2 mt-2">
            <Link
              href="/"
              className="flex-1 px-3 py-2 text-center text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition"
            >
              View Site
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: '/admin' })}
              className="flex-1 px-3 py-2 text-xs font-semibold text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 lg:ml-64 px-4 sm:px-6 lg:px-10 pt-20 lg:pt-10 pb-10 min-w-0">{children}</main>
    </div>
  )
}
