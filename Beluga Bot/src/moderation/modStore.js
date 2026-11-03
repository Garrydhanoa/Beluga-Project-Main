/**
 * Database access for the moderation system. Everything here is plain reads and
 * writes; Discord side effects live in actions.js / bans.js / suspensions.js.
 *
 * The strike count is stored rather than derived because Directors can set it by
 * hand and an approved appeal removes one without touching the original case.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');

const STRIKE_LIMIT = 3;

async function logEvent({ discordId = null, caseId = null, kind, summary, actorId = null, actorName = null }) {
    try {
        await pool.query(
            `INSERT INTO mod_events (discord_id, case_id, kind, summary, actor_id, actor_name)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [discordId, caseId, kind, String(summary).slice(0, 1000), actorId, actorName],
        );
    } catch (err) {
        Logger.warning(`mod event write failed: ${err.message}`);
    }
}

async function createCase({
    discordId, targetName = null, kind, rule = null, reason, actor, source = null, counts = true,
    strikeNumber = null, durationSeconds = null, expiresAt = null, details = {}, status = 'active',
    actionId = null, legacyRef = null, createdAt = null,
}) {
    const { rows } = await pool.query(
        `INSERT INTO mod_cases
            (discord_id, target_name, kind, status, rule_code, rule_label, reason, actor_id, actor_name,
             source, counts, strike_number, duration_seconds, expires_at, details, action_id, legacy_ref, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17, COALESCE($18::timestamptz, NOW()))
         RETURNING *`,
        [
            String(discordId), targetName, kind, status, rule?.code || null, rule?.label || null,
            String(reason).slice(0, 1500), actor?.id || null, actor?.name || null,
            source || actor?.source || 'command', counts, strikeNumber, durationSeconds, expiresAt,
            JSON.stringify(details || {}), actionId, legacyRef, createdAt,
        ],
    );
    return rows[0];
}

async function getCase(id) {
    const n = parseInt(id, 10);
    if (!Number.isFinite(n)) return null;
    const { rows } = await pool.query('SELECT * FROM mod_cases WHERE id = $1', [n]);
    return rows[0] || null;
}

async function getCaseByAction(actionId) {
    const { rows } = await pool.query('SELECT * FROM mod_cases WHERE action_id = $1', [actionId]);
    return rows[0] || null;
}

/** Atomically record the outcome of one step so a retry can't repeat it. */
async function setStep(caseId, step, value) {
    await pool.query(
        `UPDATE mod_cases SET steps = jsonb_set(COALESCE(steps, '{}'::jsonb), $2::text[], $3::jsonb, TRUE), updated_at = NOW() WHERE id = $1`,
        [caseId, [step], JSON.stringify(value)],
    );
}

async function setMessageId(caseId, key, messageId) {
    await pool.query(
        `UPDATE mod_cases SET msg_ids = jsonb_set(COALESCE(msg_ids, '{}'::jsonb), $2::text[], $3::jsonb, TRUE), updated_at = NOW() WHERE id = $1`,
        [caseId, [key], JSON.stringify(String(messageId))],
    );
}

async function mergeDetails(caseId, patch) {
    await pool.query(
        `UPDATE mod_cases SET details = COALESCE(details, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [caseId, JSON.stringify(patch)],
    );
}

async function setCaseStatus(caseId, status) {
    const { rows } = await pool.query(
        `UPDATE mod_cases SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [caseId, status],
    );
    return rows[0] || null;
}

/** Reason edits keep the old wording so nobody can quietly rewrite history. */
async function updateReason(caseId, reason, actor) {
    const current = await getCase(caseId);
    if (!current) return null;
    const history = Array.isArray(current.details?.reason_history) ? current.details.reason_history : [];
    history.push({ reason: current.reason, by: actor?.name || null, at: new Date().toISOString() });
    const { rows } = await pool.query(
        `UPDATE mod_cases SET reason = $2, details = COALESCE(details, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [caseId, String(reason).slice(0, 1500), JSON.stringify({ reason_history: history })],
    );
    await logEvent({
        discordId: current.discord_id, caseId, kind: 'reason',
        summary: `${actor?.name || 'Staff'} changed the reason on case ${caseId} to: ${reason}`,
        actorId: actor?.id, actorName: actor?.name,
    });
    return rows[0];
}

async function markVoided(caseId, reason, actor) {
    const { rows } = await pool.query(
        `UPDATE mod_cases SET status = 'voided', void_reason = $2, voided_by_id = $3, voided_by_name = $4,
                voided_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status <> 'voided' RETURNING *`,
        [caseId, String(reason).slice(0, 1000), actor?.id || null, actor?.name || null],
    );
    return rows[0] || null;
}

async function listCases(discordId, { limit = 10, offset = 0, includeLegacy = true } = {}) {
    const { rows } = await pool.query(
        `SELECT * FROM mod_cases
          WHERE discord_id = $1 AND ($4::boolean OR counts = TRUE)
          ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
        [String(discordId), limit, offset, includeLegacy],
    );
    return rows;
}

async function countCases(discordId, { includeLegacy = true } = {}) {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM mod_cases WHERE discord_id = $1 AND ($2::boolean OR counts = TRUE)`,
        [String(discordId), includeLegacy],
    );
    return rows[0]?.n || 0;
}

// ── member state ──────────────────────────────────────────────────────────────

async function getState(discordId) {
    const { rows } = await pool.query('SELECT * FROM mod_member_state WHERE discord_id = $1', [String(discordId)]);
    return rows[0] || { discord_id: String(discordId), strikes: 0, warned_at: null, last_chance: false, legacy_strikes: 0 };
}

async function addStrike(discordId) {
    const { rows } = await pool.query(
        `INSERT INTO mod_member_state (discord_id, strikes) VALUES ($1, 1)
         ON CONFLICT (discord_id) DO UPDATE SET strikes = mod_member_state.strikes + 1, updated_at = NOW()
         RETURNING strikes`,
        [String(discordId)],
    );
    return rows[0].strikes;
}

async function removeStrike(discordId) {
    const { rows } = await pool.query(
        `UPDATE mod_member_state SET strikes = GREATEST(strikes - 1, 0), updated_at = NOW()
          WHERE discord_id = $1 RETURNING strikes`,
        [String(discordId)],
    );
    return rows[0]?.strikes ?? 0;
}

async function setStrikes(discordId, count) {
    const n = Math.max(0, parseInt(count, 10) || 0);
    await pool.query(
        `INSERT INTO mod_member_state (discord_id, strikes) VALUES ($1, $2)
         ON CONFLICT (discord_id) DO UPDATE SET strikes = $2, updated_at = NOW()`,
        [String(discordId), n],
    );
    return n;
}

async function markWarned(discordId) {
    await pool.query(
        `INSERT INTO mod_member_state (discord_id, warned_at) VALUES ($1, NOW())
         ON CONFLICT (discord_id) DO UPDATE SET warned_at = NOW(), updated_at = NOW()`,
        [String(discordId)],
    );
}

async function clearWarned(discordId) {
    await pool.query(
        `UPDATE mod_member_state SET warned_at = NULL, updated_at = NOW() WHERE discord_id = $1`,
        [String(discordId)],
    );
}

async function setLastChance(discordId, value) {
    await pool.query(
        `INSERT INTO mod_member_state (discord_id, last_chance) VALUES ($1, $2)
         ON CONFLICT (discord_id) DO UPDATE SET last_chance = $2, updated_at = NOW()`,
        [String(discordId), !!value],
    );
}

async function setLegacyStrikes(discordId, count) {
    await pool.query(
        `INSERT INTO mod_member_state (discord_id, legacy_strikes) VALUES ($1, $2)
         ON CONFLICT (discord_id) DO UPDATE SET legacy_strikes = $2, updated_at = NOW()`,
        [String(discordId), Math.max(0, parseInt(count, 10) || 0)],
    );
}

/** Everything the /modlog header and the confirm cards show. */
async function memberSummary(discordId) {
    const id = String(discordId);
    const [state, suspensions, bans, kinds] = await Promise.all([
        getState(id),
        pool.query(`SELECT * FROM mod_suspensions WHERE discord_id = $1 AND status IN ('active','queued') ORDER BY id`, [id]),
        pool.query(`SELECT * FROM mod_bans WHERE discord_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [id]),
        pool.query(
            `SELECT kind, COUNT(*)::int AS n FROM mod_cases
              WHERE discord_id = $1 AND counts = TRUE AND status <> 'voided' GROUP BY kind`,
            [id],
        ),
    ]);
    return {
        strikes: state.strikes,
        warned: !!state.warned_at,
        lastChance: !!state.last_chance,
        legacyStrikes: state.legacy_strikes || 0,
        suspensions: suspensions.rows,
        ban: bans.rows[0] || null,
        kinds: Object.fromEntries(kinds.rows.map((r) => [r.kind, r.n])),
    };
}

// ── evidence ──────────────────────────────────────────────────────────────────

const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

/** Discord CDN links expire, so the bytes are copied in immediately. */
async function addEvidenceFile({ caseId, attachment, actor }) {
    if (!attachment?.url) return { ok: false, error: 'No file.' };
    if (attachment.size && attachment.size > MAX_EVIDENCE_BYTES) return { ok: false, error: 'File is over 8MB.' };
    const res = await fetch(attachment.url);
    if (!res.ok) return { ok: false, error: `Download failed (${res.status}).` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_EVIDENCE_BYTES) return { ok: false, error: 'File is over 8MB.' };
    await pool.query(
        `INSERT INTO mod_evidence (case_id, kind, filename, mime, size_bytes, bytes, added_by_id, added_by_name)
         VALUES ($1, 'file', $2, $3, $4, $5, $6, $7)`,
        [caseId, attachment.name || 'evidence', attachment.contentType || 'application/octet-stream', bytes.length, bytes, actor?.id || null, actor?.name || null],
    );
    return { ok: true };
}

async function addEvidenceText({ caseId, text, sourceMessageId = null, actor = null }) {
    await pool.query(
        `INSERT INTO mod_evidence (case_id, kind, text, source_message_id, added_by_id, added_by_name)
         VALUES ($1, 'text', $2, $3, $4, $5)`,
        [caseId, String(text).slice(0, 4000), sourceMessageId, actor?.id || null, actor?.name || null],
    );
}

async function evidenceCount(caseId) {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM mod_evidence WHERE case_id = $1', [caseId]);
    return rows[0]?.n || 0;
}

// ── drafts & requests ─────────────────────────────────────────────────────────

/** Confirm cards, Director requests and panels keep their state here. */
async function createRequest({ kind, payload, actor, status = 'pending' }) {
    const { rows } = await pool.query(
        `INSERT INTO mod_requests (kind, payload, status, requested_by_id, requested_by_name)
         VALUES ($1, $2::jsonb, $3, $4, $5) RETURNING *`,
        [kind, JSON.stringify(payload || {}), status, actor?.id || null, actor?.name || null],
    );
    return rows[0];
}

async function getRequest(id) {
    const n = parseInt(id, 10);
    if (!Number.isFinite(n)) return null;
    const { rows } = await pool.query('SELECT * FROM mod_requests WHERE id = $1', [n]);
    return rows[0] || null;
}

async function updateRequestPayload(id, payload) {
    await pool.query('UPDATE mod_requests SET payload = $2::jsonb WHERE id = $1', [id, JSON.stringify(payload || {})]);
}

async function setRequestMessage(id, channelId, messageId) {
    await pool.query('UPDATE mod_requests SET channel_id = $2, message_id = $3 WHERE id = $1', [id, channelId, messageId]);
}

/** Compare-and-set, so two people pressing a button can't both win. */
async function decideRequest(id, status, actor, from = ['pending', 'draft']) {
    const { rows } = await pool.query(
        `UPDATE mod_requests SET status = $2, decided_by_id = $3, decided_by_name = $4, decided_at = NOW()
          WHERE id = $1 AND status = ANY($5::text[]) RETURNING *`,
        [id, status, actor?.id || null, actor?.name || null, from],
    );
    return rows[0] || null;
}

module.exports = {
    STRIKE_LIMIT, MAX_EVIDENCE_BYTES,
    logEvent, createCase, getCase, getCaseByAction, setStep, setMessageId, mergeDetails, setCaseStatus,
    updateReason, markVoided, listCases, countCases,
    getState, addStrike, removeStrike, setStrikes, markWarned, clearWarned, setLastChance, setLegacyStrikes, memberSummary,
    addEvidenceFile, addEvidenceText, evidenceCount,
    createRequest, getRequest, updateRequestPayload, setRequestMessage, decideRequest,
};
