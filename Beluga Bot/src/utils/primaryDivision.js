/**
 * Which division / team is a player *actually* in?  (CommonJS mirror)
 *
 * A **GM is rostered on all three of their franchise's teams** (AA, AAA and
 * Majors), so 14 players have three equally-active roster rows and something has
 * to choose. Picking alphabetically is what made Tranq read as AA; picking the
 * HIGHEST division is also wrong (Knuck0ball, erase and JOKER are on all three
 * but play AAA). The salary sheet's `League` column is the signal that holds —
 * it matched where each GM really played 7/7 times, and it's what `/whois`
 * already uses.
 *
 * Exact mirror of `beluga-league-main/lib/primaryDivision.js` — keep in sync.
 */

/** Majors > AAA > AA. Higher number wins. Unknown divisions sort last. */
function divisionRank(division) {
    const d = String(division || '').trim().toLowerCase();
    if (d.startsWith('major')) return 3;
    if (d === 'aaa') return 2;
    if (d === 'aa') return 1;
    return 0;
}

/**
 * Divisions are stored CAPITALIZED (`AA` / `AAA` / `Majors`) in every table.
 * Never compare them with ===.
 */
function sameDivision(a, b) {
    const ra = divisionRank(a);
    const rb = divisionRank(b);
    if (ra && rb) return ra === rb;
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** The division a player belongs to, best signal first. */
function primaryDivision({ sheetLeague = null, statsDivision = null, rosterRows = [] } = {}) {
    if (sheetLeague) return sheetLeague;
    if (statsDivision) return statsDivision;

    const divisions = [...new Set((rosterRows || []).map((r) => r && r.division).filter(Boolean))];
    if (!divisions.length) return null;
    if (divisions.length === 1) return divisions[0];

    // Rostered in several divisions with no sheet League and no games played —
    // nothing to go on. Return null rather than guessing; some GMs are pure
    // staff who have never played.
    return null;
}

/**
 * The single roster row representing this player, so team/teamId/role agree with
 * the division we report. Returns null when they hold no active roster slot.
 */
function pickPrimaryRoster(rosterRows = [], { sheetLeague = null, statsDivision = null } = {}) {
    const rows = (rosterRows || []).filter(Boolean);
    if (!rows.length) return null;
    if (rows.length === 1) return rows[0];

    const target = primaryDivision({ sheetLeague, statsDivision, rosterRows: rows });
    const match = rows.find((r) => sameDivision(r.division, target));
    if (match) return match;

    return rows.slice().sort((a, b) => divisionRank(b.division) - divisionRank(a.division))[0];
}

module.exports = { divisionRank, sameDivision, primaryDivision, pickPrimaryRoster };
