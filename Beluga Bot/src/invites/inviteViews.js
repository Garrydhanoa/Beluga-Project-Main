/**
 * Embeds + components for /invite-leaderboard, /invites and the live board.
 *
 * Leaderboard controls carry the OWNER's id in their customId so only the person
 * who ran the command can drive them (the router enforces it). Pages are rebuilt
 * from the DB on every click — no sessions to expire.
 *
 *   inv:lb:<owner>:<c|l>:<page>     ◀ / ▶ / Campaign⇄Lifetime
 *   inv:lbp:<owner>:<c|l>:<page>    "View a person" select (value = discord id)
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { leaderboardPage, personStats } = require('./inviteCounts');
const { siteUrl, siteLabel } = require('../utils/siteFooter');

const ACCENT = 0x22d3ee; // cyan — the league's ocean accent
const MEDAL = ['🥇', '🥈', '🥉'];
const ts = (d, style = 'D') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;

function nameOf(guild, id) {
    const m = guild?.members?.cache?.get(String(id));
    return m?.displayName || m?.user?.username || null;
}

function rankLines(rows) {
    return rows.map((r) => `${r.rank <= 3 ? MEDAL[r.rank - 1] : `**${r.rank}.**`} <@${r.id}> — **${r.total}**`);
}

/** The interactive leaderboard. @param {'c'|'l'} view */
async function buildLeaderboard(guild, ownerId, view = 'c', page = 0) {
    const scope = view === 'l' ? 'lifetime' : 'campaign';
    const data = await leaderboardPage(scope, page, 10);
    const title = scope === 'lifetime'
        ? 'Invite Leaderboard — Lifetime'
        : `Invite Leaderboard — ${data.campaign?.name || 'Campaign'}`;

    const meta = [];
    if (scope === 'campaign' && data.campaign) {
        meta.push(`Since ${ts(data.campaign.starts_at)}`);
        if (data.campaign.ends_at) meta.push(`ends ${ts(data.campaign.ends_at, 'R')}`);
        if (data.campaign.prize) meta.push(`Prize: ${data.campaign.prize}`);
    }
    const body = data.rows.length ? rankLines(data.rows).join('\n') : 'No invites counted yet.';
    const footerLines = [
        `Page ${data.page + 1}/${data.pageCount} · Last reset: ${data.lastReset ? ts(data.lastReset) : 'never'}`,
        `-# [View current and lifetime invites on ${siteLabel()}](<${siteUrl('/invites')}>)`,
    ];
    const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(title)
        .setDescription([meta.length ? meta.join(' · ') : null, body, '', ...footerLines].filter((l) => l !== null).join('\n'));

    const v = view === 'l' ? 'l' : 'c';
    // The trailing p/n/t keeps the three ids unique: on a single page ◀ and ▶ both
    // target page 0, and Discord rejects a message with duplicate custom ids.
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`inv:lb:${ownerId}:${v}:${Math.max(0, data.page - 1)}:p`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(data.page === 0),
        new ButtonBuilder().setCustomId(`inv:lb:${ownerId}:${v}:${Math.min(data.pageCount - 1, data.page + 1)}:n`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(data.page >= data.pageCount - 1),
        new ButtonBuilder().setCustomId(`inv:lb:${ownerId}:${v === 'l' ? 'c' : 'l'}:0:t`).setLabel(v === 'l' ? 'Show campaign' : 'Show lifetime').setStyle(ButtonStyle.Primary),
    );
    const components = [buttons];
    if (data.rows.length) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(`inv:lbp:${ownerId}:${v}:${data.page}`)
            .setPlaceholder('View a person')
            .addOptions(data.rows.map((r) => ({
                label: `${r.rank}. ${nameOf(guild, r.id) || `User ${r.id.slice(-4)}`}`.slice(0, 100),
                description: `${r.total} invite${r.total === 1 ? '' : 's'}`,
                value: r.id,
            })));
        components.push(new ActionRowBuilder().addComponents(select));
    }
    return { embeds: [embed], components };
}

/** One person's invite card (ephemeral). */
async function buildPersonCard(guild, discordId) {
    const s = await personStats(discordId);
    const name = nameOf(guild, discordId) || `User ${String(discordId).slice(-4)}`;
    const lines = [
        `**${s.campaign?.name || 'Campaign'}:** ${s.campaignTotal} invite${s.campaignTotal === 1 ? '' : 's'}${s.campaignRank ? ` (#${s.campaignRank})` : ''}`,
        `**Lifetime:** ${s.lifetimeTotal} invite${s.lifetimeTotal === 1 ? '' : 's'}${s.lifetimeRank ? ` (#${s.lifetimeRank})` : ''}`,
        `**Pending review:** ${s.pending}`,
        `**Last reset:** ${s.lastReset ? ts(s.lastReset) : 'never'}`,
    ];
    if (s.invitedBy) lines.push(`**Invited by:** <@${s.invitedBy}>`);
    const embed = new EmbedBuilder().setColor(ACCENT).setTitle(`Invites — ${name}`).setDescription(lines.join('\n'));
    if (s.invitees.length) {
        const list = s.invitees.map((i) => `<@${i.id}>${i.thisCampaign ? '' : ' · lifetime'}`).join('\n');
        embed.addFields({ name: `Counted invites (latest ${s.invitees.length})`, value: list.slice(0, 1024) });
    }
    embed.addFields({ name: '​', value: `-# [Full leaderboard on ${siteLabel()}](<${siteUrl('/invites')}>)` });
    return { embeds: [embed] };
}

/** The live board: campaign top 10 only. */
async function buildLiveBoard() {
    const data = await leaderboardPage('campaign', 0, 10);
    const meta = [];
    if (data.campaign) {
        meta.push(`Since ${ts(data.campaign.starts_at)}`);
        if (data.campaign.ends_at) meta.push(`ends ${ts(data.campaign.ends_at, 'R')}`);
    }
    if (data.campaign?.prize) meta.push(`Prize: ${data.campaign.prize}`);
    const body = data.rows.length ? rankLines(data.rows).join('\n') : 'No invites counted yet — invite a friend and have them register.';
    const embed = new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(`Invite Leaderboard — ${data.campaign?.name || 'Campaign'}`)
        .setDescription([
            meta.length ? meta.join(' · ') : null,
            body,
            '',
            `Last reset: ${data.lastReset ? ts(data.lastReset) : 'never'} · Use \`/invites\` to see your own count.`,
            `-# [View current and lifetime invites on ${siteLabel()}](<${siteUrl('/invites')}>)`,
        ].filter((l) => l !== null).join('\n'));
    return { embeds: [embed], key: JSON.stringify({ c: data.campaign?.id, n: data.campaign?.name, p: data.campaign?.prize, e: data.campaign?.ends_at, r: data.rows, l: data.lastReset }) };
}

module.exports = { buildLeaderboard, buildPersonCard, buildLiveBoard };
