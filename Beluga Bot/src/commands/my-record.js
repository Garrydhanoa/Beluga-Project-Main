const { SlashCommandBuilder } = require('discord.js');
const mod = require('../moderation/modCommands');

// /my-record: a member's own warnings, strikes and suspensions. Staff notes and staff
// names are left out.
const data = new SlashCommandBuilder().setName('my-record').setDescription('See your own moderation record.').setDMPermission(false);

module.exports = { data, execute: mod.myRecord };
