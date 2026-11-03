const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /strike: rulebook 6.1.2. Works out the next strike and shows its package on a
// confirm card, which staff can edit before confirming.
const data = new SlashCommandBuilder().setName('strike').setDescription('Give a member a strike, with the rulebook package.').setDMPermission(false);
opts.user(data);
opts.rule(data);
opts.reason(data);
opts.evidence(data);
opts.silent(data);

module.exports = { data, execute: mod.strike };
