const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { LeagueDB } = require('../utils/database');
const { buildBracketCard } = require('../stats/bracketCard');
const { ensureBracketGraph, recomputeBracket, loadBracket } = require('../stats/playoffBracket');
const { appendFooter } = require('../utils/siteFooter');
const Logger = require('../utils/logger');

/**
 * /bracket — post the live playoff bracket as an image.
 *
 * Replaces the hand-made Photoshop graphic: everything comes from the DB, so it
 * is correct the moment a series is confirmed. Posts publicly (it is an info
 * command, like /standings), and ends with the shared site footer.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('bracket')
        .setDescription('Post the current playoff bracket.')
        .setDMPermission(false)
        .addStringOption((o) => o.setName('division').setDescription('Division (default: all three)').setRequired(false)
            .addChoices(
                { name: 'Majors', value: 'Majors' },
                { name: 'AAA', value: 'AAA' },
                { name: 'AA', value: 'AA' },
            )),

    async execute(interaction) {
        // Quiet ack, then post each division as its own channel message — the same
        // behaviour as /standings and /power-rankings.
        await interaction.reply({ content: 'Posting…', flags: 64 });

        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) {
                await interaction.editReply('❌ No active season.');
                return;
            }

            const chosen = interaction.options.getString('division');
            const divisions = chosen ? [chosen] : ['Majors', 'AAA', 'AA'];

            let posted = 0;
            const missing = [];

            for (const division of divisions) {
                // Wire a legacy bracket and pull in any results reported since the
                // last render. Both idempotent, both cheap.
                await ensureBracketGraph(season.id, division).catch(() => {});
                await recomputeBracket(season.id, division).catch(() => {});

                const bracket = await loadBracket(season.id, division);
                if (!bracket || !bracket.rounds.length) { missing.push(division); continue; }

                const card = await buildBracketCard(season.id, division, {
                    seasonNumber: season.season_number ?? season.seasonNumber ?? null,
                });
                if (!card) { missing.push(division); continue; }

                await interaction.channel.send({
                    files: [new AttachmentBuilder(card, { name: `bracket-${division.toLowerCase()}.png` })],
                });
                posted += 1;
            }

            if (posted) {
                await interaction.channel.send({ content: appendFooter('', interaction.guild) }).catch(() => {});
            }

            await interaction.editReply(
                posted
                    ? `Posted ${posted} bracket${posted === 1 ? '' : 's'}.${missing.length ? ` No bracket yet for: ${missing.join(', ')}.` : ''}`
                    : `No playoff bracket has been seeded yet${missing.length ? ` for ${missing.join(', ')}` : ''}.`
            );
        } catch (error) {
            Logger.error('/bracket failed', error);
            await interaction.editReply(`❌ Could not build the bracket: ${error.message}`);
        }
    },
};
