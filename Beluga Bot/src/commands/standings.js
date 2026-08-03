const { SlashCommandBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { getStandings } = require('../stats/statsStore');
const { buildStandingsImage } = require('../stats/standingsCard');
const { resolveWeek, weekHeader } = require('../utils/weekNumber');
const { siteFooter } = require('../utils/siteFooter');
const Logger = require('../utils/logger');

/**
 * /standings — posts standings for ALL divisions, rendered from the DATABASE
 * (same data and tiebreakers as the website), as themed images. The command
 * only acks quietly (ephemeral); the images are posted straight to the channel,
 * one per division, in order: Majors → AAA → AA.
 */
const DIVISIONS = ['Majors', 'AAA', 'AA'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('standings')
        .setDescription('Post the standings for all divisions (live from the database).')
        .setDMPermission(false)
        .addIntegerOption((option) =>
            option.setName('week')
                .setDescription('Week number to show in the header (defaults to the current week)')
                .setMinValue(1)
                .setRequired(false)),

    async execute(interaction) {
        // Quiet ack only — keeps the channel clean (no public "used /standings").
        await interaction.reply({ content: '📊 Posting standings…', flags: 64 });
        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) {
                await interaction.editReply('❌ No active season.');
                return;
            }
            const seasonNumber = season.season_number ?? season.seasonNumber ?? null;
            const week = resolveWeek(interaction, season);
            const header = weekHeader(week);

            // Render every division FIRST so we know which one is last — the
            // website footer rides on the final message rather than adding an
            // extra one after the images.
            const empty = [];
            const images = [];
            for (const division of DIVISIONS) {
                // eslint-disable-next-line no-await-in-loop
                const rows = await getStandings(season.id, division);
                if (!rows.length) {
                    empty.push(division);
                    continue;
                }
                // eslint-disable-next-line no-await-in-loop
                const image = await buildStandingsImage(
                    rows.map((r) => ({ ...r, rank: r.place ?? r.rank })),
                    { division, seasonNumber, playoffLine: 8 }
                );
                images.push({ division, image });
            }

            let posted = 0;
            for (const { division, image } of images) {
                // First image carries the WEEK header; the last carries the site
                // footer (both, when only one division posts).
                const lines = [];
                if (posted === 0 && header) lines.push(header);
                if (posted === images.length - 1) lines.push(siteFooter(interaction.guild));
                // eslint-disable-next-line no-await-in-loop
                await interaction.channel.send({
                    content: lines.length ? lines.join('\n') : undefined,
                    files: [{ attachment: image, name: `${division.toLowerCase()}-standings.png` }],
                });
                posted += 1;
            }

            if (!posted) {
                await interaction.editReply('📭 No results recorded yet in any division this season.');
                return;
            }
            await interaction.editReply(
                `✅ Posted standings for ${posted} division${posted === 1 ? '' : 's'}.${empty.length ? ` (No results yet: ${empty.join(', ')})` : ''}`
            );
        } catch (error) {
            Logger.error('/standings failed', error);
            await interaction.editReply('❌ Failed to build the standings. Try again or ping salary crew.').catch(() => {});
        }
    },
};
