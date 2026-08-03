const { SlashCommandBuilder } = require('discord.js');
const { pool, LeagueDB } = require('../utils/database');
const { teamAutocomplete } = require('../utils/teamRoles');
const { isSalaryCrew } = require('../stats/report/threadContext');
const flow = require('../stats/report/flow');

/**
 * /staff-report — salary-crew-only "missed week" report, usable in ANY channel.
 * Staff pick the division/teams/week manually; the rest is the normal report
 * flow (group link → matching → salary crew can finalize instantly). Playoff
 * series are reported here with playoffs=true.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('staff-report')
        .setDescription('Salary crew: report a series for any matchup (missed weeks, playoffs).')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('division').setDescription('Division').setRequired(true)
            .addChoices({ name: 'Majors', value: 'Majors' }, { name: 'AAA', value: 'AAA' }, { name: 'AA', value: 'AA' }))
        .addStringOption((o) => o.setName('home_team').setDescription('Home team').setRequired(true)
            .setAutocomplete(true))
        .addStringOption((o) => o.setName('away_team').setDescription('Away team').setRequired(true)
            .setAutocomplete(true))
        .addIntegerOption((o) => o.setName('week').setDescription('Week number').setRequired(false).setMinValue(1).setMaxValue(30))
        .addBooleanOption((o) => o.setName('playoffs').setDescription('Is this a playoff series?').setRequired(false)),

    // Live team list from the current season (DB), filtered by the chosen division.
    async autocomplete(interaction) {
        await teamAutocomplete(interaction, { valueField: 'name', divisionOptionName: 'division' });
    },

    async execute(interaction) {
        // No defer here — showModal must be the first response.
        if (!isSalaryCrew(interaction.member)) {
            await interaction.reply({ content: '❌ Only **salary crew** can use this command.', flags: 64 });
            return;
        }

        const division = interaction.options.getString('division');
        const homeName = interaction.options.getString('home_team');
        const awayName = interaction.options.getString('away_team');
        const week = interaction.options.getInteger('week') ?? 0;
        const isPlayoff = Boolean(interaction.options.getBoolean('playoffs'));

        if (homeName === awayName) {
            await interaction.reply({ content: '❌ Home and away must be different teams.', flags: 64 });
            return;
        }

        const season = await LeagueDB.getActiveSeason();
        if (!season) {
            await interaction.reply({ content: '❌ No active season.', flags: 64 });
            return;
        }
        const teams = await pool.query(
            `SELECT id, name FROM teams
             WHERE season_id = $1 AND division = $2 AND is_active = TRUE
               AND LOWER(name) IN (LOWER($3), LOWER($4))`,
            [season.id, division, homeName, awayName]
        );
        const byName = new Map(teams.rows.map((t) => [t.name.toLowerCase(), t]));
        const home = byName.get(homeName.toLowerCase());
        const away = byName.get(awayName.toLowerCase());
        if (!home || !away) {
            await interaction.reply({ content: `❌ Both teams must be active in ${division} this season.`, flags: 64 });
            return;
        }

        await flow.startStaffReport(interaction, {
            seasonId: season.id, homeTeamId: home.id, awayTeamId: away.id, week, isPlayoff,
        });
    },
};
