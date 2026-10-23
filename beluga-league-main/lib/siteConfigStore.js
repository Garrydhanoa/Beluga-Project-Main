import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

const DEFAULTS = {
  notification: {
    enabled: false,
    message: '',
    href: '/players',
  },
  // Playoffs: `enabled` is the public visibility switch (nav link + /playoffs for
  // the CURRENT season — archived seasons stay reachable regardless). The rest are
  // the automation switches, mirrored in the bot's playoffBracket.js DEFAULT_SETTINGS.
  // They default ON so a fresh install runs itself; `enabled` defaults OFF so a
  // half-seeded bracket is never public by accident.
  playoffs: {
    enabled: false,
    autoAdvance: true,
    autoThreads: true,
    autoChampion: true,
    autoAnnounce: true,
  },
}

export async function getSiteConfig(key) {
  await ensureLeagueSchema()
  const r = await query('SELECT value FROM site_config WHERE key = $1', [key])
  if (!r.rows.length) return DEFAULTS[key] || {}
  return { ...(DEFAULTS[key] || {}), ...(r.rows[0].value || {}) }
}

export async function setSiteConfig(key, value) {
  await ensureLeagueSchema()
  const r = await query(`
    INSERT INTO site_config (key, value)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    RETURNING value
  `, [key, JSON.stringify(value || {})])
  return r.rows[0].value
}
