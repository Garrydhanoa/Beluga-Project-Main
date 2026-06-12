'use client'

// Homepage extras driven by admin Site Content: the montage video embeds
// (max 2, after Meet the Teams) and a rotating staff-quote strip. Renders
// nothing until staff add content.

import { useEffect, useState } from 'react'

function youtubeEmbedUrl(url) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return `https://www.youtube.com/embed/${u.pathname.slice(1)}`
    const id = u.searchParams.get('v')
    return id ? `https://www.youtube.com/embed/${id}` : null
  } catch { return null }
}

export function useSiteContent() {
  const [data, setData] = useState({ quotes: [], montage: [] })
  useEffect(() => {
    fetch('/api/public/site-content', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData({ quotes: d.quotes || [], montage: d.montage || [] }))
      .catch(() => {})
  }, [])
  return data
}

export function MontageSection({ montage }) {
  const videos = (montage || []).map((m) => ({ ...m, embed: youtubeEmbedUrl(m.youtube_url) })).filter((m) => m.embed).slice(0, 2)
  if (!videos.length) return null
  return (
    <section className="container mx-auto px-4 py-16">
      <div className="text-center mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-blue-300/70 mb-2">Highlights</div>
        <h2 className="text-3xl md:text-4xl font-black text-white">League Montage</h2>
      </div>
      <div className={`grid gap-6 max-w-5xl mx-auto ${videos.length > 1 ? 'md:grid-cols-2' : 'md:grid-cols-1 max-w-3xl'}`}>
        {videos.map((v, i) => (
          <div key={i} className="rounded-2xl overflow-hidden border border-white/10 bg-black/40 aspect-video">
            <iframe src={v.embed} title={v.title || `Montage ${i + 1}`} className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen />
          </div>
        ))}
      </div>
    </section>
  )
}

// Hall of Fame — most championships (franchises + players). Renders nothing
// until at least one champion exists.
export function HallOfFame() {
  const [data, setData] = useState(null)
  useEffect(() => {
    fetch('/api/public/hall-of-fame', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [])
  if (!data || (!data.franchises?.length && !data.players?.length)) return null
  return (
    <section className="container mx-auto px-4 py-16">
      <div className="text-center mb-8">
        <div className="text-xs font-bold tracking-[0.25em] uppercase text-yellow-300/70 mb-2">Legends</div>
        <h2 className="text-3xl md:text-4xl font-black text-white">🏆 Hall of Fame</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        <div className="rounded-2xl bg-white/[0.03] border border-yellow-400/20 p-5">
          <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-yellow-300/70 mb-3">Most Championships — Franchises</div>
          <ol className="space-y-2">
            {data.franchises.map((f) => (
              <li key={f.name} className="flex items-center gap-3 text-sm">
                <span className="text-white/40 w-4">{f.rank}</span>
                <a href={`/teams/${encodeURIComponent(f.name)}`} className="text-white font-bold flex-1 truncate hover:text-yellow-200">{f.name}</a>
                <span className="text-yellow-300 font-black">{'🏆'.repeat(Math.min(f.titles, 5))} {f.titles}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="rounded-2xl bg-white/[0.03] border border-yellow-400/20 p-5">
          <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-yellow-300/70 mb-3">Most Championships — Players</div>
          <ol className="space-y-2">
            {data.players.map((p) => (
              <li key={p.discordId} className="flex items-center gap-3 text-sm">
                <span className="text-white/40 w-4">{p.rank}</span>
                <a href={`/players/${encodeURIComponent(p.discordId)}`} className="text-white font-bold flex-1 truncate hover:text-yellow-200">{p.name}</a>
                <span className="text-yellow-300 font-black">{p.titles}×</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}

export function QuoteStrip({ quotes }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (!quotes || quotes.length < 2) return undefined
    const t = setInterval(() => setIdx((i) => (i + 1) % quotes.length), 8000)
    return () => clearInterval(t)
  }, [quotes])
  if (!quotes?.length) return null
  const q = quotes[idx % quotes.length]
  return (
    <div className="container mx-auto px-4 py-6">
      <div className="max-w-2xl mx-auto flex items-center gap-3 px-5 py-3 rounded-2xl bg-white/[0.03] border border-white/10">
        {q.authorId && (
          <img src={`https://cdn.discordapp.com/embed/avatars/${Number(BigInt(q.authorId) >> 22n) % 6}.png`}
            alt="" className="w-8 h-8 rounded-full opacity-80" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        )}
        <p className="text-sm text-blue-100/80 italic flex-1 truncate">“{q.text}”</p>
        <span className="text-xs font-bold text-blue-300/80 whitespace-nowrap">— {q.author}</span>
      </div>
    </div>
  )
}
