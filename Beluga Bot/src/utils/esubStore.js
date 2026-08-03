/**
 * E-sub (one-day sub) usage — the single DB-backed source of truth.
 *
 * Counts live in `team_esubs`, keyed by (season_id, team_id). Because a team row
 * is per (season, division, name), the count is inherently per-division AND
 * resets itself the moment a new season is started: the new season has new team
 * ids, so there are no rows, so every team reads 0.
 *
 * This replaces the "One Day Sub Tracker" tab of the salary spreadsheet, which
 * addressed cells by `TEAM_NAMES.indexOf(team)` → column B+i. That header row
 * had drifted (it still listed Fallen Angels/Valkyries/Acid Esports/Wizards/
 * Alchemy Esports while the code used the newer constants list), so reads and
 * writes landed on some other team's column entirely.
 *
 * The per-season limit lives on `season_config.esub_limit` (website-owned,
 * editable from the admin panel). Every read here degrades to DEFAULT_LIMIT so
 * the bot keeps working if it is deployed ahead of the website migration.
 */

const { pool, isDatabaseAvailable } = require('./database');
const Logger = require('./logger');

const DEFAULT_ESUB_LIMIT = 3;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

/** Per-season e-sub allowance (season_config.esub_limit → 3). */
async function getEsubLimit(seasonId) {
    if (!db() || !seasonId) return DEFAULT_ESUB_LIMIT;
    try {
        const r = await pool.query('SELECT esub_limit FROM season_config WHERE season_id = $1', [seasonId]);
        const n = Number(r.rows[0]?.esub_limit);
        return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ESUB_LIMIT;
    } catch {
        // Column/table not migrated yet — fall back rather than block a signing.
        return DEFAULT_ESUB_LIMIT;
    }
}

/** E-subs already used by one team this season. */
async function getEsubUsed(seasonId, teamId) {
    if (!db() || !seasonId || !teamId) return 0;
    try {
        const r = await pool.query(
            'SELECT used FROM team_esubs WHERE season_id = $1 AND team_id = $2',
            [seasonId, teamId]
        );
        return Number(r.rows[0]?.used) || 0;
    } catch (err) {
        Logger.error('getEsubUsed failed', err);
        return 0;
    }
}

/**
 * Consume one e-sub, atomically and only if it stays within `limit`.
 * @returns {Promise<number|null>} the new count, or null when the team is
 *   already at the limit (nothing was written).
 */
async function consumeEsub(seasonId, teamId, limit, actor = null) {
    if (!db() || !seasonId || !teamId) return null;
    const cap = Number.isFinite(limit) ? limit : DEFAULT_ESUB_LIMIT;
    // The WHERE below only guards the DO UPDATE branch, so a cap of 0 has to be
    // rejected here or the very first INSERT would slip a 1 through.
    if (cap < 1) return null;
    const r = await pool.query(
        `INSERT INTO team_esubs (season_id, team_id, used, updated_by)
         VALUES ($1, $2, 1, $4)
         ON CONFLICT (season_id, team_id) DO UPDATE
            SET used = team_esubs.used + 1, updated_at = now(), updated_by = $4
          WHERE team_esubs.used + 1 <= $3
         RETURNING used`,
        [seasonId, teamId, cap, actor]
    );
    // No row back = the WHERE on the DO UPDATE rejected it (already at cap).
    return r.rows.length ? Number(r.rows[0].used) : null;
}

/**
 * Give one e-sub back (cancel). Never goes below 0.
 * @returns {Promise<number>} the new count.
 */
async function refundEsub(seasonId, teamId, actor = null) {
    if (!db() || !seasonId || !teamId) return 0;
    const r = await pool.query(
        `INSERT INTO team_esubs (season_id, team_id, used, updated_by)
         VALUES ($1, $2, 0, $3)
         ON CONFLICT (season_id, team_id) DO UPDATE
            SET used = GREATEST(0, team_esubs.used - 1), updated_at = now(), updated_by = $3
         RETURNING used`,
        [seasonId, teamId, actor]
    );
    return Number(r.rows[0]?.used) || 0;
}

/** Set an exact count (admin correction). */
async function setEsubUsed(seasonId, teamId, used, actor = null) {
    if (!db() || !seasonId || !teamId) return 0;
    const value = Math.max(0, Math.trunc(Number(used) || 0));
    const r = await pool.query(
        `INSERT INTO team_esubs (season_id, team_id, used, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (season_id, team_id) DO UPDATE
            SET used = EXCLUDED.used, updated_at = now(), updated_by = $4
         RETURNING used`,
        [seasonId, teamId, value, actor]
    );
    return Number(r.rows[0]?.used) || 0;
}

/**
 * Every active team in a season with its e-sub usage (0 when it has no row).
 * @returns {Promise<Array<{teamId, name, division, used}>>}
 */
async function getSeasonEsubUsage(seasonId) {
    if (!db() || !seasonId) return [];
    try {
        const r = await pool.query(
            `SELECT t.id, t.name, t.division, COALESCE(e.used, 0) AS used
             FROM teams t
             LEFT JOIN team_esubs e ON e.team_id = t.id AND e.season_id = t.season_id
             WHERE t.season_id = $1 AND t.is_active = TRUE
             ORDER BY CASE t.division WHEN 'Majors' THEN 0 WHEN 'AAA' THEN 1 ELSE 2 END, t.name`,
            [seasonId]
        );
        return r.rows.map((x) => ({
            teamId: x.id, name: x.name, division: x.division, used: Number(x.used) || 0,
        }));
    } catch (err) {
        Logger.error('getSeasonEsubUsage failed', err);
        return [];
    }
}

module.exports = {
    DEFAULT_ESUB_LIMIT,
    getEsubLimit,
    getEsubUsed,
    consumeEsub,
    refundEsub,
    setEsubUsed,
    getSeasonEsubUsage,
};
