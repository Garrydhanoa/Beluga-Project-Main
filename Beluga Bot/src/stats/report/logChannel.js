/**
 * Edge-case / error logging for the stats system.
 *
 * Operator requirement: log ANYTHING that goes wrong to one channel with a plain
 * summary + a detailed error dump (copy-pasteable), ping salary crew there, and
 * also ping salary crew in the originating thread so the failed report is easy
 * to find. Never throws (logging must not break the flow).
 */

const { EmbedBuilder } = require('discord.js');
const { LOG_CHANNEL_ID, SALARY_CREW_ROLE_ID } = require('./constants');
const Logger = require('../../utils/logger');

function truncate(str, n) {
    const s = String(str ?? '');
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/**
 * @param {import('discord.js').Client} client
 * @param {object} opts
 * @param {string} opts.summary        one-line what-went-wrong
 * @param {string} [opts.detail]       longer human explanation
 * @param {Error|string} [opts.error]  raw error for the copy-paste dump
 * @param {object} [opts.thread]       Discord thread/channel to also ping in
 * @param {string} [opts.division]
 * @param {string} [opts.groupUrl]
 * @param {boolean} [opts.pingSalaryCrew=true]
 * @param {boolean} [opts.pingInThread=true]
 */
async function logEdge(client, {
    summary, detail = null, error = null, thread = null, division = null,
    groupUrl = null, pingSalaryCrew = true, pingInThread = true,
} = {}) {
    const crewPing = pingSalaryCrew && SALARY_CREW_ROLE_ID ? `<@&${SALARY_CREW_ROLE_ID}>` : '';
    const rawError = error
        ? (error.stack || error.message || String(error))
        : null;

    // Unified log: everything that hits the log channel is also searchable on the
    // website's hidden higgenlogs page (Bot ▸ Fails). Best-effort, never blocks.
    try {
        require('../../utils/higgenLog').logFailure({
            eventType: 'stats_edge_case',
            action: 'stats.edge-case',
            summary: `Stats reporting hit an edge case: ${String(summary || 'something went wrong').slice(0, 400)}`,
            error,
            division,
            details: [
                detail ? ['What happened', String(detail).slice(0, 900)] : null,
                groupUrl ? ['Ballchasing group', groupUrl] : null,
                thread?.name ? ['In thread', `#${thread.name}`] : null,
            ].filter(Boolean),
        });
    } catch { /* audit table may not exist yet */ }

    // 1) Detailed log to the log channel.
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
        if (channel && channel.isTextBased?.()) {
            const embed = new EmbedBuilder()
                .setTitle('⚠️ Stats edge case')
                .setColor(0xE67E22)
                .setDescription(truncate(summary || 'Something went wrong.', 4000))
                .setTimestamp();
            if (division) embed.addFields({ name: 'Division', value: String(division), inline: true });
            if (groupUrl) embed.addFields({ name: 'Group', value: truncate(groupUrl, 1000) });
            if (thread?.id) embed.addFields({ name: 'Thread', value: `<#${thread.id}>`, inline: true });
            if (detail) embed.addFields({ name: 'Details', value: truncate(detail, 1000) });

            const content = crewPing || undefined;
            await channel.send({ content, embeds: [embed] });
            if (rawError) {
                await channel.send({ content: `\`\`\`\n${truncate(rawError, 1800)}\n\`\`\`` });
            }
        }
    } catch (err) {
        Logger.error('logEdge: failed to write to log channel', err);
    }

    // 2) Short ping in the originating thread so it's easy to find.
    if (pingInThread && thread && thread.isTextBased?.()) {
        try {
            await thread.send({
                content: `${crewPing} ⚠️ ${truncate(summary || 'A report issue occurred.', 1500)}`.trim(),
            });
        } catch (err) {
            Logger.error('logEdge: failed to ping in thread', err);
        }
    }
}

module.exports = { logEdge };
