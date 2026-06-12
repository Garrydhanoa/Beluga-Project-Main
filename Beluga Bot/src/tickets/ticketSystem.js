/**
 * Configurable ticket system (replaces the hardcoded /openticket reasons).
 *
 * Everything is admin-panel driven (website → ticket_reasons / ticket_panels):
 *   - reasons: name, emoji, description, staff role IDs (access+ping), welcome
 *     message, modal questions, max open tickets per user
 *   - panels: the website queues a panel row; the bot posts it (reason select)
 * Flow: pick reason → (optional modal questions) → private channel under the
 * panel's category with per-reason role access → welcome embed pings the
 * access roles + the opener → control panel:
 *   - user can only REQUEST close (staff must confirm)
 *   - staff close has an "are you sure" step
 *   - staff-only Add Member
 * Transcripts keep working exactly as today (TicketDB + website ticket sync).
 * customId prefix: `tk:` — routed from bot.js like the `rs:` report ids.
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, UserSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelType, PermissionFlagsBits,
} = require('discord.js');
const { pool, isDatabaseAvailable, TicketDB } = require('../utils/database');
const { ROLES } = require('../constants/roles');
const Logger = require('../utils/logger');

const EPHEMERAL = 64;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function ensureTicketTables() {
    if (!db()) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ticket_reasons (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            emoji TEXT,
            description TEXT,
            welcome_message TEXT,
            staff_role_ids TEXT[] NOT NULL DEFAULT '{}',
            questions JSONB NOT NULL DEFAULT '[]'::jsonb,
            max_open_per_user INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `).catch((e) => Logger.error('ticket_reasons ensure failed', e));
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ticket_panels (
            id SERIAL PRIMARY KEY,
            channel_id TEXT NOT NULL,
            message_id TEXT,
            title TEXT NOT NULL DEFAULT 'Open a ticket',
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `).catch((e) => Logger.error('ticket_panels ensure failed', e));
}

function isTicketId(customId) {
    return String(customId || '').startsWith('tk:');
}

async function getReason(id) {
    const r = await pool.query(`SELECT * FROM ticket_reasons WHERE id = $1`, [Number(id)]);
    return r.rows[0] || null;
}

function memberIsTicketStaff(member, reason) {
    const ids = (reason?.staff_role_ids || []);
    if (member?.roles?.cache?.has(ROLES.SALARY_CREW)) return true;
    return ids.some((rid) => member?.roles?.cache?.has(rid));
}

// ---- panel posting ------------------------------------------------------------

function buildPanelMessage(panel, reasons) {
    const embed = new EmbedBuilder()
        .setTitle(`🎫 ${panel.title}`)
        .setColor(0x3498DB)
        .setDescription(panel.description || 'Pick a reason below to open a private ticket with the right staff.')
        .addFields(reasons.slice(0, 10).map((r) => ({
            name: `${r.emoji ? `${r.emoji} ` : ''}${r.name}`,
            value: r.description || '​',
            inline: false,
        })));
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('tk:open')
            .setPlaceholder('Open a ticket…')
            .addOptions(reasons.slice(0, 25).map((r) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(r.name.slice(0, 100))
                    .setDescription((r.description || '').slice(0, 100) || undefined)
                    .setEmoji(r.emoji || undefined)
                    .setValue(String(r.id))
            ))
    );
    return { embeds: [embed], components: [row] };
}

/** Poll: post any queued panels (message_id NULL) + refresh existing ones when reasons change. */
async function pollTicketPanels(client) {
    if (!db()) return;
    try {
        const reasons = (await pool.query(
            `SELECT * FROM ticket_reasons WHERE is_active = TRUE ORDER BY sort_order, id`
        )).rows;
        const panels = (await pool.query(`SELECT * FROM ticket_panels WHERE is_active = TRUE`)).rows;
        for (const panel of panels) {
            const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
            if (!channel?.isTextBased()) continue;
            if (!reasons.length) continue;
            const payload = buildPanelMessage(panel, reasons);
            if (!panel.message_id) {
                const msg = await channel.send(payload);
                await pool.query(`UPDATE ticket_panels SET message_id = $1 WHERE id = $2`, [msg.id, panel.id]);
            } else {
                // Keep the panel in sync with reason edits (cheap idempotent edit).
                const msg = await channel.messages.fetch(panel.message_id).catch(() => null);
                if (msg) await msg.edit(payload).catch(() => {});
                else {
                    const fresh = await channel.send(payload);
                    await pool.query(`UPDATE ticket_panels SET message_id = $1 WHERE id = $2`, [fresh.id, panel.id]);
                }
            }
        }
    } catch (err) {
        Logger.error('pollTicketPanels failed', err);
    }
}

function startTicketPanelPoller(client, intervalMs = 60 * 1000) {
    ensureTicketTables().then(() => pollTicketPanels(client));
    setInterval(() => pollTicketPanels(client), intervalMs);
}

// ---- open flow -----------------------------------------------------------------

async function handleOpenSelect(interaction) {
    const reason = await getReason(interaction.values[0]);
    if (!reason || !reason.is_active) {
        return interaction.reply({ content: '❌ That ticket type is no longer available.', flags: EPHEMERAL });
    }
    // Per-user open-ticket cap for this reason.
    const open = await pool.query(
        `SELECT COUNT(*)::int AS n FROM tickets WHERE created_by = $1 AND reason = $2`,
        [interaction.user.id, reason.name]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    if (Number(open.rows[0].n) >= Number(reason.max_open_per_user || 1)) {
        return interaction.reply({ content: `❌ You already have ${open.rows[0].n} open **${reason.name}** ticket(s). Finish those first.`, flags: EPHEMERAL });
    }

    const questions = Array.isArray(reason.questions) ? reason.questions.slice(0, 5) : [];
    if (questions.length) {
        const modal = new ModalBuilder().setCustomId(`tk:modal:${reason.id}`).setTitle(reason.name.slice(0, 45));
        questions.forEach((q, i) => {
            modal.addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(`q${i}`)
                    .setLabel(String(q.label || `Question ${i + 1}`).slice(0, 45))
                    .setStyle(q.type === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                    .setRequired(q.required !== false)
                    .setMaxLength(q.type === 'paragraph' ? 1000 : 200)
            ));
        });
        return interaction.showModal(modal);
    }
    await interaction.deferReply({ flags: EPHEMERAL });
    return createTicketChannel(interaction, reason, []);
}

async function handleOpenModal(interaction, reasonId) {
    await interaction.deferReply({ flags: EPHEMERAL });
    const reason = await getReason(reasonId);
    if (!reason) return interaction.editReply('❌ Ticket type not found.');
    const questions = Array.isArray(reason.questions) ? reason.questions.slice(0, 5) : [];
    const answers = questions.map((q, i) => ({
        label: q.label || `Question ${i + 1}`,
        value: interaction.fields.getTextInputValue(`q${i}`) || '—',
    }));
    return createTicketChannel(interaction, reason, answers);
}

async function createTicketChannel(interaction, reason, answers) {
    try {
        const guild = interaction.guild;
        const panelChannel = interaction.channel;
        const username = (interaction.member?.displayName || interaction.user.username);
        const name = `${reason.name}-${username}`.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 95);

        const overwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ];
        for (const rid of (reason.staff_role_ids || [])) {
            const role = await guild.roles.fetch(rid).catch(() => null);
            if (role) overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        }

        const channel = await guild.channels.create({
            name,
            type: ChannelType.GuildText,
            parent: panelChannel?.parentId || undefined,
            permissionOverwrites: overwrites,
        });

        await TicketDB.create({
            channelId: channel.id,
            channelName: channel.name,
            reason: reason.name,
            createdBy: interaction.user.id,
            createdByUsername: interaction.user.username,
            userIds: [interaction.user.id],
        });

        const embed = new EmbedBuilder()
            .setTitle(`${reason.emoji ? `${reason.emoji} ` : ''}${reason.name}`)
            .setColor(0x3498DB)
            .setDescription(reason.welcome_message || 'A staff member will be with you shortly.')
            .setFooter({ text: 'Users can request a close — staff confirm it. Transcripts are saved on the website.' })
            .setTimestamp();
        if (answers.length) {
            embed.addFields(answers.map((a) => ({ name: a.label.slice(0, 250), value: String(a.value).slice(0, 1000), inline: false })));
        }
        const controls = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`tk:reqclose:${reason.id}`).setLabel('Request Close').setEmoji('🙋').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`tk:close:${reason.id}`).setLabel('Close (staff)').setEmoji('🔒').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`tk:add:${reason.id}`).setLabel('Add member (staff)').setEmoji('➕').setStyle(ButtonStyle.Secondary),
        );
        const pings = [...(reason.staff_role_ids || []).map((r) => `<@&${r}>`), `<@${interaction.user.id}>`].join(' ');
        await channel.send({ content: pings, embeds: [embed], components: [controls] });

        await interaction.editReply(`✅ Ticket opened: ${channel}`);
    } catch (err) {
        Logger.error('createTicketChannel failed', err);
        await interaction.editReply('❌ Failed to open the ticket — ping staff directly.').catch(() => {});
    }
}

// ---- in-ticket controls --------------------------------------------------------

async function handleRequestClose(interaction, reasonId) {
    const reason = await getReason(reasonId);
    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tk:confirm:${reasonId}`).setLabel('Confirm close (staff)').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tk:cancelclose').setLabel('Keep open').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
        content: `🙋 <@${interaction.user.id}> requested to close this ticket. ${(reason?.staff_role_ids || []).map((r) => `<@&${r}>`).join(' ')} — confirm below.`,
        components: [confirmRow],
    });
}

async function handleStaffClose(interaction, reasonId) {
    const reason = await getReason(reasonId);
    if (!memberIsTicketStaff(interaction.member, reason)) {
        return interaction.reply({ content: '❌ Only the staff for this ticket type can close it.', flags: EPHEMERAL });
    }
    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tk:confirm:${reasonId}`).setLabel('Yes, close this ticket').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tk:cancelclose').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({ content: '⚠️ **Are you sure you want to close this ticket?** The channel will be deleted (transcript stays on the website).', components: [confirmRow], flags: EPHEMERAL });
}

async function handleConfirmClose(interaction, reasonId) {
    const reason = await getReason(reasonId);
    if (!memberIsTicketStaff(interaction.member, reason)) {
        return interaction.reply({ content: '❌ Only staff can confirm a close.', flags: EPHEMERAL });
    }
    await interaction.reply({ content: `🔒 Closing — transcript is saved on the website. (by <@${interaction.user.id}>)` });
    try {
        await TicketDB.delete(interaction.channel.id);
    } catch { /* row may already be gone */ }
    setTimeout(() => interaction.channel.delete('Ticket closed (confirmed by staff)').catch(() => {}), 4000);
}

async function handleAddMember(interaction, reasonId) {
    const reason = await getReason(reasonId);
    if (!memberIsTicketStaff(interaction.member, reason)) {
        return interaction.reply({ content: '❌ Only staff can add members to a ticket.', flags: EPHEMERAL });
    }
    const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId('tk:adduser').setPlaceholder('Pick the member to add').setMinValues(1).setMaxValues(1)
    );
    await interaction.reply({ content: 'Who should be added to this ticket?', components: [row], flags: EPHEMERAL });
}

async function handleAddUserSelect(interaction) {
    const userId = interaction.values[0];
    await interaction.deferUpdate();
    await interaction.channel.permissionOverwrites.create(userId, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    }).catch(() => {});
    const t = await TicketDB.get(interaction.channel.id).catch(() => null);
    if (t) {
        const ids = new Set([...(t.userIds || t.user_ids || []), userId]);
        await TicketDB.update(interaction.channel.id, { ...t, userIds: [...ids] }).catch(() => {});
    }
    await interaction.channel.send(`➕ <@${userId}> was added to the ticket by <@${interaction.user.id}>.`).catch(() => {});
}

// ---- router ---------------------------------------------------------------------

async function route(interaction) {
    const [, action, arg] = String(interaction.customId).split(':');
    try {
        if (action === 'open' && interaction.isStringSelectMenu()) return await handleOpenSelect(interaction);
        if (action === 'modal' && interaction.isModalSubmit()) return await handleOpenModal(interaction, arg);
        if (action === 'reqclose') return await handleRequestClose(interaction, arg);
        if (action === 'close') return await handleStaffClose(interaction, arg);
        if (action === 'confirm') return await handleConfirmClose(interaction, arg);
        if (action === 'cancelclose') return await interaction.update({ content: '✅ Ticket stays open.', components: [] }).catch(() => {});
        if (action === 'add') return await handleAddMember(interaction, arg);
        if (action === 'adduser' && interaction.isUserSelectMenu()) return await handleAddUserSelect(interaction);
    } catch (err) {
        if (err?.code === 10062 || err?.code === 40060) return;
        Logger.error(`ticket router error (${action})`, err);
        try {
            if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Something went wrong — try again or ping staff.', flags: EPHEMERAL });
            }
        } catch { /* ignore */ }
    }
    return null;
}

module.exports = { ensureTicketTables, startTicketPanelPoller, isTicketId, route };
