/**
 * The per-thread "Report Series" panel: a public message with a single button
 * that starts the report. Reposted to the bottom of the thread on a cadence so
 * it stays reachable, but only when the thread is idle (no active report) and
 * only when newer messages have pushed it up.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ids = require('./ids');
const sessions = require('./sessionStore');
const { PANEL_REPOST_MS, ABANDON_PING_MS, SALARY_CREW_ROLE_ID } = require('./constants');
const { pool, isDatabaseAvailable } = require('../../utils/database');
const Logger = require('../../utils/logger');

function db() { return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable; }

function buildPanelMessage(ctx) {
    const embed = new EmbedBuilder()
        .setTitle('📊 Report this Series')
        .setColor(0x3498DB)
        .setDescription(
            `Report the completed series for **${ctx.homeTeam.name}** vs **${ctx.awayTeam.name}**.\n\n` +
            'Click **Report Series** and paste your **Ballchasing replay group** link. ' +
            'You\'ll then match each replay player to their Discord account, and the other team confirms.\n\n' +
            '**Who can report:** a **captain or GM** of either team in this matchup, or **salary crew**.'
        )
        .addFields(
            { name: 'Division', value: String(ctx.division), inline: true },
            { name: 'Week', value: String(ctx.week ?? '—'), inline: true },
        )
        .setFooter({ text: 'Only a captain/GM of these teams (or salary crew) can use this.' });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(ids.build('start'))
            .setLabel('Report Series')
            .setEmoji('📊')
            .setStyle(ButtonStyle.Primary)
    );
    return { embeds: [embed], components: [row] };
}

/** Post a fresh panel into a thread and record it. */
async function postPanel(client, threadId, ctx) {
    try {
        const channel = await client.channels.fetch(threadId).catch(() => null);
        if (!channel || !channel.isTextBased()) return null;
        const msg = await channel.send(buildPanelMessage(ctx));
        await sessions.upsertPanel(threadId, {
            channelId: channel.id, messageId: msg.id, division: ctx.division,
            seasonId: ctx.seasonId, week: ctx.week, homeTeamId: ctx.homeTeam.id,
            awayTeamId: ctx.awayTeam.id, status: 'active',
        });
        return msg;
    } catch (err) {
        Logger.error('postPanel failed', err);
        return null;
    }
}

/**
 * Repost the panel to the bottom if it's been pushed up and enough time passed.
 * Skips threads with an active report in progress (those panels take priority).
 */
async function maybeRepostPanel(client, panelRow) {
    try {
        if (panelRow.status !== 'active') return;
        // Don't churn while a report is mid-flight.
        const active = await sessions.getActiveSessionByThread(panelRow.thread_id);
        if (active) return;

        const lastPosted = panelRow.last_posted_at ? new Date(panelRow.last_posted_at).getTime() : 0;
        if (Date.now() - lastPosted < PANEL_REPOST_MS) return;

        const channel = await client.channels.fetch(panelRow.thread_id).catch(() => null);
        if (!channel || !channel.isTextBased()) {
            await sessions.setPanelStatus(panelRow.thread_id, 'closed');
            return;
        }
        if (channel.archived) return;

        // Only repost if newer messages have pushed the panel up.
        const latest = await channel.messages.fetch({ limit: 1 }).then((c) => c.first()).catch(() => null);
        if (latest && latest.id === panelRow.message_id) return; // still at the bottom

        // Rebuild ctx from the stored panel row (names from DB would require a
        // lookup; the stored ids are enough — re-resolve via threadContext).
        const { resolveThreadContext } = require('./threadContext');
        const ctx = await resolveThreadContext(panelRow.thread_id);
        if (!ctx) return;

        // Delete the old panel message, then post a fresh one.
        if (panelRow.message_id) {
            await channel.messages.delete(panelRow.message_id).catch(() => {});
        }
        await postPanel(client, panelRow.thread_id, ctx);
    } catch (err) {
        Logger.error('maybeRepostPanel failed', err);
    }
}

/**
 * Ensure every open week thread has a "Report Series" panel. Posts one into any
 * open thread that doesn't have a panel yet (decoupled from thread creation).
 */
async function ensurePanelsForOpenThreads(client) {
    if (!db()) return;
    try {
        const { resolveThreadContext } = require('./threadContext');
        const r = await pool.query(
            `SELECT DISTINCT thread_id FROM week_threads
             WHERE thread_id IS NOT NULL AND COALESCE(is_closed, FALSE) = FALSE`
        );
        for (const row of r.rows) {
            const tid = row.thread_id;
            // eslint-disable-next-line no-await-in-loop
            const existing = await sessions.getPanel(tid);
            // Matchup already reported/closed → never post a start panel again.
            if (existing && (existing.status === 'reported' || existing.status === 'closed')) continue;
            // A report is in progress → no start panel while it runs.
            // eslint-disable-next-line no-await-in-loop
            if (await sessions.getActiveSessionByThread(tid)) continue;
            // Already has a live start panel → leave it (reposter keeps it at bottom).
            if (existing && existing.status === 'active' && existing.message_id) continue;
            // Otherwise (none yet, or it was hidden by a now-ended report) → post one.
            // eslint-disable-next-line no-await-in-loop
            const ctx = await resolveThreadContext(tid);
            if (!ctx || ctx.isClosed) continue;
            // eslint-disable-next-line no-await-in-loop
            await postPanel(client, tid, ctx);
        }
    } catch (err) {
        Logger.error('ensurePanelsForOpenThreads failed', err);
    }
}

/** Remove the start panel while a report is in progress (so it can't be re-started). */
async function hidePanel(client, threadId) {
    try {
        const panel = await sessions.getPanel(threadId);
        if (panel?.message_id && panel.channel_id) {
            const ch = await client.channels.fetch(panel.channel_id).catch(() => null);
            if (ch) await ch.messages.delete(panel.message_id).catch(() => {});
        }
        await sessions.setPanelStatus(threadId, 'in_progress');
        await sessions.setPanelMessage(threadId, null);
    } catch (err) {
        Logger.error('hidePanel failed', err);
    }
}

/** Re-post the start panel immediately (e.g. after a report is cancelled). */
async function restorePanel(client, threadId) {
    try {
        const { resolveThreadContext } = require('./threadContext');
        const ctx = await resolveThreadContext(threadId);
        if (!ctx || ctx.isClosed) return;
        await postPanel(client, threadId, ctx);
    } catch (err) {
        Logger.error('restorePanel failed', err);
    }
}

/**
 * Ping salary crew once for any report stuck with no progress for 24h
 * (operator Q3.9: reports never expire, but staff get notified).
 */
async function pingAbandonedReports(client) {
    if (!db()) return;
    try {
        const r = await pool.query(
            `SELECT * FROM stats_report_sessions
             WHERE state = ANY($1)
               AND updated_at < NOW() - INTERVAL '24 hours'
               AND COALESCE((message_ids->>'abandonPinged')::boolean, FALSE) = FALSE`,
            [sessions.ACTIVE_STATES]
        );
        for (const s of r.rows) {
            // eslint-disable-next-line no-await-in-loop
            const channel = await client.channels.fetch(s.channel_id || s.thread_id).catch(() => null);
            if (channel?.isTextBased?.()) {
                // eslint-disable-next-line no-await-in-loop
                await channel.send({
                    content: `<@&${SALARY_CREW_ROLE_ID}> ⏰ This score report has had no progress for 24+ hours (state: ${s.state}). Please nudge the captains or take over.`,
                }).catch(() => {});
            }
            // eslint-disable-next-line no-await-in-loop
            await sessions.updateSession(s.id, { messageIds: { ...(s.message_ids || {}), abandonPinged: true } });
        }
    } catch (err) {
        Logger.error('pingAbandonedReports failed', err);
    }
}

/** Periodic sweep: provision missing panels + keep idle panels at the bottom. */
function startPanelReposter(client, intervalMs = 30 * 60 * 1000) {
    const tick = async () => {
        try {
            await ensurePanelsForOpenThreads(client);
            const panels = await sessions.getActivePanels();
            for (const p of panels) {
                // eslint-disable-next-line no-await-in-loop
                await maybeRepostPanel(client, p);
            }
            await pingAbandonedReports(client);
        } catch (err) {
            Logger.error('panel reposter tick failed', err);
        }
    };
    // First sweep shortly after boot, then on the interval.
    setTimeout(tick, 15 * 1000);
    setInterval(tick, intervalMs);
    Logger.info('Stats report panel reposter started');
}

module.exports = { buildPanelMessage, postPanel, maybeRepostPanel, ensurePanelsForOpenThreads, hidePanel, restorePanel, startPanelReposter };
