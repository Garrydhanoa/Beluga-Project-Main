/**
 * DM inbox — the two-way half of the DM Center.
 *
 * Incoming: every DM a member sends the bot is recorded into `dm_messages` and
 * bumps its `dm_conversations` row, so staff read and reply from the website.
 * The bot does NOT answer on its own unless that conversation has `ai_enabled`
 * turned on from the panel — the default is silence, so nothing goes out to a
 * member that staff didn't type.
 *
 * Outgoing: replies typed on the website land in `dm_messages` as
 * direction='out', status='queued'. `drainOutgoing` picks them up and delivers
 * them. Broadcast DMs (dmSender.js) are recorded here too, so a conversation
 * shows the full history either way.
 *
 * Requires GatewayIntentBits.DirectMessages + Partials.Channel (see bot.js).
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const { generateDmReply } = require('./dmAi');
const { getPersona } = require('../ai/persona');
const { pickPrimaryRoster } = require('../utils/primaryDivision');
const { getSheetLeague } = require('../utils/salSheetLookup');

/** Sheet League for a player, or null if the sheet is unreachable. */
async function sheetLeagueFor(discordId) {
    try { return await getSheetLeague(discordId); } catch { return null; }
}

/** Division their stats say they played in this season. */
async function statsDivisionFor(discordId) {
    try {
        const r = await pool.query(
            `SELECT division FROM stats_player_season
              WHERE discord_id = $1 AND is_playoff = FALSE
                AND season_id = (SELECT id FROM seasons WHERE status = 'active' LIMIT 1)
              LIMIT 1`,
            [String(discordId)]
        );
        return r.rows[0]?.division || null;
    } catch { return null; }
}

const MAX_LEN = 2000;
const PREVIEW_LEN = 140;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function preview(text, attachments = []) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, PREVIEW_LEN);
    if (attachments.length) return `[${attachments.length} attachment${attachments.length === 1 ? '' : 's'}]`;
    return '';
}

/**
 * Upsert the conversation row. `unreadDelta` is 1 for an incoming message and 0
 * for anything we send (our own messages never mark a conversation unread).
 */
async function touchConversation({ discordId, displayName, avatarUrl, text, attachments, direction, unreadDelta = 0 }) {
    await pool.query(
        `INSERT INTO dm_conversations
            (discord_id, display_name, avatar_url, last_message_at, last_message_preview, last_direction, unread_count)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6)
         ON CONFLICT (discord_id) DO UPDATE SET
            display_name = COALESCE(EXCLUDED.display_name, dm_conversations.display_name),
            avatar_url = COALESCE(EXCLUDED.avatar_url, dm_conversations.avatar_url),
            last_message_at = CURRENT_TIMESTAMP,
            last_message_preview = EXCLUDED.last_message_preview,
            last_direction = EXCLUDED.last_direction,
            unread_count = dm_conversations.unread_count + $6,
            archived = FALSE,
            updated_at = CURRENT_TIMESTAMP`,
        [String(discordId), displayName || null, avatarUrl || null, preview(text, attachments), direction, unreadDelta]
    );
}

/**
 * Record a message we successfully sent (blast, staff reply, AI reply, welcome).
 *
 * `attachments` mirrors the incoming shape ({name, url, contentType, size}) so the
 * DM Center renders images inline — used by the welcome card. Note Discord CDN URLs
 * are signed and expire (~24h), so an old card thumbnail eventually 404s; the text
 * always survives.
 *
 * `displayName`/`avatarUrl` matter when WE start the conversation (nobody has DMed
 * us yet), otherwise the Inbox list shows a nameless, faceless row.
 *
 * Always writes status='sent' — a 'queued' row would be claimed by drainOutgoing()
 * and delivered a second time.
 */
async function recordOutgoing({
    discordId, content, authorName, authorDiscordId, source = 'blast', discordMessageId = null,
    attachments = [], displayName = null, avatarUrl = null,
}) {
    if (!db()) return;
    try {
        const files = Array.isArray(attachments) ? attachments : [];
        await pool.query(
            `INSERT INTO dm_messages
                (discord_id, direction, content, attachments, author_name, author_discord_id, source, status, discord_message_id, sent_at)
             VALUES ($1, 'out', $2, $3::jsonb, $4, $5, $6, 'sent', $7, CURRENT_TIMESTAMP)`,
            [String(discordId), content, JSON.stringify(files), authorName || null, authorDiscordId || null, source, discordMessageId]
        );
        await touchConversation({ discordId, displayName, avatarUrl, text: content, attachments: files, direction: 'out', unreadDelta: 0 });
    } catch (err) {
        // Never let bookkeeping break an actual send.
        if (!/relation .* does not exist/.test(String(err.message))) {
            Logger.warning(`dmInbox.recordOutgoing failed for ${discordId}: ${err.message}`);
        }
    }
}

/**
 * MessageCreate hook. Returns true when the message was a DM we handled, so the
 * caller can stop processing it as a guild message.
 */
async function captureIncomingDm(message, { aiChat } = {}) {
    // DM channels have no guild. Ignore our own messages and other bots.
    if (message.guild) return false;
    if (message.author?.bot) return true;
    if (!db()) return true;

    const discordId = String(message.author.id);
    const attachments = [...message.attachments.values()].map((a) => ({
        name: a.name,
        url: a.url,
        contentType: a.contentType || null,
        size: a.size || null,
    }));

    try {
        await pool.query(
            `INSERT INTO dm_messages
                (discord_id, direction, content, attachments, author_name, author_discord_id, source, status, discord_message_id)
             VALUES ($1, 'in', $2, $3::jsonb, $4, $1, 'dm', 'sent', $5)`,
            [
                discordId,
                message.content || '',
                JSON.stringify(attachments),
                message.author.globalName || message.author.username || null,
                String(message.id),
            ]
        );

        let avatarUrl = null;
        try { avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 256 }); } catch { /* optional */ }

        await touchConversation({
            discordId,
            displayName: message.author.globalName || message.author.username,
            avatarUrl,
            text: message.content,
            attachments,
            direction: 'in',
            unreadDelta: 1,
        });

        Logger.info(`DM inbox: message from ${message.author.tag} (${discordId})`);
    } catch (err) {
        if (!/relation .* does not exist/.test(String(err.message))) {
            Logger.error(`dmInbox capture failed for ${discordId} — ${err?.code || ''} ${err?.message || err}`);
        }
        return true;
    }

    await maybeAiReply(message, aiChat, discordId);
    return true;
}

/**
 * Auto-reply ONLY when staff have switched AI on for this conversation.
 * Anything the AI says is stored as an outgoing message so the thread reads
 * correctly and staff can see exactly what the member was told.
 *
 * The reply comes from `dm/dmAi.js`, NOT the server chatbot: memory is this DM's
 * own last 15 messages, and the persona (professional / unhinged) is per
 * conversation. The server bot's shared history is never read or written here.
 */
async function maybeAiReply(message, aiChat, discordId) {
    try {
        // ai_enabled is DM-scoped: does the bot answer this person's DMs at all?
        const r = await pool.query(
            `SELECT ai_enabled FROM dm_conversations WHERE discord_id = $1`, [discordId]
        );
        if (!r.rows[0]?.ai_enabled) return;

        // The VOICE, on the other hand, is a property of the person and is the
        // same one they get in the server.
        const persona = await getPersona(discordId);

        const displayName = message.author.globalName || message.author.username;
        await message.channel.sendTyping().catch(() => {});

        const reply = await generateDmReply({
            aiChat,
            discordId,
            displayName,
            userMessage: message.content || '',
            mode: persona,
            // Already stored above — don't feed it back as history.
            excludeMessageId: String(message.id),
        });
        if (!reply) return;

        const text = String(reply).slice(0, MAX_LEN);
        const sent = await message.author.send({ content: text, allowedMentions: { parse: [] } });
        await recordOutgoing({
            discordId,
            content: text,
            authorName: persona === 'unhinged' ? 'Beluga AI (unhinged)' : 'Beluga AI',
            source: 'ai',
            discordMessageId: sent?.id ? String(sent.id) : null,
        });
    } catch (err) {
        Logger.warning(`DM AI reply failed for ${discordId}: ${err?.code || ''} ${err?.message || err}`);
    }
}

/**
 * Substitute the personalization tokens a staff reply may contain, so {name}
 * etc. behave the same in a 1:1 reply as they do in a broadcast rather than
 * being delivered literally.
 */
async function renderReply(discordId, content) {
    let ctx = {};
    let seasonNumber = null;
    try {
        const r = await pool.query(
            `SELECT COALESCE(c.display_name, m.display_name, m.username) AS name
               FROM dm_conversations c
               LEFT JOIN discord_members m ON m.discord_id = c.discord_id
              WHERE c.discord_id = $1 LIMIT 1`,
            [String(discordId)]
        );
        ctx = r.rows[0] || {};

        // A GM is rostered on all three of their franchise's teams, so this used
        // to be a LIMIT 1 over three equally-valid rows — {team}/{division} came
        // out arbitrary. Fetch them all and resolve properly.
        const roster = await pool.query(
            `SELECT tm.name AS team, tm.division, f.name AS franchise
               FROM team_roster_members trm
               JOIN teams tm ON tm.id = trm.team_id
               LEFT JOIN team_franchises f ON f.id = tm.franchise_id
              WHERE trm.discord_id = $1 AND trm.is_active = TRUE AND tm.is_active = TRUE
                AND trm.season_id = (SELECT id FROM seasons WHERE status = 'active' LIMIT 1)`,
            [String(discordId)]
        );
        const picked = pickPrimaryRoster(roster.rows, {
            sheetLeague: await sheetLeagueFor(discordId),
            statsDivision: await statsDivisionFor(discordId),
        });
        if (picked) Object.assign(ctx, picked);

        const s = await pool.query(`SELECT season_number FROM seasons WHERE status = 'active' LIMIT 1`);
        seasonNumber = s.rows[0]?.season_number ?? null;
    } catch { /* tokens degrade to sensible defaults */ }

    const values = {
        name: ctx.name || 'there',
        team: ctx.team || 'Free Agent',
        franchise: ctx.franchise || 'Free Agent',
        division: ctx.division || '—',
        season: seasonNumber ? `S${seasonNumber}` : '—',
    };
    let text = String(content || '').replace(/\{(name|team|franchise|division|season)\}/g, (_m, k) => values[k]);
    if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}…`;
    return text;
}

/**
 * Deliver replies typed on the website. Kept small and frequent so a staff
 * reply lands in the member's DMs within a second or two of hitting send.
 */
async function drainOutgoing(client) {
    if (!db()) return;
    try {
        const res = await pool.query(
            `SELECT id, discord_id, content, author_name FROM dm_messages
              WHERE direction = 'out' AND status = 'queued'
              ORDER BY id LIMIT 20`
        );
        if (!res.rows.length) return;

        for (const row of res.rows) {
            try {
                const user = await client.users.fetch(String(row.discord_id));
                const sent = await user.send({
                    content: await renderReply(row.discord_id, row.content),
                    allowedMentions: { parse: [] },
                });
                await pool.query(
                    `UPDATE dm_messages SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL,
                            discord_message_id = $2
                      WHERE id = $1`,
                    [row.id, sent?.id ? String(sent.id) : null]
                );
            } catch (err) {
                const reason = err?.code === 50007
                    ? 'DMs closed (blocked or privacy settings)'
                    : String(err?.message || err).slice(0, 200);
                Logger.error(
                    `DM reply ${row.id} to ${row.discord_id} failed — ` +
                    `${err?.code || ''} ${err?.message || err} ${JSON.stringify(err?.rawError || {})}`
                );
                await pool.query(
                    `UPDATE dm_messages SET status = 'failed', error = $2 WHERE id = $1`,
                    [row.id, reason]
                ).catch(() => {});
            }
            // Gentle pacing; staff replies are low volume but this keeps a burst safe.
            await sleep(250);
        }
    } catch (err) {
        if (!/relation .* does not exist/.test(String(err.message))) {
            Logger.error('DM outgoing drain failed', err);
        }
    }
}

function startDmInbox(client, pollMs = 2000) {
    if (!db()) {
        Logger.warning('DM inbox not started (no database).');
        return;
    }
    setInterval(() => drainOutgoing(client), pollMs);
    Logger.info('DM inbox started');
}

module.exports = { captureIncomingDm, recordOutgoing, drainOutgoing, startDmInbox };
