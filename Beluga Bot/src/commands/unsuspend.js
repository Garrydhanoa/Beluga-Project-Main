const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /unsuspend: lift a suspension early.
const data = new SlashCommandBuilder().setName('unsuspend').setDescription("Lift a member's suspension early.").setDMPermission(false);
opts.user(data);
opts.reason(data);
opts.silent(data);

module.exports = { data, execute: mod.unsuspend };
