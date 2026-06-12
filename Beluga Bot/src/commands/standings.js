const { SlashCommandBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { getStandings } = require('../stats/statsStore');
const { buildStandingsImage } = require('../stats/standingsCard');
const Logger = require('../utils/logger');

/**
 * /standings — division standings rendered from the DATABASE (same data and
 * tiebreakers as the website), as a themed image. Replaces the old
 * Google-Sheet-driven version.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('standings')
        .setDescription('Current division standings (live from the database).')
        .setDMPermission(false)
        .addStringOption((option) =>
            option.setName('division')
                .setDescription('The division to get standings for')
                .setRequired(true)
                .addChoices(
                    { name: 'Majors', value: 'Majors' },
                    { name: 'AAA', value: 'AAA' },
                    { name: 'AA', value: 'AA' }
                )),

    async execute(interaction) {
        await interaction.deferReply();
        try {
            const division = interaction.options.getString('division');
            const season = await LeagueDB.getActiveSeason();
            if (!season) {
                await interaction.editReply('❌ No active season.');
                return;
            }

            const rows = await getStandings(season.id, division);
            if (!rows.length) {
                await interaction.editReply(`📭 No results recorded yet for **${division}** this season — standings appear after the first reported series.`);
                return;
            }

            const image = await buildStandingsImage(rows.map((r) => ({ ...r, rank: r.place ?? r.rank })), {
                division,
                seasonNumber: season.season_number ?? season.seasonNumber ?? null,
                playoffLine: 8,
            });

            await interaction.editReply({
                files: [{ attachment: image, name: `${division.toLowerCase()}-standings.png` }],
            });
        } catch (error) {
            Logger.error('/standings failed', error);
            await interaction.editReply('❌ Failed to build the standings. Try again or ping salary crew.');
        }
    },
};
