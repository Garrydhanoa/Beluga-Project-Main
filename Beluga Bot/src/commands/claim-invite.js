const { SlashCommandBuilder } = require('discord.js');
const higgenLog = require('../utils/higgenLog');
const { fileClaim } = require('../invites/inviteTracker');

/**
 * /claim-invite user — run by the INVITER to say "I invited this person" when the
 * bot could not credit anyone (vanity link, Server Discovery, a general link).
 * Only while the member is unattributed and inside the claim window; one pending
 * claim per person at a time. Staff approve or reject it on the admin Invites tab.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('claim-invite')
        .setDescription('Claim that you invited a member who joined through a general link.')
        .setDMPermission(false)
        .addUserOption((o) => o.setName('user').setDescription('The member you invited').setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });
        const target = interaction.options.getUser('user', true);
        const res = await fileClaim(interaction.client, interaction.user.id, target);
        if (!res.ok) higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: res.message });
        await interaction.editReply({ content: res.message, allowedMentions: { parse: [] } });
    },
};
