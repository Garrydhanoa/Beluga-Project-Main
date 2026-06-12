/**
 * app_config — tiny key/value store shared by bot + website for admin-set
 * settings (e.g. stats_channel_id for FF-strike pings + game-of-the-week).
 */
const { pool, isDatabaseAvailable } = require('./database');
const Logger = require('./logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function ensureAppConfig() {
    if (!db()) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `).catch((e) => Logger.error('ensureAppConfig failed', e));
}

async function getConfig(key, fallback = null) {
    if (!db()) return fallback;
    try {
        const r = await pool.query(`SELECT value FROM app_config WHERE key = $1`, [key]);
        return r.rows[0]?.value ?? fallback;
    } catch {
        return fallback;
    }
}

async function setConfig(key, value) {
    if (!db()) return false;
    await pool.query(
        `INSERT INTO app_config (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [key, value == null ? null : String(value)]
    );
    return true;
}

module.exports = { ensureAppConfig, getConfig, setConfig };
