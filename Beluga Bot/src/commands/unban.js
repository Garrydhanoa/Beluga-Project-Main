const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /unban: paste the Discord ID, since a banned person isn't in the member list.
const data = new SlashCommandBuilder().setName('unban').setDescription('Unban someone.').setDMPermission(false);
opts.user(data, 'Paste their Discord ID');
opts.reason(data);

module.exports = { data, execute: mod.unban };
