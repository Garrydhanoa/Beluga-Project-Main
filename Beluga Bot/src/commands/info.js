const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { config } = require('../config/config');
const Logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('Get information about the Beluga League Bot'),

    async execute(interaction) {
        Logger.bot(`User ${interaction.user.tag} requested bot info`);

        const embed = new EmbedBuilder()
            .setTitle(`🤖 ${config.bot.name}`)
            .setDescription(config.bot.description)
            .setColor(0x0099FF)
            .setTimestamp()
            .addFields(
                { 
                    name: '📊 Available Divisions', 
                    value: config.divisions.map(div => `• ${div.displayName} (${div.teamCount} teams)`).join('\n'),
                    inline: true 
                },
                { 
                    name: '⚙️ Version', 
                    value: config.bot.version,
                    inline: true 
                },
                { 
                    name: '🕐 Uptime', 
                    value: `${Math.floor(process.uptime() / 60)} minutes`,
                    inline: true 
                },
                {
                    name: '📝 Available Commands',
                    value: '• `/standings` - View division standings\n• `/health` - Check bot status\n• `/info` - Show this information\n• `/register` - Register yourself to the league!',
                    inline: false
                }
            )
            .setFooter({ text: 'Beluga League Bot • Made with ❤️' });

        await interaction.reply({ embeds: [embed] });
        Logger.success(`Sent bot info to ${interaction.user.tag}`);
    },
};
