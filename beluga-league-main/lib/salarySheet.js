import { GoogleSpreadsheet } from 'google-spreadsheet'
import { JWT } from 'google-auth-library'
import path from 'path'
import fs from 'fs'

/**
 * Reads the league salary spreadsheet (the "old sheet setup") to enrich players
 * with salary + division (League). Keyed by Discord ID.
 *
 *   SalSheet tab:         'Discord ID' (col P), 'SAL lock' (col O = salary), eligibility flags
 *   Player Directory tab: 'User ID', 'Display Name', 'Salary', 'League', 'Team', 'FA'
 *
 * 30-minute in-memory cache; serves stale data if a refresh fails.
 */

const cache = {
  byDiscordId: null,
  fetchedAt: 0,
  ttlMs: 30 * 60 * 1000,
}

function getConfig() {
  if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return {
      auth: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      sheetId: process.env.SHEET_ID_PLAYERS || '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs',
    }
  }
  const credPath = path.join(process.cwd(), 'credentials.json')
  if (fs.existsSync(credPath)) {
    const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'))
    return {
      auth: { client_email: credentials.client_email, private_key: credentials.private_key },
      sheetId: process.env.SHEET_ID_PLAYERS || '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs',
    }
  }
  return null
}

function normalizeLeague(raw) {
  const v = String(raw || '').trim().toLowerCase()
  if (!v) return null
  if (v.includes('major')) return 'Majors'
  if (v.includes('aaa')) return 'AAA'
  if (v.includes('aa')) return 'AA'
  return raw
}

async function fetchFresh() {
  const config = getConfig()
  if (!config) throw new Error('Salary sheet not configured (missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY)')

  const auth = new JWT({
    email: config.auth.client_email,
    key: config.auth.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  const doc = new GoogleSpreadsheet(config.sheetId, auth)
  await doc.loadInfo()

  const dirSheet = doc.sheetsByTitle['Player Directory']
  const salSheet = doc.sheetsByTitle['SalSheet']

  const byDiscordId = new Map()

  // SalSheet — salary + eligibility, keyed by Discord ID.
  if (salSheet) {
    const rows = await salSheet.getRows()
    for (const row of rows) {
      const discordId = row.get('Discord ID')
      if (!discordId) continue
      const salRaw = row.get('SAL lock')
      byDiscordId.set(String(discordId).trim(), {
        salary: salRaw ? parseFloat(salRaw) : null,
        league: normalizeLeague(row.get('League')),
        eligible: row.get('Eligible?') === 'YES',
        isFreeAgent: row.get('FA?') === 'YES',
        ir: row.get('IR?') === 'YES',
        suspended: row.get('Suspended?') === 'YES',
        nickname: row.get('Nickname') || null,
        sal2sPeak: row.get('2s PEAK') || null,
        sal3sPeak: row.get('3s PEAK') || null,
      })
    }
  }

  // Player Directory — fills league/salary gaps, keyed by User ID.
  if (dirSheet) {
    const rows = await dirSheet.getRows()
    for (const row of rows) {
      const userId = row.get('User ID')
      if (!userId) continue
      const key = String(userId).trim()
      const existing = byDiscordId.get(key) || {}
      const dirSalary = row.get('Salary')
      byDiscordId.set(key, {
        ...existing,
        salary: existing.salary != null ? existing.salary : (dirSalary ? parseFloat(dirSalary) : null),
        league: existing.league || normalizeLeague(row.get('League')),
        sheetTeam: row.get('Team') || null,
        displayName: existing.nickname || row.get('Display Name') || row.get('Username') || null,
      })
    }
  }

  return byDiscordId
}

/**
 * Returns a Map<discordId, { salary, league, ... }>. Cached 30 min.
 * On failure, returns the stale cache if available, else an empty Map.
 */
export async function getSalaryMap() {
  const now = Date.now()
  if (cache.byDiscordId && now - cache.fetchedAt < cache.ttlMs) {
    return cache.byDiscordId
  }
  try {
    const fresh = await fetchFresh()
    cache.byDiscordId = fresh
    cache.fetchedAt = now
    return fresh
  } catch (err) {
    console.warn('[salarySheet] refresh failed:', err.message)
    return cache.byDiscordId || new Map()
  }
}

export function salaryMapToObject(map) {
  const obj = {}
  for (const [k, v] of map.entries()) obj[k] = v
  return obj
}
