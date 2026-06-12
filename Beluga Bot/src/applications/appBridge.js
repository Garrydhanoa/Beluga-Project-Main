/**
 * Applications → Discord bridge.
 *
 * The website stores form submissions (app_submissions) with message_id NULL;
 * this poller posts each to its form's channel as an embed:
 *   - pings the form's ping roles + the applicant (outside the embed)
 *   - attaches uploaded files (≤8MB each, forwarded from the DB). Per operator
 *     rule: after a successful send, file BYTES are kept only for the last 10
 *     submissions per form; if the send FAILS the bytes are kept forever until
 *     the submission is deleted manually.
 *   - vote buttons (👍/👎, one vote per staff member, role-gated) that never end
 *   - Accept/Deny buttons gated to the form's decision roles; deciding updates
 *     the embed + website status and DMs the applicant the configured message.
 * customId prefix: `ap:` — routed from bot.js.
 */

const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder,
} = require('discord.js');
const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

const EPHEMERAL = 64;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

function isAppId(customId) {
    return String(customId || '').startsWith('ap:');
}

function statusColor(status) {
    return status === 'accepted' ? 0x2ECC71 : status === 'denied' ? 0xE74C3C : 0xF1C40F;
}

function buildSubmissionEmbed(form, sub) {
    const answers = Array.isArray(sub.answers) ? sub.answers : [];
    const votes = sub.votes || { up: [], down: [] };
    const embed = new EmbedBuilder()
        .setTitle(`📨 ${form.name}`)
        .setColor(statusColor(sub.status))
        .setDescription(`Submitted by <@${sub.discord_id}> (\`${sub.username || sub.discord_id}\`)`)
        .addFields(
            ...answers.slice(0, 20).map((a) => ({
                name: String(a.label || '?').slice(0, 250),
                value: String(a.value || '—').slice(0, 1000),
                inline: false,
            })),
            { name: 'Status', value: `**${(sub.status || 'pending').toUpperCase()}**`, inline: true },
        )
        .setFooter({ text: `Submission #${sub.id} · full record on the website admin` })
        .setTimestamp(new Date(sub.created_at));
    if (form.allow_votes) {
        embed.addFields({ name: 'Votes', value: `👍 ${votes.up.length} · 👎 ${votes.down.length}`, inline: true });
    }
    return embed;
}

function buildRows(form, sub) {
    const rows = [];
    if (sub.status === 'pending') {
        const row = new ActionRowBuilder();
        if (form.allow_votes) {
            row.addComponents(
                new ButtonBuilder().setCustomId(`ap:v:u:${sub.id}`).setLabel('👍').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`ap:v:d:${sub.id}`).setLabel('👎').setStyle(ButtonStyle.Secondary),
            );
        }
        if ((form.decision_role_ids || []).length) {
            row.addComponents(
                new ButtonBuilder().setCustomId(`ap:a:${sub.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`ap:d:${sub.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
            );
        }
        if (row.components.length) rows.push(row);
    }
    return rows;
}

// ---- poller -------------------------------------------------------------------

async function postPendingSubmissions(client) {
    if (!db()) return;
    try {
        const rows = await pool.query(`
            SELECT s.*, f.name, f.channel_id, f.ping_role_ids, f.allow_votes, f.decision_role_ids
            FROM app_submissions s JOIN app_forms f ON f.id = s.form_id
            WHERE s.message_id IS NULL AND s.post_failed = FALSE
            ORDER BY s.id LIMIT 5
        `);
        for (const sub of rows.rows) {
            const form = sub; // joined fields
            try {
                const channel = await client.channels.fetch(sub.channel_id).catch(() => null);
                if (!channel?.isTextBased()) throw new Error(`form channel ${sub.channel_id} unavailable`);

                // Attach files from the DB (forward-only storage model).
                const fileRows = await pool.query(
                    `SELECT id, name, mime, data FROM app_files WHERE submission_id = $1 ORDER BY id`, [sub.id]
                );
                const files = fileRows.rows
                    .filter((f) => f.data)
                    .map((f) => new AttachmentBuilder(Buffer.from(f.data), { name: f.name || `file-${f.id}` }));

                const pings = [...(sub.ping_role_ids || []).map((r) => `<@&${r}>`), `<@${sub.discord_id}>`].join(' ');
                const msg = await channel.send({
                    content: pings || undefined,
                    embeds: [buildSubmissionEmbed(form, sub)],
                    components: buildRows(form, sub),
                    files,
                });
                await pool.query(`UPDATE app_submissions SET message_id = $1 WHERE id = $2`, [msg.id, sub.id]);

                // Send succeeded → retention: keep file BYTES only for the most
                // recent 10 submissions of this form (rows stay for the record).
                await pool.query(`
                    UPDATE app_files SET data = NULL
                    WHERE keep_forever = FALSE AND data IS NOT NULL AND submission_id IN (
                        SELECT id FROM app_submissions
                        WHERE form_id = $1 AND message_id IS NOT NULL
                        ORDER BY id DESC OFFSET 10
                    )
                `, [sub.form_id]);
            } catch (err) {
                Logger.error(`application post failed for submission ${sub.id}`, err);
                // Keep files forever + flag so staff check it on the website.
                await pool.query(`UPDATE app_submissions SET post_failed = TRUE WHERE id = $1`, [sub.id]);
                await pool.query(`UPDATE app_files SET keep_forever = TRUE WHERE submission_id = $1`, [sub.id]);
                try {
                    const { logEdge } = require('../stats/report/logChannel');
                    await logEdge(client, {
                        summary: `Application submission #${sub.id} (${sub.name}) could not be posted to Discord — review it on the website admin.`,
                        error: err, pingInThread: false,
                    });
                } catch { /* log channel optional */ }
            }
        }
    } catch (err) {
        // Tables may not exist until the website deploys its schema.
        if (!/relation .* does not exist/.test(String(err.message))) {
            Logger.error('postPendingSubmissions failed', err);
        }
    }
}

function startApplicationPoller(client, intervalMs = 30 * 1000) {
    setInterval(() => postPendingSubmissions(client), intervalMs);
    setTimeout(() => postPendingSubmissions(client), 10 * 1000);
}

// ---- interactions ---------------------------------------------------------------

async function loadSub(id) {
    const r = await pool.query(
        `SELECT s.*, f.name, f.channel_id, f.ping_role_ids, f.allow_votes, f.decision_role_ids,
            f.vote_role_ids, f.dm_on_decision, f.accept_message, f.deny_message
         FROM app_submissions s JOIN app_forms f ON f.id = s.form_id WHERE s.id = $1`,
        [Number(id)]
    );
    return r.rows[0] || null;
}

function hasAnyRole(member, roleIds) {
    if (!roleIds || !roleIds.length) return true; // unrestricted
    return roleIds.some((r) => member?.roles?.cache?.has(r));
}

async function refreshMessage(interaction, sub) {
    await interaction.message.edit({
        embeds: [buildSubmissionEmbed(sub, sub)],
        components: buildRows(sub, sub),
    }).catch(() => {});
}

async function handleVote(interaction, dir, subId) {
    const sub = await loadSub(subId);
    if (!sub) return interaction.reply({ content: '❌ Submission not found.', flags: EPHEMERAL });
    if (sub.status !== 'pending') return interaction.reply({ content: 'ℹ️ Voting is over — a decision was made.', flags: EPHEMERAL });
    if (!hasAnyRole(interaction.member, sub.vote_role_ids)) {
        return interaction.reply({ content: '❌ You don\'t have a voting role for this form.', flags: EPHEMERAL });
    }
    const votes = sub.votes || { up: [], down: [] };
    votes.up = (votes.up || []).filter((id) => id !== interaction.user.id);
    votes.down = (votes.down || []).filter((id) => id !== interaction.user.id);
    votes[dir === 'u' ? 'up' : 'down'].push(interaction.user.id);
    await pool.query(`UPDATE app_submissions SET votes = $1::jsonb WHERE id = $2`, [JSON.stringify(votes), sub.id]);
    sub.votes = votes;
    await interaction.deferUpdate();
    await refreshMessage(interaction, sub);
}

async function handleDecision(interaction, decision, subId) {
    const sub = await loadSub(subId);
    if (!sub) return interaction.reply({ content: '❌ Submission not found.', flags: EPHEMERAL });
    if (sub.status !== 'pending') return interaction.reply({ content: `ℹ️ Already **${sub.status}**.`, flags: EPHEMERAL });
    if (!hasAnyRole(interaction.member, sub.decision_role_ids?.length ? sub.decision_role_ids : ['__none__'])) {
        return interaction.reply({ content: '❌ Only the designated decision roles can accept/deny this form.', flags: EPHEMERAL });
    }
    const status = decision === 'a' ? 'accepted' : 'denied';
    await pool.query(
        `UPDATE app_submissions SET status = $1, decided_at = CURRENT_TIMESTAMP, decided_by = $2 WHERE id = $3`,
        [status, interaction.user.id, sub.id]
    );
    sub.status = status;
    await interaction.deferUpdate();
    await refreshMessage(interaction, sub);
    await interaction.channel.send(`${status === 'accepted' ? '✅' : '⛔'} Submission #${sub.id} (**${sub.name}**) was **${status}** by <@${interaction.user.id}>.`).catch(() => {});

    if (sub.dm_on_decision) {
        try {
            const user = await interaction.client.users.fetch(sub.discord_id);
            const template = status === 'accepted' ? (sub.accept_message || 'Your application to **{form}** was accepted! 🎉') : (sub.deny_message || 'Your application to **{form}** was not accepted this time.');
            await user.send(template.replaceAll('{form}', sub.name));
        } catch { /* DMs closed */ }
    }
}

async function route(interaction) {
    const parts = String(interaction.customId).split(':'); // ap : v|a|d : (dir)? : id
    try {
        if (parts[1] === 'v') return await handleVote(interaction, parts[2], parts[3]);
        if (parts[1] === 'a' || parts[1] === 'd') return await handleDecision(interaction, parts[1], parts[2]);
    } catch (err) {
        if (err?.code === 10062 || err?.code === 40060) return;
        Logger.error('application router error', err);
    }
    return null;
}

module.exports = { isAppId, route, startApplicationPoller };
