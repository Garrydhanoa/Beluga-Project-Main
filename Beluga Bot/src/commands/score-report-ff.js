const { SlashCommandBuilder } = require('discord.js');
const { TEAM_NAMES } = require('../constants/roles');
const { guessWeekFromChannel, submitSeries } = require('../utils/scoreReport');
const Logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('score-report-ff')
        .setDescription('Report a forfeit as a 3-0 series (standings only, no player stats).')
        .addStringOption((option) =>
            option
                .setName('division')
                .setDescription('Division for this series')
                .setRequired(true)
                .addChoices(
                    { name: 'Majors', value: 'MAJORS' },
                    { name: 'AAA', value: 'AAA' },
                    { name: 'AA', value: 'AA' }
                )
        )
        .addStringOption((option) =>
            option
                .setName('winner_team')
                .setDescription('Team receiving the 3-0 win')
                .setRequired(true)
                .addChoices(...TEAM_NAMES.map((team) => ({ name: team, value: team })))
        )
        .addStringOption((option) =>
            option
                .setName('loser_team')
                .setDescription('Team receiving the 0-3 loss')
                .setRequired(true)
                .addChoices(...TEAM_NAMES.map((team) => ({ name: team, value: team })))
        )
        .addIntegerOption((option) =>
            option
                .setName('week')
                .setDescription('Week number (optional, auto-guessed in week threads)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(20)
        )
        .addBooleanOption((option) =>
            option
                .setName('playoffs')
                .setDescription('Set true if this matchup is playoffs')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const division = interaction.options.getString('division');
            const winnerTeam = interaction.options.getString('winner_team');
            const loserTeam = interaction.options.getString('loser_team');
            const playoffs = Boolean(interaction.options.getBoolean('playoffs'));

            if (winnerTeam === loserTeam) {
                await interaction.editReply('Winner and loser teams must be different.');
                return;
            }

            const weekOption = interaction.options.getInteger('week');
            const guessedWeek = guessWeekFromChannel(interaction.channel);
            const week = weekOption || guessedWeek || null;

            const result = await submitSeries({
                interaction,
                division,
                homeTeamName: winnerTeam,
                awayTeamName: loserTeam,
                week,
                isPlayoff: playoffs,
                reportType: 'ff',
                replayUrls: [],
                reportSource: 'score-report-ff',
                requireApprovals: true,
            });

            await interaction.editReply(
                `FF report submitted (3-0): ${result.summary}\nSeries ID: ${result.seriesId}\nStatus: ${result.status}`
            );
        } catch (error) {
            Logger.error('score-report-ff failed', error);
            await interaction.editReply(`Failed to submit FF report: ${error.message}`);
        }
    },
};
