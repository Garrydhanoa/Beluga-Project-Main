/**
 * Assistant GM roles (S11).
 *
 * Fills ROLES.AGM_ROLES[teamName] = team_franchises.agm_role_id for the active
 * season's teams — the same shape constantsSync gives ROLES.GM_ROLES (that file
 * is off-limits, so this is a sibling that runs beside it). Every command that
 * lets a GM act reads both maps through utils/franchiseManagers.js.
 *
 * The column is read through to_jsonb(), so a bot deployed before the website's
 * migration (no agm_role_id column yet) simply sees no AGM roles instead of erroring.
 */

const { pool, isDatabaseAvailable } = require('./database');
const Logger = require('./logger');
const { ROLES } = require('../constants/roles');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function syncAgmRoles() {
    if (!db()) return { ok: false, teams: 0, note: 'db unavailable' };
    try {
        const r = await pool.query(
            `SELECT DISTINCT t.name, (to_jsonb(f) ->> 'agm_role_id') AS agm_role_id
             FROM teams t
             JOIN seasons s ON s.id = t.season_id AND s.status = 'active'
             JOIN team_franchises f ON f.id = t.franchise_id
             WHERE t.is_active = TRUE`
        );
        for (const k of Object.keys(ROLES.AGM_ROLES)) delete ROLES.AGM_ROLES[k];
        let n = 0;
        for (const row of r.rows) {
            if (row.agm_role_id) { ROLES.AGM_ROLES[row.name] = row.agm_role_id; n++; }
        }
        return { ok: true, teams: n };
    } catch (err) {
        Logger.error('syncAgmRoles failed (AGM roles kept as they were)', err);
        return { ok: false, teams: 0, note: err.message };
    }
}

/** Boot + periodic refresh (an AGM role saved on the website goes live within minutes). */
function startAgmRoleSync(intervalMs = 5 * 60 * 1000) {
    syncAgmRoles().then((res) => {
        if (res.ok) Logger.info(`AGM roles synced (${res.teams} team${res.teams === 1 ? '' : 's'} with an AGM role)`);
    });
    return setInterval(() => { syncAgmRoles(); }, intervalMs);
}

module.exports = { syncAgmRoles, startAgmRoleSync };
