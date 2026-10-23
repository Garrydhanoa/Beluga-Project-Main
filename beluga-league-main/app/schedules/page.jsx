"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import TeamLogo from "../components/TeamLogo"
import SeasonPicker from "../components/SeasonPicker"
import { useSeason, seasonQuerySuffix } from "../components/SeasonContext"

const DIVISIONS = [
  { key: 'aa', label: 'AA', tagline: 'AA Division', teams: 14 },
  { key: 'aaa', label: 'AAA', tagline: 'AAA Division', teams: 14 },
  { key: 'majors', label: 'MAJORS', tagline: 'Majors Division', teams: 10 },
]

function FadeIn({ children, delay = 0, y = 30, className = "" }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

function getTeamInitials(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase())
    .slice(0, 3)
    .join('')
}

function TeamSide({ name, teamId, side }) {
  // Ghost logo positioning — bleeds out of the card toward the outer corner
  const ghostPos =
    side === 'home'
      ? '-top-10 -right-10'
      : '-bottom-10 -left-10'
  const alignment = side === 'home' ? 'justify-end' : 'justify-start'
  const textAlign = side === 'home' ? 'text-right' : 'text-left'
  const label = side === 'home' ? 'Home' : 'Away'

  const logoEl = (
    <Link
      href={`/teams/${encodeURIComponent(name)}`}
      className="flex-shrink-0 relative w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center hover:scale-110 transition-transform"
    >
      <div className="absolute inset-0 rounded-full bg-blue-500/0 group-hover:bg-blue-500/20 blur-md transition-all" />
      <TeamLogo
        name={name}
        teamId={teamId}
        className="relative w-full h-full"
        imgClassName="relative w-full h-full object-contain drop-shadow-lg"
      />
    </Link>
  )

  const textEl = (
    <div className={`min-w-0 ${textAlign}`}>
      <div className="text-[9px] font-bold tracking-[0.25em] uppercase text-blue-300/60">
        {label}
      </div>
      <div className="text-base sm:text-lg font-bold text-white group-hover:text-blue-200 transition-colors truncate max-w-[180px]">
        {name}
      </div>
    </div>
  )

  return (
    <>
      {/* Ghost logo background */}
      <div
        className={`absolute ${ghostPos} w-44 h-44 opacity-[0.08] group-hover:opacity-[0.2] transition-opacity duration-700 pointer-events-none`}
        aria-hidden="true"
      >
        <TeamLogo name={name} teamId={teamId} className="w-full h-full" imgClassName="w-full h-full object-contain" alt="" />
      </div>
      {/* Foreground content */}
      <div className={`relative flex items-center gap-3 ${alignment}`}>
        {side === 'home' ? (
          <>
            {textEl}
            {logoEl}
          </>
        ) : (
          <>
            {logoEl}
            {textEl}
          </>
        )}
      </div>
    </>
  )
}

export default function SchedulesPage() {
  const { season } = useSeason()
  const [activeTab, setActiveTab] = useState('aa')
  const [regular, setRegular] = useState({ aa: {}, aaa: {}, majors: {} })
  const [seasonLabel, setSeasonLabel] = useState('Season')

  useEffect(() => {
    fetch(`/api/schedule?${seasonQuerySuffix(season).replace(/^&/, '')}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setRegular(data?.regular || { aa: {}, aaa: {}, majors: {} })
        setSeasonLabel(data?.season?.seasonNumber ? `Season ${data.season.seasonNumber}` : 'Season')
      })
      .catch(() => {})
  }, [season])

  const currentSchedule = regular[activeTab] || {}
  const currentDivision = DIVISIONS.find((d) => d.key === activeTab)

  return (
    <div className="relative text-white overflow-hidden">
      {/* Hero */}
      <section className="container mx-auto px-4 pt-16 pb-10">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-400/30 backdrop-blur-sm mb-6">
              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              <span className="text-xs text-blue-200 font-medium tracking-[0.2em] uppercase">
                {seasonLabel} · Schedule
              </span>
            </div>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight mb-5 leading-[0.95]">
              <span className="block text-white">Match</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-200 via-blue-300 to-blue-500 drop-shadow-[0_0_30px_rgba(59,130,246,0.3)]">
                Schedules
              </span>
            </h1>
            <p className="text-base md:text-lg text-blue-100/70 max-w-xl mx-auto">
              Full season schedule across all divisions. Each team plays two matches per week.
            </p>
          </div>
        </FadeIn>
      </section>

      {/* Division Tabs */}
      <section className="container mx-auto px-4 mb-10">
        <FadeIn delay={0.1}>
          <div className="flex justify-center mb-4"><SeasonPicker /></div>
          <div className="flex justify-center gap-2 sm:gap-3 flex-wrap">
            {DIVISIONS.map((div) => {
              const active = activeTab === div.key
              return (
                <button
                  key={div.key}
                  onClick={() => setActiveTab(div.key)}
                  className={`relative px-6 sm:px-8 py-3 rounded-full font-bold text-sm sm:text-base transition-all ${
                    active
                      ? 'bg-blue-500 text-white shadow-[0_0_30px_rgba(59,130,246,0.5)] scale-105'
                      : 'bg-white/5 hover:bg-white/10 border border-white/15 hover:border-blue-400/50 text-white/70 hover:text-blue-200'
                  }`}
                >
                  {div.label}
                </button>
              )
            })}
          </div>
        </FadeIn>

        {/* Division info strip */}
        <FadeIn delay={0.15}>
          <div className="mt-6 text-center">
            <div className="inline-flex items-center gap-3 sm:gap-6 px-5 py-3 rounded-full bg-white/[0.03] border border-white/10 backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-blue-300/60 font-bold">
                  Division
                </span>
                <span className="text-sm font-black text-white">
                  {currentDivision.tagline}
                </span>
              </div>
              <span className="hidden sm:block w-px h-5 bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-blue-300/60 font-bold">
                  Teams
                </span>
                <span className="text-sm font-black text-white">{currentDivision.teams}</span>
              </div>
              <span className="hidden sm:block w-px h-5 bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.2em] text-blue-300/60 font-bold">
                  Weeks
                </span>
                <span className="text-sm font-black text-white">
                  {Object.keys(currentSchedule).length}
                </span>
              </div>
            </div>
          </div>
        </FadeIn>
      </section>

      {/* Week sections */}
      <section className="container mx-auto px-4 pb-24 max-w-7xl">
        <div className="space-y-12">
          {Object.entries(currentSchedule).map(([week, matches], weekIndex) => {
            const weekNum = week.split(' ')[1] || String(weekIndex + 1)
            return (
              <FadeIn key={`${activeTab}-${week}`} delay={weekIndex * 0.05} y={20}>
                <section>
                  {/* Week header */}
                  <div className="flex items-center gap-4 mb-6">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-bold tracking-[0.25em] uppercase text-blue-300/60">
                        Week
                      </span>
                      <span className="text-5xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-blue-300 leading-none">
                        {String(weekNum).padStart(2, '0')}
                      </span>
                    </div>
                    <div className="flex-1 h-px bg-gradient-to-r from-blue-400/40 via-blue-400/20 to-transparent" />
                    <div className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-400/30 text-[10px] font-bold tracking-wider uppercase text-blue-200">
                      {matches.length} {matches.length === 1 ? 'match' : 'matches'}
                    </div>
                  </div>

                  {/* Match grid — ticket stub style */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {matches.map((match, i) => (
                      <div
                        key={`${week}-${i}`}
                        className="group relative rounded-2xl border border-white/10 hover:border-blue-400/50 hover:shadow-[0_10px_40px_rgba(59,130,246,0.25)] hover:-translate-y-1 transition-all duration-500 overflow-hidden bg-black/20"
                      >
                        {/* HOME HALF — top */}
                        <div className="relative px-5 pt-5 pb-9 overflow-hidden bg-gradient-to-br from-blue-600/15 via-blue-500/5 to-transparent">
                          <TeamSide name={match[0]} teamId={match[2]} side="home" />
                        </div>

                        {/* Perforated divider */}
                        <div className="relative h-0 z-20">
                          {/* Dashed line across */}
                          <div className="absolute inset-x-8 top-0 border-t border-dashed border-blue-400/30" />
                          {/* Notch circles at the edges */}
                          <div className="absolute left-0 top-0 -translate-y-1/2 w-4 h-4 rounded-full bg-[#0a0f1e] border border-blue-400/30" />
                          <div className="absolute right-0 top-0 -translate-y-1/2 w-4 h-4 rounded-full bg-[#0a0f1e] border border-blue-400/30" />
                          {/* Centered VS badge */}
                          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2">
                            <div className="relative">
                              <div className="absolute inset-0 bg-blue-500/40 blur-xl rounded-full" />
                              <div className="relative w-14 h-14 rounded-full bg-gradient-to-b from-blue-400 via-blue-500 to-blue-700 border-2 border-blue-200/50 flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.7)] group-hover:shadow-[0_0_45px_rgba(59,130,246,1)] transition-shadow">
                                <span className="text-xs font-black text-white tracking-[0.1em] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                                  VS
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* AWAY HALF — bottom */}
                        <div className="relative px-5 pt-9 pb-5 overflow-hidden bg-gradient-to-tr from-transparent via-blue-500/5 to-blue-400/10">
                          <TeamSide name={match[1]} teamId={match[3]} side="away" />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </FadeIn>
            )
          })}
        </div>

        {/* Empty state fallback */}
        {Object.keys(currentSchedule).length === 0 && (
          <div className="text-center py-24 text-sm text-white/40 rounded-2xl bg-white/[0.02] border border-dashed border-white/10">
            No schedule published for this division yet.
          </div>
        )}
      </section>
    </div>
  )
}
