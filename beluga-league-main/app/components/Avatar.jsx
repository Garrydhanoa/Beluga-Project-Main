"use client"

import { useState } from 'react'

/**
 * Discord avatar with a graceful gradient-initials fallback. `src` is the
 * avatar_url mirrored from discord_members; when it's missing or fails to load
 * we render the first letter of the name on a deterministic gradient so the UI
 * never shows a broken image or a raw ID.
 */
function initialOf(name) {
  const s = String(name || '').trim()
  if (!s) return '?'
  // Skip leading non-alphanumerics so "@name" / emoji names still pick a letter.
  const m = s.match(/[A-Za-z0-9]/)
  return (m ? m[0] : s[0]).toUpperCase()
}

// Deterministic gradient from the name so each player keeps a stable color.
const GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-cyan-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-sky-500 to-blue-700',
  'from-teal-500 to-cyan-700',
  'from-fuchsia-500 to-pink-600',
  'from-emerald-500 to-teal-700',
  'from-amber-500 to-orange-600',
]
function gradientFor(name) {
  const s = String(name || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
}

export default function Avatar({ src, name, size = 40, className = '', ring = true }) {
  const [failed, setFailed] = useState(false)
  const dim = typeof size === 'number' ? `${size}px` : size
  const ringCls = ring ? 'ring-2 ring-white/10' : ''

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name || ''}
        width={typeof size === 'number' ? size : undefined}
        height={typeof size === 'number' ? size : undefined}
        style={{ width: dim, height: dim }}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`rounded-full object-cover bg-black/40 ${ringCls} ${className}`}
      />
    )
  }

  return (
    <div
      style={{ width: dim, height: dim, fontSize: typeof size === 'number' ? size * 0.42 : undefined }}
      className={`rounded-full flex items-center justify-center font-black text-white bg-gradient-to-br ${gradientFor(name)} ${ringCls} ${className}`}
      aria-label={name || ''}
    >
      {initialOf(name)}
    </div>
  )
}
