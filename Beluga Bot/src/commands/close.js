const { SlashCommandBuilder } = require('discord.js');
const ticketManager = require('./openticket');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket'),

    async execute(interaction) {
        await ticketManager.executeClose(interaction);
    }
};
