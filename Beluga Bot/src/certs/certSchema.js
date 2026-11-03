/**
 * GM / AGM rulebook certification — tables.
 *
 * MIRRORED in beluga-league-main/lib/leagueSchema.js (the `cert_*` steps). Keep
 * the two copies in sync: the website writes attempts, questions, requests,
 * grants and decisions; the bot posts the staff notices, tallies Salary Crew
 * reactions and carries out approvals (roles + DM).
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

// Same defaults the website falls back to (site_config key 'certification').
const DEFAULT_SETTINGS = {
    passPct: 90,
    noticeChannelId: '1299015210702737429',
    gmRoleId: '1419411413809631314',
    agmRoleId: '',
    gmOpen: false,
    agmOpen: false,
};

const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS cert_questions (
        id SERIAL PRIMARY KEY,
        prompt TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'mc',
        options JSONB NOT NULL DEFAULT '[]'::jsonb,
        correct_index INTEGER NOT NULL DEFAULT 0,
        rule_ref TEXT,
        for_gm BOOLEAN NOT NULL DEFAULT TRUE,
        for_agm BOOLEAN NOT NULL DEFAULT TRUE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS cert_attempts (
        id SERIAL PRIMARY KEY,
        season_id INTEGER,
        discord_id TEXT NOT NULL,
        username TEXT,
        test TEXT NOT NULL,
        franchise_id INTEGER,
        franchise_name TEXT,
        status TEXT NOT NULL DEFAULT 'in_progress',
        questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        answers JSONB NOT NULL DEFAULT '{}'::jsonb,
        score INTEGER,
        total INTEGER,
        pct NUMERIC(5,2),
        passed BOOLEAN,
        signature TEXT,
        acknowledged JSONB,
        ip TEXT,
        user_agent TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        submitted_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cert_attempts_person ON cert_attempts (season_id, test, discord_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_cert_attempts_open ON cert_attempts (season_id, test, discord_id) WHERE status = 'in_progress'`,
    `CREATE TABLE IF NOT EXISTS cert_requests (
        id SERIAL PRIMARY KEY,
        attempt_id INTEGER UNIQUE REFERENCES cert_attempts(id) ON DELETE CASCADE,
        season_id INTEGER,
        discord_id TEXT NOT NULL,
        username TEXT,
        test TEXT NOT NULL,
        franchise_id INTEGER,
        franchise_name TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        notice_channel_id TEXT,
        notice_message_id TEXT,
        notice_failed BOOLEAN NOT NULL DEFAULT FALSE,
        notice_synced BOOLEAN NOT NULL DEFAULT TRUE,
        crew_approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
        crew_denials JSONB NOT NULL DEFAULT '[]'::jsonb,
        decided_by TEXT,
        decided_by_name TEXT,
        decided_at TIMESTAMPTZ,
        decision_note TEXT,
        roles_granted JSONB NOT NULL DEFAULT '[]'::jsonb,
        result TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cert_requests_status ON cert_requests (status, id)`,
    `CREATE TABLE IF NOT EXISTS cert_grants (
        id SERIAL PRIMARY KEY,
        season_id INTEGER,
        discord_id TEXT NOT NULL,
        test TEXT NOT NULL,
        extra INTEGER NOT NULL DEFAULT 1,
        reason TEXT,
        granted_by TEXT,
        granted_by_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS cert_retake_requests (
        id SERIAL PRIMARY KEY,
        season_id INTEGER,
        discord_id TEXT NOT NULL,
        username TEXT,
        test TEXT NOT NULL,
        attempt_id INTEGER,
        note TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        notice_channel_id TEXT,
        notice_message_id TEXT,
        notice_failed BOOLEAN NOT NULL DEFAULT FALSE,
        notice_synced BOOLEAN NOT NULL DEFAULT TRUE,
        resolved_by TEXT,
        resolved_by_name TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS cert_events (
        id BIGSERIAL PRIMARY KEY,
        season_id INTEGER,
        attempt_id INTEGER,
        discord_id TEXT,
        username TEXT,
        test TEXT,
        event TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '[]'::jsonb,
        ip TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cert_events_recent ON cert_events (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cert_events_attempt ON cert_events (attempt_id)`,
];

let _ready = false;
let _promise = null;

async function ensureCertSchema() {
    if (_ready) return true;
    if (!db()) return false;
    if (_promise) return _promise;
    _promise = (async () => {
        try {
            for (const sql of SCHEMA_SQL) await pool.query(sql);
            _ready = true;
            return true;
        } catch (err) {
            Logger.error('ensureCertSchema failed', err);
            return false;
        } finally {
            _promise = null;
        }
    })();
    return _promise;
}

async function getCertSettings() {
    if (!db()) return { ...DEFAULT_SETTINGS };
    try {
        const r = await pool.query(`SELECT value FROM site_config WHERE key = 'certification'`);
        return { ...DEFAULT_SETTINGS, ...(r.rows[0]?.value || {}) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/** Timeline row (the website's Tests tab reads these). */
async function recordCertEvent({ seasonId = null, attemptId = null, discordId = null, username = null, test = null, event, details = [] }) {
    if (!db()) return;
    await pool.query(
        `INSERT INTO cert_events (season_id, attempt_id, discord_id, username, test, event, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [seasonId, attemptId, discordId ? String(discordId) : null, username, test, event, JSON.stringify(details || [])]
    ).catch(() => {});
}

module.exports = { db, ensureCertSchema, getCertSettings, recordCertEvent, DEFAULT_SETTINGS };
