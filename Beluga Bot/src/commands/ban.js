const { SlashCommandBuilder } = require('discord.js');
const opts = require('../moderation/modOptions');
const mod = require('../moderation/modCommands');

// /ban: rulebook 6.1.4. Directors confirm it directly; anyone else's goes to the
// Directors for approval. Accepts someone who has already left, by Discord ID.
const data = new SlashCommandBuilder().setName('ban').setDescription('Ban a member (temp, or appealable after a set time).').setDMPermission(false);
opts.user(data, 'The member, or paste a Discord ID if they already left');
data.addStringOption((o) => o.setName('type').setDescription('Which kind of ban').setRequired(true).addChoices(
    { name: 'Temp ban: auto-unbans on the date, DM has a permanent invite', value: 'temp' },
    { name: 'Appealable ban: can appeal once after a set time', value: 'appealable' },
));
opts.rule(data);
opts.reason(data);
data.addStringOption((o) => o.setName('length').setDescription('Temp: how long. Appealable: when they can appeal (default 6 months).').setRequired(false).setAutocomplete(true));
data.addStringOption((o) => o.setName('delete_messages').setDescription('Delete their recent messages').setRequired(false).addChoices(
    { name: 'None', value: '0' },
    { name: 'Last hour', value: '3600' },
    { name: 'Last 24 hours', value: '86400' },
    { name: 'Last 7 days', value: '604800' },
));
opts.evidence(data);
opts.silent(data);

module.exports = { data, execute: mod.ban, autocomplete: mod.banAutocomplete };
