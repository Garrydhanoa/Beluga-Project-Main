/**
 * One-off import of the old hand-typed records: #strike-channel, #player-suspensions
 * and the current Discord ban list. The operator chose history-only, so nothing here
 * counts: everyone starts at 0/3, and the strike count they reached under the old
 * system is kept in `legacy_strikes` purely so staff can see it on a confirm card.
 *
 * buildPlan() is pure, which is what lets tools/mod-history-dryrun.js show the exact
 * list for review before anything is written. Applying twice is safe: every row is
 * keyed on the Discord message id it came from.
 */

const { pool } = require('../utils/database');
const { CHANNELS } = require('./modConfig');
const store = require('./modStore');

const REF_LABEL = {
    [CHANNELS.CODE_OF_CONDUCT]: 'Code of Conduct',
    [CHANNELS.RULEBOOK]: 'Rulebook',
};
const OLD_STAFF = 'Before this system';

function refOf(text) {
    const m = String(text).match(/<#(\d+)>/);
    return m ? REF_LABEL[m[1]] || null : null;
}

function cleanReason(text) {
    return String(text)
        .replace(/<@!?\d+>/g, '')
        .replace(/\(?\s*(rule\s*)?ref\.?\s*<#\d+>\s*\)?/gi, '')
        .replace(/<#\d+>/g, '')
        .replace(/[()*]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function classifyStrikePost(content) {
    const c = String(content);
    if (/remov/i.test(c)) {
        const numbers = [...c.replace(/<@!?\d+>/g, '').matchAll(/\d/g)].length;
        return { kind: 'unstrike', removes: Math.max(numbers, 1) };
    }
    if (/kicked/i.test(c)) return { kind: 'kick' };
    if (/only warning|\bwarning\b|\bwarned\b/i.test(c)) return { kind: 'warn' };
    const number = c.match(/\b([123])\s*\/\s*3\b/) || c.match(/strike\s*([123])\b/i);
    if (number) return { kind: 'strike', strikeNumber: parseInt(number[1], 10) };
    if (/\bban\b|\bbanned\b/i.test(c)) return { kind: 'ban' };
    return null;
}

/**
 * @param {object} raw {strikes:[msg], suspensions:[msg], bans:[{id,name,reason}]}
 *   where msg = {id, content, timestamp, authorName}
 */
function buildPlan(raw) {
    const cases = [];
    const skipped = [];
    const legacy = new Map();
    const banDates = new Map();
    const byOldest = (list) => [...list].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    for (const msg of byOldest(raw.strikes || [])) {
        const id = String(msg.content).match(/<@!?(\d+)>/)?.[1];
        const parsed = classifyStrikePost(msg.content);
        if (!id || !parsed) {
            skipped.push({ channel: 'strike-channel', content: msg.content });
            continue;
        }
        const current = legacy.get(id) || 0;
        if (parsed.kind === 'strike') legacy.set(id, Math.max(current, parsed.strikeNumber));
        if (parsed.kind === 'unstrike') legacy.set(id, Math.max(current - parsed.removes, 0));
        if (parsed.kind === 'ban' || parsed.strikeNumber === 3) banDates.set(id, msg.timestamp);
        cases.push({
            legacyRef: `msg:${msg.id}`, discordId: id, kind: parsed.kind, strikeNumber: parsed.strikeNumber || null,
            ruleLabel: refOf(msg.content), reason: cleanReason(msg.content) || 'See the original post', actorName: msg.authorName, createdAt: msg.timestamp,
        });
    }
    for (const msg of byOldest(raw.suspensions || [])) {
        const id = String(msg.content).match(/<@!?(\d+)>/)?.[1];
        if (!id) {
            skipped.push({ channel: 'player-suspensions', content: msg.content });
            continue;
        }
        cases.push({
            legacyRef: `msg:${msg.id}`, discordId: id, kind: 'suspend', strikeNumber: null,
            ruleLabel: refOf(msg.content), reason: cleanReason(msg.content) || 'See the original post', actorName: msg.authorName, createdAt: msg.timestamp,
        });
    }
    const bans = (raw.bans || []).map((b) => ({
        legacyRef: `ban:${b.id}`, discordId: String(b.id), targetName: b.name || null, kind: 'ban', strikeNumber: null,
        ruleLabel: null, reason: b.reason || 'No reason was recorded', actorName: OLD_STAFF,
        createdAt: banDates.get(String(b.id)) || null,
    }));
    return { cases, bans, skipped, legacyStrikes: [...legacy.entries()].filter(([, n]) => n > 0) };
}

async function insertCase(item) {
    const { rows } = await pool.query(
        `INSERT INTO mod_cases (discord_id, target_name, kind, status, rule_label, reason, actor_name, source, counts, strike_number, legacy_ref, created_at, details)
         VALUES ($1, $2, $3, 'ended', $4, $5, $6, 'import', FALSE, $7, $8, COALESCE($9::timestamptz, NOW()), $10::jsonb)
         ON CONFLICT (legacy_ref) WHERE legacy_ref IS NOT NULL DO NOTHING RETURNING id`,
        [
            item.discordId, item.targetName || null, item.kind, item.ruleLabel, item.reason.slice(0, 1500), item.actorName,
            item.strikeNumber, item.legacyRef, item.createdAt, JSON.stringify(item.createdAt ? {} : { date_unknown: true }),
        ],
    );
    return rows[0]?.id || null;
}

async function applyPlan(plan) {
    let added = 0;
    for (const item of plan.cases) {
        if (await insertCase(item)) added += 1;
    }
    for (const item of plan.bans) {
        const id = await insertCase(item);
        if (id) {
            added += 1;
            await pool.query(
                `INSERT INTO mod_bans (case_id, discord_id, ban_type) VALUES ($1, $2, 'legacy') ON CONFLICT (case_id) DO NOTHING`,
                [id, item.discordId],
            );
        }
    }
    for (const [discordId, count] of plan.legacyStrikes) await store.setLegacyStrikes(discordId, count);
    return added;
}

async function fetchAll(client, channelId) {
    const channel = await client.channels.fetch(channelId);
    const out = [];
    let before;
    for (;;) {
        const page = await channel.messages.fetch({ limit: 100, before });
        if (!page.size) break;
        for (const m of page.values()) {
            out.push({ id: m.id, content: m.content, timestamp: m.createdAt.toISOString(), authorName: m.member?.displayName || m.author?.username });
        }
        before = page.last().id;
        if (page.size < 100) break;
    }
    return out;
}

async function importHistory(client, { actor }) {
    const { getGuild } = require('./modGuild');
    const guild = getGuild(client);
    const bans = await guild.bans.fetch();
    const plan = buildPlan({
        strikes: await fetchAll(client, CHANNELS.STRIKES),
        suspensions: await fetchAll(client, CHANNELS.SUSPENSIONS),
        bans: bans.map((b) => ({ id: b.user.id, name: b.user.globalName || b.user.username, reason: b.reason })),
    });
    const added = await applyPlan(plan);
    await store.logEvent({
        kind: 'import',
        summary: `${actor?.name || 'Staff'} imported the old moderation history: ${added} new rows, ${plan.skipped.length} posts skipped.`,
        actorId: actor?.id, actorName: actor?.name,
    });
    return { summary: `Imported ${added} rows of old history. ${plan.skipped.length} posts could not be read.`, problems: [] };
}

module.exports = { buildPlan, applyPlan, importHistory };
