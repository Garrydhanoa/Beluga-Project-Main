// Server-side helpers for the admin Salary panel.
//
// Mirrors the bot's /salary-adjustment + /update-sal commands so the operator can
// manage salaries from the website: see who is LOCKED at what, see who the auto-calc
// (SalSheet col N) says SHOULD MOVE UP vs the locked value (col O), and adjust / unlock.
//
// SalSheet columns (verified live): B=name, N=auto-calc salary (FORMULA, read-only),
// O=locked salary (RAW — the value the salary-lock writes), P=Discord ID. We only ever
// WRITE column O (USER_ENTERED), exactly like the bot commands. The manual_salaries
// lock table is the bot-owned override the auto-lock SKIPS; we read+write it here too.

import { JWT } from 'google-auth-library'
import { query } from './db'

const SPREADSHEET_ID = process.env.SHEET_ID_PLAYERS || '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs'
const SAL_TAB = 'SalSheet'
// The salary-change announcement channel (same as the bot commands).
const SALARY_ANNOUNCEMENT_CHANNEL_ID = '1430752024630268024'

// 0-based column indices within a B:P read: B=0(name) … N=12(calc) O=13(locked) P=14(discord).
const COL = { name: 0, calc: 12, locked: 13, discord: 14 }

// Use the same JWT credentials as lib/salarySheet.js and call the Sheets REST API
// directly (the website depends on google-auth-library, not googleapis). This mirrors
// the bot's values.get / values.update (USER_ENTERED) exactly.
function getJWT() {
  const client_email = process.env.GOOGLE_CLIENT_EMAIL
  const private_key = process.env.GOOGLE_PRIVATE_KEY
  if (!client_email || !private_key) {
    throw new Error('Google Sheets creds not configured (GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY)')
  }
  return new JWT({
    email: client_email,
    key: private_key.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

async function valuesGet(range) {
  const auth = getJWT()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`
  const res = await auth.request({ url })
  return res.data?.values || []
}

async function valuesUpdate(range, value) {
  const auth = getJWT()
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`
  await auth.request({ url, method: 'PUT', data: { values: [[value]] } })
}

// Parse a sheet cell into a number (ignore a stray leading apostrophe), else null.
function num(v) {
  if (v == null) return null
  const s = String(v).trim().replace(/^'/, '')
  if (!s) return null
  const f = parseFloat(s)
  return Number.isNaN(f) ? null : f
}

// League salary → division thresholds (per the bot's /changed-sals grouping).
export function divisionForSalary(v) {
  const n = parseFloat(v)
  if (Number.isNaN(n)) return null
  if (n >= 16) return 'Majors'
  if (n >= 13) return 'AAA'
  return 'AA'
}

// Read the SalSheet → Map<discordId, {rowIndex, name, calc(N), locked(O), lockedRaw}>.
export async function readSalSheet() {
  const rows = await valuesGet(`${SAL_TAB}!B2:P`)
  const byDiscord = new Map()
  rows.forEach((row, i) => {
    const discord = String(row[COL.discord] || '').trim()
    if (!discord) return
    byDiscord.set(discord, {
      rowIndex: i + 2, // B2 is sheet row 2
      name: String(row[COL.name] || '').trim(),
      calc: num(row[COL.calc]),       // N (auto)
      locked: num(row[COL.locked]),   // O (locked)
      lockedRaw: String(row[COL.locked] || '').trim(),
    })
  })
  return byDiscord
}

export async function findSalRowByDiscord(discordId) {
  const map = await readSalSheet()
  return map.get(String(discordId).trim()) || null
}

// Write SalSheet col O (the locked salary) for a row. USER_ENTERED so a number lands
// as a number (matches the bot commands).
export async function writeSalaryO(rowIndex, value) {
  await valuesUpdate(`${SAL_TAB}!O${rowIndex}`, value)
}

// The board the panel shows: every LOCKED player (manual_salaries) joined to their
// sheet N/O, with a state flag — should_move_up (N>O), locked_above (N<O), in_sync.
export async function listSalaryBoard() {
  const [sheetMap, locks] = await Promise.all([
    readSalSheet(),
    query(
      `SELECT discord_id, username, salary, set_by_username, updated_at
         FROM manual_salaries`
    ).catch(() => ({ rows: [] })),
  ])
  const board = []
  for (const lock of locks.rows) {
    const did = String(lock.discord_id)
    const s = sheetMap.get(did) || {}
    const locked = s.locked != null ? s.locked : num(lock.salary)
    const calc = s.calc != null ? s.calc : null
    let state = 'in_sync'
    if (calc == null) state = 'no_calc'
    else if (locked == null) state = 'no_calc'
    else if (calc > locked) state = 'should_move_up'
    else if (calc < locked) state = 'locked_above'
    board.push({
      discordId: did,
      name: s.name || lock.username || null,
      rowIndex: s.rowIndex || null,
      locked,
      calc,
      delta: (calc != null && locked != null) ? +(calc - locked).toFixed(2) : null,
      state,
      division: divisionForSalary(locked != null ? locked : calc),
      lockedBy: lock.set_by_username || null,
      lockedAt: lock.updated_at || null,
    })
  }
  const rank = { should_move_up: 0, locked_above: 1, no_calc: 2, in_sync: 3 }
  board.sort((a, b) =>
    (rank[a.state] - rank[b.state]) ||
    ((b.delta || 0) - (a.delta || 0)) ||
    String(a.name || '').localeCompare(String(b.name || '')))
  return {
    board,
    counts: {
      total: board.length,
      shouldMoveUp: board.filter((b) => b.state === 'should_move_up').length,
      lockedAbove: board.filter((b) => b.state === 'locked_above').length,
    },
  }
}

// Upsert the manual-salary lock (mirrors the bot's ManualSalaryDB.set).
export async function upsertLock(discordId, name, salary, setById, setByName) {
  await query(
    `INSERT INTO manual_salaries (discord_id, username, salary, set_by, set_by_username)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_id) DO UPDATE SET
       username = EXCLUDED.username, salary = EXCLUDED.salary,
       set_by = EXCLUDED.set_by, set_by_username = EXCLUDED.set_by_username,
       updated_at = CURRENT_TIMESTAMP`,
    [String(discordId), name || 'Unknown', salary, String(setById || 'website'), setByName || 'admin']
  )
}

export async function deleteLock(discordId) {
  const r = await query(
    `DELETE FROM manual_salaries WHERE discord_id = $1 RETURNING *`, [String(discordId)]
  )
  return r.rows.length > 0
}

// Queue a salary announcement for the bot to post (it drains trn_outbox every ~15s and
// swaps {mention} → the real <@discord_id>). Best-effort: never block the action.
export async function enqueueSalaryAnnounce(discordId, message) {
  try {
    await query(
      `INSERT INTO trn_outbox (run_id, row_index, discord_id, channel_id, kind, message)
       VALUES (NULL, NULL, $1, $2, 'salary', $3)`,
      [discordId ? String(discordId) : null, SALARY_ANNOUNCEMENT_CHANNEL_ID, String(message)]
    )
    return true
  } catch {
    return false // announce is non-critical
  }
}

// Build the salary-change message (mirrors salaryAdjustment.js determineSalaryChange).
// Uses the {mention} token so the bot renders the real mention.
export function salaryChangeMessage(oldSalary, newSalary) {
  const oldStr = oldSalary == null ? '' : String(oldSalary).trim()
  const isNew = oldStr === '' || oldStr.toUpperCase() === 'NS' || Number.isNaN(parseFloat(oldStr))
  if (isNew) return { direction: 'new', message: `{mention} you are a **${newSalary}** salary` }
  const o = parseFloat(oldStr)
  const n = parseFloat(newSalary)
  if (n > o) return { direction: 'up', message: `{mention} has been manually moved **up** from a **${oldStr}** to **${newSalary}**` }
  if (n < o) return { direction: 'down', message: `{mention} has been manually moved **down** from a **${oldStr}** to **${newSalary}**` }
  return { direction: 'same', message: `{mention}'s salary remains at **${newSalary}**` }
}
