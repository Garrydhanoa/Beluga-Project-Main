'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useSeason, seasonQuerySuffix } from '../components/SeasonContext'
import SeasonPicker from '../components/SeasonPicker'
import PlayoffBracket from '../components/PlayoffBracket'

/**
 * The public playoff bracket page.
 *
 * Replaces the bare matchup list that used to sit at the bottom of /schedules,
 * which had no seeds, scores, winners, logos or publish gate.
 *
 * Visibility: the toggle on the admin Playoffs tab governs the CURRENT season.
 * An archived season's bracket is always readable, because /seasons links here
 * as part of the league's history.
 */

const DIVISIONS = [
  { key: 'Majors', label: 'Majors' },
  { key: 'AAA', label: 'AAA' },
  { key: 'AA', label: 'AA' },
]

// Copied locally, exactly as every other public page does.
function FadeIn({ children, delay = 0, y = 20 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

export default function PlayoffsPage() {
  const { season } = useSeason()
  const router = useRouter()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeDivision, setActiveDivision] = useState('Majors')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/public/playoffs?${seasonQuerySuffix(season).replace(/^&/, '')}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [season])

  // Hidden and not an archive -> this page isn't meant to be reachable.
  useEffect(() => {
    if (!loading && data && !data.enabled && !data.isArchive) {
      router.replace('/')
    }
  }, [loading, data, router])

  const brackets = data?.brackets || []
  const bracket = brackets.find((b) => b.division?.toLowerCase() === activeDivision.toLowerCase()) || null
  const seasonNumber = data?.season?.seasonNumber

  return (
    <div className="relative text-white overflow-hidden">
      {/* Hero */}
      <section className="container mx-auto px-4 pt-16 pb-8">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-yellow-400/10 border border-yellow-400/30 backdrop-blur-sm mb-6">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-xs text-yellow-100 font-medium tracking-[0.2em] uppercase">
              {seasonNumber ? `Season ${seasonNumber}` : 'Season'}
              {data?.isArchive ? ' · Archive' : ' · Postseason'}
            </span>
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-4 leading-[0.95]">
            <span className="block text-white">Playoff</span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-500 drop-shadow-[0_0_30px_rgba(250,204,21,0.25)]">
              Bracket
            </span>
          </h1>

          <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
            Win and advance. Every result is live the moment a series is confirmed.
          </p>
        </div>
      </section>

      {/* Season + division */}
      <section className="container mx-auto px-4 pb-8">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <SeasonPicker />
          {DIVISIONS.map((d) => {
            const has = brackets.some((b) => b.division?.toLowerCase() === d.key.toLowerCase())
            return (
              <button
                key={d.key}
                onClick={() => setActiveDivision(d.key)}
                aria-pressed={activeDivision === d.key}
                className={`px-6 py-2.5 rounded-full font-bold text-sm transition-all ${
                  activeDivision === d.key
                    ? 'bg-blue-500 text-white shadow-[0_0_30px_rgba(59,130,246,0.5)] scale-105'
                    : 'bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/70 hover:text-blue-200'
                } ${has ? '' : 'opacity-50'}`}
              >
                {d.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Bracket */}
      <section className="container mx-auto px-4 pb-24 max-w-[1400px]">
        {loading ? (
          <div className="text-center py-20 text-sm text-blue-200/60">Loading…</div>
        ) : !bracket ? (
          <div className="text-center py-20 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
            No {activeDivision} bracket published yet.
          </div>
        ) : (
          <FadeIn>
            <PlayoffBracket bracket={bracket} />
          </FadeIn>
        )}
      </section>
    </div>
  )
}
