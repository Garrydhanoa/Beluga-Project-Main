const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /untimeout: remove an active timeout early.
const data = new SlashCommandBuilder().setName('untimeout').setDescription("Remove a member's timeout.").setDMPermission(false);
opts.user(data);
opts.reason(data);
opts.silent(data);

module.exports = { data, execute: mod.untimeout };
