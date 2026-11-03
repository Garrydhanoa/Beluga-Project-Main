const { SlashCommandBuilder } = require('discord.js');
const mod = require('../moderation/modCommands');

// /reason: change a case's reason. The old wording is kept on the case.
const data = new SlashCommandBuilder().setName('reason').setDescription('Change the reason on a case (staff).').setDMPermission(false);
data.addIntegerOption((o) => o.setName('id').setDescription('Case number').setRequired(true).setMinValue(1));
data.addStringOption((o) => o.setName('reason').setDescription('The new reason').setRequired(true).setMinLength(3).setMaxLength(1000));

module.exports = { data, execute: mod.reason };
