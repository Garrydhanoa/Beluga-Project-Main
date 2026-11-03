/**
 * Catches moderation done outside the bot: Carl-bot, Dyno and Discord's own right-click
 * menu. Each one becomes a case, so nothing skips the record, and whoever did it is
 * asked for a reason if there wasn't one. The bot's own actions are ignored here
 * because they already have cases.
 */

const { ActionRowBuilder, AuditLogEvent, ButtonBuilder, ButtonStyle } = require('discord.js');
const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { db, ensureModSchema } = require('./modSchema');
const store = require('./modStore');
const posting = require('./modPosting');

const NO_REASON = 'No reason given yet';

function timeoutChange(entry) {
    const change = entry.changes?.find((c) => c.key === 'communication_disabled_until');
    if (!change) return null;
    if (change.new) return { kind: 'timeout', until: new Date(change.new) };
    return { kind: 'untimeout', until: null };
}

function classify(entry) {
    if (entry.action === AuditLogEvent.MemberBanAdd) return { kind: 'ban' };
    if (entry.action === AuditLogEvent.MemberBanRemove) return { kind: 'unban' };
    if (entry.action === AuditLogEvent.MemberKick) return { kind: 'kick' };
    if (entry.action === AuditLogEvent.MemberUpdate) return timeoutChange(entry);
    return null;
}

async function onAuditEntry(entry, guild) {
    try {
        if (!db() || !(await ensureModSchema())) return;
        const client = guild.client;
        if (!entry.executorId || entry.executorId === client.user.id) return;
        const what = classify(entry);
        if (!what) return;
        const targetId = entry.targetId;
        if (!targetId) return;

        const [executor, target] = await Promise.all([
            client.users.fetch(entry.executorId).catch(() => null),
            client.users.fetch(targetId).catch(() => null),
        ]);
        const reason = String(entry.reason || '').trim();
        const seconds = what.until ? Math.max(Math.round((what.until - Date.now()) / 1000), 1) : null;
        const c = await store.createCase({
            discordId: targetId,
            targetName: target?.globalName || target?.username || null,
            kind: what.kind,
            status: ['ban', 'timeout'].includes(what.kind) ? 'active' : 'ended',
            reason: reason || NO_REASON,
            actor: { id: entry.executorId, name: executor?.globalName || executor?.username || null },
            source: 'outside',
            durationSeconds: seconds,
            expiresAt: what.until || null,
            details: { needs_reason: !reason, via: executor?.bot ? executor.username : 'Discord' },
        });
        if (what.kind === 'ban') {
            await pool.query(
                `INSERT INTO mod_bans (case_id, discord_id, ban_type) VALUES ($1, $2, 'outside') ON CONFLICT (case_id) DO NOTHING`,
                [c.id, targetId],
            );
        }
        if (what.kind === 'unban') {
            await pool.query(
                `UPDATE mod_bans SET status = 'lifted', unbanned_at = NOW(), unban_reason = $2 WHERE discord_id = $1 AND status = 'active'`,
                [targetId, reason || 'Unbanned outside the bot'],
            );
        }
        await store.logEvent({
            discordId: targetId, caseId: c.id, kind: what.kind,
            summary: `${executor?.username || entry.executorId} did this outside the bot (${posting.KIND_LABEL[what.kind]}). ${reason ? `Reason: ${reason}` : 'No reason given.'}`,
            actorId: entry.executorId, actorName: executor?.username || null,
        });
        const components = reason ? [] : [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`md:addreason:${c.id}`).setLabel('Add reason').setStyle(ButtonStyle.Primary),
        )];
        await posting.postLog(client, c, { components, extra: [{ name: 'Done through', value: c.details.via }] });

        if (['ban', 'kick'].includes(what.kind)) {
            await require('./rogueBrake').note(client, { id: entry.executorId, name: executor?.username || null }, what.kind);
        }
        if (!reason && executor && !executor.bot) {
            await posting.dmMember(client, entry.executorId, `You used ${posting.KIND_LABEL[what.kind].toLowerCase()} on ${target?.username || targetId} without a reason. Please add one with \`/reason ${c.id}\` so it stays on their record.`);
        }
    } catch (err) {
        Logger.error('Outside moderation capture failed', err);
        higgenLog.logFailure({ summary: `A moderation action outside the bot could not be recorded: ${err.message}`, error: err, action: 'moderation.outside', where: 'Audit log listener' });
    }
}

module.exports = { onAuditEntry };
