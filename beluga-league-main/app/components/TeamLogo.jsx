'use client'

import { useState, useEffect } from 'react'

/**
 * Team logo with a reliable fallback chain.
 *
 * - If the team has an admin-uploaded DB logo (`hasDbLogo`), load it from the DB
 *   endpoint FIRST so re-uploads show instantly, then fall back to the static
 *   /logos file, then initials.
 * - Otherwise load the static /logos file FIRST (fast + reliable, cacheable),
 *   then try the DB endpoint, then initials.
 *
 * This avoids the broken-image flashes that happened when every logo went through
 * the uncached DB endpoint (most teams only have static files).
 */
function initialsOf(name) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase())
    .slice(0, 3)
    .join('') || 'T'
}

export default function TeamLogo({ name, teamId, className = '', imgClassName = '', alt, version, hasDbLogo = false }) {
  const [stage, setStage] = useState(0)

  // Reset the fallback chain whenever the inputs change.
  useEffect(() => { setStage(0) }, [name, teamId, version, hasDbLogo])

  const valid = name && typeof name === 'string' && !name.includes('[object') && !name.includes('undefined')
  if (!valid) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <span className="font-bold text-blue-200">{initialsOf(name)}</span>
      </div>
    )
  }

  // DB endpoint is the single source of truth: it resolves team logo → franchise
  // logo internally (by id when we have it — exact match — else by name), so
  // re-uploads show instantly everywhere. There is no static /logos fallback
  // anymore; a missing logo resolves to initials below.
  const idQuery = teamId != null && teamId !== '' ? `teamId=${encodeURIComponent(teamId)}` : `name=${encodeURIComponent(name)}`
  const dbUrl = `/api/teams/logo?${idQuery}${version ? `&v=${encodeURIComponent(version)}` : ''}`
  const sources = [dbUrl]

  if (stage >= sources.length) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <span className="font-bold text-blue-200">{initialsOf(name)}</span>
      </div>
    )
  }

  return (
    <img
      src={sources[stage]}
      alt={alt ?? name}
      className={imgClassName || className}
      onError={() => setStage((s) => s + 1)}
    />
  )
}
