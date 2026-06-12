/**
 * AI settings persistence.
 *
 * Stores the currently-selected AI provider so it survives bot restarts.
 * Backed by a tiny key/value table in Postgres (when DATABASE_URL is set),
 * with an in-memory cache so reads are instant. If there is no database the
 * selection still works for the current process, it just resets on restart.
 */

const Logger = require('./logger');
const { pool, isDatabaseAvailable } = require('./database');

// Channel where the bot posts real-time AI activity / fallback logs.
const AI_LOG_CHANNEL_ID = '1403961461776060416';

// Valid providers the bot can switch between.
const VALID_PROVIDERS = ['google', 'groq', 'mistral'];
const DEFAULT_PROVIDER = 'google';

const SETTINGS_KEY = 'ai_active_provider';

let cachedProvider = DEFAULT_PROVIDER;
let tableReady = false;

async function ensureTable() {
    if (tableReady || !isDatabaseAvailable()) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_settings (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        tableReady = true;
    } catch (error) {
        Logger.warning('Could not ensure bot_settings table:', error.message);
    }
}

/**
 * Load the persisted provider into the cache. Call once at startup.
 */
async function initAISettings() {
    if (!isDatabaseAvailable()) {
        Logger.info(`AI settings: no database, using default provider "${DEFAULT_PROVIDER}" (resets on restart)`);
        return cachedProvider;
    }
    try {
        await ensureTable();
        const result = await pool.query('SELECT value FROM bot_settings WHERE key = $1', [SETTINGS_KEY]);
        if (result.rows.length > 0 && VALID_PROVIDERS.includes(result.rows[0].value)) {
            cachedProvider = result.rows[0].value;
            Logger.info(`AI settings: loaded active provider "${cachedProvider}" from database`);
        } else {
            Logger.info(`AI settings: no saved provider, using default "${DEFAULT_PROVIDER}"`);
        }
    } catch (error) {
        Logger.warning('AI settings: failed to load from database, using default:', error.message);
    }
    return cachedProvider;
}

function getActiveProvider() {
    return cachedProvider;
}

/**
 * Persist + cache the new active provider. Returns true on a valid switch.
 */
async function setActiveProvider(provider) {
    if (!VALID_PROVIDERS.includes(provider)) return false;
    cachedProvider = provider;
    if (isDatabaseAvailable()) {
        try {
            await ensureTable();
            await pool.query(
                `INSERT INTO bot_settings (key, value, updated_at)
                 VALUES ($1, $2, CURRENT_TIMESTAMP)
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
                [SETTINGS_KEY, provider]
            );
        } catch (error) {
            Logger.warning('AI settings: failed to persist provider (kept in memory):', error.message);
        }
    }
    return true;
}

module.exports = {
    AI_LOG_CHANNEL_ID,
    VALID_PROVIDERS,
    DEFAULT_PROVIDER,
    initAISettings,
    getActiveProvider,
    setActiveProvider,
};
