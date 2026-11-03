/**
 * Reads a window of Discord chat for the Beluga Insider.
 *
 * Deny by default: a channel is read only when @everyone can view it or it is one
 * of the named extras (#captains, #general-managers). Leadership, logs and tickets
 * are refused by name as well, so a permission change can't leak them into a post.
 * New private channels are therefore never read until someone adds them.
 *
 * `quotable` marks what may be repeated word for word. The extras and match threads
 * feed storylines only, because their members didn't speak in front of the league.
 *
 * Plain REST with the bot token rather than discord.js, so the same code runs on
 * Railway and from tools/insider-packet.js.
 */

const { pool } = require('../utils/database');
const { divisionLabel } = require('../utils/divisionLabels');
const { cleanName } = require('./names');

const API = 'https://discord.com/api/v10';
const VIEW_CHANNEL = 1024n;
const DISCORD_EPOCH = 1420070400000n;
const TEXT_TYPES = new Set([0, 5]); // text, announcement
const FORUM_TYPE = 15;
const THREAD_TYPES = new Set([10, 11]); // announcement thread, public thread
const USER_MESSAGE_TYPES = new Set([0, 19]); // default, reply
const CHANNEL_CAP = 5000;
const ARCHIVED_PAGES = 20;

const REFUSED_CATEGORY = /leadership|all logs|audit/i;
const REFUSED_NAME = /^ticket-|password|contact|application|transcript|banned|staff/i;

async function get(path) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } });
        if (res.status === 429) {
            const wait = (Number(res.headers.get('retry-after')) || 2) * 1000;
            // eslint-disable-next-line no-await-in-loop
            await new Promise((resolve) => setTimeout(resolve, wait + 100));
            continue;
        }
        if (!res.ok) {
            const err = new Error(`${path} returned ${res.status}`);
            err.status = res.status;
            throw err;
        }
        return res.json();
    }
    throw new Error(`${path} kept rate limiting`);
}

/** The snowflake a message sent at `date` would be just above. */
function snowflakeAt(date) {
    return ((BigInt(date.getTime()) - DISCORD_EPOCH) << 22n).toString();
}

function isRefused(channel, categoryName) {
    return REFUSED_CATEGORY.test(categoryName || '') || REFUSED_NAME.test(channel.name || '');
}

function isPublic(channel, guildId) {
    const everyone = (channel.permission_overwrites || []).find((o) => o.id === guildId);
    return !(everyone && (BigInt(everyone.deny) & VIEW_CHANNEL) !== 0n);
}

/** Which channels may be read, and whether they can be quoted. */
async function readableChannels(guildId, settings, { publicOnly = false } = {}) {
    const channels = await get(`/guilds/${guildId}/channels`);
    const categories = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
    const extras = new Set(publicOnly ? [] : settings.extraChannelIds || []);
    const readable = [];
    const refused = [];
    for (const channel of channels) {
        if (!TEXT_TYPES.has(channel.type) && channel.type !== FORUM_TYPE) continue;
        const category = categories.get(channel.parent_id) || '';
        const isExtra = extras.has(channel.id);
        if (isRefused(channel, category) && !isExtra) {
            refused.push(channel.name);
            continue;
        }
        const open = isPublic(channel, guildId);
        if (!open && !isExtra) {
            refused.push(channel.name);
            continue;
        }
        readable.push({ id: channel.id, name: channel.name, type: channel.type, lastId: channel.last_message_id, quotable: open });
    }
    return { readable, refused };
}

function describeMedia(message) {
    const tags = [];
    for (const file of message.attachments || []) {
        const type = file.content_type || '';
        if (type.startsWith('video')) tags.push('[clip]');
        else if (type.startsWith('image')) tags.push('[image]');
        else tags.push('[file]');
    }
    return tags.join(' ');
}

/** Message text with ids turned into names, so the writer never sees a raw mention. */
function tidy(text, lookup) {
    return String(text || '')
        .replace(/<@!?(\d+)>/g, (_m, id) => `@${lookup.member(id)}`)
        .replace(/<@&(\d+)>/g, (_m, id) => `@${lookup.role(id)}`)
        .replace(/<#(\d+)>/g, (_m, id) => `#${lookup.channel(id)}`)
        .replace(/<a?:(\w+):\d+>/g, ':$1:')
        .replace(/https?:\/\/\S*(tenor|klipy|giphy)\S*/gi, '[gif]')
        .replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*/gi, '[link: $1]')
        .replace(/\s+/g, ' ')
        .trim();
}

function shape(message, lookup) {
    const media = describeMedia(message);
    const text = [tidy(message.content, lookup), media].filter(Boolean).join(' ');
    return {
        id: message.id,
        at: message.timestamp,
        author: lookup.member(message.author?.id, message.author?.global_name || message.author?.username),
        text,
        reactions: (message.reactions || []).reduce((sum, r) => sum + (r.count || 0), 0),
        replyTo: message.referenced_message?.author ? lookup.member(message.referenced_message.author.id, message.referenced_message.author.username) : undefined,
    };
}

/** Oldest-first messages in the window. Flags truncation rather than dropping it silently. */
async function readWindow(channelId, from, to, lookup, { bots = false, flagged = new Set() } = {}) {
    const ceiling = BigInt(snowflakeAt(to));
    const messages = [];
    let after = snowflakeAt(from);
    let truncated = false;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const page = await get(`/channels/${channelId}/messages?limit=100&after=${after}`);
        if (!page.length) break;
        page.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        let done = false;
        for (const message of page) {
            if (BigInt(message.id) >= ceiling) { done = true; break; }
            if (message.author?.bot && !bots) continue;
            if (!USER_MESSAGE_TYPES.has(message.type)) continue;
            if (flagged.has(message.id)) continue;
            const row = shape(message, lookup);
            if (row.text) messages.push(row);
        }
        if (done || page.length < 100) break;
        if (messages.length >= CHANNEL_CAP) { truncated = true; break; }
        after = page[page.length - 1].id;
    }
    return { messages, truncated };
}

/** Public threads under readable channels that may have activity in the window. */
async function threadsInWindow(guildId, parents, skip, from) {
    const found = new Map();
    const take = (thread) => {
        if (!parents.has(thread.parent_id) || !THREAD_TYPES.has(thread.type) || skip.has(thread.id)) return;
        found.set(thread.id, { id: thread.id, name: thread.name, parent: parents.get(thread.parent_id) });
    };
    const active = await get(`/guilds/${guildId}/threads/active`);
    (active.threads || []).forEach(take);

    const gaps = [];
    for (const [parentId, parent] of parents) {
        let before = '';
        for (let page = 0; page < ARCHIVED_PAGES; page += 1) {
            let body;
            try {
                // eslint-disable-next-line no-await-in-loop
                body = await get(`/channels/${parentId}/threads/archived/public?limit=100${before}`);
            } catch (err) {
                if (err.status !== 403 && err.status !== 404) gaps.push(`Archived threads in #${parent.name}: ${err.message}`);
                break;
            }
            const threads = body.threads || [];
            threads.forEach((t) => { if (new Date(t.thread_metadata?.archive_timestamp) >= from) take(t); });
            const oldest = threads[threads.length - 1]?.thread_metadata?.archive_timestamp;
            if (!body.has_more || !oldest || new Date(oldest) < from) break;
            before = `&before=${encodeURIComponent(oldest)}`;
        }
    }
    return { threads: Array.from(found.values()), gaps };
}

/** Match threads come from the database, live rows and closed-thread archives both. */
async function matchThreads(from, to, lookup) {
    const live = await pool.query(
        `SELECT t.thread_id, w.division, w.week_number, w.team1, w.team2,
            t.message_id, t.author_id, t.author_display, t.author_username, t.content, t.message_created_at
         FROM thread_messages t
         LEFT JOIN week_threads w ON w.thread_id = t.thread_id
         WHERE t.is_bot = FALSE AND t.message_created_at >= $1::timestamptz AND t.message_created_at < $2::timestamptz
         ORDER BY t.message_created_at`,
        [from, to]
    );
    const archived = await pool.query(
        `SELECT a.thread_id, a.division, a.week_number, a.team1, a.team2,
            m->>'messageId' AS message_id, m->>'authorId' AS author_id, m->>'authorDisplay' AS author_display,
            m->>'authorUsername' AS author_username, m->>'content' AS content, m->>'createdAt' AS message_created_at
         FROM thread_archives a
         CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(a.transcript) = 'array' THEN a.transcript ELSE '[]'::jsonb END
         ) AS m
         WHERE a.closed_at >= $1::timestamptz
           AND COALESCE((m->>'isBot')::boolean, FALSE) = FALSE
           AND (m->>'createdAt')::timestamptz >= $1::timestamptz AND (m->>'createdAt')::timestamptz < $2::timestamptz
         ORDER BY (m->>'createdAt')::timestamptz`,
        [from, to]
    );

    const threads = new Map();
    for (const row of [...live.rows, ...archived.rows]) {
        const key = row.thread_id;
        if (!threads.has(key)) {
            const week = row.week_number != null ? `Week ${row.week_number}` : 'Match thread';
            const division = row.division ? ` ${divisionLabel(row.division)}` : '';
            const teams = row.team1 ? `: ${row.team1} vs ${row.team2}` : '';
            threads.set(key, { channel: `${week}${division}${teams}`, kind: 'match_thread', quotable: false, truncated: false, messages: [] });
        }
        const text = tidy(row.content, lookup);
        if (!text) continue;
        threads.get(key).messages.push({
            id: row.message_id,
            at: row.message_created_at,
            author: lookup.member(row.author_id, cleanName(row.author_display || row.author_username)),
            text,
            reactions: 0,
        });
    }
    return Array.from(threads.values());
}

async function buildLookup(guildId, channels) {
    const members = await pool.query(`SELECT discord_id, display_name, username FROM discord_members`);
    const names = new Map(members.rows.map((m) => [m.discord_id, cleanName(m.display_name || m.username)]));
    const roles = await get(`/guilds/${guildId}/roles`);
    const roleNames = new Map(roles.map((r) => [r.id, r.name]));
    const channelNames = new Map(channels.map((c) => [c.id, c.name]));
    return {
        member: (id, fallback = 'someone') => names.get(id) || cleanName(fallback),
        role: (id) => roleNames.get(id) || 'a role',
        channel: (id) => channelNames.get(id) || 'a channel',
    };
}

/**
 * All readable chat in [from, to).
 * @returns {{ channels: object[], refused: string[], gaps: string[], totals: object }}
 */
async function collectChat({ guildId, settings, from, to, publicOnly = false }) {
    const { readable, refused } = await readableChannels(guildId, settings, { publicOnly });
    const lookup = await buildLookup(guildId, readable);
    const floor = BigInt(snowflakeAt(from));
    const gaps = [];
    const channels = [];

    const flaggedRows = await pool.query(
        `SELECT message_id FROM mod_flags WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz + INTERVAL '1 day'`,
        [from, to]
    );
    const flagged = new Set(flaggedRows.rows.map((r) => r.message_id));

    for (const channel of readable) {
        if (channel.type === FORUM_TYPE) continue;
        if (!channel.lastId || BigInt(channel.lastId) < floor) continue;
        try {
            // eslint-disable-next-line no-await-in-loop
            const { messages, truncated } = await readWindow(channel.id, from, to, lookup, { flagged });
            if (truncated) gaps.push(`#${channel.name} hit the ${CHANNEL_CAP} message cap, so its newest messages are missing.`);
            if (messages.length) channels.push({ channel: channel.name, kind: channel.quotable ? 'public' : 'private', quotable: channel.quotable, truncated, messages });
        } catch (err) {
            gaps.push(`#${channel.name}: ${err.message}`);
        }
    }

    const weekThreads = await pool.query(`SELECT thread_id FROM week_threads WHERE thread_id IS NOT NULL`);
    const skip = new Set(weekThreads.rows.map((r) => r.thread_id));
    const parents = new Map(readable.map((c) => [c.id, c]));
    const { threads, gaps: threadGaps } = await threadsInWindow(guildId, parents, skip, from);
    gaps.push(...threadGaps);
    for (const thread of threads) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const { messages, truncated } = await readWindow(thread.id, from, to, lookup, { flagged });
            if (messages.length) {
                const quotable = thread.parent.quotable;
                channels.push({ channel: `#${thread.parent.name} > ${thread.name}`, kind: quotable ? 'public_thread' : 'private_thread', quotable, truncated, messages });
            }
        } catch (err) {
            gaps.push(`Thread ${thread.name}: ${err.message}`);
        }
    }

    channels.push(...await matchThreads(from, to, lookup));

    const totals = {
        channels: channels.length,
        messages: channels.reduce((sum, c) => sum + c.messages.length, 0),
        characters: channels.reduce((sum, c) => sum + c.messages.reduce((n, m) => n + m.text.length, 0), 0),
    };
    return { channels, refused, gaps, totals, lookup };
}

/** Bot announcements in a channel, for salary moves. Text only. */
async function readAnnouncements(channelId, from, to, lookup) {
    const { messages } = await readWindow(channelId, from, to, lookup, { bots: true });
    return messages.map((m) => ({ at: m.at, text: m.text }));
}

/** The last long posts in the Insider channel, so an issue doesn't repeat them. */
async function recentIssues(channelId, before, lookup, count = 3) {
    const page = await get(`/channels/${channelId}/messages?limit=50&before=${snowflakeAt(before)}`);
    return page
        .filter((m) => (m.content || '').length >= 400)
        .slice(0, count)
        .map((m) => ({ at: m.timestamp, author: lookup.member(m.author?.id, m.author?.username), text: tidy(m.content, lookup) }));
}

async function guildEmoji(guildId) {
    const list = await get(`/guilds/${guildId}/emojis`);
    return list.map((e) => e.name);
}

module.exports = { collectChat, readAnnouncements, recentIssues, guildEmoji, readableChannels, snowflakeAt };
