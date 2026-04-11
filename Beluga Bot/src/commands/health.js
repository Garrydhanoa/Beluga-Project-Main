const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const { googleSheetsService } = require('../utils/googleSheets');
const { imageGenerator } = require('../utils/imageGenerator');
const { config } = require('../config/config');
const Logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('health')
        .setDescription('Check the bot\'s health and connectivity status')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

    async execute(interaction) {
        Logger.bot(`User ${interaction.user.tag} requested health check`);
        // Restrict command to specific roles
        const allowedRoleIds = ['1156814621429215240', '1299015429355999263', '1156814621429215239'];
        const member = interaction.member;
        if (!member || !member.roles || !member.roles.cache.some(role => allowedRoleIds.includes(role.id))) {
            await interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
            return;
        }

        await interaction.deferReply();

        const healthEmbed = new EmbedBuilder()
            .setTitle('🏥 Bot Health Check')
            .setColor(0x00FF00)
            .setTimestamp()
            .setFooter({ text: config.bot.name });

        const checks = [];

        try {
            // Test Google Sheets connectivity
            Logger.info('Testing Google Sheets connectivity...');
            const sheetsTest = await googleSheetsService.testConnection();
            checks.push({
                name: '📊 Google Sheets',
                value: sheetsTest ? '✅ Connected' : '❌ Connection Failed',
                inline: true
            });

            // Test Image Generation
            Logger.info('Testing image generation...');
            const imageTest = await imageGenerator.testImageGeneration();
            checks.push({
                name: '🖼️ Image Generation',
                value: imageTest ? '✅ Working' : '❌ Failed',
                inline: true
            });

            // Check configured divisions
            const divisionsConfig = config.divisions.map(div => {
                const hasSpreadsheet = config.sheets.spreadsheetIds[div.value];
                return `${hasSpreadsheet ? '✅' : '❌'} ${div.displayName}`;
            }).join('\n');

            checks.push({
                name: '🏆 Configured Divisions',
                value: divisionsConfig,
                inline: false
            });

            // Bot info
            checks.push({
                name: '🤖 Bot Information',
                value: `Version: ${config.bot.version}\nUptime: ${Math.floor(process.uptime())}s`,
                inline: true
            });

            healthEmbed.addFields(...checks);

            // Set overall status color
            const allHealthy = checks.every(check => !check.value.includes('❌'));
            healthEmbed.setColor(allHealthy ? 0x00FF00 : 0xFF9900);

            await interaction.editReply({ embeds: [healthEmbed] });
            Logger.success(`Health check completed for ${interaction.user.tag}`);

        } catch (error) {
            Logger.error('Health check failed', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Health Check Failed')
                .setDescription('An error occurred while performing the health check.')
                .setColor(0xFF0000)
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },
};
