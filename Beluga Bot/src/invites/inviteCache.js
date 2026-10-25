/**
 * The BACKUP attribution method: cache every invite's use count, and on a join
 * re-fetch and see which counter went up.
 *
 * Discord's own member-source data (memberSource.js) is the source of truth; this
 * exists so tracking keeps working if that endpoint ever changes, and so the two
 * can be compared — a disagreement sends the invite to staff review.
 *
 * Known blind spots, all reported as `ambiguous` rather than guessed:
 *  - two members joining inside one fetch window (two counters move, or one moves by 2);
 *  - an invite that hit max uses on this join is DELETED by Discord, so it shows up
 *    as "vanished" instead of "+1" — treated as the match only when it was exactly
 *    one use short of its cap.
 *
 * Also keeps `invite_codes` in sync: the admin tab lists codes from it and staff
 * tag general links (Website, Reddit ad, …) there. Tags survive every sync.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const { db } = require('./inviteSchema');

let codes = new Map();     // code -> { uses, maxUses, inviterId, inviterBot, expiresAt }
let vanity = null;         // { code, uses }
let chain = Promise.resolve();
let loaded = false;

function snapshotOf(invite) {
    return {
        uses: Number(invite.uses) || 0,
        maxUses: Number(invite.maxUses) || 0,
        inviterId: invite.inviterId || invite.inviter?.id || null,
        inviterBot: !!invite.inviter?.bot,
        expiresAt: invite.expiresTimestamp || null,
        channelId: invite.channelId || invite.channel?.id || null,
        temporary: !!invite.temporary,
        createdAt: invite.createdTimestamp || null,
    };
}

async function fetchAll(guild) {
    const fetched = await guild.invites.fetch({ cache: false });
    const next = new Map();
    for (const inv of fetched.values()) next.set(inv.code, snapshotOf(inv));
    let nextVanity = null;
    try {
        const v = await guild.fetchVanityData();
        if (v?.code) nextVanity = { code: v.code, uses: Number(v.uses) || 0 };
    } catch { /* no vanity / no permission — fine */ }
    return { next, nextVanity };
}

/** Persist the current invite list. Tags (is_general / label) are never touched. */
async function persist(map, v) {
    if (!db()) return;
    const rows = [...map.entries()].map(([code, s]) => ({
        code,
        inviter_id: s.inviterId,
        inviter_is_bot: s.inviterBot,
        channel_id: s.channelId,
        uses: s.uses,
        max_uses: s.maxUses,
        temporary: s.temporary,
        expires_at: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
        created_at: s.createdAt ? new Date(s.createdAt).toISOString() : null,
        is_vanity: false,
    }));
    if (v) rows.push({ code: v.code, inviter_id: null, inviter_is_bot: false, channel_id: null, uses: v.uses, max_uses: 0, temporary: false, expires_at: null, created_at: null, is_vanity: true });
    try {
        await pool.query(
            `INSERT INTO invite_codes (code, inviter_id, inviter_is_bot, channel_id, uses, max_uses, temporary, expires_at, created_at, is_vanity, deleted_at, synced_at)
             SELECT code, inviter_id, inviter_is_bot, channel_id, uses, max_uses, temporary, expires_at, created_at, is_vanity, NULL, NOW()
               FROM jsonb_to_recordset($1::jsonb) AS x(code TEXT, inviter_id TEXT, inviter_is_bot BOOLEAN, channel_id TEXT, uses INT,
                    max_uses INT, temporary BOOLEAN, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ, is_vanity BOOLEAN)
             ON CONFLICT (code) DO UPDATE SET
                inviter_id = EXCLUDED.inviter_id, inviter_is_bot = EXCLUDED.inviter_is_bot, channel_id = EXCLUDED.channel_id,
                uses = EXCLUDED.uses, max_uses = EXCLUDED.max_uses, temporary = EXCLUDED.temporary,
                expires_at = EXCLUDED.expires_at, created_at = COALESCE(EXCLUDED.created_at, invite_codes.created_at),
                is_vanity = EXCLUDED.is_vanity, deleted_at = NULL, synced_at = NOW()`,
            [JSON.stringify(rows)]
        );
        await pool.query(
            `UPDATE invite_codes SET deleted_at = NOW()
              WHERE deleted_at IS NULL AND code <> ALL($1::text[])`,
            [rows.map((r) => r.code)]
        );
    } catch (err) {
        Logger.error('invite_codes sync failed', err);
    }
}

/** Fetch + store, NOT chained — only call from code already running on the chain. */
async function loadNow(guild) {
    const { next, nextVanity } = await fetchAll(guild);
    codes = next;
    vanity = nextVanity;
    loaded = true;
    await persist(codes, vanity);
    return codes.size;
}

/** Load the cache on startup (and on the reconcile sweep). */
async function refresh(guild) {
    const run = chain.then(() => loadNow(guild));
    chain = run.catch(() => {});
    return run;
}

function onInviteCreate(invite) {
    try { codes.set(invite.code, snapshotOf(invite)); } catch { /* ignore */ }
    if (!db()) return;
    const s = snapshotOf(invite);
    pool.query(
        `INSERT INTO invite_codes (code, inviter_id, inviter_is_bot, channel_id, uses, max_uses, temporary, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (code) DO UPDATE SET inviter_id = EXCLUDED.inviter_id, inviter_is_bot = EXCLUDED.inviter_is_bot,
            uses = EXCLUDED.uses, max_uses = EXCLUDED.max_uses, deleted_at = NULL, synced_at = NOW()`,
        [invite.code, s.inviterId, s.inviterBot, s.channelId, s.uses, s.maxUses, s.temporary,
            s.expiresAt ? new Date(s.expiresAt) : null, s.createdAt ? new Date(s.createdAt) : new Date()]
    ).catch((err) => Logger.error('invite_codes insert failed', err));
}

function onInviteDelete(invite) {
    // Keep the old snapshot in `codes`: a max-uses invite is deleted by Discord in
    // the same instant the join lands, and the diff needs its last count to see it.
    if (!db()) return;
    pool.query(`UPDATE invite_codes SET deleted_at = NOW() WHERE code = $1`, [invite.code])
        .catch((err) => Logger.error('invite_codes delete mark failed', err));
}

/**
 * Work out which invite this join used. Joins are serialized through one chain so
 * each diff compares against the state the previous join left behind.
 * @returns {{ result: 'match'|'ambiguous'|'none'|'unavailable', code?: string, inviterId?: string|null, inviterBot?: boolean, vanity?: boolean }}
 */
function diffOnJoin(guild) {
    const run = chain.then(async () => {
        if (!loaded) {
            // Already on the chain — calling refresh() here would queue behind
            // ourselves and deadlock every later join.
            await loadNow(guild).catch(() => {});
            return { result: 'unavailable' };
        }
        const before = codes;
        const beforeVanity = vanity;
        const { next, nextVanity } = await fetchAll(guild);

        const candidates = [];
        let totalBump = 0;
        for (const [code, now] of next) {
            const was = before.get(code);
            const bump = now.uses - (was ? was.uses : 0);
            if (bump > 0) {
                totalBump += bump;
                candidates.push({ code, inviterId: now.inviterId, inviterBot: now.inviterBot, vanity: false });
            }
        }
        const nowMs = Date.now();
        for (const [code, was] of before) {
            if (next.has(code)) continue;
            const usedUp = was.maxUses > 0 && was.uses === was.maxUses - 1;
            const expired = was.expiresAt && was.expiresAt < nowMs;
            if (usedUp && !expired) {
                totalBump += 1;
                candidates.push({ code, inviterId: was.inviterId, inviterBot: was.inviterBot, vanity: false });
            }
        }
        if (nextVanity && beforeVanity && nextVanity.uses > beforeVanity.uses) {
            totalBump += nextVanity.uses - beforeVanity.uses;
            candidates.push({ code: nextVanity.code, inviterId: null, inviterBot: false, vanity: true });
        }

        codes = next;
        vanity = nextVanity || beforeVanity;
        persist(codes, vanity).catch(() => {});

        if (candidates.length === 1 && totalBump === 1) return { result: 'match', ...candidates[0] };
        if (candidates.length === 0) return { result: 'none' };
        return { result: 'ambiguous' };
    });
    chain = run.catch(() => {});
    return run.catch((err) => {
        Logger.warning(`Invite diff failed (${err.message}) — Discord member data will decide.`);
        return { result: 'unavailable' };
    });
}

module.exports = { refresh, onInviteCreate, onInviteDelete, diffOnJoin };
