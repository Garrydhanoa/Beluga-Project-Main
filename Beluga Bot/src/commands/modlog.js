const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /modlog: staff-only, private view of someone's full record.
const data = new SlashCommandBuilder().setName('modlog').setDescription("See a member's moderation record (staff).").setDMPermission(false);
opts.user(data, 'The member, or paste a Discord ID if they left');

module.exports = { data, execute: mod.modlog };
