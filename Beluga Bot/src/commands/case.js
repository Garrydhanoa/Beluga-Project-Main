const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /case: view one case, and optionally attach more evidence to it.
const data = new SlashCommandBuilder().setName('case').setDescription('View a moderation case (staff).').setDMPermission(false);
data.addIntegerOption((o) => o.setName('id').setDescription('Case number').setRequired(true).setMinValue(1));
opts.evidence(data);

module.exports = { data, execute: mod.viewCase };
