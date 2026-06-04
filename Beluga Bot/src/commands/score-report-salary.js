const { SlashCommandBuilder } = require('discord.js');
const { TEAM_NAMES, ROLES } = require('../constants/roles');
const {
    isBallchasingGroupUrl,
    parseReplayUrl,
    submitSeries,
} = require('../utils/scoreReport');
const Logger = require('../utils/logger');

const replayOptionNames = ['replay_1', 'replay_2', 'replay_3', 'replay_4', 'replay_5', 'replay_6', 'replay_7'];

const data = new SlashCommandBuilder()
    .setName('score-report-salary')
    .setDescription('Salary crew score report command (manual/finals/admin flow).')
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
    )
    .addBooleanOption((option) =>
        option
            .setName('playoffs')
            .setDescription('Is this playoffs?')
            .setRequired(true)
    )
    .addBooleanOption((option) =>
        option
            .setName('ff')
            .setDescription('Forfeit report? If true, records 3-0 standings-only.')
            .setRequired(false)
    )
    .addIntegerOption((option) =>
        option
            .setName('week')
            .setDescription('Week number')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(20)
    );

replayOptionNames.forEach((name, index) => {
    data.addStringOption((option) =>
        option
            .setName(name)
            .setDescription(`Replay URL ${index + 1} (https://ballchasing.com/replay/<uuid>)`)
            .setRequired(false)
    );
});

module.exports = {
    data,

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            if (!interaction.member?.roles?.cache?.has(ROLES.SALARY_CREW)) {
                await interaction.editReply('Only salary crew can use this command.');
                return;
            }

            const division = interaction.options.getString('division');
            const homeTeam = interaction.options.getString('home_team');
            const awayTeam = interaction.options.getString('away_team');
            const week = interaction.options.getInteger('week') || null;
            const playoffs = Boolean(interaction.options.getBoolean('playoffs'));
            const ff = Boolean(interaction.options.getBoolean('ff'));

            if (homeTeam === awayTeam) {
                await interaction.editReply('Home and away teams must be different.');
                return;
            }

            const replayUrls = replayOptionNames
                .map((name) => interaction.options.getString(name))
                .filter(Boolean);

            if (!ff) {
                if (!replayUrls.length) {
                    await interaction.editReply('Provide at least one replay link, or set ff=true for a forfeit report.');
                    return;
                }

                const invalid = replayUrls.find((url) => isBallchasingGroupUrl(url) || !parseReplayUrl(url));
                if (invalid) {
                    await interaction.editReply('Invalid replay input. Use only individual replay URLs: https://ballchasing.com/replay/<uuid>. Group URLs are not accepted.');
                    return;
                }
            }

            const result = await submitSeries({
                interaction,
                division,
                homeTeamName: homeTeam,
                awayTeamName: awayTeam,
                week,
                isPlayoff: playoffs,
                reportType: ff ? 'ff' : 'standard',
                replayUrls,
                reportSource: 'score-report-salary',
                requireApprovals: false,
            });

            await interaction.editReply(
                `Salary report submitted: ${result.summary}\nSeries ID: ${result.seriesId}\nStatus: ${result.status}\nFinal approval posted in <#1444621891275985037>.`
            );
        } catch (error) {
            Logger.error('score-report-salary failed', error);
            await interaction.editReply(`Failed to submit salary score report: ${error.message}`);
        }
    },
};
