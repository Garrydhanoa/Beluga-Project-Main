const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /note: a private staff note on someone's record. The member is not told.
const data = new SlashCommandBuilder().setName('note').setDescription("Add a private staff note to a member's record.").setDMPermission(false);
opts.user(data);
opts.reason(data);
opts.rule(data, false);
opts.evidence(data);

module.exports = { data, execute: mod.note };
