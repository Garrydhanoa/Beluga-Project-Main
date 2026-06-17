const { SlashCommandBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { getDivisionLeaders, buildLeaderboardImage } = require('../stats/leaderboardCard');
const Logger = require('../utils/logger');

/**
 * /leaderboard — posts the average stat leaders for ALL divisions as themed
 * images (same min-games gate + data as the website leaderboards page). Like
 * /standings, it only acks quietly (ephemeral) and posts one image per division
 * straight to the channel, in order: Majors → AAA → AA.
 */
const DIVISIONS = ['Majors', 'AAA', 'AA'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Post the average stat leaders for all divisions (live from the database).')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.reply({ content: '🏆 Posting leaderboards…', flags: 64 });
        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) {
                await interaction.editReply('❌ No active season.');
                return;
            }
            const seasonNumber = season.season_number ?? season.seasonNumber ?? null;

            let posted = 0;
            for (const division of DIVISIONS) {
                // eslint-disable-next-line no-await-in-loop
                const leaders = await getDivisionLeaders(season.id, division);
                // eslint-disable-next-line no-await-in-loop
                const image = await buildLeaderboardImage(leaders, { division, seasonNumber });
                // eslint-disable-next-line no-await-in-loop
                await interaction.channel.send({
                    files: [{ attachment: image, name: `${division.toLowerCase()}-leaderboard.png` }],
                });
                posted += 1;
            }

            await interaction.editReply(`✅ Posted leaderboards for ${posted} division${posted === 1 ? '' : 's'}.`);
        } catch (error) {
            Logger.error('/leaderboard failed', error);
            await interaction.editReply('❌ Failed to build the leaderboards. Try again or ping salary crew.').catch(() => {});
        }
    },
};
