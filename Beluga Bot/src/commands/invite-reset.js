const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const higgenLog = require('../utils/higgenLog');
const { ROLES } = require('../constants/roles');
const { getActiveCampaign } = require('../invites/inviteSchema');

/**
 * /invite-reset — Salary Crew only. Ends the current invite campaign: archives its
 * final top 10, zeroes campaign counts and starts the next campaign. Lifetime
 * counts are never touched. Asks for a red-button confirmation first (inv:reset).
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-reset')
        .setDescription('End and archive the current invite campaign (Salary Crew).')
        .setDMPermission(false),

    async execute(interaction) {
        if (!interaction.member?.roles?.cache?.has(ROLES.SALARY_CREW)) {
            higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: 'They are not Salary Crew.' });
            return interaction.reply({ content: 'Only Salary Crew can reset the invite campaign.', flags: 64 });
        }
        const campaign = await getActiveCampaign();
        if (!campaign) return interaction.reply({ content: 'There is no active invite campaign.', flags: 64 });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`inv:reset:${interaction.user.id}:${campaign.id}`).setLabel(`End ${campaign.name}`.slice(0, 80)).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`inv:resetx:${interaction.user.id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({
            content: `This ends **${campaign.name}**: its final top 10 is archived, campaign counts go back to 0 and a new campaign starts. Lifetime counts are not affected. Continue?`,
            components: [row],
            flags: 64,
        });
    },
};
