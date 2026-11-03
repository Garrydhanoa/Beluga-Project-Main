/**
 * "BOD (13.5) Barry" → "Barry", "Blezzy | RFA" → "Blezzy". The first half is the rule
 * `playerName` uses in src/ai/leagueData.js; the free-agent tag only matters in print.
 */
function cleanName(name) {
    const raw = String(name || '').trim();
    if (!raw) return 'someone';
    return raw.replace(/^[^()]*\([^)]*\)\s*/, '').replace(/\s*\|\s*R?FA\s*$/i, '').trim() || raw;
}

module.exports = { cleanName };
