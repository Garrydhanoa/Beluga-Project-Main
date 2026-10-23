// Browser-side helpers for the login pages (admin + applications).

/**
 * A light device fingerprint: timezone, languages, screen, CPU/RAM class, touch.
 * Deliberately no canvas/audio tricks — combined with the first-party device cookie
 * it's enough to recognise the same device across IPs and accounts.
 */
export function collectFingerprint() {
  if (typeof window === 'undefined') return null
  try {
    const n = window.navigator || {}
    const s = window.screen || {}
    return {
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      lang: n.language || null,
      langs: Array.isArray(n.languages) ? n.languages.slice(0, 4).join(',') : null,
      platform: n.userAgentData?.platform || n.platform || null,
      screen: s.width && s.height ? `${s.width}x${s.height}` : null,
      dpr: window.devicePixelRatio || null,
      colorDepth: s.colorDepth || null,
      cores: n.hardwareConcurrency || null,
      memory: n.deviceMemory || null,
      touch: n.maxTouchPoints ?? null,
      vendor: n.vendor || null,
    }
  } catch {
    return null
  }
}

/** Register this device + fingerprint; resolves to { banned, message }. */
export async function checkSecurityStatus() {
  try {
    const r = await fetch('/api/security/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fp: collectFingerprint() }),
      cache: 'no-store',
    })
    const j = await r.json().catch(() => ({}))
    return { banned: !!j.banned, message: j.message || null }
  } catch {
    return { banned: false, message: null }
  }
}

/** Tell the server where a signed-in person is (live sessions view). */
export function sendHeartbeat(path) {
  try {
    fetch('/api/security/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
      keepalive: true,
    }).catch(() => {})
  } catch { /* ignore */ }
}
