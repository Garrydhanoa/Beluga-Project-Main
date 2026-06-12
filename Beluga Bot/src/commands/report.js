const { SlashCommandBuilder } = require('discord.js');
const flow = require('../stats/report/flow');

/**
 * /report — start a score report for the current week thread's matchup.
 * Backup for the in-thread "Report Series" panel button; same gated flow
 * (captain/GM of one of the two teams, or salary crew). Shows the group-link
 * modal, or an ephemeral error if not allowed / not a matchup thread.
 */
module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Report this matchup\'s series (use inside the week thread).')
        .setDMPermission(false),

    async execute(interaction) {
        await flow.startReport(interaction);
    },
};
