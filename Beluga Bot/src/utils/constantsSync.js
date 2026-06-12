/**
 * DB-hydration for the legacy team constants — the bridge that makes EVERY
 * command DB-driven without rewriting them.
 *
 * All transaction commands read ROLES.GM_ROLES / TEAM_ROLES / NP_ROLES /
 * TEAM_NAMES / TEAM_COLORS at execute time. This module MUTATES those exported
 * objects in place from the database (active-season teams + their franchises):
 *   TEAM_ROLES[DIV][name] = teams.discord_role_id
 *   GM_ROLES[name]        = franchise gm_role_id
 *   NP_ROLES[name]        = franchise np_role_id
 *   TEAM_NAMES            = active season's team names
 *   TEAM_COLORS[name]     = franchise color
 * Called at bot startup (+ every 5 min) and by registerCommands before command
 * files are required, so slash-command choices are built from the DB too.
 * If the DB is unreachable, the hardcoded values simply remain (safe fallback).
 */

const { pool, isDatabaseAvailable } = require('./database');
const { ROLES, TEAM_ROLES, NP_ROLES, TEAM_NAMES, TEAM_COLORS } = require('../constants/roles');
const Logger = require('./logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

function clearObject(obj) {
    for (const k of Object.keys(obj)) delete obj[k];
}

/**
 * @returns {Promise<{ok:boolean, teams:number, note?:string}>}
 */
async function syncTeamConstants() {
    if (!db()) return { ok: false, teams: 0, note: 'db unavailable — constants kept' };
    try {
        const season = await pool.query(
            `SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`
        );
        const seasonId = season.rows[0]?.id;
        if (!seasonId) return { ok: false, teams: 0, note: 'no active season — constants kept' };

        const r = await pool.query(
            `SELECT t.name, t.division, t.discord_role_id,
                COALESCE(f.gm_role_id, t.discord_gm_role_id) AS gm_role_id,
                COALESCE(f.np_role_id, t.discord_np_role_id) AS np_role_id,
                f.color
             FROM teams t
             LEFT JOIN team_franchises f ON f.id = t.franchise_id
             WHERE t.season_id = $1 AND t.is_active = TRUE
             ORDER BY t.name`,
            [seasonId]
        );
        if (!r.rows.length) return { ok: false, teams: 0, note: 'no active teams — constants kept' };

        // Rebuild in place so every module holding a reference sees fresh data.
        clearObject(TEAM_ROLES);
        TEAM_ROLES.MAJORS = {};
        TEAM_ROLES.AAA = {};
        TEAM_ROLES.AA = {};
        clearObject(ROLES.GM_ROLES);
        clearObject(NP_ROLES);
        clearObject(TEAM_COLORS);
        TEAM_NAMES.length = 0;

        const seen = new Set();
        for (const t of r.rows) {
            const divKey = t.division === 'Majors' ? 'MAJORS' : String(t.division).toUpperCase();
            if (!TEAM_ROLES[divKey]) TEAM_ROLES[divKey] = {};
            if (t.discord_role_id) TEAM_ROLES[divKey][t.name] = t.discord_role_id;
            if (t.gm_role_id) ROLES.GM_ROLES[t.name] = t.gm_role_id;
            if (t.np_role_id) NP_ROLES[t.name] = t.np_role_id;
            if (t.color) {
                const n = parseInt(String(t.color).replace('#', ''), 16);
                if (Number.isFinite(n)) TEAM_COLORS[t.name] = n;
            }
            if (!seen.has(t.name)) {
                seen.add(t.name);
                TEAM_NAMES.push(t.name);
            }
        }
        return { ok: true, teams: r.rows.length };
    } catch (err) {
        Logger.error('syncTeamConstants failed (hardcoded constants kept)', err);
        return { ok: false, teams: 0, note: err.message };
    }
}

/** Boot + periodic refresh (role edits on the website go live within minutes). */
function startTeamConstantsSync(intervalMs = 5 * 60 * 1000) {
    syncTeamConstants().then((res) =>
        Logger.info(`Team constants ${res.ok ? `hydrated from DB (${res.teams} team rows)` : `NOT hydrated: ${res.note}`}`)
    );
    setInterval(() => syncTeamConstants(), intervalMs);
}

module.exports = { syncTeamConstants, startTeamConstantsSync };
