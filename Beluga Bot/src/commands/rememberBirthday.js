const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { BirthdayDB, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remember-birthday')
        .setDescription('Register your birthday for automated wishes')
        .addIntegerOption(option =>
            option.setName('month')
                .setDescription('Birth month (1-12)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(12))
        .addIntegerOption(option =>
            option.setName('day')
                .setDescription('Birth day (1-31)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(31))
        .addIntegerOption(option =>
            option.setName('year')
                .setDescription('Birth year (optional, for age calculation)')
                .setRequired(false)
                .setMinValue(1900)
                .setMaxValue(new Date().getFullYear())),

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const month = interaction.options.getInteger('month');
            const day = interaction.options.getInteger('day');
            const year = interaction.options.getInteger('year');
            const userId = interaction.user.id;
            const username = interaction.user.username;
            const displayName = interaction.member?.displayName || interaction.user.username;

            // Validate date
            const dateString = `${year || 2000}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            const testDate = new Date(dateString);
            
            if (testDate.getMonth() + 1 !== month || testDate.getDate() !== day) {
                await interaction.editReply({
                    content: '❌ Invalid date! Please check the month and day values.',
                });
                return;
            }

            // Check if database exists
            if (!isDatabaseAvailable()) {
                await interaction.editReply({
                    content: '❌ Database not available. Please contact an administrator.',
                });
                Logger.error('Database not available for birthday command');
                return;
            }

            // Check if this is an update (before saving)
            const existing = await BirthdayDB.get(userId);
            const isUpdate = existing !== null;

            // Save birthday to database
            const saved = await BirthdayDB.save(userId, username, displayName, month, day, year);
            
            if (!saved) {
                await interaction.editReply({
                    content: '❌ Failed to save your birthday. Please try again later.',
                });
                return;
            }

            // Calculate days until next birthday
            const today = new Date();
            const currentYear = today.getFullYear();
            let nextBirthday = new Date(currentYear, month - 1, day);
            
            // If birthday has passed this year, calculate for next year
            if (nextBirthday < today) {
                nextBirthday = new Date(currentYear + 1, month - 1, day);
            }
            
            // Calculate difference in days
            const diffTime = nextBirthday - today;
            const daysUntil = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            // Format days until message
            let daysMessage;
            if (daysUntil === 0) {
                daysMessage = '🎉 **Today is your birthday!** 🎂';
            } else if (daysUntil === 1) {
                daysMessage = '🎈 **Tomorrow is your birthday!**';
            } else {
                daysMessage = `⏰ **${daysUntil} days** until your birthday`;
            }

            const embed = new EmbedBuilder()
                .setTitle('🎂 Birthday Registered!')
                .setDescription(`<@${userId}>'s birthday has been ${isUpdate ? 'updated' : 'saved'}!`)
                .addFields([
                    {
                        name: '⏳ Countdown',
                        value: daysMessage,
                        inline: false
                    },
                    {
                        name: '🎉 Celebration',
                        value: 'You will receive a special birthday wish on your special day!',
                        inline: false
                    }
                ])
                .setColor(0xFF69B4)
                .setFooter({ text: `Registered for ${displayName}` })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            Logger.error('Error in remember-birthday command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while saving your birthday. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    }
};
