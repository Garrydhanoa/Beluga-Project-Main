import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

const DEFAULTS = {
  notification: {
    enabled: false,
    message: '',
    href: '/players',
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
