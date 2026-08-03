/**
 * Which division / team is a player *actually* in?
 *
 * Normally trivial — one active roster row. But a **GM is rostered on all three
 * of their franchise's teams** (AA, AAA and Majors), so 14 players in the league
 * have three equally-active roster rows and something has to choose.
 *
 * Getting that choice wrong is what made Tranq's profile say AA: the query
 * ordered by `t.division` and `'AA' < 'AAA' < 'Majors'` alphabetically, so the
 * first row won. Picking the HIGHEST division instead is also wrong — Knuck0ball,
 * erase and JOKER are each rostered on all three but actually play AAA.
 *
 * The signal that holds is the salary sheet's `League` column: checked against
 * `stats_player_season`, it matched the division each GM really played in 7/7
 * times. It's also what `/whois` has always used, so this keeps the site and the
 * bot telling the same story.
 *
 * Mirrored in the bot at `Beluga Bot/src/utils/primaryDivision.js` — keep the two
 * in sync.
 */

/** Majors > AAA > AA. Higher number wins. Unknown divisions sort last. */
export function divisionRank(division) {
  const d = String(division || '').trim().toLowerCase()
  if (d.startsWith('major')) return 3
  if (d === 'aaa') return 2
  if (d === 'aa') return 1
  return 0
}

/**
 * Divisions are stored CAPITALIZED (`AA` / `AAA` / `Majors`) in every table —
 * teams, stats_player_season, stats_team_season, stats_series, week_threads,
 * schedule_matches, power_rankings. Never compare them with ===.
 */
export function sameDivision(a, b) {
  const ra = divisionRank(a)
  const rb = divisionRank(b)
  if (ra && rb) return ra === rb
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

/**
 * The division a player belongs to, best signal first.
 *
 * @param {object}   opts
 * @param {string?}  opts.sheetLeague   SalSheet "League" (already normalized by salarySheet.js)
 * @param {string?}  opts.statsDivision division from stats_player_season for the ACTIVE season
 * @param {object[]} opts.rosterRows    active-season roster rows, each with a `division`
 */
export function primaryDivision({ sheetLeague = null, statsDivision = null, rosterRows = [] } = {}) {
  if (sheetLeague) return sheetLeague
  if (statsDivision) return statsDivision

  const divisions = [...new Set(
    (rosterRows || []).map((r) => r?.division).filter(Boolean)
  )]
  if (!divisions.length) return null
  if (divisions.length === 1) return divisions[0]

  // Rostered in several divisions with no sheet League and no games played —
  // there is genuinely nothing to go on. Return null rather than guessing: some
  // GMs are pure staff who have never played, and inventing a division for them
  // is how this bug started. Callers should render "no division", not a default.
  return null
}

/**
 * The single roster row that represents this player, so `currentTeam`,
 * `currentTeamId` and `role` all agree with the division we report. Without
 * this, a GM's profile links to their AA team while claiming to be Majors.
 *
 * Returns null when they hold no active roster slot (a genuine free agent).
 */
export function pickPrimaryRoster(rosterRows = [], { sheetLeague = null, statsDivision = null } = {}) {
  const rows = (rosterRows || []).filter(Boolean)
  if (!rows.length) return null
  if (rows.length === 1) return rows[0]

  const target = primaryDivision({ sheetLeague, statsDivision, rosterRows: rows })
  const match = rows.find((r) => sameDivision(r.division, target))
  if (match) return match

  // Sheet says a division they aren't rostered in (stale sheet, mid-move).
  // Fall back to the highest division they ARE on rather than dropping them.
  return rows.slice().sort((a, b) => divisionRank(b.division) - divisionRank(a.division))[0]
}
