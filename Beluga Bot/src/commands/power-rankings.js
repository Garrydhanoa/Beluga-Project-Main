const { SlashCommandBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { isSalaryCrew } = require('../stats/report/threadContext');
const { refreshPowerRankings } = require('../stats/powerRankings');
const { resolveRankingWeek, countUnweekedSeries } = require('../stats/rankingWeek');
const { buildPowerRankingsImage } = require('../stats/powerCard');
const { weekHeader } = require('../utils/weekNumber');
const { siteFooter } = require('../utils/siteFooter');
const Logger = require('../utils/logger');

/**
 * /power-rankings — salary-crew only. Recomputes ALL THREE divisions' power
 * rankings (teams + players) for ONE WEEK and posts one graphic per division
 * here (Majors → AAA → AA). The command only acks quietly (ephemeral); the
 * images go straight to the channel. Player rows show their Discord avatars.
 *
 * The week is a real scope, not a label: form only looks at series up to that
 * week, and only that week's rows are replaced — recalculating week 3 leaves
 * weeks 2 and 4 alone. Trend arrows compare against the previous week, so
 * re-running the same week still shows movement. Omitting `week` targets the
 * latest week that actually has results (league-wide, so all three cards agree).
 */
const DIVISIONS = ['Majors', 'AAA', 'AA'];

/** Fetch a player's Discord avatar as a Buffer (null on any failure). */
async function fetchAvatarBuffer(client, discordId) {
    try {
        const user = await client.users.fetch(String(discordId));
        const url = user.displayAvatarURL({ extension: 'png', size: 64, forceStatic: true });
        const res = await fetch(url);
        if (!res.ok) return null;
        return Buffer.from(await res.arrayBuffer());
    } catch {
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('power-rankings')
        .setDescription('Salary crew: recompute + post power rankings for all divisions.')
        .setDMPermission(false)
        .addIntegerOption((option) =>
            option.setName('week')
                .setDescription('Week to rank — only this week is recalculated (defaults to the latest week with results)')
                .setMinValue(1)
                .setMaxValue(30)
                .setRequired(false)),

    async execute(interaction) {
        if (!isSalaryCrew(interaction.member)) {
            await interaction.reply({ content: '❌ Only **salary crew** can post power rankings.', flags: 64 });
            return;
        }
        // Quiet ack only — keeps the channel clean (no public "used /command").
        await interaction.reply({ content: '📈 Recomputing + posting power rankings…', flags: 64 });
        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) {
                await interaction.editReply('❌ No active season.');
                return;
            }
            const seasonNumber = season.season_number ?? season.seasonNumber ?? null;
            const week = await resolveRankingWeek(season.id, interaction.options.getInteger('week'), season);
            const header = weekHeader(week);

            // Render every division FIRST so we know which one is last — the
            // website footer rides on the final message rather than adding an
            // extra one after the images.
            const empty = [];
            const images = [];
            for (const division of DIVISIONS) {
                // eslint-disable-next-line no-await-in-loop
                const { teams, players } = await refreshPowerRankings(season.id, division, week);
                if (!teams.length && !players.length) {
                    empty.push(division);
                    continue;
                }
                const topPlayers = players.slice(0, 10);
                // Resolve avatars for the top players (best-effort, parallel).
                // eslint-disable-next-line no-await-in-loop
                const avatars = await Promise.all(
                    topPlayers.map((p) => fetchAvatarBuffer(interaction.client, p.discordId))
                );
                topPlayers.forEach((p, i) => { p.avatarBuffer = avatars[i]; });

                // eslint-disable-next-line no-await-in-loop
                const img = await buildPowerRankingsImage({
                    division, seasonNumber, week,
                    teams: teams.slice(0, 10), players: topPlayers,
                });
                images.push({ division, img });
            }

            let posted = 0;
            for (const { division, img } of images) {
                // First image carries the WEEK + season header; the last carries
                // the site footer (both, when only one division posts).
                const lines = [];
                if (posted === 0) {
                    if (header) lines.push(header);
                    lines.push(`📈 **Power Rankings — Season ${seasonNumber ?? ''}${week != null ? `, Week ${week}` : ''}**`);
                }
                if (posted === images.length - 1) lines.push(siteFooter(interaction.guild));
                // eslint-disable-next-line no-await-in-loop
                await interaction.channel.send({
                    content: lines.length ? lines.join('\n') : undefined,
                    files: [{ attachment: img, name: `${division.toLowerCase()}-power-rankings.png` }],
                });
                posted += 1;
            }

            if (!posted) {
                await interaction.editReply(`📭 No recorded results up to week ${week} — power rankings appear after the first reported series.`);
                return;
            }
            // Series reported without a week count toward EVERY week's window.
            // Surface the number instead of letting it skew an early week silently.
            const unweeked = await countUnweekedSeries(season.id).catch(() => 0);
            const notes = [];
            if (empty.length) notes.push(`No results yet: ${empty.join(', ')}.`);
            if (unweeked) notes.push(`${unweeked} series ${unweeked === 1 ? 'has' : 'have'} no week set — they count toward every week.`);
            await interaction.editReply(
                `✅ Posted week ${week} power rankings for ${posted} division${posted === 1 ? '' : 's'}. Only week ${week} was recalculated.${notes.length ? `\n${notes.join(' ')}` : ''}`
            );
        } catch (error) {
            Logger.error('/power-rankings failed', error);
            await interaction.editReply('❌ Failed to build power rankings. Check the logs.').catch(() => {});
        }
    },
};
