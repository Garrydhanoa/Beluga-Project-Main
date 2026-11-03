const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /warn: rulebook 6.1.1. Posts in #strike-channel and DMs the member.
const data = new SlashCommandBuilder().setName('warn').setDescription('Give a member their one warning.').setDMPermission(false);
opts.user(data);
opts.rule(data);
opts.reason(data);
opts.evidence(data);
opts.silent(data);

module.exports = { data, execute: mod.warn };
