/**
 * Side assignment + player auto-matching for a parsed series.
 *
 * Extracted verbatim from flow.js so the interactive captain/staff report and the
 * website's manual-report importer share ONE copy of this logic. flow.js still
 * owns what to DO with the guesses (a human always confirms the sides there);
 * the importer applies them directly and lets staff correct afterwards.
 */

const statsStore = require('../statsStore');

/**
 * Fill in best-guess matches: remembered account link (if on roster) else name match.
 * @param {Array} slots  from initSlots() — mutated in place and returned
 * @param {Array<{discordId:string, displayName:string}>} roster
 */
async function autoSuggest(slots, roster) {
    const byName = new Map(roster.map((m) => [String(m.displayName || '').toLowerCase(), m.discordId]));
    const rosterIds = new Set(roster.map((m) => m.discordId));
    for (const slot of slots) {
        const remembered = await statsStore.resolveDiscordByAccount(slot.platform, slot.platformId);
        if (remembered && rosterIds.has(remembered)) { slot.discordId = remembered; continue; }
        const nm = String(slot.name || '').toLowerCase();
        if (byName.has(nm)) { slot.discordId = byName.get(nm); continue; }
        const partial = roster.find((m) => nm && String(m.displayName || '').toLowerCase().includes(nm));
        if (partial) slot.discordId = partial.discordId;
    }
    return slots;
}

/**
 * Decide which parsed cluster (0/1) is the home team.
 * A remembered account link is worth 2, a display-name match 1.
 * @returns {Promise<{homeIdx:0|1, confident:boolean}>}
 */
async function assignSides(parsed, homeRoster, awayRoster) {
    const homeSet = new Set(homeRoster.map((m) => m.discordId));
    const awaySet = new Set(awayRoster.map((m) => m.discordId));
    const homeNames = new Set(homeRoster.map((m) => String(m.displayName || '').toLowerCase()));
    const awayNames = new Set(awayRoster.map((m) => String(m.displayName || '').toLowerCase()));
    const affinity = [];
    for (const team of parsed.teams) {
        let h = 0; let a = 0;
        for (const p of team.players) {
            const did = await statsStore.resolveDiscordByAccount(p.platform, p.platformId);
            if (did && homeSet.has(did)) h += 2;
            if (did && awaySet.has(did)) a += 2;
            const nm = String((p.names && p.names[0]) || '').toLowerCase();
            if (nm && homeNames.has(nm)) h += 1;
            if (nm && awayNames.has(nm)) a += 1;
        }
        affinity.push({ h, a });
    }
    // team0 home-leaning and team1 away-leaning (or vice-versa) and they disagree → confident.
    const t0Home = affinity[0].h - affinity[0].a;
    const t1Home = affinity[1].h - affinity[1].a;
    if (t0Home > 0 && t1Home < 0) return { homeIdx: 0, confident: true };
    if (t1Home > 0 && t0Home < 0) return { homeIdx: 1, confident: true };
    if (t0Home !== t1Home) return { homeIdx: t0Home > t1Home ? 0 : 1, confident: false };
    return { homeIdx: 0, confident: false };
}

module.exports = { autoSuggest, assignSides };
