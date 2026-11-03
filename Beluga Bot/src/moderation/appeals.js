/**
 * Appeals (rulebook 6.1.4). The website takes the form; everything after that happens
 * here: a vote in #admin-chat, then a Director's final call once enough people voted.
 *
 * A banned person shares no server with the bot, so they can't be DMed the result. It
 * shows on the website instead, along with the invite if they were approved.
 */

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { CHANNELS, STAFF_ROLES, getSettings, asInt } = require('./modConfig');
const { RANK, rankOf, isFrozen } = require('./modPerms');
const { ensureModSchema } = require('./modSchema');
const { getGuild } = require('./modGuild');
const store = require('./modStore');
const posting = require('./modPosting');

const EPHEMERAL = 64;
const { clip, caseTitle } = posting;

async function tally(appealId) {
    const { rows } = await pool.query(
        `SELECT vote, COUNT(*)::int AS n FROM mod_appeal_votes WHERE appeal_id = $1 GROUP BY vote`,
        [appealId],
    );
    const by = Object.fromEntries(rows.map((r) => [r.vote, r.n]));
    return { yes: by.yes || 0, no: by.no || 0, total: (by.yes || 0) + (by.no || 0) };
}

function appealEmbed(appeal, c, votes, threshold) {
    const embed = new EmbedBuilder()
        .setTitle(`Appeal: ${appeal.discord_name || appeal.discord_id}`.slice(0, 256))
        .setColor(posting.COLORS.ban)
        .addFields(
            { name: 'Member', value: clip(`<@${appeal.discord_id}>\n\`${appeal.discord_id}\``), inline: true },
            { name: 'Appealing', value: clip(`Case ${appeal.case_id}: ${c ? caseTitle(c) : appeal.kind}`), inline: true },
            { name: 'Original reason', value: clip(c?.reason) },
        );
    for (const a of (Array.isArray(appeal.answers) ? appeal.answers : []).slice(0, 6)) {
        embed.addFields({ name: clip(a.question, 256), value: clip(a.answer) });
    }
    embed.addFields({ name: 'Votes', value: `✅ ${votes.yes}   ❌ ${votes.no}   (${votes.total} of ${threshold})` });
    return embed.setTimestamp(new Date(appeal.created_at));
}

function voteRow(appealId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`md:apv:${appealId}:yes`).setEmoji('✅').setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`md:apv:${appealId}:no`).setEmoji('❌').setLabel('Deny').setStyle(ButtonStyle.Danger),
    );
}

function decideRow(appealId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`md:apd:${appealId}:ok`).setLabel('Approve appeal').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`md:apd:${appealId}:no`).setLabel('Deny appeal').setStyle(ButtonStyle.Danger),
    );
}

/** Post anything the website filed that hasn't reached #admin-chat yet. */
async function postPending(client) {
    await ensureModSchema();
    const settings = await getSettings();
    const threshold = asInt(settings.appeal_vote_threshold, 5);
    const { rows } = await pool.query(`SELECT * FROM mod_appeals WHERE status = 'voting' AND posted_at IS NULL ORDER BY id`);
    for (const appeal of rows) {
        const c = await store.getCase(appeal.case_id);
        const msg = await posting.sendTo(client, CHANNELS.ADMIN_CHAT, {
            content: `New appeal from <@${appeal.discord_id}>. Please vote.`,
            embeds: [appealEmbed(appeal, c, { yes: 0, no: 0, total: 0 }, threshold)],
            components: [voteRow(appeal.id)],
            allowedMentions: { parse: [] },
        }, 'an appeal');
        if (msg) await pool.query('UPDATE mod_appeals SET vote_message_id = $2, posted_at = NOW() WHERE id = $1', [appeal.id, msg.id]);
    }
    return { summary: rows.length ? `Posted ${rows.length} appeal(s).` : 'Nothing to post.', problems: [] };
}

async function moveToDirectors(client, appeal, c, votes, threshold) {
    const msg = await posting.sendTo(client, CHANNELS.DIRECTOR_CHAT, {
        content: `<@&${STAFF_ROLES.DIRECTOR}> Appeal from <@${appeal.discord_id}> is ready for a final decision: ✅ ${votes.yes}, ❌ ${votes.no}.`,
        embeds: [appealEmbed(appeal, c, votes, threshold)],
        components: [decideRow(appeal.id)],
        allowedMentions: { roles: [STAFF_ROLES.DIRECTOR] },
    }, 'an appeal for final decision');
    if (msg) await pool.query('UPDATE mod_appeals SET director_message_id = $2 WHERE id = $1', [appeal.id, msg.id]);
}

// md:apv:<appealId>:yes|no
async function vote(interaction, [id, choice]) {
    if (rankOf(interaction.member) < RANK.ADMIN || await isFrozen(interaction.user.id)) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: 'Only Admins and Directors vote on appeals.' });
        return interaction.reply({ content: 'Only Admins and Directors vote on appeals.', flags: EPHEMERAL });
    }
    const appealId = parseInt(id, 10);
    const { rows } = await pool.query('SELECT * FROM mod_appeals WHERE id = $1', [appealId]);
    const appeal = rows[0];
    if (!appeal || appeal.status !== 'voting') {
        return interaction.reply({ content: 'Voting on this appeal has closed.', flags: EPHEMERAL });
    }
    await pool.query(
        `INSERT INTO mod_appeal_votes (appeal_id, voter_id, voter_name, vote) VALUES ($1, $2, $3, $4)
         ON CONFLICT (appeal_id, voter_id) DO UPDATE SET vote = $4, created_at = NOW()`,
        [appealId, interaction.user.id, interaction.member?.displayName || interaction.user.username, choice === 'yes' ? 'yes' : 'no'],
    );
    const settings = await getSettings();
    const threshold = asInt(settings.appeal_vote_threshold, 5);
    const votes = await tally(appealId);
    const c = await store.getCase(appeal.case_id);
    const reached = votes.total >= threshold;
    await interaction.update({
        embeds: [appealEmbed(appeal, c, votes, threshold)],
        components: reached ? [] : [voteRow(appealId)],
    });
    higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `Voted ${choice === 'yes' ? 'accept' : 'deny'} on the appeal for case ${appeal.case_id} (${votes.yes} accept, ${votes.no} deny).` });
    if (reached) {
        const moved = await pool.query(
            `UPDATE mod_appeals SET status = 'director' WHERE id = $1 AND status = 'voting' RETURNING id`,
            [appealId],
        );
        if (moved.rows.length) await moveToDirectors(interaction.client, appeal, c, votes, threshold);
    }
    return undefined;
}

// md:apd:<appealId>:ok|no
async function decideButton(interaction, [id, verdict]) {
    if (rankOf(interaction.member) < RANK.DIRECTOR) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: 'Only a Director makes the final call on an appeal.' });
        return interaction.reply({ content: 'Only a Director makes the final call.', flags: EPHEMERAL });
    }
    return interaction.showModal(new ModalBuilder()
        .setCustomId(`md:apm:${id}:${verdict}`)
        .setTitle(verdict === 'ok' ? 'Approve appeal' : 'Deny appeal')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('note').setLabel('Reason for this decision').setStyle(TextInputStyle.Paragraph)
            .setRequired(true).setMaxLength(1000))));
}

// md:apm:<appealId>:ok|no
async function decideModal(interaction, [id, verdict]) {
    if (rankOf(interaction.member) < RANK.DIRECTOR) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: 'Only a Director makes the final call on an appeal.' });
        return interaction.reply({ content: 'Only a Director makes the final call.', flags: EPHEMERAL });
    }
    await interaction.deferUpdate();
    const res = await decide(interaction.client, parseInt(id, 10), {
        verdict: verdict === 'ok' ? 'approved' : 'denied',
        note: interaction.fields.getTextInputValue('note').trim(),
        actor: { id: interaction.user.id, name: interaction.member?.displayName || interaction.user.username, source: 'command' },
    });
    higgenLog.markSubRouterOutcome(interaction, { outcome: res.problems?.length ? 'partial' : 'success', note: res.summary });
    return interaction.editReply({ content: clip(`${res.summary}${res.problems?.length ? `\nNot completed: ${res.problems.join(' ')}` : ''}`, 1900), components: [] });
}

async function applyApprovedBan(client, guild, appeal, c, note, actor, problems) {
    const { liftBan, getReturnInvite } = require('./bans');
    const problem = await liftBan(guild, appeal.discord_id, `Appeal approved (case ${c.id}): ${note}`, { caseId: c.id });
    if (problem) problems.push(problem);
    // Rule 6.1.4: one strike comes off, and any infraction after re-entry is a ban.
    await store.removeStrike(appeal.discord_id);
    await store.setLastChance(appeal.discord_id, true);
    try {
        const url = await getReturnInvite(guild);
        await pool.query('UPDATE mod_bans SET invite_url = $2 WHERE case_id = $1', [c.id, url]);
    } catch (err) {
        problems.push(`The return invite could not be created: ${err.message}`);
    }
    await store.createCase({
        discordId: appeal.discord_id, targetName: appeal.discord_name, kind: 'unban', status: 'ended',
        reason: `Appeal approved: ${note}`, actor, details: { appeal_id: appeal.id, original_case: c.id },
    });
}

async function applyApprovedSuspension(client, guild, appeal, c, note, actor, problems) {
    const { rows } = await pool.query(
        `SELECT * FROM mod_suspensions WHERE case_id = $1 AND status IN ('active','queued')`,
        [c.id],
    );
    const { liftAllFor } = require('./suspensions');
    await liftAllFor(
        { client, guild, actor, target: { id: appeal.discord_id, name: appeal.discord_name } },
        rows, { reason: `Appeal approved: ${note}`, problems, quiet: true },
    );
    await store.createCase({
        discordId: appeal.discord_id, targetName: appeal.discord_name, kind: 'unsuspend', status: 'ended',
        reason: `Appeal approved: ${note}`, actor, details: { appeal_id: appeal.id, original_case: c.id },
    });
}

/** The single place an appeal is settled, from Discord or the Mod Logs tab. */
async function decide(client, appealId, { verdict, note, actor }) {
    const status = verdict === 'approved' ? 'approved' : 'denied';
    const claimed = await pool.query(
        `UPDATE mod_appeals SET status = $2, decided_by_id = $3, decided_by_name = $4, decision_note = $5, decided_at = NOW()
          WHERE id = $1 AND status = 'director' RETURNING *`,
        [appealId, status, actor?.id || null, actor?.name || null, String(note || '').slice(0, 1000)],
    );
    const appeal = claimed.rows[0];
    if (!appeal) return { summary: 'This appeal has already been decided or is still being voted on.', problems: [] };

    const problems = [];
    const guild = getGuild(client);
    const c = await store.getCase(appeal.case_id);
    if (status === 'approved' && guild && c) {
        try {
            if (appeal.kind === 'ban') await applyApprovedBan(client, guild, appeal, c, note, actor, problems);
            else await applyApprovedSuspension(client, guild, appeal, c, note, actor, problems);
            await pool.query('UPDATE mod_appeals SET applied_at = NOW() WHERE id = $1', [appeal.id]);
        } catch (err) {
            Logger.error(`Appeal ${appeal.id} could not be applied`, err);
            problems.push(`The appeal is marked approved, but applying it failed: ${err.message}`);
        }
    }
    await store.logEvent({
        discordId: appeal.discord_id, caseId: appeal.case_id, kind: 'appeal',
        summary: `${actor?.name || 'A Director'} ${status} the appeal on case ${appeal.case_id}: ${note}`,
        actorId: actor?.id, actorName: actor?.name,
    });
    if (appeal.kind !== 'ban') {
        await posting.dmMember(client, appeal.discord_id, `Your Beluga League appeal was ${status}.\n\n${note}`);
    }
    await posting.sendTo(client, CHANNELS.TIMEOUT_LOG, {
        embeds: [new EmbedBuilder()
            .setTitle(`Appeal ${status}: case ${appeal.case_id}`)
            .setDescription(clip(`<@${appeal.discord_id}>\nDecided by ${actor?.name || 'a Director'}: ${note}`, 2000))
            .setColor(status === 'approved' ? posting.COLORS.unban : posting.COLORS.ban)
            .setTimestamp()],
        allowedMentions: { parse: [] },
    }, 'an appeal decision');
    return { summary: `Appeal ${status}.`, problems };
}

module.exports = { postPending, vote, decideButton, decideModal, decide };
