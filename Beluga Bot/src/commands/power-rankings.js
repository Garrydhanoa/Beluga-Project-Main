const { SlashCommandBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { isSalaryCrew } = require('../stats/report/threadContext');
const { refreshPowerRankings } = require('../stats/powerRankings');
const { buildPowerRankingsImage } = require('../stats/powerCard');
const { resolveWeek, weekHeader } = require('../utils/weekNumber');
const Logger = require('../utils/logger');

/**
 * /power-rankings — salary-crew only. Recomputes ALL THREE divisions' power
 * rankings (teams + players) from recent form, saves them (with trend arrows
 * vs the previous run), and posts one graphic per division here (Majors → AAA
 * → AA). The command only acks quietly (ephemeral); the images go straight to
 * the channel. Player rows show their Discord avatars.
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
                .setDescription('Week number to show in the header (defaults to the current week)')
                .setMinValue(1)
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
            const week = resolveWeek(interaction, season);
            const header = weekHeader(week);

            let posted = 0;
            const empty = [];
            for (const division of DIVISIONS) {
                // eslint-disable-next-line no-await-in-loop
                const { teams, players } = await refreshPowerRankings(season.id, division);
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
                    division, seasonNumber,
                    teams: teams.slice(0, 10), players: topPlayers,
                });
                // First posted image carries the WEEK + season header line.
                const content = posted === 0
                    ? `${header ? `${header}\n` : ''}📈 **Power Rankings — Season ${seasonNumber ?? ''}**`
                    : undefined;
                // eslint-disable-next-line no-await-in-loop
                await interaction.channel.send({
                    content,
                    files: [{ attachment: img, name: `${division.toLowerCase()}-power-rankings.png` }],
                });
                posted += 1;
            }

            if (!posted) {
                await interaction.editReply('📭 No recorded results in any division yet — power rankings appear after the first reported series.');
                return;
            }
            await interaction.editReply(
                `✅ Posted power rankings for ${posted} division${posted === 1 ? '' : 's'}.${empty.length ? ` (No results yet: ${empty.join(', ')})` : ''}`
            );
        } catch (error) {
            Logger.error('/power-rankings failed', error);
            await interaction.editReply('❌ Failed to build power rankings. Check the logs.').catch(() => {});
        }
    },
};
