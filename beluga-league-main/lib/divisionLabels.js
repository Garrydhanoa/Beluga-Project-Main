// Display names for the three divisions.
//
// The DB, the SalSheet (column R), the trn-scraper and every comparison in code
// keep the stored codes 'AA' / 'AAA' / 'Majors' — those never change. Only what
// people SEE goes through here (S11 rename, applies to every season):
//   Majors → Premier · AAA → Contenders · AA → Academy
// Mirrored in Beluga Bot/src/utils/divisionLabels.js — keep the two in sync.

export const DIVISION_CODES = ['Majors', 'AAA', 'AA']

export const DIVISION_LABELS = {
  Majors: 'Premier',
  AAA: 'Contenders',
  AA: 'Academy',
}

// Salary bands + on-field caps as of Season 11 (display/AI copy only — the
// real division mapping is SalSheet column R; the real caps are
// season_config.onfield_caps).
export const DIVISION_BANDS = {
  Majors: { min: 17, max: 21, cap: 55, text: '17+' },
  AAA: { min: 14.75, max: 16.75, cap: 47.5, text: '14.75–16.75' },
  AA: { min: 12.5, max: 14.5, cap: 40.5, text: '12.5–14.5' },
}

// Any casing / legacy spelling → stored code ('Majors' | 'AAA' | 'AA'), or null.
export function divisionCode(value) {
  const s = String(value ?? '').trim().toLowerCase()
  if (!s) return null
  if (s.startsWith('major') || s === 'premier') return 'Majors'
  if (s === 'aaa' || s === 'contenders') return 'AAA'
  if (s === 'aa' || s === 'academy') return 'AA'
  return null
}

// Stored code (any casing) → display name. Unknown values pass through.
export function divisionLabel(value) {
  const code = divisionCode(value)
  return code ? DIVISION_LABELS[code] : (value ?? '')
}

// Upper-case display name for headers/pills ('PREMIER').
export function divisionLabelUpper(value) {
  return String(divisionLabel(value)).toUpperCase()
}
