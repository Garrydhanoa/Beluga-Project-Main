/**
 * On-field salary cap validation (operator rule B2): for EACH game, the players
 * who actually played on each team must be within their division's on-field cap.
 * If any game on either side is over cap — or a matched player has no salary —
 * the report is BLOCKED and salary crew is pinged. Caps live in
 * season_config.onfield_caps (per division); salaries come from a resolver.
 *
 * If the salary SOURCE itself is unavailable (e.g. the sheet is down), we cannot
 * verify, so we warn+log instead of blocking every report.
 */

const { pool, isDatabaseAvailable } = require('../../utils/database');
const { getSalaryMap } = require('./salarySheet');
const Logger = require('../../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

/**
 * Build a salary resolver: discordId -> number | null.
 * Primary source = the league SalSheet (where everyone's salary actually lives);
 * manual_salaries is layered on top as an override (matches the website).
 * sourceOk is true if EITHER source loaded, so a transient sheet outage with a
 * cached map still verifies; a total failure → sourceOk false (warn, don't block).
 * @returns {Promise<{ sourceOk: boolean, salaryOf: (discordId:string)=>(number|null) }>}
 */
async function buildSalaryResolver() {
    const map = new Map();
    let sourceOk = false;

    // 1) SalSheet (primary).
    try {
        const sheet = await getSalaryMap();
        if (sheet.ok) {
            for (const [k, v] of sheet.map) map.set(k, v);
            sourceOk = true;
        }
    } catch (err) {
        Logger.error('buildSalaryResolver: SalSheet read failed', err);
    }

    // 2) manual_salaries (override on top of the sheet).
    if (db()) {
        try {
            const r = await pool.query(`SELECT discord_id, salary FROM manual_salaries`);
            for (const row of r.rows) {
                const n = Number(row.salary);
                if (Number.isFinite(n)) map.set(String(row.discord_id), n);
            }
            sourceOk = true;
        } catch (err) {
            Logger.error('buildSalaryResolver: manual_salaries read failed', err);
        }
    }

    return {
        sourceOk,
        salaryOf: (discordId) => {
            if (!discordId) return null;
            return map.has(String(discordId)) ? map.get(String(discordId)) : null;
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.division
 * @param {object} opts.caps        season_config.onfield_caps (per division)
 * @param {Array}  opts.games       [{ gameNumber, homePlayers:[{discordId,name}], awayPlayers:[...] }]
 * @param {function} opts.salaryOf  discordId -> number|null
 * @param {boolean} opts.sourceOk   whether salary data could be read at all
 * @param {object} [opts.teamNames] { home, away } for messages
 */
function checkSeriesCaps({ division, caps, games, salaryOf, sourceOk, teamNames = {} }) {
    const capRaw = caps ? caps[division] : undefined;
    const cap = capRaw != null && capRaw !== '' ? Number(capRaw) : null;

    // Can't verify → don't block, just report so the flow can warn+log.
    if (!sourceOk || cap == null || !Number.isFinite(cap)) {
        return { ok: true, blocked: false, canVerify: false, cap, violations: [], missing: [] };
    }

    const violations = [];
    const missing = [];
    const sideName = (side) => (side === 'home' ? (teamNames.home || 'Home') : (teamNames.away || 'Away'));

    for (const g of games) {
        for (const side of ['home', 'away']) {
            const players = side === 'home' ? (g.homePlayers || []) : (g.awayPlayers || []);
            let total = 0;
            let hasMissing = false;
            for (const p of players) {
                const sal = salaryOf(p.discordId);
                if (sal == null || !Number.isFinite(sal)) {
                    hasMissing = true;
                    missing.push({ game: g.gameNumber, side, team: sideName(side), name: p.name, discordId: p.discordId });
                } else {
                    total += sal;
                }
            }
            if (!hasMissing && total > cap) {
                violations.push({
                    game: g.gameNumber, side, team: sideName(side),
                    total: Math.round(total * 100) / 100, cap, over: Math.round((total - cap) * 100) / 100,
                });
            }
        }
    }

    const blocked = violations.length > 0 || missing.length > 0;
    return { ok: !blocked, blocked, canVerify: true, cap, violations, missing };
}

module.exports = { buildSalaryResolver, checkSeriesCaps };
