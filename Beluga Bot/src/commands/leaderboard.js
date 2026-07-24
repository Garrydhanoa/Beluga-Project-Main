const { SlashCommandBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { getDivisionLeaders, getLifetimeLeaders, buildLeaderboardImage } = require('../stats/leaderboardCard');
const Logger = require('../utils/logger');

/**
 * /leaderboard — posts the average stat leaders (same min-games gate + data as the
 * website leaderboards page). Like /standings, it acks quietly (ephemeral) and posts
 * images straight to the channel: the CURRENT season per division (Majors → AAA → AA),
 * then a league-wide ALL-TIME (lifetime) card. Lifetime stats are not division-scoped.
 */
const DIVISIONS = ['Majors', 'AAA', 'AA'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Post the current-season (per division) and all-time stat leaders.')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.reply({ content: '🏆 Posting leaderboards…', flags: 64 });
        try {
            let posted = 0;

            // Current season, per division.
            const season = await LeagueDB.getActiveSeason();
            if (season) {
                const seasonNumber = season.season_number ?? season.seasonNumber ?? null;
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
            }

            // League-wide all-time (lifetime) card.
            const lifeLeaders = await getLifetimeLeaders();
            const lifeImage = await buildLeaderboardImage(lifeLeaders, { title: 'All-Time · Lifetime', scopeLabel: 'All-Time' });
            await interaction.channel.send({
                files: [{ attachment: lifeImage, name: 'alltime-leaderboard.png' }],
            });
            posted += 1;

            await interaction.editReply(
                season
                    ? `✅ Posted current-season leaderboards (3 divisions) + all-time.`
                    : `✅ No active season — posted the all-time leaderboard.`
            );
        } catch (error) {
            Logger.error('/leaderboard failed', error);
            await interaction.editReply('❌ Failed to build the leaderboards. Try again or ping salary crew.').catch(() => {});
        }
    },
};
