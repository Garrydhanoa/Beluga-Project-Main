/**
 * Staff-facing and member-facing cards: /modlog, /case, /my-record and the confirm
 * cards. These build messages only; modRouter.js handles what the buttons do.
 *
 * Every id is `md:<action>:...`, which routes through bot.js's single interaction
 * choke point so each click lands in higgenlogs.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const store = require('./modStore');
const posting = require('./modPosting');
const { RANK } = require('./modPerms');

const PAGE_SIZE = 6;
const { clip, formatDuration, stamp, caseTitle, suspensionLengthText } = posting;

function caseLine(c) {
    const old = c.counts ? '' : ' (old system)';
    const voided = c.status === 'voided' ? ' (voided)' : '';
    const removed = c.status === 'removed' ? ' (removed)' : '';
    const when = stamp(c.created_at, 'd');
    return `**#${c.id}** ${caseTitle(c)}${old}${voided}${removed} · ${when}\n${clip(c.reason, 140)}`;
}

function suspensionLine(s) {
    if (s.unit === 'series') {
        const left = Math.max((s.total || 0) - (s.served || 0), 0);
        const paused = s.status === 'active' && !s.team_id ? ', paused until signed' : '';
        return `${left} of ${s.total} series left${paused}${s.status === 'queued' ? ' (queued)' : ''}`;
    }
    if (s.ends_at) return `${suspensionLengthText(s.unit, s.total)}, ends ${stamp(s.ends_at, 'R')}`;
    return suspensionLengthText(s.unit, s.total) + (s.status === 'queued' ? ' (queued)' : '');
}

function statusFields(summary) {
    const parts = [
        `Strikes: **${summary.strikes}/${store.STRIKE_LIMIT}**${summary.legacyStrikes ? ` (had ${summary.legacyStrikes} under the old system)` : ''}`,
        `Warning: ${summary.warned ? 'used' : 'not used'}`,
    ];
    if (summary.lastChance) parts.push('**Last chance** (rule 6.1.4): any infraction means a ban');
    if (summary.ban) {
        if (summary.ban.ban_type === 'temp') parts.push(`**Banned** until ${stamp(summary.ban.unban_at)}`);
        else if (summary.ban.appeal_after) parts.push(`**Banned**, can appeal from ${stamp(summary.ban.appeal_after, 'D')}`);
        else parts.push('**Banned**');
    }
    for (const s of summary.suspensions) parts.push(`**Suspended**: ${suspensionLine(s)}`);
    return parts.join('\n');
}

async function modlogView(discordId, name, ownerId, page = 0) {
    const summary = await store.memberSummary(discordId);
    const total = await store.countCases(discordId);
    const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
    const current = Math.min(Math.max(page, 0), pages - 1);
    const cases = await store.listCases(discordId, { limit: PAGE_SIZE, offset: current * PAGE_SIZE });
    const embed = new EmbedBuilder()
        .setTitle(`Mod log: ${name || discordId}`.slice(0, 256))
        .setColor(summary.ban ? posting.COLORS.ban : summary.suspensions.length ? posting.COLORS.suspend : 0x3498DB)
        .setDescription(clip(statusFields(summary), 2000))
        .setFooter({ text: `${total} case${total === 1 ? '' : 's'} · page ${current + 1} of ${pages} · ID ${discordId}` });
    if (cases.length) embed.addFields({ name: 'History', value: clip(cases.map(caseLine).join('\n\n')) });
    else embed.addFields({ name: 'History', value: 'Nothing on record.' });
    const components = pages > 1 ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`md:log:${ownerId}:${discordId}:${current - 1}`).setLabel('Newer').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
        new ButtonBuilder().setCustomId(`md:log:${ownerId}:${discordId}:${current + 1}`).setLabel('Older').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    )] : [];
    return { embeds: [embed], components };
}

async function caseView(c, viewerRank) {
    const evidence = await store.evidenceCount(c.id);
    const extra = [];
    if (evidence) extra.push({ name: 'Evidence', value: `${evidence} item${evidence === 1 ? '' : 's'}`, inline: true });
    if (c.strike_number) extra.push({ name: 'Strike', value: `${c.strike_number}/${store.STRIKE_LIMIT}`, inline: true });
    const history = Array.isArray(c.details?.reason_history) ? c.details.reason_history : [];
    if (history.length) {
        extra.push({ name: 'Earlier reasons', value: clip(history.map((h) => `${h.reason} (changed by ${h.by || 'staff'})`).join('\n')) });
    }
    const embed = posting.caseEmbed(c, { extra });
    const row = new ActionRowBuilder();
    if (evidence) row.addComponents(new ButtonBuilder().setCustomId(`md:ev:${c.id}`).setLabel('Show evidence').setStyle(ButtonStyle.Secondary));
    if (viewerRank >= RANK.DIRECTOR && c.status !== 'voided' && c.counts) {
        row.addComponents(new ButtonBuilder().setCustomId(`md:void:${c.id}`).setLabel('Void case').setStyle(ButtonStyle.Danger));
    }
    if (c.details?.needs_reason && viewerRank >= RANK.TRIAL) {
        row.addComponents(new ButtonBuilder().setCustomId(`md:addreason:${c.id}`).setLabel('Add reason').setStyle(ButtonStyle.Primary));
    }
    return { embeds: [embed], components: row.components.length ? [row] : [] };
}

/** Members see their own record, minus staff notes and staff names. */
async function myRecordView(discordId, name) {
    const summary = await store.memberSummary(discordId);
    const cases = (await store.listCases(discordId, { limit: 25, includeLegacy: true }))
        .filter((c) => c.kind !== 'note' && c.status !== 'voided')
        .slice(0, 8);
    const embed = new EmbedBuilder()
        .setTitle(`Your record: ${name}`.slice(0, 256))
        .setColor(summary.suspensions.length ? posting.COLORS.suspend : 0x3498DB)
        .setDescription(clip(statusFields(summary), 2000));
    if (cases.length) embed.addFields({ name: 'Recent', value: clip(cases.map(caseLine).join('\n\n')) });
    else embed.addFields({ name: 'Recent', value: 'Nothing on record.' });
    return { embeds: [embed] };
}

function describePackage(pkg) {
    const lines = [];
    if (pkg.ban) {
        lines.push(pkg.ban.type === 'temp'
            ? `Temp ban until ${stamp(pkg.ban.unbanAt)}`
            : `Ban, can appeal from ${stamp(pkg.ban.appealAfter, 'D')}`);
    } else {
        lines.push(pkg.timeoutSeconds ? `${formatDuration(pkg.timeoutSeconds)} timeout` : 'No timeout');
        lines.push(pkg.suspension ? `${suspensionLengthText(pkg.suspension.unit, pkg.suspension.total)} suspension` : 'No suspension');
    }
    return lines.map((l) => `• ${l}`).join('\n');
}

function confirmRow(requestId, { canApply, hasEdit }) {
    const row = new ActionRowBuilder();
    row.addComponents(new ButtonBuilder()
        .setCustomId(`md:go:${requestId}`)
        .setLabel(canApply ? 'Confirm' : 'Send to Directors')
        .setStyle(canApply ? ButtonStyle.Danger : ButtonStyle.Primary));
    if (hasEdit) row.addComponents(new ButtonBuilder().setCustomId(`md:edit:${requestId}`).setLabel('Edit package').setStyle(ButtonStyle.Secondary));
    row.addComponents(new ButtonBuilder().setCustomId(`md:x:${requestId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
    return row;
}

function strikeCard(request, summary, team, canApply) {
    const p = request.payload;
    const next = summary.strikes + 1;
    const embed = new EmbedBuilder()
        .setTitle(`Confirm Strike ${next}/${store.STRIKE_LIMIT}`)
        .setColor(posting.COLORS.strike)
        .addFields(
            { name: 'Member', value: clip(`<@${p.targetId}>`), inline: true },
            { name: 'Team', value: clip(team ? team.teamName : 'Unsigned'), inline: true },
            { name: 'Record', value: clip(statusFields(summary)) },
            { name: 'Rule', value: clip(p.ruleLabel) },
            { name: 'Reason', value: clip(p.reason) },
            { name: 'Package', value: clip(describePackage(p.pkg)) },
        );
    if (summary.lastChance) embed.setDescription('This member is on last chance. Rule 6.1.4 says any infraction means a ban.');
    if (!canApply) embed.setFooter({ text: 'A ban needs a Director, so this goes to them for approval.' });
    return { embeds: [embed], components: [confirmRow(request.id, { canApply, hasEdit: true })] };
}

function banCard(request, summary, team, canApply) {
    const p = request.payload;
    const embed = new EmbedBuilder()
        .setTitle('Confirm ban')
        .setColor(posting.COLORS.ban)
        .addFields(
            { name: 'Member', value: clip(`<@${p.targetId}>`), inline: true },
            { name: 'Team', value: clip(team ? `${team.teamName} (released automatically)` : 'Unsigned'), inline: true },
            { name: 'Record', value: clip(statusFields(summary)) },
            { name: 'Rule', value: clip(p.ruleLabel) },
            { name: 'Reason', value: clip(p.reason) },
            { name: 'Ban', value: clip(describePackage({ ban: p.ban })) },
        );
    if (!canApply) embed.setFooter({ text: 'A ban needs a Director, so this goes to them for approval.' });
    return { embeds: [embed], components: [confirmRow(request.id, { canApply, hasEdit: false })] };
}

function kickCard(request, summary, team, canApply) {
    const p = request.payload;
    const embed = new EmbedBuilder()
        .setTitle('Confirm kick')
        .setColor(posting.COLORS.ban)
        .addFields(
            { name: 'Member', value: clip(`<@${p.targetId}>`), inline: true },
            { name: 'Team', value: clip(team ? team.teamName : 'Unsigned'), inline: true },
            { name: 'Record', value: clip(statusFields(summary)) },
            { name: 'Rule', value: clip(p.ruleLabel) },
            { name: 'Reason', value: clip(p.reason) },
        );
    if (!canApply) embed.setFooter({ text: 'A kick needs a Director, so this goes to them for approval.' });
    return { embeds: [embed], components: [confirmRow(request.id, { canApply, hasEdit: false })] };
}

/** One-warning rule and last-chance notice for warn, timeout and suspend. */
function noticeCard(request, text) {
    return {
        content: text,
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`md:go:${request.id}`).setLabel('Continue anyway').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`md:x:${request.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        )],
    };
}

/** Sent to #director-chat when a ban or kick from below Director needs approving. */
function requestEmbed(request) {
    const p = request.payload;
    const kick = p.action === 'kick';
    const what = p.action === 'strike' ? `Strike ${p.strikeNumber}/${store.STRIKE_LIMIT} with a ban` : (kick ? 'Kick' : 'Ban');
    const embed = new EmbedBuilder()
        .setTitle(`${kick ? 'Kick' : 'Ban'} request: ${p.targetName || p.targetId}`.slice(0, 256))
        .setColor(posting.COLORS.ban)
        .addFields(
            { name: 'Member', value: clip(`<@${p.targetId}>\n\`${p.targetId}\``), inline: true },
            { name: 'Requested by', value: clip(`<@${request.requested_by_id}>`), inline: true },
            { name: 'Action', value: clip(what), inline: true },
            { name: 'Rule', value: clip(p.ruleLabel) },
            { name: 'Reason', value: clip(p.reason) },
        )
        .setTimestamp(new Date(request.created_at));
    if (!kick) embed.addFields({ name: 'Ban', value: clip(describePackage({ ban: p.action === 'strike' ? p.pkg.ban : p.ban })) });
    return embed;
}

function requestRow(requestId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`md:rq:${requestId}:ok`).setLabel('Approve').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`md:rq:${requestId}:no`).setLabel('Deny').setStyle(ButtonStyle.Secondary),
    );
}

module.exports = {
    PAGE_SIZE, caseLine, statusFields, suspensionLine, modlogView, caseView, myRecordView, describePackage,
    strikeCard, banCard, kickCard, noticeCard, requestEmbed, requestRow,
};
