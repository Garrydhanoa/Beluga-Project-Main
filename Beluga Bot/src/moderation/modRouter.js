/**
 * Central dispatch for every `md:` interaction: confirm cards, Director requests,
 * /modlog paging, case controls, release prompts, season reviews, chat filter panels
 * and appeal votes. Routed from the single interactionCreate choke point in bot.js,
 * never a collector, so every click lands in higgenlogs. Errors are swallowed here,
 * so outcomes are reported back via markSubRouterOutcome.
 */

const {
    ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { ruleByCode, CHANNELS, STAFF_ROLES } = require('./modConfig');
const { RANK, rankOf, isAllowed, isFrozen } = require('./modPerms');
const { parseDuration, parseSuspensionLength } = require('./modParse');
const actions = require('./actions');
const store = require('./modStore');
const views = require('./modViews');
const posting = require('./modPosting');
const { actorOf, outcomeText, mark } = require('./modCommands');
const { resolveTeam, releasePlayer } = require('./release');

const EPHEMERAL = 64;

function isModId(customId) {
    return typeof customId === 'string' && customId.startsWith('md:');
}

async function deny(interaction, content, note = content) {
    higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note });
    return interaction.reply({ content, flags: EPHEMERAL });
}

async function needRank(interaction, action) {
    if (!isAllowed(rankOf(interaction.member), action) || await isFrozen(interaction.user.id)) {
        await deny(interaction, 'You do not have the rank for this.');
        return false;
    }
    return true;
}

function contextFrom(interaction, payload, actor) {
    return {
        client: interaction.client,
        guild: interaction.guild,
        target: { id: payload.targetId, name: payload.targetName },
        actor,
        rule: payload.ruleCode ? ruleByCode(payload.ruleCode) : null,
        reason: payload.reason,
        attachment: payload.attachment || null,
        silent: !!payload.silent,
    };
}

async function perform(interaction, payload, actor) {
    const ctx = contextFrom(interaction, payload, actor);
    switch (payload.action) {
        case 'warn': return actions.warn(ctx);
        case 'timeout': return actions.timeout(ctx, { seconds: payload.seconds });
        case 'kick': return actions.kick(ctx);
        case 'suspend': return actions.suspend(ctx, payload.length);
        case 'strike': return actions.strike(ctx, payload.pkg);
        case 'ban': return actions.ban(ctx, payload.ban);
        default: throw new actions.ModError(`Unknown moderation action "${payload.action}".`);
    }
}

// Removing someone from the server is the Directors' call: a ban, a kick, or a strike that bans.
const needsDirector = (payload) => ['ban', 'kick'].includes(payload.action) || (payload.action === 'strike' && payload.pkg?.ban);
const removalKind = (payload) => (payload.action === 'kick' ? 'kick' : 'ban');

async function sendToDirectors(interaction, request) {
    const what = removalKind(request.payload);
    await pool.query(`UPDATE mod_requests SET kind = $2, status = 'pending' WHERE id = $1`, [request.id, `${what}_request`]);
    const fresh = await store.getRequest(request.id);
    const msg = await posting.sendTo(interaction.client, CHANNELS.DIRECTOR_CHAT, {
        content: `<@&${STAFF_ROLES.DIRECTOR}>`,
        embeds: [views.requestEmbed(fresh)],
        components: [views.requestRow(fresh.id)],
        allowedMentions: { roles: [STAFF_ROLES.DIRECTOR] },
    }, `a ${what} request`);
    if (msg) await store.setRequestMessage(fresh.id, msg.channelId, msg.id);
    higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `Sent a ${what} request for ${fresh.payload.targetName} to the Directors.` });
    await interaction.editReply({
        content: msg ? 'Sent to the Directors. Nothing has been applied yet.' : 'The request could not be posted in #director-chat.',
        embeds: [], components: [],
    });
}

function editModal(request) {
    const { pkg } = request.payload;
    const modal = new ModalBuilder().setCustomId(`md:editm:${request.id}`).setTitle('Edit package');
    const timeoutValue = pkg.timeoutSeconds ? posting.formatDuration(pkg.timeoutSeconds) : 'none';
    const suspensionValue = pkg.suspension
        ? (pkg.suspension.unit === 'indefinite' ? 'indefinite' : `${pkg.suspension.total} ${pkg.suspension.unit}`)
        : 'none';
    modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('timeout').setLabel('Timeout (e.g. 2d, 1w, none)').setStyle(TextInputStyle.Short)
            .setRequired(true).setValue(timeoutValue)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('suspension').setLabel('Suspension (e.g. 3 series, 1 season, none)').setStyle(TextInputStyle.Short)
            .setRequired(true).setValue(suspensionValue)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('ban').setLabel('Ban (none, appeal 6mo, or temp 30d)').setStyle(TextInputStyle.Short)
            .setRequired(true).setValue(pkg.ban ? (pkg.ban.type === 'temp' ? 'temp 30d' : 'appeal 6mo') : 'none')),
    );
    return modal;
}

function readBanField(text) {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw || raw === 'none') return { ban: null };
    const m = raw.match(/^(appeal|temp)\s+(.+)$/);
    const seconds = m ? parseDuration(m[2]) : null;
    if (!seconds) return { error: 'I could not read the ban field. Use `none`, `appeal 6mo` or `temp 30d`.' };
    const at = new Date(Date.now() + seconds * 1000).toISOString();
    return { ban: m[1] === 'temp' ? { type: 'temp', unbanAt: at } : { type: 'appealable', appealAfter: at } };
}

async function renderDraft(interaction, request) {
    const summary = await store.memberSummary(request.payload.targetId);
    const team = await resolveTeam(request.payload.targetId).catch(() => null);
    const canApply = !needsDirector(request.payload) || rankOf(interaction.member) >= RANK.DIRECTOR;
    return views.strikeCard(request, summary, team, canApply);
}

async function ownDraft(interaction, id) {
    const request = await store.getRequest(id);
    if (!request || request.status !== 'draft') {
        await deny(interaction, 'This card has already been used or cancelled.');
        return null;
    }
    if (request.requested_by_id !== interaction.user.id) {
        await deny(interaction, 'These controls belong to whoever ran the command.', "They tried to use someone else's confirm card.");
        return null;
    }
    return request;
}

const HANDLERS = {
    // md:log:<owner>:<discordId>:<page>
    async log(interaction, [ownerId, discordId, page]) {
        if (interaction.user.id !== ownerId) return deny(interaction, 'Run `/modlog` yourself to page through this.');
        await interaction.deferUpdate();
        const c = (await store.listCases(discordId, { limit: 1 }))[0];
        await interaction.editReply(await views.modlogView(discordId, c?.target_name, ownerId, parseInt(page, 10) || 0));
    },

    // md:ev:<caseId>
    async ev(interaction, [caseId]) {
        if (!(await needRank(interaction, 'case'))) return undefined;
        await interaction.deferReply({ flags: EPHEMERAL });
        const { rows } = await pool.query('SELECT * FROM mod_evidence WHERE case_id = $1 ORDER BY id LIMIT 10', [caseId]);
        const files = rows.filter((r) => r.bytes).slice(0, 5).map((r) => ({ attachment: r.bytes, name: r.filename || `evidence-${r.id}` }));
        const texts = rows.filter((r) => r.text).map((r) => r.text);
        return interaction.editReply({
            content: posting.clip(texts.join('\n\n') || (files.length ? `Evidence for case ${caseId}:` : 'No evidence on this case.'), 1900),
            files,
        });
    },

    // md:void:<caseId>
    async void(interaction, [caseId]) {
        if (!(await needRank(interaction, 'void'))) return undefined;
        return interaction.showModal(new ModalBuilder()
            .setCustomId(`md:voidm:${caseId}`)
            .setTitle(`Void case ${caseId}`)
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('reason').setLabel('Why is this being voided?').setStyle(TextInputStyle.Paragraph)
                .setRequired(true).setMaxLength(1000))));
    },
    async voidm(interaction, [caseId]) {
        if (!(await needRank(interaction, 'void'))) return undefined;
        await interaction.deferReply({ flags: EPHEMERAL });
        const res = await actions.voidCase({
            client: interaction.client, guild: interaction.guild, actor: actorOf(interaction),
            reason: interaction.fields.getTextInputValue('reason').trim(),
        }, parseInt(caseId, 10));
        mark(interaction, res);
        return interaction.editReply({ content: outcomeText(res) });
    },

    // md:addreason:<caseId>
    async addreason(interaction, [caseId]) {
        if (!(await needRank(interaction, 'reason'))) return undefined;
        return interaction.showModal(new ModalBuilder()
            .setCustomId(`md:addreasonm:${caseId}`)
            .setTitle(`Reason for case ${caseId}`)
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('reason').setLabel('Why was this done?').setStyle(TextInputStyle.Paragraph)
                .setRequired(true).setMaxLength(1000))));
    },
    async addreasonm(interaction, [caseId]) {
        if (!(await needRank(interaction, 'reason'))) return undefined;
        await interaction.deferReply({ flags: EPHEMERAL });
        const reason = interaction.fields.getTextInputValue('reason').trim();
        const res = await actions.changeReason({ client: interaction.client, guild: interaction.guild, actor: actorOf(interaction) }, parseInt(caseId, 10), reason);
        await store.mergeDetails(parseInt(caseId, 10), { needs_reason: false });
        mark(interaction, res);
        return interaction.editReply({ content: outcomeText(res) });
    },

    // md:go:<requestId>
    async go(interaction, [id]) {
        const request = await ownDraft(interaction, id);
        if (!request) return undefined;
        const rank = rankOf(interaction.member);
        await interaction.deferUpdate();
        if (needsDirector(request.payload) && rank < RANK.DIRECTOR) return sendToDirectors(interaction, request);
        const won = await store.decideRequest(request.id, 'approved', actorOf(interaction), ['draft']);
        if (!won) return interaction.editReply({ content: 'This card has already been used.', embeds: [], components: [] });
        const res = await perform(interaction, request.payload, actorOf(interaction));
        if (needsDirector(request.payload)) await require('./rogueBrake').note(interaction.client, actorOf(interaction), removalKind(request.payload));
        mark(interaction, res);
        return interaction.editReply({ content: outcomeText(res), embeds: [], components: [] });
    },

    // md:edit:<requestId>
    async edit(interaction, [id]) {
        const request = await ownDraft(interaction, id);
        if (!request) return undefined;
        return interaction.showModal(editModal(request));
    },
    async editm(interaction, [id]) {
        const request = await ownDraft(interaction, id);
        if (!request) return undefined;
        const timeoutText = interaction.fields.getTextInputValue('timeout').trim().toLowerCase();
        const suspensionText = interaction.fields.getTextInputValue('suspension').trim().toLowerCase();
        const timeoutSeconds = timeoutText === 'none' ? 0 : parseDuration(timeoutText);
        if (timeoutText !== 'none' && !timeoutSeconds) return deny(interaction, 'I could not read the timeout. Try `2d` or `none`.');
        if (timeoutSeconds > 28 * 86400) return deny(interaction, 'Discord limits a timeout to 28 days.');
        const suspension = suspensionText === 'none' ? null : parseSuspensionLength(suspensionText);
        if (suspensionText !== 'none' && !suspension) return deny(interaction, 'I could not read the suspension. Try `3 series` or `none`.');
        const parsed = readBanField(interaction.fields.getTextInputValue('ban'));
        if (parsed.error) return deny(interaction, parsed.error);
        // Strike 3 is a ban by rule, so only someone who can ban may change that.
        if (!parsed.ban && request.payload.pkg?.ban && rankOf(interaction.member) < RANK.DIRECTOR) {
            return deny(interaction, 'Only a Director can remove the ban from this package.');
        }
        const payload = { ...request.payload, pkg: { timeoutSeconds, suspension, ban: parsed.ban } };
        await store.updateRequestPayload(request.id, payload);
        return interaction.update(await renderDraft(interaction, { ...request, payload }));
    },

    // md:x:<requestId>
    async x(interaction, [id]) {
        const request = await ownDraft(interaction, id);
        if (!request) return undefined;
        await store.decideRequest(request.id, 'cancelled', actorOf(interaction), ['draft']);
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: 'They cancelled the confirm card, so nothing was applied.' });
        return interaction.update({ content: 'Cancelled. Nothing was applied.', embeds: [], components: [] });
    },

    // md:rq:<requestId>:ok|no
    async rq(interaction, [id, verdict]) {
        if (!(await needRank(interaction, 'decide'))) return undefined;
        await interaction.deferUpdate();
        const approver = actorOf(interaction);
        const status = verdict === 'ok' ? 'approved' : 'denied';
        const request = await store.decideRequest(parseInt(id, 10), status, approver, ['pending']);
        if (!request) return interaction.followUp({ content: 'Someone already decided this request.', flags: EPHEMERAL });
        const what = removalKind(request.payload);
        const requester = { id: request.requested_by_id, name: request.requested_by_name, source: 'command' };
        const original = interaction.message.embeds[0];
        if (status === 'denied') {
            higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `Denied the ${what} request for ${request.payload.targetName}.` });
            await posting.dmMember(interaction.client, requester.id, `Your ${what} request for ${request.payload.targetName} was denied by ${approver.name}.`);
            return interaction.editReply({ content: `Denied by ${approver.name}.`, embeds: original ? [original] : [], components: [] });
        }
        const res = await perform(interaction, request.payload, requester);
        await store.mergeDetails(res.case.id, { approved_by: approver.name, approved_by_id: approver.id });
        await require('./rogueBrake').note(interaction.client, approver, what);
        mark(interaction, res);
        return interaction.editReply({ content: `Approved by ${approver.name}.\n${outcomeText(res)}`.slice(0, 1900), embeds: original ? [original] : [], components: [] });
    },

    // md:release:<suspensionId>
    async release(interaction, [id]) {
        if (!(await needRank(interaction, 'release'))) return undefined;
        await interaction.deferUpdate();
        const claimed = await pool.query(
            `UPDATE mod_suspensions SET release_state = 'releasing' WHERE id = $1 AND release_state = 'offered' RETURNING *`,
            [id],
        );
        const row = claimed.rows[0];
        if (!row) return interaction.followUp({ content: 'This has already been handled.', flags: EPHEMERAL });
        const c = await store.getCase(row.case_id);
        const res = await releasePlayer({
            client: interaction.client, guild: interaction.guild, discordId: row.discord_id,
            playerName: c?.target_name, actor: actorOf(interaction), reason: `Suspended: ${c?.reason || ''}`,
        });
        await pool.query('UPDATE mod_suspensions SET release_state = $2 WHERE id = $1', [row.id, res.ok ? 'released' : 'offered']);
        const text = res.ok
            ? `Released from ${res.team.teamName}.${res.problems.length ? ` Not completed: ${res.problems.join(' ')}` : ''}`
            : `Not released: ${res.skipped}`;
        higgenLog.markSubRouterOutcome(interaction, { outcome: res.ok ? 'success' : 'failed', note: text });
        await store.logEvent({ discordId: row.discord_id, caseId: row.case_id, kind: 'release', summary: text, actorId: interaction.user.id, actorName: actorOf(interaction).name });
        return interaction.followUp({ content: text, flags: EPHEMERAL });
    },
    // md:keep:<suspensionId>
    async keep(interaction, [id]) {
        if (!(await needRank(interaction, 'release'))) return undefined;
        await pool.query(`UPDATE mod_suspensions SET release_state = 'kept' WHERE id = $1 AND release_state = 'offered'`, [id]);
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: 'Staff chose to keep the player on their team.' });
        return interaction.update({ components: [] });
    },

    // md:carry:<suspensionId>
    async carry(interaction, [id]) {
        if (!(await needRank(interaction, 'suspend'))) return undefined;
        const { rowCount } = await pool.query(
            `UPDATE mod_suspensions SET review_state = 'carried' WHERE id = $1 AND review_state = 'pending'`,
            [id],
        );
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: 'The remaining series carry into the new season.' });
        return interaction.update({ content: rowCount ? `Carried over by ${actorOf(interaction).name}.` : 'This has already been decided.', components: [] });
    },
    // md:clear:<suspensionId>
    async clear(interaction, [id]) {
        if (!(await needRank(interaction, 'unsuspend'))) return undefined;
        await interaction.deferUpdate();
        const { rows } = await pool.query(
            `UPDATE mod_suspensions SET review_state = 'cleared' WHERE id = $1 AND review_state = 'pending' RETURNING *`,
            [id],
        );
        if (!rows[0]) return interaction.followUp({ content: 'This has already been decided.', flags: EPHEMERAL });
        const { lift } = require('./suspensions');
        await lift(interaction.client, interaction.guild, rows[0], {
            reason: 'Cleared at season rollover', actor: actorOf(interaction), quiet: true,
        });
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: 'The remaining series were cleared at season rollover.' });
        return interaction.editReply({ content: `Cleared by ${actorOf(interaction).name}.`, components: [] });
    },

    // Chat filter staff panels (md:fl...) and appeal controls (md:ap...)
    async fl(interaction, parts) { return require('./filter/panels').route(interaction, parts); },
    async flm(interaction, parts) { return require('./filter/panels').routeModal(interaction, parts); },
    async apv(interaction, parts) { return require('./appeals').vote(interaction, parts); },
    async apd(interaction, parts) { return require('./appeals').decideButton(interaction, parts); },
    async apm(interaction, parts) { return require('./appeals').decideModal(interaction, parts); },
};

async function route(interaction) {
    const [, action, ...parts] = interaction.customId.split(':');
    const handler = Object.prototype.hasOwnProperty.call(HANDLERS, action) ? HANDLERS[action] : null;
    if (!handler) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'unhandled', note: `No handler is registered for the moderation control "${action}".` });
        return;
    }
    try {
        await handler(interaction, parts);
    } catch (err) {
        if (err?.code === 10062 || err?.code === 40060) {
            higgenLog.markSubRouterOutcome(interaction, { outcome: 'expired', note: 'The control was used after its interaction had timed out.' });
            return;
        }
        if (err instanceof actions.ModError) {
            higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: err.message });
            const content = err.message;
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
            else await interaction.reply({ content, flags: EPHEMERAL }).catch(() => {});
            return;
        }
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'failed', note: `The moderation control "${action}" threw an error.`, error: err });
        Logger.error(`moderation router error on '${action}'`, err);
        try {
            const content = 'Something went wrong. Check the case before trying again.';
            if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: EPHEMERAL });
            else await interaction.reply({ content, flags: EPHEMERAL });
        } catch { /* ignore secondary failures */ }
    }
}

module.exports = { isModId, route, perform };
