const { ActionRowBuilder, StringSelectMenuBuilder, SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const { fetchStandingsData } = require('../utils/googleSheets');
const { createStandingsImage } = require('../utils/imageGenerator');
const { config } = require('../config/config');
const Logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('standings')
        .setDescription('Get the standings for a selected division.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
        .addStringOption(option =>
            option.setName('division')
                .setDescription('The division to get standings for')
                .setRequired(true)
                .addChoices(
                    { name: 'AA Division', value: 'aa' },
                    { name: 'AAA Division', value: 'aaa' },
                    { name: 'Majors Division', value: 'majors' }
                )),
    async execute(interaction) {
        try {
            // Restrict command to specific roles
            const allowedRoleIds = ['1156814621429215240', '1299015429355999263', '1156814621429215239'];
            const member = interaction.member;
            if (!member || !member.roles || !member.roles.cache.some(role => allowedRoleIds.includes(role.id))) {
                await interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
                return;
            }

            // Defer immediately to prevent timeout
            await interaction.deferReply();
            
            const selectedDivision = interaction.options.getString('division');
            const divisionInfo = config.divisions.find(div => div.value === selectedDivision);
            
            Logger.info(`Fetching standings for division: ${selectedDivision}`);
            
            const standingsData = await fetchStandingsData(selectedDivision);
            
            if (!standingsData || standingsData.length === 0) {
                await interaction.editReply({
                    content: `❌ No standings data found for ${divisionInfo?.displayName || selectedDivision}. Please try again later.`
                });
                return;
            }

            Logger.info(`Generating standings image for division: ${selectedDivision}`);
            const imageBuffer = await createStandingsImage(standingsData, selectedDivision);

            await interaction.editReply({ 
                content: `Here are the standings for ${divisionInfo?.displayName || selectedDivision.toUpperCase()}:`, 
                files: [{ attachment: imageBuffer, name: `${selectedDivision}-standings.png` }] 
            });

            Logger.success(`Successfully sent standings for ${selectedDivision}`);
        } catch (error) {
            Logger.error(`Failed to generate standings`, error);
            
            try {
                const errorMessage = '❌ An error occurred while fetching the standings. Please try again later.';
                
                if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply(errorMessage);
                } else if (!interaction.replied) {
                    await interaction.reply({
                        content: errorMessage,
                        flags: 64 // MessageFlags.Ephemeral
                    });
                }
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },
};