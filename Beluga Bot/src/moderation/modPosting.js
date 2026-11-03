/**
 * Everything the moderation system says in Discord: the public posts (same format
 * staff used by hand), the #timeout-log embeds, member DMs and the /modlog cards.
 *
 * Staff names appear in #timeout-log and /modlog only, never in public posts or DMs.
 * Nothing here throws: a failed post must never undo a punishment already applied,
 * so failures come back as `null` / `{ok:false}` and are logged.
 */

const { EmbedBuilder } = require('discord.js');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { CHANNELS, ruleByCode, refChannelId } = require('./modConfig');
const { STRIKE_LIMIT } = require('./modStore');

const COLORS = {
    note: 0x5865F2, warn: 0xF1C40F, timeout: 0xE67E22, untimeout: 0x2ECC71, strike: 0xE74C3C,
    unstrike: 0x2ECC71, suspend: 0xC0392B, unsuspend: 0x2ECC71, kick: 0xD35400, ban: 0x992D22,
    unban: 0x2ECC71, filter: 0x9B59B6, void: 0x95A5A6,
};

const KIND_LABEL = {
    note: 'Staff note', warn: 'Warning', timeout: 'Timeout', untimeout: 'Timeout removed', strike: 'Strike',
    unstrike: 'Strike removed', suspend: 'Suspension', unsuspend: 'Suspension lifted', kick: 'Kick',
    ban: 'Ban', unban: 'Unban', filter: 'Chat filter timeout',
};

const SOURCE_LABEL = {
    command: 'Discord command', website: 'Admin panel', filter: 'Chat filter', outside: 'Outside Discord action',
    import: 'Imported history', system: 'System',
};

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

function clip(value, max = 1024) {
    const s = String(value ?? '').trim() || 'None';
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "2 days", "1 hour", "10 minutes". */
function formatDuration(seconds) {
    const s = Math.max(0, Math.round(seconds || 0));
    const units = [[604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (const [size, name] of units) {
        if (s >= size && s % size === 0) {
            const n = s / size;
            return `${n} ${name}${n === 1 ? '' : 's'}`;
        }
    }
    if (s >= 3600) return `${(s / 3600).toFixed(1)} hours`;
    if (s >= 60) return `${Math.round(s / 60)} minutes`;
    return `${s} seconds`;
}

const stamp = (date, style = 'F') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

function suspensionLengthText(unit, total) {
    if (unit === 'indefinite') return 'Indefinite';
    const n = parseInt(total, 10) || 0;
    const word = n >= 0 && n <= 10 ? NUMBER_WORDS[n] : String(n);
    const noun = { series: 'Series', days: 'Day', weeks: 'Week', seasons: 'Season' }[unit] || 'Series';
    return `${word} ${noun}`;
}

function caseTitle(c) {
    if (c.kind === 'strike') return `Strike ${c.strike_number || '?'}/${STRIKE_LIMIT}`;
    return KIND_LABEL[c.kind] || c.kind;
}

async function sendTo(client, channelId, payload, what) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased?.()) throw new Error('Channel is not text based');
        return await channel.send(payload);
    } catch (err) {
        Logger.error(`moderation: could not post ${what}`, err);
        higgenLog.logFailure({
            summary: `The moderation system could not post ${what}: ${err.message}`,
            error: err, action: 'moderation.post', where: `Channel ${channelId}`,
        });
        return null;
    }
}

// ── public posts (the old hand-typed format) ──────────────────────────────────

function ruleRef(c) {
    return `<#${refChannelId(ruleByCode(c.rule_code))}>`;
}

function ping(id) {
    return { parse: [], users: [String(id)] };
}

async function postWarning(client, c) {
    return sendTo(client, CHANNELS.STRIKES, {
        content: `<@${c.discord_id}> ONLY warning for ${c.reason} (ref ${ruleRef(c)})`,
        allowedMentions: ping(c.discord_id),
    }, 'a warning');
}

async function postStrike(client, c) {
    const banned = (c.strike_number || 0) >= STRIKE_LIMIT;
    const tail = banned ? ' This results in a ban.' : '';
    return sendTo(client, CHANNELS.STRIKES, {
        content: `<@${c.discord_id}> Strike ${c.strike_number}/${STRIKE_LIMIT} for ${c.reason} ${ruleRef(c)}${tail}`,
        allowedMentions: ping(c.discord_id),
    }, 'a strike');
}

async function postStrikeRemoval(client, c, number) {
    return sendTo(client, CHANNELS.STRIKES, {
        content: `<@${c.discord_id}> Removal of Strike ${number}`,
        allowedMentions: ping(c.discord_id),
    }, 'a strike removal');
}

async function postKick(client, c) {
    return sendTo(client, CHANNELS.STRIKES, {
        content: `<@${c.discord_id}> Kicked for ${c.reason} (ref ${ruleRef(c)})`,
        allowedMentions: ping(c.discord_id),
    }, 'a kick');
}

async function postBan(client, c) {
    return sendTo(client, CHANNELS.STRIKES, {
        content: `<@${c.discord_id}> Ban for ${c.reason} (ref ${ruleRef(c)})`,
        allowedMentions: ping(c.discord_id),
    }, 'a ban');
}

async function postSuspension(client, c, suspension) {
    const length = `${suspensionLengthText(suspension.unit, suspension.total)} Suspension`;
    const basis = c.kind === 'strike' ? `Strike ${c.strike_number} rule ref` : `${c.reason}, ref`;
    return sendTo(client, CHANNELS.SUSPENSIONS, {
        content: `<@${c.discord_id}> ${length} (${basis} ${ruleRef(c)})`,
        allowedMentions: ping(c.discord_id),
    }, 'a suspension');
}

async function postSuspensionLifted(client, discordId) {
    return sendTo(client, CHANNELS.GENERAL, {
        content: `<@${discordId}> Your suspension has been served and you are eligible to play again.`,
        allowedMentions: ping(discordId),
    }, 'a suspension lift');
}

// ── #timeout-log ──────────────────────────────────────────────────────────────

function caseEmbed(c, { problems = [], extra = [] } = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`Case ${c.id}: ${caseTitle(c)}`.slice(0, 256))
        .setColor(c.status === 'voided' ? COLORS.void : (COLORS[c.kind] || 0x5865F2))
        .addFields(
            { name: 'Member', value: clip(`<@${c.discord_id}>${c.target_name ? ` (${c.target_name})` : ''}\n\`${c.discord_id}\``), inline: true },
            { name: 'Staff', value: clip(c.actor_id ? `<@${c.actor_id}>${c.actor_name ? ` (${c.actor_name})` : ''}` : (c.actor_name || 'System')), inline: true },
            { name: 'Source', value: clip(SOURCE_LABEL[c.source] || c.source), inline: true },
        )
        .setTimestamp(new Date(c.created_at));
    if (c.rule_label) embed.addFields({ name: 'Rule', value: clip(c.rule_label) });
    embed.addFields({ name: 'Reason', value: clip(c.reason) });
    if (c.duration_seconds) {
        embed.addFields({
            name: 'Timeout',
            value: clip(`${formatDuration(c.duration_seconds)}${c.expires_at ? `, ends ${stamp(c.expires_at)}` : ''}`),
        });
    }
    for (const row of extra) embed.addFields({ name: clip(row.name, 256), value: clip(row.value), inline: !!row.inline });
    if (problems.length) embed.addFields({ name: 'Not completed', value: clip(problems.map((p) => `• ${p}`).join('\n')) });
    if (c.status === 'voided') {
        embed.addFields({ name: 'Voided', value: clip(`${c.void_reason || 'No reason'} (by ${c.voided_by_name || 'staff'})`) });
    }
    return embed;
}

async function postLog(client, c, opts = {}) {
    return sendTo(client, CHANNELS.TIMEOUT_LOG, {
        embeds: [caseEmbed(c, opts)],
        components: opts.components || [],
        allowedMentions: { parse: [] },
    }, 'a moderation log entry');
}

// ── DMs ───────────────────────────────────────────────────────────────────────

/**
 * DM a member and mirror it into the DM Center. A closed-DM failure is an expected
 * outcome, so it's returned rather than logged as an error.
 */
async function dmMember(client, discordId, content) {
    try {
        const user = await client.users.fetch(String(discordId));
        const sent = await user.send({ content: clip(content, 2000), allowedMentions: { parse: [] } });
        try {
            const { recordOutgoing } = require('../dm/dmInbox');
            await recordOutgoing({
                discordId: String(discordId), content, authorName: 'Moderation', source: 'moderation',
                discordMessageId: sent.id, displayName: user.globalName || user.username, avatarUrl: user.displayAvatarURL?.() || null,
            });
        } catch { /* mirroring never blocks a DM */ }
        return { ok: true };
    } catch (err) {
        const closed = err?.code === 50007;
        return { ok: false, error: closed ? 'Their DMs are closed.' : (err?.message || 'DM failed.') };
    }
}

module.exports = {
    COLORS, KIND_LABEL, SOURCE_LABEL, clip, formatDuration, stamp, suspensionLengthText, caseTitle, sendTo,
    postWarning, postStrike, postStrikeRemoval, postKick, postBan, postSuspension, postSuspensionLifted,
    caseEmbed, postLog, dmMember,
};
