const { SlashCommandBuilder } = require('discord.js');
const ticketManager = require('./openticket');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a user from the current ticket')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to remove from the ticket')
                .setRequired(true)),

    async execute(interaction) {
        await ticketManager.executeRemove(interaction);
    }
};
