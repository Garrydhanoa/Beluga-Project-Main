/**
 * Discord's own "how did this member join" data — the same thing the server's
 * Members tab shows as Join Method / Invited by.
 *
 * Read through POST /guilds/{id}/members-search, which returns supplemental
 * member objects with `join_source_type`, `source_invite_code` and `inviter_id`.
 * Needs Manage Server + the Server Members intent (both present). Verified live
 * against the guild before this was built.
 *
 * CAVEATS (why the invite-use diff in inviteCache.js still exists as a backup):
 *  - the endpoint is not in Discord's official docs (community-documented), so
 *    it can change without notice — every failure flips the health flag the
 *    admin tab shows, and logs to higgenlogs once per outage;
 *  - it is backed by a search index, so a member who joined seconds ago is not
 *    found yet (callers retry), and an unindexed guild answers 202 + retry_after.
 */

const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { setSetting } = require('./inviteSchema');

const JOIN_SOURCE = {
    0: 'unknown',
    1: 'oauth',          // added by a bot through the guilds.join OAuth scope
    2: 'integration',    // Twitch / YouTube / subscription integrations
    3: 'discovery',
    4: 'hub',
    5: 'invite',
    6: 'vanity',
    7: 'manual_verification',
    8: 'lobby',
};

let health = { ok: null, at: null, error: null };

async function setHealth(ok, error = null) {
    const changed = health.ok !== ok;
    health = { ok, at: new Date().toISOString(), error: error ? String(error.message || error).slice(0, 300) : null };
    if (!changed) return;
    try { await setSetting('member_search_health', JSON.stringify(health)); } catch { /* best effort */ }
    if (!ok) {
        higgenLog.logFailure({
            summary: 'The bot could not read Discord\'s "Invited by" data for members. Invite tracking has fallen back to the invite-count method until it recovers.',
            error,
            action: 'invites.member-search',
            where: 'Invite tracking',
        });
    } else {
        Logger.info('Invite tracking: Discord member-source data is available.');
    }
}

function getHealth() { return { ...health }; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One members-search call, with the 202 "index not ready" retry built in. */
async function search(client, guildId, body, { maxWaits = 3 } = {}) {
    for (let attempt = 0; ; attempt++) {
        const res = await client.rest.post(`/guilds/${guildId}/members-search`, { body });
        // 202 comes back as a body with code 110000 and no members.
        if (res && res.code === 110000 && attempt < maxWaits) {
            const wait = Math.max(2, Math.min(60, Number(res.retry_after) || 5));
            await sleep(wait * 1000);
            continue;
        }
        if (!res || !Array.isArray(res.members)) {
            throw new Error(res?.message || 'Unexpected members-search response');
        }
        return res;
    }
}

function normalize(m) {
    const user = m?.member?.user || {};
    const type = Number(m?.join_source_type ?? 0);
    return {
        userId: String(user.id),
        isBot: !!user.bot,
        joinedAt: m?.member?.joined_at ? new Date(m.member.joined_at) : null,
        joinSourceType: type,
        source: JOIN_SOURCE[type] || 'unknown',
        code: m?.source_invite_code || null,
        inviterId: m?.inviter_id ? String(m.inviter_id) : null,
    };
}

/**
 * Look up one member. Resolves to the normalized record, or null when the member
 * is not in the index yet (just joined) — the caller decides whether to retry.
 * Throws when the endpoint itself is broken.
 */
async function lookup(client, guildId, userId) {
    try {
        const res = await search(client, guildId, {
            limit: 1,
            and_query: { user_id: { or_query: [String(userId)] } },
        });
        await setHealth(true);
        const hit = res.members[0];
        return hit ? normalize(hit) : null;
    } catch (err) {
        await setHealth(false, err);
        throw err;
    }
}

/** Every member, oldest join first. Two requests for ~1.2k members. */
async function scanAll(client, guildId) {
    const out = [];
    const seen = new Set();
    let after = null;
    try {
        for (let page = 0; page < 50; page++) {
            const body = { limit: 1000, sort: 2 }; // JOINED_AT_ASC
            if (after) body.after = after;
            const res = await search(client, guildId, body);
            for (const m of res.members) {
                const rec = normalize(m);
                if (seen.has(rec.userId)) continue;
                seen.add(rec.userId);
                out.push(rec);
            }
            if (res.members.length < 1000) break;
            const last = res.members[res.members.length - 1];
            after = { user_id: String(last.member.user.id), guild_joined_at: Date.parse(last.member.joined_at) };
        }
        await setHealth(true);
        return out;
    } catch (err) {
        await setHealth(false, err);
        throw err;
    }
}

module.exports = { lookup, scanAll, getHealth, JOIN_SOURCE };
