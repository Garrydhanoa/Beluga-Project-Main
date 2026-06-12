const { SlashCommandBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { isSalaryCrew } = require('../stats/report/threadContext');
const { refreshPowerRankings } = require('../stats/powerRankings');
const { buildPowerRankingsImage } = require('../stats/powerCard');
const Logger = require('../utils/logger');

/**
 * /power-rankings — salary-crew only. Recomputes ALL THREE divisions' power
 * rankings (teams + players) from recent form, saves them (with trend arrows
 * vs the previous run), and posts one graphic per division here.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('power-rankings')
        .setDescription('Salary crew: recompute + post power rankings for all divisions.')
        .setDMPermission(false),

    async execute(interaction) {
        if (!isSalaryCrew(interaction.member)) {
            await interaction.reply({ content: '❌ Only **salary crew** can post power rankings.', flags: 64 });
            return;
        }
        await interaction.deferReply();
        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) {
                await interaction.editReply('❌ No active season.');
                return;
            }
            const seasonNumber = season.season_number ?? season.seasonNumber ?? null;
            const files = [];
            const empty = [];
            for (const division of ['Majors', 'AAA', 'AA']) {
                const { teams, players } = await refreshPowerRankings(season.id, division);
                if (!teams.length && !players.length) {
                    empty.push(division);
                    continue;
                }
                const img = await buildPowerRankingsImage({
                    division, seasonNumber,
                    teams: teams.slice(0, 10), players: players.slice(0, 10),
                });
                files.push({ attachment: img, name: `${division.toLowerCase()}-power-rankings.png` });
            }
            if (!files.length) {
                await interaction.editReply('📭 No recorded results in any division yet — power rankings appear after the first reported series.');
                return;
            }
            await interaction.editReply({
                content: `📈 **Power Rankings — Season ${seasonNumber ?? ''}**${empty.length ? `\n-# No results yet in: ${empty.join(', ')}` : ''}`,
                files,
            });
        } catch (error) {
            Logger.error('/power-rankings failed', error);
            await interaction.editReply('❌ Failed to build power rankings. Check the logs.');
        }
    },
};
