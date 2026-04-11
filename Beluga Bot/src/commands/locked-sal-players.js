const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ROLES } = require('../constants/roles');
const { ManualSalaryDB, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('locked-sal-players')
        .setDescription('View all players with locked salaries'),

    async execute(interaction) {
        try {
            // Permission check - Salary Crew only
            if (!interaction.member.roles.cache.has(ROLES.SALARY_CREW)) {
                return await interaction.reply({
                    content: '❌ You do not have permission to use this command. Only Salary Crew can view locked salary players.',
                    ephemeral: true
                });
            }

            await interaction.deferReply();

            // Check if database is available
            if (!isDatabaseAvailable()) {
                return await interaction.editReply({
                    content: '❌ Database is not available. Cannot retrieve locked salary information.\n\n' +
                            'This command requires database access to view manual salary overrides.'
                });
            }

            // Get all locked salary players from database
            const lockedPlayers = await ManualSalaryDB.getAll();

            if (lockedPlayers.length === 0) {
                return await interaction.editReply({
                    content: '✅ No players currently have locked salaries.\n\n' +
                            'Players with locked salaries will not have their salaries automatically updated by the salary sync system.'
                });
            }

            // Create embed to display locked players
            const embed = new EmbedBuilder()
                .setTitle('🔒 Locked Salary Players')
                .setColor('#FFA500') // Orange color
                .setDescription(`Found **${lockedPlayers.length}** player(s) with locked salaries.\n\n` +
                              `These players will not have their salaries automatically updated by the salary sync system.`)
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.tag}` });

            // Add fields for each locked player
            for (const player of lockedPlayers) {
                const userMention = `<@${player.discord_id}>`;
                const username = player.username || 'Unknown User';
                const salary = player.salary !== null && player.salary !== undefined 
                    ? `$${player.salary}M` 
                    : 'Not Set';

                embed.addFields({
                    name: `${username}`,
                    value: `**User:** ${userMention}\n` +
                           `**Discord ID:** \`${player.discord_id}\`\n` +
                           `**Locked Salary:** ${salary}`,
                    inline: false
                });
            }

            await interaction.editReply({
                embeds: [embed]
            });

            Logger.info(`Locked salary players viewed by ${interaction.user.tag} - Found ${lockedPlayers.length} players`);

        } catch (error) {
            Logger.error('Error in locked-sal-players command:', error);
            
            const errorMessage = '❌ An error occurred while retrieving locked salary players.';
            
            if (interaction.deferred) {
                await interaction.editReply({
                    content: errorMessage
                });
            } else {
                await interaction.reply({
                    content: errorMessage
                });
            }
        }
    }
};
