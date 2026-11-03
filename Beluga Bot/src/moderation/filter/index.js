/**
 * Chat filter entry points. bot.js calls onMessage / onMessageEdit / onAutomodAction.
 *
 *   slurs   no joke exception: delete, 5-minute timeout, tell the member, ask staff.
 *           The word list catches these first; a slur that got past it and that the AI
 *           catches twice over gets the same treatment.
 *   spam    delete, 10-minute timeout
 *   AI      abuse and discrimination are flag only, staff decide
 *
 * The six Discord AutoMod rules stay as they are. A message they block never reaches
 * MessageCreate, so the AutoMod event feeds the same slur handling.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AutoModerationActionType } = require('discord.js');
const { pool } = require('../../utils/database');
const Logger = require('../../utils/logger');
const higgenLog = require('../../utils/higgenLog');
const { ROLES } = require('../../constants/roles');
const { db, ensureModSchema } = require('../modSchema');
const { CHANNELS, ruleByCode, getSettings, asBool, asInt, asList } = require('../modConfig');
const { rankOf, RANK } = require('../modPerms');
const { getGuild } = require('../modGuild');
const actions = require('../actions');
const store = require('../modStore');
const posting = require('../modPosting');
const matcher = require('./matcher');
const spam = require('./spam');
const aiBatcher = require('./aiBatcher');

const FILTER_ACTOR = { id: null, name: 'Chat filter', source: 'filter' };
const DEDUPE_MS = 15 * 1000;
const MAX_SPAM_DELETES = 20;

let ready = false;
let filterClient = null;
const recentAutomod = new Map();

function channelListed(channel, list) {
    if (!list.length || !channel) return false;
    return list.includes(channel.id) || list.includes(channel.parentId) || list.includes(channel.parent?.parentId);
}

function isExempt(member, settings) {
    const exempt = asList(settings.filter_exempt_roles);
    return !!exempt.length && exempt.some((id) => member?.roles?.cache?.has(id));
}

function isFlagOnly(channel, settings) {
    return channelListed(channel, asList(settings.filter_flag_only_channels))
        || /^ticket-/i.test(channel?.name || '');
}

async function insertFlag({ layer, messageId, channel, author, authorName, content, matched, verdict = null, model = null }) {
    const { rows } = await pool.query(
        `INSERT INTO mod_flags (layer, message_id, channel_id, channel_name, author_id, author_name, content, matched, verdict, model)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) ON CONFLICT DO NOTHING RETURNING *`,
        [layer, messageId, channel?.id || null, channel?.name || null, author, authorName, String(content || '').slice(0, 2000), matched, verdict ? JSON.stringify(verdict) : null, model],
    );
    return rows[0] || null;
}

function alertEmbed(flag, { title, color, lines = [] }) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(posting.clip(flag.content, 3500))
        .addFields(
            { name: 'Member', value: posting.clip(`<@${flag.author_id}>${flag.author_name ? ` (${flag.author_name})` : ''}\n\`${flag.author_id}\``), inline: true },
            { name: 'Channel', value: posting.clip(flag.channel_id ? `<#${flag.channel_id}>` : 'Unknown'), inline: true },
        )
        .setFooter({ text: `Flag ${flag.id}` })
        .setTimestamp(new Date(flag.created_at));
    for (const row of lines) embed.addFields({ name: row.name, value: posting.clip(row.value), inline: !!row.inline });
    return embed;
}

async function priorHits(authorId) {
    const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM mod_flags WHERE author_id = $1 AND layer = 'slur'
            AND status <> 'dismissed' AND created_at > NOW() - INTERVAL '30 days'`,
        [authorId],
    );
    return rows[0]?.n || 0;
}

/** True once the message is gone, including when someone beat us to it. */
async function removeMessage(message, channel, messageId) {
    try {
        if (message) await message.delete();
        else await channel.messages.delete(messageId);
        return true;
    } catch (err) {
        return err?.code === 10008;
    }
}

/** A slur from the word list, or from the AI when `ai` is { verdict, model }. */
async function handleSlur({ client, guild, member, user, channel, messageId, content, word, message = null, settings, ai = null }) {
    const authorName = member?.displayName || user?.username || null;
    const flag = await insertFlag({
        layer: 'slur', messageId, channel, author: user.id, authorName, content, matched: word,
        verdict: ai?.verdict || null, model: ai?.model || null,
    });
    if (!flag) return false;

    const flagOnly = isFlagOnly(channel, settings);
    const seconds = asInt(settings.filter_slur_timeout_seconds, 300);
    const problems = [];
    let result = null;
    if (!flagOnly) {
        // A message Discord AutoMod blocked has nothing left to delete.
        if ((message || ai) && !(await removeMessage(message, channel, messageId))) {
            problems.push('The message could not be deleted.');
        }
        result = await actions.timeout({
            client, guild, target: { id: user.id, name: authorName }, member, actor: FILTER_ACTOR,
            rule: ruleByCode('coc4'),
            reason: ai ? 'The AI chat check removed a message containing a slur' : 'The chat filter removed a message containing a banned word',
        }, {
            seconds,
            kind: 'filter',
            dmText: `You were automatically timed out in Beluga League for ${posting.formatDuration(seconds)} because your message contained a word that is not allowed here. Staff will review it.\n\nYour message: ${posting.clip(content, 1000)}`,
        });
        problems.push(...(result.problems || []));
        await store.addEvidenceText({ caseId: result.case.id, text: content, sourceMessageId: messageId });
        await pool.query('UPDATE mod_flags SET case_id = $2 WHERE id = $1', [flag.id, result.case.id]);
    }

    const hits = await priorHits(user.id);
    const msg = await posting.sendTo(client, CHANNELS.AUTOMOD_LOG, {
        content: `<@&${ROLES.SALARY_CREW}>`,
        embeds: [alertEmbed(flag, {
            title: flagOnly
                ? `${ai ? 'AI caught a slur' : 'Banned word'} (flag only, no action taken)`
                : `${ai ? 'AI caught a slur' : 'Banned word'}: timed out for ${posting.formatDuration(seconds)}`,
            color: posting.COLORS.ban,
            lines: [
                { name: 'Matched', value: `||${word}||`, inline: true },
                { name: 'Hits in 30 days', value: String(hits), inline: true },
                ...(ai ? [{ name: 'Why', value: `${posting.clip(ai.verdict.why, 300)} (${Math.round((Number(ai.verdict.confidence) || 0) * 100)}% sure, ${ai.model})` }] : []),
                ...(problems.length ? [{ name: 'Not completed', value: problems.join('\n') }] : []),
            ],
        })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`md:fl:bad:${flag.id}`).setLabel('Yes, it is bad').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`md:fl:ok:${flag.id}`).setLabel('No, false alarm').setStyle(ButtonStyle.Secondary),
        )],
        allowedMentions: { parse: [], roles: [ROLES.SALARY_CREW] },
    }, 'a chat filter alert');
    if (msg) await pool.query('UPDATE mod_flags SET alert_message_id = $2 WHERE id = $1', [flag.id, msg.id]);
    return true;
}

async function handleSpam(message, hit, settings) {
    const member = message.member;
    const authorName = member?.displayName || message.author.username;
    const ids = hit.messages.filter((m) => m.channelId === message.channelId).map((m) => m.id).slice(-MAX_SPAM_DELETES);
    await message.channel.bulkDelete(ids, true).catch(() => {});
    const seconds = asInt(settings.filter_spam_timeout_seconds, 600);
    const flag = await insertFlag({
        layer: 'spam', messageId: message.id, channel: message.channel, author: message.author.id,
        authorName, content: message.content, matched: hit.kind,
    });
    const result = await actions.timeout({
        client: message.client, guild: message.guild, target: { id: message.author.id, name: authorName }, member,
        actor: FILTER_ACTOR, rule: ruleByCode('spam'), reason: `Spam: ${hit.kind}`,
    }, { seconds, kind: 'filter' });
    if (!flag) return;
    await pool.query('UPDATE mod_flags SET case_id = $2 WHERE id = $1', [flag.id, result.case.id]);
    const msg = await posting.sendTo(message.client, CHANNELS.AUTOMOD_LOG, {
        embeds: [alertEmbed(flag, {
            title: `Spam: timed out for ${posting.formatDuration(seconds)}`,
            color: posting.COLORS.timeout,
            lines: [{ name: 'Detected', value: hit.kind }],
        })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`md:fl:ok:${flag.id}`).setLabel('False alarm').setStyle(ButtonStyle.Secondary),
        )],
        allowedMentions: { parse: [] },
    }, 'a spam alert');
    if (msg) await pool.query('UPDATE mod_flags SET alert_message_id = $2 WHERE id = $1', [flag.id, msg.id]);
}

/** A slur past the word list that the AI confirmed twice. See aiBatcher.judgeSlur. */
async function handleAiSlur(item, verdict, model) {
    if (matcher.isAllowed(verdict.word)) {
        await handleAiFlag(item, verdict, model, []);
        return;
    }
    const settings = await getSettings();
    const guild = getGuild(filterClient);
    const channel = await filterClient.channels.fetch(item.channelId).catch(() => null);
    const member = await guild.members.fetch(item.authorId).catch(() => null);
    const user = member?.user || await filterClient.users.fetch(item.authorId);
    await handleSlur({
        client: filterClient, guild, member, user, channel, messageId: item.id, content: item.content,
        word: verdict.word || 'unknown', settings, ai: { verdict, model },
    });
}

/** Everything else the AI raises: an embed asking staff what to do. */
async function handleAiFlag(item, verdict, model, context) {
    const flag = await insertFlag({
        layer: 'ai', messageId: item.id, channel: { id: item.channelId, name: item.channelName },
        author: item.authorId, authorName: item.authorName, content: item.content, matched: verdict.label, verdict, model,
    });
    if (!flag) return;
    const label = { discrimination: 'Discrimination', slur: 'Possible slur' }[verdict.label] || 'Targeted abuse';
    const earlier = context.map((c) => `**${c.authorName}:** ${posting.clip(c.content, 150)}`).join('\n');
    const msg = await posting.sendTo(filterClient, CHANNELS.AUTOMOD_LOG, {
        embeds: [alertEmbed(flag, {
            title: `AI flag: ${label}. Is this timeoutable?`,
            color: posting.COLORS.warn,
            lines: [
                { name: 'Why', value: `${posting.clip(verdict.why, 300)} (${Math.round((Number(verdict.confidence) || 0) * 100)}% sure)` },
                { name: 'Jump', value: `https://discord.com/channels/${item.guildId}/${item.channelId}/${item.id}` },
                ...(earlier ? [{ name: 'Earlier in the chat', value: earlier }] : []),
            ],
        })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`md:fl:yes:${flag.id}`).setLabel('Yes, time out').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`md:fl:no:${flag.id}`).setLabel('No').setStyle(ButtonStyle.Secondary),
        )],
        allowedMentions: { parse: [] },
    }, 'an AI flag');
    if (msg) await pool.query('UPDATE mod_flags SET alert_message_id = $2 WHERE id = $1', [flag.id, msg.id]);
}

function report(err, where) {
    Logger.error(`Chat filter failed (${where})`, err);
    higgenLog.logFailure({ summary: `The chat filter failed while ${where}: ${err.message}`, error: err, action: 'moderation.filter', where: 'Chat filter' });
}

async function scan(message, { edited }) {
    const settings = await getSettings();
    if (!asBool(settings.filter_enabled)) return false;
    if (channelListed(message.channel, asList(settings.filter_ignored_channels))) return false;
    if (isExempt(message.member, settings)) return false;

    if (asBool(settings.filter_slur_enabled) && message.content) {
        const hit = matcher.matchText(message.content);
        if (hit) {
            const handled = await handleSlur({
                client: message.client, guild: message.guild, member: message.member, user: message.author,
                channel: message.channel, messageId: message.id, content: message.content, word: hit.word, message, settings,
            });
            if (handled) return true;
        }
    }
    if (!edited && asBool(settings.filter_spam_enabled)
        && rankOf(message.member) < RANK.TRIAL && !isFlagOnly(message.channel, settings)) {
        const hit = spam.check(message, settings);
        if (hit) {
            await handleSpam(message, hit, settings);
            return true;
        }
    }
    if (!channelListed(message.channel, asList(settings.filter_ai_excluded_channels)) && !/^ticket-/i.test(message.channel?.name || '')) {
        await aiBatcher.enqueue(message, settings);
    }
    return false;
}

/** @returns {Promise<boolean>} true when the message was removed */
async function onMessage(message) {
    if (!ready || !message.guild || message.author?.bot || message.webhookId) return false;
    try {
        return await scan(message, { edited: false });
    } catch (err) {
        report(err, 'checking a message');
        return false;
    }
}

/** Posting something clean and editing it afterwards shouldn't get past the filter. */
async function onMessageEdit(oldMessage, newMessage) {
    if (!ready) return;
    try {
        const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
        if (!message?.guild || message.author?.bot || message.webhookId) return;
        if (oldMessage?.content === message.content) return;
        await scan(message, { edited: true });
    } catch (err) {
        report(err, 'checking an edited message');
    }
}

/** A message AutoMod blocked never reaches MessageCreate; this is its only trace. */
async function onAutomodAction(execution) {
    if (!ready) return;
    try {
        if (execution.action?.type === AutoModerationActionType.SendAlertMessage) return;
        const key = `${execution.userId}:${execution.ruleId}:${execution.content}`;
        const now = Date.now();
        for (const [k, at] of recentAutomod) if (now - at > DEDUPE_MS) recentAutomod.delete(k);
        if (recentAutomod.has(key)) return;
        recentAutomod.set(key, now);

        const settings = await getSettings();
        if (!asBool(settings.filter_enabled) || !asBool(settings.filter_slur_enabled)) return;
        const content = execution.content || execution.matchedContent || '';
        const hit = matcher.matchText(content) || (execution.matchedKeyword ? matcher.matchText(execution.matchedKeyword) : null);
        if (!hit) return;
        const guild = execution.guild;
        const member = await guild.members.fetch(execution.userId).catch(() => null);
        const user = member?.user || await guild.client.users.fetch(execution.userId);
        const channel = execution.channelId ? await guild.channels.fetch(execution.channelId).catch(() => null) : null;
        await handleSlur({
            client: guild.client, guild, member, user, channel,
            messageId: `automod:${execution.ruleId}:${execution.userId}:${now}`,
            content, word: hit.word, settings,
        });
    } catch (err) {
        report(err, 'handling a Discord AutoMod action');
    }
}

/** What the filter would do with a message. Used by the Mod Logs test box. */
async function testMessage(text) {
    const settings = await getSettings();
    const hit = matcher.matchText(text);
    const parts = [hit
        ? `Word engine: matched "${hit.word}", so it would delete the message and time them out.`
        : 'Word engine: no match.'];
    try {
        const { verdict, model, second } = await aiBatcher.classifyOne(text, settings);
        const percent = Math.round((Number(verdict.confidence) || 0) * 100);
        const flagged = ['targeted', 'discrimination', 'slur'].includes(verdict.label)
            && (Number(verdict.confidence) || 0) >= (parseFloat(settings.filter_ai_confidence) || 0.8);
        const bar = parseFloat(settings.filter_ai_slur_confidence) || 0.9;
        const acts = asBool(settings.filter_ai_slur_action) && verdict.label === 'slur' && flagged
            && second?.slur && Number(second.confidence) >= bar;
        const outcome = acts ? 'it would delete the message, time them out and ask staff' : (flagged ? 'it would flag this for staff' : 'no flag');
        parts.push(`AI (${model}): ${verdict.label}, ${percent}% sure, ${outcome}. ${verdict.why || ''}`);
    } catch (err) {
        parts.push(`AI: unavailable (${err.message}).`);
    }
    return parts.join(' ');
}

async function startFilter(client) {
    if (!db() || !(await ensureModSchema())) return;
    const guild = getGuild(client);
    if (guild) await matcher.seedIfEmpty(guild).catch((err) => Logger.error('Chat filter word seeding failed', err));
    await matcher.reload();
    filterClient = client;
    aiBatcher.init(client, handleAiFlag, handleAiSlur);
    ready = true;
}

module.exports = { startFilter, onMessage, onMessageEdit, onAutomodAction, testMessage, isFlagOnly };
