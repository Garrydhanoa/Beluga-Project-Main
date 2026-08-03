const { SlashCommandBuilder } = require('discord.js');
const { getTeamRoster, createRosterEmbed, getLogoAttachment } = require('../utils/rosterManager');
const { findTeam, teamAutocomplete } = require('../utils/teamRoles');
const { getTeamChoices, getDivisionChoices } = require('../constants/roles');
const { siteFooter } = require('../utils/siteFooter');
const Logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roster')
        .setDescription('View the roster for a specific team')
        .addStringOption(option =>
            option
                .setName('team')
                .setDescription('Select a team')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option
                .setName('division')
                .setDescription('Select a division')
                .setRequired(true)
                .addChoices(...getDivisionChoices())
        ),

    // Live team list from the current season (DB), filtered by the chosen division.
    async autocomplete(interaction) {
        await teamAutocomplete(interaction, { valueField: 'name', divisionOptionName: 'division' });
    },

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const teamName = interaction.options.getString('team');
            const division = interaction.options.getString('division');

            Logger.info(`${interaction.user.username} requested roster for ${teamName} ${division}`);

            // Get roster data
            const rosterData = await getTeamRoster(interaction.guild, teamName, division);
            
            if (!rosterData) {
                return await interaction.editReply({
                    content: `❌ Could not find roster for ${teamName} ${division}. This team may not exist in this division.`,
                });
            }

            // Create embed
            const embed = createRosterEmbed(rosterData);

            // Get team logo from the DB (team logo → franchise logo).
            const dbTeam = await findTeam(teamName, division).catch(() => null);
            const logoAttachment = await getLogoAttachment(dbTeam?.id, teamName);

            // Send roster. The footer goes in the message CONTENT (not the embed)
            // so createRosterEmbed stays untouched — it's shared with the
            // auto-posted roster messages.
            const replyOptions = { content: siteFooter(interaction.guild), embeds: [embed] };
            if (logoAttachment) {
                replyOptions.files = [logoAttachment];
            }

            await interaction.editReply(replyOptions);

            Logger.info(`Sent roster for ${teamName} ${division} to ${interaction.user.username}`);

        } catch (error) {
            Logger.error('Failed to execute roster command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while fetching the roster. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    }
};

