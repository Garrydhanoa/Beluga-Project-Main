'use client'

// Homepage "Top Inviters" strip: the current invite campaign's top 5, with a link
// to the full /invites page (which deliberately has no top-nav entry).
// Renders nothing until someone has a counted invite.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Avatar from './Avatar'

const MEDAL = ['🥇', '🥈', '🥉']

export default function InviteLeadersPreview() {
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch('/api/public/invites?preview=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
  }, [])

  const top = Array.isArray(data?.top) ? data.top : []
  if (!top.length) return null

  return (
    <section className="container mx-auto px-4 pb-16">
      <div className="text-center mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">{data?.campaign?.name || 'Invite campaign'}</div>
        <h2 className="text-3xl md:text-4xl font-black text-white">Top Inviters</h2>
      </div>
      <div className="max-w-3xl mx-auto space-y-2">
        {top.map((r, i) => (
          <div key={r.discordId} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-blue-400/30 transition">
            <span className="w-7 text-center font-black text-white/60">{i < 3 ? MEDAL[i] : r.rank}</span>
            <Avatar src={r.avatarUrl} name={r.name} size={32} />
            <Link href={`/players/${encodeURIComponent(r.discordId)}`} className="flex-1 min-w-0 truncate font-bold text-white hover:text-blue-200">
              {r.name}
            </Link>
            <span className="font-mono font-black text-blue-300">{r.total}</span>
            <span className="text-[10px] uppercase tracking-wider text-white/40 hidden sm:inline">invites</span>
          </div>
        ))}
      </div>
      <div className="text-center mt-6">
        <Link href="/invites"
          className="inline-block px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-blue-500/20 hover:bg-blue-500/30 border border-blue-400/40 transition">
          See leaderboard
        </Link>
      </div>
    </section>
  )
}
