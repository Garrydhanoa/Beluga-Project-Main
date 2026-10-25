const { SlashCommandBuilder } = require('discord.js');
const { buildPersonCard } = require('../invites/inviteViews');

/**
 * /invites [user] — campaign + lifetime invite count, rank, pending reviews and
 * the latest counted invitees, for yourself or someone else. Private reply.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('invites')
        .setDescription('See your invite count (or someone else\'s).')
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('Whose invites to show (default: you)').setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        const user = interaction.options.getUser('user') || interaction.user;
        await interaction.editReply(await buildPersonCard(interaction.guild, user.id));
    },
};
