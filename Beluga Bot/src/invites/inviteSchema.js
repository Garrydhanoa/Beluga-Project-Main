/**
 * Invite campaign — tables, settings and the per-invitee history log.
 *
 * MIRRORED in beluga-league-main/lib/leagueSchema.js (the `invite_*` steps).
 * Keep the two copies in sync: the bot writes most of this, the website's admin
 * Invites tab writes staff decisions, tags, adjustments and settings.
 *
 * `invites` is ONE ROW PER INVITEE — the current attribution for that member.
 * Everything that ever happened to them lives in `invite_events`.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

// Defaults the website also falls back to. Channel ids come from the operator.
const DEFAULT_SETTINGS = {
    invite_channel_id: '1563757886176493568',
    staff_channel_id: '1299015210702737429',
    min_account_age_days: '30',
    claim_window_days: '5',
    dm_inviter: 'true',
};

const SCHEMA_SQL = [
    `CREATE TABLE IF NOT EXISTS invite_campaigns (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        prize TEXT,
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'active',
        end_pinged_at TIMESTAMPTZ,
        final_top JSONB,
        created_by TEXT,
        ended_by TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_campaigns_active ON invite_campaigns ((status)) WHERE status = 'active'`,
    `CREATE TABLE IF NOT EXISTS invites (
        invitee_id TEXT PRIMARY KEY,
        joined_at TIMESTAMPTZ,
        left_at TIMESTAMPTZ,
        in_guild BOOLEAN NOT NULL DEFAULT TRUE,
        account_created_at TIMESTAMPTZ,
        pre_launch BOOLEAN NOT NULL DEFAULT FALSE,
        known_before BOOLEAN NOT NULL DEFAULT FALSE,
        join_count INTEGER NOT NULL DEFAULT 1,
        source_type TEXT NOT NULL DEFAULT 'unknown',
        invite_code TEXT,
        discord_inviter_id TEXT,
        diff_inviter_id TEXT,
        diff_code TEXT,
        diff_result TEXT,
        inviter_id TEXT,
        verified_via TEXT,
        verified_at TIMESTAMPTZ,
        flags TEXT[] NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'tracked',
        registered_at TIMESTAMPTZ,
        counted_at TIMESTAMPTZ,
        credited_campaign_id INTEGER,
        claimable_until TIMESTAMPTZ,
        notified_at TIMESTAMPTZ,
        claim_posted_at TIMESTAMPTZ,
        review_posted_at TIMESTAMPTZ,
        admin_locked BOOLEAN NOT NULL DEFAULT FALSE,
        decided_by TEXT,
        decided_at TIMESTAMPTZ,
        decision_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites (inviter_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_invites_status ON invites (status)`,
    `CREATE TABLE IF NOT EXISTS invite_events (
        id BIGSERIAL PRIMARY KEY,
        invitee_id TEXT,
        inviter_id TEXT,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invite_events_invitee ON invite_events (invitee_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_invite_events_inviter ON invite_events (inviter_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS invite_claims (
        id SERIAL PRIMARY KEY,
        invitee_id TEXT NOT NULL,
        claimer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        decided_by TEXT,
        decided_at TIMESTAMPTZ,
        note TEXT
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_claims_one_pending ON invite_claims (claimer_id) WHERE status = 'pending'`,
    `CREATE INDEX IF NOT EXISTS idx_invite_claims_invitee ON invite_claims (invitee_id, status)`,
    `CREATE TABLE IF NOT EXISTS invite_adjustments (
        id SERIAL PRIMARY KEY,
        inviter_id TEXT NOT NULL,
        delta INTEGER NOT NULL,
        scope TEXT NOT NULL DEFAULT 'both',
        campaign_id INTEGER,
        reason TEXT NOT NULL,
        actor_id TEXT,
        actor_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invite_adjustments_inviter ON invite_adjustments (inviter_id)`,
    `CREATE TABLE IF NOT EXISTS invite_codes (
        code TEXT PRIMARY KEY,
        inviter_id TEXT,
        inviter_is_bot BOOLEAN NOT NULL DEFAULT FALSE,
        channel_id TEXT,
        uses INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER NOT NULL DEFAULT 0,
        temporary BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ,
        is_vanity BOOLEAN NOT NULL DEFAULT FALSE,
        is_general BOOLEAN NOT NULL DEFAULT FALSE,
        label TEXT,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS invite_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS invite_actions (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        payload JSONB,
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by_discord_id TEXT,
        requested_by_username TEXT,
        result TEXT,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fulfilled_at TIMESTAMPTZ
    )`,
    `CREATE INDEX IF NOT EXISTS idx_invite_actions_status ON invite_actions (status, id)`,
    // The first campaign. Only seeded into an EMPTY table so a deleted/renamed
    // campaign is never resurrected.
    `INSERT INTO invite_campaigns (name) SELECT 'Campaign 1' WHERE NOT EXISTS (SELECT 1 FROM invite_campaigns)`,
];

let _ready = false;
let _promise = null;

async function ensureInviteSchema() {
    if (_ready) return true;
    if (!db()) return false;
    if (_promise) return _promise;
    _promise = (async () => {
        try {
            for (const sql of SCHEMA_SQL) await pool.query(sql);
            _ready = true;
            return true;
        } catch (err) {
            Logger.error('ensureInviteSchema failed', err);
            return false;
        } finally {
            _promise = null;
        }
    })();
    return _promise;
}

// ── settings ──────────────────────────────────────────────────────────────────

async function getSettings() {
    const out = { ...DEFAULT_SETTINGS };
    if (!db()) return out;
    try {
        const { rows } = await pool.query('SELECT key, value FROM invite_settings');
        for (const r of rows) if (r.value !== null && r.value !== '') out[r.key] = r.value;
    } catch (err) {
        Logger.error('invite settings read failed', err);
    }
    return out;
}

async function getSetting(key) {
    const all = await getSettings();
    return all[key] ?? null;
}

async function setSetting(key, value) {
    if (!db()) return;
    await pool.query(
        `INSERT INTO invite_settings (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, value === null || value === undefined ? null : String(value)]
    );
}

function intSetting(settings, key) {
    const n = parseInt(settings[key] ?? DEFAULT_SETTINGS[key], 10);
    return Number.isFinite(n) ? n : parseInt(DEFAULT_SETTINGS[key], 10);
}

// ── history ───────────────────────────────────────────────────────────────────

/** Append one plain-English line to a member's invite history (admin tab). */
async function logEvent({ inviteeId = null, inviterId = null, kind, summary, actorId = null, actorName = null }) {
    if (!db()) return;
    try {
        await pool.query(
            `INSERT INTO invite_events (invitee_id, inviter_id, kind, summary, actor_id, actor_name)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [inviteeId, inviterId, kind, String(summary).slice(0, 600), actorId, actorName]
        );
    } catch (err) {
        Logger.error('invite event log failed', err);
    }
}

async function getActiveCampaign() {
    if (!db()) return null;
    const { rows } = await pool.query(`SELECT * FROM invite_campaigns WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    return rows[0] || null;
}

module.exports = {
    db,
    ensureInviteSchema,
    getSettings,
    getSetting,
    setSetting,
    intSetting,
    logEvent,
    getActiveCampaign,
    DEFAULT_SETTINGS,
    SCHEMA_SQL,
};
