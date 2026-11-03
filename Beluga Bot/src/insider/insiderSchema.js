/**
 * Beluga Insider — tables and settings.
 *
 * MIRRORED in beluga-league-main/lib/leagueSchema.js (the `insider_*` steps). Keep
 * the two copies in sync: the bot builds packets, runs the review desk and posts
 * issues; the website hands packets to the writer and takes its drafts.
 *
 * The writer is a cloud run with no Discord or database login of its own, so
 * every row here that came from the writer is a DRAFT until a person approves it.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

// Same defaults the website falls back to (site_config key 'insider').
const DEFAULT_SETTINGS = {
    enabled: false,
    reviewChannelId: '1299015210702737429', // #admin-chat
    publishChannelId: '1249174579100913714', // #beluga-insider
    salaryChannelId: '1430752024630268024', // #salary-announcement
    quotesChannelId: '1179173566911098981', // #beluga-quotes
    reviewRoleId: '1195275384120418354', // Salary Crew
    pingRoleId: '1251312866896773191', // League News
    extraChannelIds: [
        '1156814623576698898', // #captains
        '1309324047389294673', // #general-managers
    ],
};

const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS insider_issues (
        id SERIAL PRIMARY KEY,
        issue_date DATE NOT NULL UNIQUE,
        issue_number INTEGER,
        season_id INTEGER,
        week INTEGER,
        edition TEXT NOT NULL DEFAULT 'offseason',
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL DEFAULT 'collecting',
        packet JSONB,
        draft JSONB,
        final JSONB,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        interview JSONB,
        rewrite_note TEXT,
        review_channel_id TEXT,
        review_message_id TEXT,
        review_thread_id TEXT,
        approved_by_id TEXT,
        approved_by_name TEXT,
        published_at TIMESTAMPTZ,
        published_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        header_png BYTEA,
        hidden BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_insider_issues_status ON insider_issues (status, issue_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_insider_issues_published ON insider_issues (published_at DESC)`,
    `CREATE TABLE IF NOT EXISTS insider_queries (
        id BIGSERIAL PRIMARY KEY,
        issue_id INTEGER,
        sql TEXT NOT NULL,
        row_count INTEGER,
        result JSONB,
        took_ms INTEGER,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_insider_queries_issue ON insider_queries (issue_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS insider_edits (
        id BIGSERIAL PRIMARY KEY,
        issue_id INTEGER NOT NULL,
        section TEXT,
        before TEXT,
        after TEXT,
        editor_id TEXT,
        editor_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_insider_edits_recent ON insider_edits (created_at DESC)`,
];

let _ready = false;
let _promise = null;

async function ensureInsiderSchema() {
    if (_ready) return true;
    if (!db()) return false;
    if (_promise) return _promise;
    _promise = (async () => {
        try {
            for (const sql of SCHEMA_SQL) await pool.query(sql);
            _ready = true;
            return true;
        } catch (err) {
            Logger.error('ensureInsiderSchema failed', err);
            return false;
        } finally {
            _promise = null;
        }
    })();
    return _promise;
}

async function getInsiderSettings() {
    if (!db()) return { ...DEFAULT_SETTINGS };
    try {
        const r = await pool.query(`SELECT value FROM site_config WHERE key = 'insider'`);
        return { ...DEFAULT_SETTINGS, ...(r.rows[0]?.value || {}) };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

module.exports = { db, ensureInsiderSchema, getInsiderSettings, DEFAULT_SETTINGS };
