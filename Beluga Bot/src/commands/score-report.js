const { SlashCommandBuilder } = require('discord.js');
const { TEAM_NAMES } = require('../constants/roles');
const {
    guessWeekFromChannel,
    submitSeries,
    handleScoreReportButton,
} = require('../utils/scoreReport');
const Logger = require('../utils/logger');

const replayOptionNames = ['replay_1', 'replay_2', 'replay_3', 'replay_4', 'replay_5', 'replay_6', 'replay_7'];

const data = new SlashCommandBuilder()
    .setName('score-report')
    .setDescription('Report a series with Ballchasing replay links (captain/GM approval required).')
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
            .setName('home_team')
            .setDescription('Home team')
            .setRequired(true)
            .addChoices(...TEAM_NAMES.map((team) => ({ name: team, value: team })))
    )
    .addStringOption((option) =>
        option
            .setName('away_team')
            .setDescription('Away team')
            .setRequired(true)
            .addChoices(...TEAM_NAMES.map((team) => ({ name: team, value: team })))
    );

replayOptionNames.forEach((name, index) => {
    data.addStringOption((option) =>
        option
            .setName(name)
            .setDescription(`Individual replay URL or group URL (replay_1 only)`)
            .setRequired(index === 0)
    );
});

data
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
    );

module.exports = {
    data,

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const division = interaction.options.getString('division');
            const homeTeam = interaction.options.getString('home_team');
            const awayTeam = interaction.options.getString('away_team');
            const playoffs = Boolean(interaction.options.getBoolean('playoffs'));

            if (homeTeam === awayTeam) {
                await interaction.editReply('Home and away teams must be different.');
                return;
            }

            const replayUrls = replayOptionNames
                .map((name) => interaction.options.getString(name))
                .filter(Boolean);

            const weekOption = interaction.options.getInteger('week');
            const guessedWeek = guessWeekFromChannel(interaction.channel);
            const week = weekOption || guessedWeek || null;

            const result = await submitSeries({
                interaction,
                division,
                homeTeamName: homeTeam,
                awayTeamName: awayTeam,
                week,
                isPlayoff: playoffs,
                reportType: 'standard',
                replayUrls,
                reportSource: 'score-report',
                requireApprovals: true,
            });

            await interaction.editReply(
                `Score report submitted: ${result.summary}\nSeries ID: ${result.seriesId}\nStatus: ${result.status}`
            );
        } catch (error) {
            Logger.error('score-report failed', error);
            await interaction.editReply(`Failed to submit score report: ${error.message}`);
        }
    },

    async handleButton(interaction) {
        return handleScoreReportButton(interaction);
    },
};
