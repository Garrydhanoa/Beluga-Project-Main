const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /unstrike: Directors only. Takes one strike off; the original case stays on record.
const data = new SlashCommandBuilder().setName('unstrike').setDescription("Remove a member's latest strike (Directors).").setDMPermission(false);
opts.user(data);
opts.reason(data);
opts.silent(data);

module.exports = { data, execute: mod.unstrike };
