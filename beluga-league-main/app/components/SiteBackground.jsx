'use client'

import { useState, useEffect, useRef } from 'react'

/**
 * Cohesive gaming backdrop for every PUBLIC page (admin panel excluded). Fixed
 * behind all content: a slideshow of gaming photos that crossfade every few
 * seconds, a deep gradient, an animated tech grid, drifting glow orbs, a HUD
 * scanline, and a vignette. Photos sit under dark overlays so text stays readable.
 */

const IMAGES = [
  '/gaming/g1.jpg', '/gaming/g2.jpg', '/gaming/g3.jpg', '/gaming/g5.jpg',
  '/gaming/g8.jpg', '/gaming/g10.jpg', '/gaming/g11.jpg', '/gaming/g12.jpg',
  '/gaming/g13.jpg', '/gaming/g14.jpg', '/gaming/g15.jpg', '/gaming/g9.jpg',
]

const PHOTO_OPACITY = 0.26 // brighter than before (was 0.16)
const INTERVAL_MS = 6000

export default function SiteBackground() {
  // Two stacked layers that crossfade. The hidden layer is swapped to the next
  // image before we flip visibility, so each transition is a smooth crossfade.
  const [state, setState] = useState({ a: IMAGES[0], b: IMAGES[1 % IMAGES.length], showA: true })
  const idxRef = useRef(0)

  useEffect(() => {
    if (IMAGES.length < 2) return
    const t = setInterval(() => {
      idxRef.current = (idxRef.current + 1) % IMAGES.length
      const next = IMAGES[idxRef.current]
      setState((s) => (s.showA ? { a: s.a, b: next, showA: false } : { a: next, b: s.b, showA: true }))
    }, INTERVAL_MS)
    return () => clearInterval(t)
  }, [])

  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <style>{`
        @keyframes bg-grid-drift { from { background-position: 0 0; } to { background-position: 56px 56px; } }
        @keyframes bg-orb-pulse { 0%,100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.08); } }
        @keyframes bg-scan { 0% { transform: translateY(-10vh); opacity: 0; } 10% { opacity: .5; } 90% { opacity: .5; } 100% { transform: translateY(110vh); opacity: 0; } }
      `}</style>

      {/* Deep base */}
      <div className="absolute inset-0 bg-gradient-to-br from-black via-[#070b16] to-black" />

      {/* Crossfading gaming photos */}
      <img
        src={state.a}
        alt=""
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out"
        style={{ opacity: state.showA ? PHOTO_OPACITY : 0 }}
      />
      <img
        src={state.b}
        alt=""
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ease-in-out"
        style={{ opacity: state.showA ? 0 : PHOTO_OPACITY }}
      />

      {/* Dark overlays (lighter than before so the photos read brighter) */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#05070f]/60 via-[#05070f]/68 to-[#05070f]/88" />

      {/* Blue tints */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-10%,rgba(37,99,235,0.16),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_80%_110%,rgba(79,70,229,0.12),transparent_55%)]" />

      {/* Animated tech grid */}
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(96,165,250,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(96,165,250,0.6) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 100% 70% at 50% 30%, black 40%, transparent 90%)',
          WebkitMaskImage: 'radial-gradient(ellipse 100% 70% at 50% 30%, black 40%, transparent 90%)',
          animation: 'bg-grid-drift 18s linear infinite',
        }}
      />

      {/* Drifting glow orbs */}
      <div className="absolute -top-24 -left-24 w-[36rem] h-[36rem] rounded-full bg-blue-600/10 blur-[120px]" style={{ animation: 'bg-orb-pulse 14s ease-in-out infinite' }} />
      <div className="absolute top-1/3 -right-32 w-[34rem] h-[34rem] rounded-full bg-indigo-600/10 blur-[120px]" style={{ animation: 'bg-orb-pulse 18s ease-in-out infinite 2s' }} />
      <div className="absolute bottom-0 left-1/4 w-[28rem] h-[28rem] rounded-full bg-cyan-500/[0.07] blur-[110px]" style={{ animation: 'bg-orb-pulse 16s ease-in-out infinite 1s' }} />

      {/* Slow HUD scanline */}
      <div
        className="absolute inset-x-0 h-24"
        style={{
          background: 'linear-gradient(to bottom, transparent, rgba(96,165,250,0.06), transparent)',
          animation: 'bg-scan 11s linear infinite',
        }}
      />

      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.5)_100%)]" />
    </div>
  )
}
