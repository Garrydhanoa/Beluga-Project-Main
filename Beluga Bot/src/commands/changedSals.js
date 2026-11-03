const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const Logger = require('../utils/logger');
const { ManualSalaryDB } = require('../utils/database');
const { ROLES } = require('../constants/roles');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('changed-sals')
        .setDescription('View all players with manually locked salaries (Salary Crew only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        try {
            // Check if user has Salary Crew role
            if (!interaction.member.roles.cache.has(ROLES.SALARY_CREW)) {
                return await interaction.reply({
                    content: '❌ You must be a member of Salary Crew to use this command.',
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            Logger.info(`${interaction.user.username} requested list of manually locked salaries`);

            // Get all manual salary overrides from database
            const manualSalaries = await ManualSalaryDB.getAll();

            if (!manualSalaries || manualSalaries.length === 0) {
                return await interaction.editReply({
                    content: '📊 **No Manually Locked Salaries**\n\nThere are currently no players with manually locked salaries.'
                });
            }

            // Sort by salary (highest to lowest)
            manualSalaries.sort((a, b) => parseFloat(b.salary) - parseFloat(a.salary));

            // Build embed
            const embed = new EmbedBuilder()
                .setTitle('🔒 Manually Locked Salaries')
                .setDescription(`Found **${manualSalaries.length}** player(s) with manually locked salaries.`)
                .setColor(0xFFA500)
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

            // Group players by division
            // S11 bands (same as SalSheet column R): Premier 17+, Contenders 14.75-16.75, Academy up to 14.5
            const divisionGroups = {
                majors: [],    // 17+
                aaa: [],       // 14.75-16.75
                aa: [],        // up to 14.5
            };

            for (const player of manualSalaries) {
                const salary = parseFloat(player.salary);
                const discordMention = `<@${player.discord_id}>`;
                const adjustedBy = player.adjusted_by_name || 'Unknown';
                const adjustedAt = new Date(player.adjusted_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                });

                const playerInfo = `${discordMention} - **$${salary}**\n*Adjusted by: ${adjustedBy} on ${adjustedAt}*`;

                // Determine division based on salary
                if (salary >= 17) {
                    divisionGroups.majors.push(playerInfo);
                } else if (salary >= 14.75) {
                    divisionGroups.aaa.push(playerInfo);
                } else {
                    divisionGroups.aa.push(playerInfo);
                }
            }

            // Add fields for each division (highest to lowest)
            if (divisionGroups.majors.length > 0) {
                // Split into chunks if too many
                const chunks = chunkArray(divisionGroups.majors, 10);
                chunks.forEach((chunk, index) => {
                    const suffix = chunks.length > 1 ? ` (Part ${index + 1})` : '';
                    embed.addFields({
                        name: `🏆 Premier Division (17+)${suffix}`,
                        value: chunk.join('\n\n'),
                        inline: false
                    });
                });
            }

            if (divisionGroups.aaa.length > 0) {
                const chunks = chunkArray(divisionGroups.aaa, 10);
                chunks.forEach((chunk, index) => {
                    const suffix = chunks.length > 1 ? ` (Part ${index + 1})` : '';
                    embed.addFields({
                        name: `⭐ Contenders Division (14.75-16.75)${suffix}`,
                        value: chunk.join('\n\n'),
                        inline: false
                    });
                });
            }

            if (divisionGroups.aa.length > 0) {
                const chunks = chunkArray(divisionGroups.aa, 10);
                chunks.forEach((chunk, index) => {
                    const suffix = chunks.length > 1 ? ` (Part ${index + 1})` : '';
                    embed.addFields({
                        name: `📊 Academy Division (up to 14.5)${suffix}`,
                        value: chunk.join('\n\n'),
                        inline: false
                    });
                });
            }

            // Add summary field
            embed.addFields({
                name: '📈 Summary',
                value: `**Total Locked:** ${manualSalaries.length}\n` +
                       `**Premier (17+):** ${divisionGroups.majors.length}\n` +
                       `**Contenders (14.75-16.75):** ${divisionGroups.aaa.length}\n` +
                       `**Academy (up to 14.5):** ${divisionGroups.aa.length}`,
                inline: false
            });

            await interaction.editReply({ embeds: [embed] });
            Logger.success(`Sent manually locked salaries list to ${interaction.user.username}`);

        } catch (error) {
            Logger.error('Error in changed-sals command', error);
            
            const errorMessage = '❌ An error occurred while fetching manually locked salaries. Please try again.';
            
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorMessage });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                Logger.error('Failed to send error message to user', replyError);
            }
        }
    }
};

/**
 * Helper function to chunk array into smaller arrays
 * @param {Array} array - Array to chunk
 * @param {number} size - Size of each chunk
 * @returns {Array} Array of chunks
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}
