const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /suspend: rulebook 6.1.3. Series, days, weeks, seasons or indefinite.
const data = new SlashCommandBuilder().setName('suspend').setDescription('Suspend a player from league play.').setDMPermission(false);
opts.user(data);
data.addStringOption((o) => o.setName('length').setDescription('e.g. 1 series, 3 series, 2 weeks, 1 season, indefinite').setRequired(true).setAutocomplete(true));
opts.rule(data);
opts.reason(data);
opts.evidence(data);
opts.silent(data);

module.exports = { data, execute: mod.suspend, autocomplete: mod.suspensionAutocomplete };
