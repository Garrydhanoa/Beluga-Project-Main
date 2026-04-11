const { SlashCommandBuilder } = require('discord.js');
const ticketManager = require('./openticket');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('add')
        .setDescription('Add a user to the current ticket')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to add to the ticket')
                .setRequired(true)),

    async execute(interaction) {
        await ticketManager.executeAdd(interaction);
    }
};
