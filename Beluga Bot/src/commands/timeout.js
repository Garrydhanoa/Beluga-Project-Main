const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /timeout: a Discord timeout with a case and a reason on record.
const data = new SlashCommandBuilder().setName('timeout').setDescription('Time a member out.').setDMPermission(false);
opts.user(data);
data.addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 10m, 2h, 2d, 1w (28 days at most)').setRequired(true).setAutocomplete(true));
opts.rule(data);
opts.reason(data);
opts.evidence(data);
opts.silent(data);

module.exports = { data, execute: mod.timeout, autocomplete: mod.durationAutocomplete };
