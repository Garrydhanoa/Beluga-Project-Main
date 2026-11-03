/**
 * Moderation system — tables, settings and the chat-filter word lists.
 *
 * MIRRORED in beluga-league-main/lib/leagueSchema.js (the `mod_*` steps). Keep the
 * two copies in sync: the bot owns every Discord side effect, the website's admin
 * Mod Logs tab reads all of this and queues actions through `mod_actions`.
 *
 * `mod_cases` is the permanent record. Unlike `higgen_logs` (30-day retention) a
 * case is never pruned and never hard-deleted: voiding keeps the row and says who
 * voided it and why.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS mod_cases (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL,
        target_name TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        rule_code TEXT,
        rule_label TEXT,
        reason TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        source TEXT NOT NULL DEFAULT 'command',
        counts BOOLEAN NOT NULL DEFAULT TRUE,
        strike_number INTEGER,
        duration_seconds INTEGER,
        expires_at TIMESTAMPTZ,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        steps JSONB NOT NULL DEFAULT '{}'::jsonb,
        msg_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
        action_id INTEGER,
        legacy_ref TEXT,
        voided_by_id TEXT,
        voided_by_name TEXT,
        void_reason TEXT,
        voided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_cases_person ON mod_cases (discord_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mod_cases_recent ON mod_cases (created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mod_cases_expiry ON mod_cases (status, expires_at)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_mod_cases_legacy ON mod_cases (legacy_ref) WHERE legacy_ref IS NOT NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_mod_cases_action ON mod_cases (action_id) WHERE action_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS mod_member_state (
        discord_id TEXT PRIMARY KEY,
        strikes INTEGER NOT NULL DEFAULT 0,
        warned_at TIMESTAMPTZ,
        last_chance BOOLEAN NOT NULL DEFAULT FALSE,
        legacy_strikes INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS mod_suspensions (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL,
        discord_id TEXT NOT NULL,
        unit TEXT NOT NULL,
        total INTEGER,
        served INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        team_id INTEGER,
        team_name TEXT,
        division TEXT,
        season_id INTEGER,
        target_season_number INTEGER,
        sheet_synced BOOLEAN NOT NULL DEFAULT FALSE,
        release_state TEXT,
        review_season_id INTEGER,
        review_state TEXT,
        lifted_at TIMESTAMPTZ,
        lifted_by_id TEXT,
        lifted_by_name TEXT,
        lift_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_suspensions_active ON mod_suspensions (status, discord_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mod_suspensions_person ON mod_suspensions (discord_id, created_at DESC)`,
    // No foreign key on series_id on purpose: stats_series rows are hard-deleted by
    // the website, and the ticker has to notice and un-count them.
    `CREATE TABLE IF NOT EXISTS mod_suspension_ledger (
        suspension_id INTEGER NOT NULL,
        series_id INTEGER NOT NULL,
        team_id INTEGER,
        counted BOOLEAN NOT NULL DEFAULT TRUE,
        reason TEXT,
        noted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (suspension_id, series_id)
    )`,
    `CREATE TABLE IF NOT EXISTS mod_thread_notices (
        suspension_id INTEGER NOT NULL,
        thread_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (suspension_id, thread_id, kind)
    )`,
    `CREATE TABLE IF NOT EXISTS mod_bans (
        case_id INTEGER PRIMARY KEY,
        discord_id TEXT NOT NULL,
        ban_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        unban_at TIMESTAMPTZ,
        appeal_after TIMESTAMPTZ,
        dm_status TEXT,
        dm_error TEXT,
        invite_url TEXT,
        team_snapshot JSONB,
        unbanned_at TIMESTAMPTZ,
        unban_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_bans_person ON mod_bans (discord_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mod_bans_expiry ON mod_bans (status, unban_at)`,
    `CREATE TABLE IF NOT EXISTS mod_requests (
        id SERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by_id TEXT,
        requested_by_name TEXT,
        channel_id TEXT,
        message_id TEXT,
        decided_by_id TEXT,
        decided_by_name TEXT,
        decided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_requests_status ON mod_requests (status, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS mod_appeals (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL UNIQUE,
        discord_id TEXT NOT NULL,
        discord_name TEXT,
        kind TEXT NOT NULL,
        answers JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'voting',
        vote_message_id TEXT,
        director_message_id TEXT,
        posted_at TIMESTAMPTZ,
        decided_by_id TEXT,
        decided_by_name TEXT,
        decision_note TEXT,
        decided_at TIMESTAMPTZ,
        applied_at TIMESTAMPTZ,
        invite_shown_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_appeals_status ON mod_appeals (status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mod_appeals_person ON mod_appeals (discord_id)`,
    `CREATE TABLE IF NOT EXISTS mod_appeal_votes (
        appeal_id INTEGER NOT NULL,
        voter_id TEXT NOT NULL,
        voter_name TEXT,
        vote TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (appeal_id, voter_id)
    )`,
    // Discord CDN links expire, so evidence bytes live here permanently.
    `CREATE TABLE IF NOT EXISTS mod_evidence (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL,
        kind TEXT NOT NULL DEFAULT 'file',
        filename TEXT,
        mime TEXT,
        size_bytes INTEGER,
        bytes BYTEA,
        text TEXT,
        source_message_id TEXT,
        added_by_id TEXT,
        added_by_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_evidence_case ON mod_evidence (case_id)`,
    // Permanent per-person timeline (higgen_logs only keeps 30 days).
    `CREATE TABLE IF NOT EXISTS mod_events (
        id BIGSERIAL PRIMARY KEY,
        discord_id TEXT,
        case_id INTEGER,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_events_person ON mod_events (discord_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mod_events_recent ON mod_events (created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS mod_actions (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        payload JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ,
        requested_by_discord_id TEXT,
        requested_by_username TEXT,
        result TEXT,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fulfilled_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_actions_status ON mod_actions (status, id)`,
    `CREATE TABLE IF NOT EXISTS mod_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS mod_words (
        id SERIAL PRIMARY KEY,
        word TEXT NOT NULL UNIQUE,
        tier TEXT NOT NULL DEFAULT 'slur',
        source TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        added_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS mod_allowlist (
        id SERIAL PRIMARY KEY,
        phrase TEXT NOT NULL UNIQUE,
        added_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS mod_flags (
        id SERIAL PRIMARY KEY,
        layer TEXT NOT NULL,
        message_id TEXT,
        channel_id TEXT,
        channel_name TEXT,
        author_id TEXT NOT NULL,
        author_name TEXT,
        content TEXT,
        matched TEXT,
        verdict JSONB,
        model TEXT,
        case_id INTEGER,
        status TEXT NOT NULL DEFAULT 'open',
        alert_message_id TEXT,
        reviewed_by_id TEXT,
        reviewed_by_name TEXT,
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_flags_status ON mod_flags (status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_mod_flags_person ON mod_flags (author_id, created_at DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_mod_flags_message ON mod_flags (layer, message_id) WHERE message_id IS NOT NULL`,
    `CREATE TABLE IF NOT EXISTS mod_ai_usage (
        day DATE NOT NULL,
        model TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, model)
    )`,
    `CREATE TABLE IF NOT EXISTS mod_claude_account (
        id INTEGER PRIMARY KEY DEFAULT 1,
        balance_usd NUMERIC(12,6) NOT NULL DEFAULT 5,
        spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
        balance_set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        balance_set_by TEXT,
        state TEXT NOT NULL DEFAULT 'unknown',
        alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
        empty_since TIMESTAMPTZ,
        last_error TEXT
    )`,
    `INSERT INTO mod_claude_account (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    `ALTER TABLE mod_claude_account ADD COLUMN IF NOT EXISTS day_key TEXT`,
    `ALTER TABLE mod_claude_account ADD COLUMN IF NOT EXISTS day_spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0`,
    `ALTER TABLE mod_claude_account ADD COLUMN IF NOT EXISTS day_alert_sent BOOLEAN NOT NULL DEFAULT FALSE`,
    `CREATE TABLE IF NOT EXISTS mod_claude_usage (
        day DATE NOT NULL,
        purpose TEXT NOT NULL,
        model TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        input_tokens BIGINT NOT NULL DEFAULT 0,
        output_tokens BIGINT NOT NULL DEFAULT 0,
        cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, purpose, model)
    )`,
    `CREATE TABLE IF NOT EXISTS mod_identities (
        id SERIAL PRIMARY KEY,
        discord_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        key TEXT NOT NULL,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (discord_id, platform, key)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_identities_key ON mod_identities (platform, key)`,
    `CREATE TABLE IF NOT EXISTS mod_evasion_alerts (
        id SERIAL PRIMARY KEY,
        new_id TEXT NOT NULL,
        banned_id TEXT NOT NULL,
        key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        alert_message_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (new_id, banned_id, key)
    )`,
    `CREATE TABLE IF NOT EXISTS mod_staff_freezes (
        id SERIAL PRIMARY KEY,
        staff_id TEXT NOT NULL,
        staff_name TEXT,
        reason TEXT,
        frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        unfrozen_by_id TEXT,
        unfrozen_by_name TEXT,
        unfrozen_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mod_freezes_active ON mod_staff_freezes (staff_id) WHERE unfrozen_at IS NULL`,
    `CREATE TABLE IF NOT EXISTS mod_ff_warnings (
        season_id INTEGER NOT NULL,
        team_id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        forfeits INTEGER,
        case_id INTEGER,
        notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (season_id, team_id, level)
    )`,
    // The return invite handed to banned members is never credited to anyone.
    `ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS is_moderation BOOLEAN NOT NULL DEFAULT FALSE`,
];

let _ready = false;
let _promise = null;

async function ensureModSchema() {
    if (_ready) return true;
    if (!db()) return false;
    if (_promise) return _promise;
    _promise = (async () => {
        try {
            for (const sql of SCHEMA_SQL) {
                try {
                    await pool.query(sql);
                } catch (err) {
                    // invite_codes may not exist yet on a fresh boot; the invite
                    // schema creates it and the next start adds the column.
                    if (!/invite_codes/.test(sql)) throw err;
                    Logger.warning(`mod schema: skipped invite_codes column (${err.message})`);
                }
            }
            _ready = true;
            return true;
        } catch (err) {
            Logger.error('ensureModSchema failed', err);
            return false;
        } finally {
            _promise = null;
        }
    })();
    return _promise;
}

module.exports = { db, ensureModSchema };
