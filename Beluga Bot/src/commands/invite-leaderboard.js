const { SlashCommandBuilder } = require('discord.js');
const { buildLeaderboard } = require('../invites/inviteViews');
const { siteFooter } = require('../utils/siteFooter');

/**
 * /invite-leaderboard — the invite campaign standings, posted publicly. Top 10 per
 * page with ◀ ▶, a Campaign ⇄ Lifetime toggle, and a "View a person" dropdown.
 * Only the person who ran it can drive its controls (inv: router enforces it).
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-leaderboard')
        .setDescription('Show the invite campaign leaderboard.')
        .setDMPermission(false),

    async execute(interaction) {
        await interaction.deferReply();
        const view = await buildLeaderboard(interaction.guild, interaction.user.id, 'c', 0);
        await interaction.editReply({ content: siteFooter(interaction.guild), ...view, allowedMentions: { parse: [] } });
    },
};
