const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /kick: Directors confirm it directly; anyone else's goes to the Directors for approval.
// DMs first, because the bot can't reach them once they're out.
const data = new SlashCommandBuilder().setName('kick').setDescription('Kick a member from the server.').setDMPermission(false);
opts.user(data);
opts.rule(data);
opts.reason(data);
opts.evidence(data);
opts.silent(data);

module.exports = { data, execute: mod.kick };
