/**
 * What each moderation slash command does. The files in src/commands/ only hold the
 * option definitions and call in here, so the checks stay in one place.
 */

const higgenLog = require('../utils/higgenLog');
const { ruleByCode, getSettings, asInt, STRIKE_PACKAGE } = require('./modConfig');
const { RANK, rankOf, targetProblem, requireAction } = require('./modPerms');
const { parseDuration, parseSuspensionLength } = require('./modParse');
const actions = require('./actions');
const store = require('./modStore');
const views = require('./modViews');
const { ensureModSchema } = require('./modSchema');
const { resolveTeam } = require('./release');

const EPHEMERAL = 64;

function actorOf(interaction) {
    return {
        id: interaction.user.id,
        name: interaction.member?.displayName || interaction.user.username,
        source: 'command',
    };
}

function outcomeText(res) {
    const lines = [res.summary];
    if (res.problems?.length) lines.push('', '**Not completed:**', ...res.problems.map((p) => `• ${p}`));
    return lines.join('\n').slice(0, 1900);
}

function mark(interaction, res) {
    higgenLog.markSubRouterOutcome(interaction, {
        outcome: res.problems?.length ? 'partial' : 'success',
        note: outcomeText(res),
    });
}

/** Run an action behind a deferred reply. ModError means a clean refusal. */
async function run(interaction, fn) {
    await interaction.deferReply({ flags: EPHEMERAL });
    try {
        const res = await fn();
        mark(interaction, res);
        await interaction.editReply({ content: outcomeText(res) });
    } catch (err) {
        if (!(err instanceof actions.ModError)) throw err;
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: err.message });
        await interaction.editReply({ content: err.message });
    }
}

async function needSchema(interaction) {
    if (await ensureModSchema()) return true;
    higgenLog.markSubRouterOutcome(interaction, { outcome: 'failed', note: 'The moderation tables are unavailable.' });
    await interaction.reply({ content: 'The moderation database is unavailable right now.', flags: EPHEMERAL });
    return false;
}

async function readTarget(interaction) {
    const user = interaction.options.getUser('user', true);
    const member = interaction.options.getMember('user')
        || await interaction.guild.members.fetch(user.id).catch(() => null);
    return { id: user.id, name: member?.displayName || user.globalName || user.username, member };
}

async function refuseTarget(interaction, rank, target) {
    const problem = targetProblem(interaction.user.id, rank, target.id, rankOf(target.member));
    if (!problem) return false;
    higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: problem });
    await interaction.reply({ content: problem, flags: EPHEMERAL });
    return true;
}

function readAttachment(interaction) {
    const file = interaction.options.getAttachment('evidence');
    return file ? { url: file.url, name: file.name, size: file.size, contentType: file.contentType } : null;
}

function baseContext(interaction, target) {
    const code = interaction.options.getString('rule');
    return {
        client: interaction.client,
        guild: interaction.guild,
        target: { id: target.id, name: target.name },
        member: target.member,
        actor: actorOf(interaction),
        rule: code ? ruleByCode(code) : null,
        reason: interaction.options.getString('reason', true).trim(),
        attachment: readAttachment(interaction),
        silent: !!interaction.options.getBoolean('silent'),
    };
}

/** Everything a confirm button needs to rebuild the context later. */
function draftPayload(ctx, extra) {
    return {
        targetId: ctx.target.id, targetName: ctx.target.name,
        ruleCode: ctx.rule?.code || null, ruleLabel: ctx.rule?.label || null,
        reason: ctx.reason, attachment: ctx.attachment, silent: ctx.silent, ...extra,
    };
}

async function maybeNotice(interaction, ctx, summary, action, extra) {
    const reasons = [];
    if (action === 'warn' && summary.warned) reasons.push('They have already used their one warning, so the rulebook points to a strike.');
    if (summary.lastChance) reasons.push('They are on last chance: rule 6.1.4 says any infraction means a ban. Use /ban for that.');
    if (!reasons.length) return false;
    const request = await store.createRequest({
        kind: 'draft', status: 'draft', actor: ctx.actor, payload: draftPayload(ctx, { action, ...extra }),
    });
    await interaction.reply({ ...views.noticeCard(request, reasons.join('\n')), flags: EPHEMERAL });
    return true;
}

async function note(interaction) {
    if (!(await needSchema(interaction))) return;
    if (!(await requireAction(interaction, 'note'))) return;
    const target = await readTarget(interaction);
    await run(interaction, () => actions.note(baseContext(interaction, target)));
}

async function warn(interaction) {
    if (!(await needSchema(interaction))) return;
    const rank = await requireAction(interaction, 'warn');
    if (!rank) return;
    const target = await readTarget(interaction);
    if (await refuseTarget(interaction, rank, target)) return;
    const ctx = baseContext(interaction, target);
    if (await maybeNotice(interaction, ctx, await store.memberSummary(target.id), 'warn', {})) return;
    await run(interaction, () => actions.warn(ctx));
}

async function timeout(interaction) {
    if (!(await needSchema(interaction))) return;
    const rank = await requireAction(interaction, 'timeout');
    if (!rank) return;
    const target = await readTarget(interaction);
    if (await refuseTarget(interaction, rank, target)) return;
    const seconds = parseDuration(interaction.options.getString('duration', true));
    if (!seconds) return interaction.reply({ content: 'I could not read that length. Try `10m`, `2h`, `2d` or `1w`.', flags: EPHEMERAL });
    if (seconds > 28 * 86400) return interaction.reply({ content: 'Discord limits a timeout to 28 days.', flags: EPHEMERAL });
    const ctx = baseContext(interaction, target);
    if (await maybeNotice(interaction, ctx, await store.memberSummary(target.id), 'timeout', { seconds })) return;
    await run(interaction, () => actions.timeout(ctx, { seconds }));
}

async function untimeout(interaction) {
    if (!(await needSchema(interaction))) return;
    if (!(await requireAction(interaction, 'untimeout'))) return;
    const target = await readTarget(interaction);
    await run(interaction, () => actions.untimeout(baseContext(interaction, target)));
}

/** The kick confirm card. Also used by the chat filter's punishment panel. */
async function kickDraftCard(ctx, rank) {
    const request = await store.createRequest({
        kind: 'draft', status: 'draft', actor: ctx.actor, payload: draftPayload(ctx, { action: 'kick' }),
    });
    const summary = await store.memberSummary(ctx.target.id);
    const team = await resolveTeam(ctx.target.id).catch(() => null);
    return views.kickCard(request, summary, team, rank >= RANK.DIRECTOR);
}

async function kick(interaction) {
    if (!(await needSchema(interaction))) return;
    const rank = await requireAction(interaction, 'kick');
    if (!rank) return;
    const target = await readTarget(interaction);
    if (await refuseTarget(interaction, rank, target)) return;
    if (!target.member) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: 'They are not in the server.' });
        await interaction.reply({ content: 'They are not in the server.', flags: EPHEMERAL });
        return;
    }
    await interaction.reply({ ...(await kickDraftCard(baseContext(interaction, target), rank)), flags: EPHEMERAL });
}

function addMonths(months) {
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    return date;
}

async function defaultBan() {
    const settings = await getSettings();
    return { type: 'appealable', appealAfter: addMonths(asInt(settings.appeal_after_months, 6)).toISOString() };
}

/** The strike confirm card. Also used by the chat filter's punishment panel. */
async function strikeDraftCard(ctx, rank) {
    const summary = await store.memberSummary(ctx.target.id);
    const next = summary.strikes + 1;
    const base = STRIKE_PACKAGE[Math.min(next, store.STRIKE_LIMIT)];
    const banned = base.ban || summary.lastChance;
    const pkg = {
        timeoutSeconds: banned ? 0 : base.timeoutSeconds,
        suspension: !banned && base.series ? { unit: 'series', total: base.series } : null,
        ban: banned ? await defaultBan() : null,
    };
    const request = await store.createRequest({
        kind: 'draft', status: 'draft', actor: ctx.actor, payload: draftPayload(ctx, { action: 'strike', pkg, strikeNumber: next }),
    });
    const team = await resolveTeam(ctx.target.id).catch(() => null);
    return views.strikeCard(request, summary, team, !pkg.ban || rank >= RANK.DIRECTOR);
}

async function strike(interaction) {
    if (!(await needSchema(interaction))) return;
    const rank = await requireAction(interaction, 'strike');
    if (!rank) return;
    const target = await readTarget(interaction);
    if (await refuseTarget(interaction, rank, target)) return;
    await interaction.reply({ ...(await strikeDraftCard(baseContext(interaction, target), rank)), flags: EPHEMERAL });
}

/** The ban confirm card. Also used by the chat filter's punishment panel. */
async function banDraftCard(ctx, rank, details) {
    const request = await store.createRequest({
        kind: 'draft', status: 'draft', actor: ctx.actor, payload: draftPayload(ctx, { action: 'ban', ban: details }),
    });
    const summary = await store.memberSummary(ctx.target.id);
    const team = await resolveTeam(ctx.target.id).catch(() => null);
    return views.banCard(request, summary, team, rank >= RANK.DIRECTOR);
}

async function unstrike(interaction) {
    if (!(await needSchema(interaction))) return;
    if (!(await requireAction(interaction, 'unstrike'))) return;
    const target = await readTarget(interaction);
    await run(interaction, () => actions.unstrike(baseContext(interaction, target)));
}

async function suspend(interaction) {
    if (!(await needSchema(interaction))) return;
    const rank = await requireAction(interaction, 'suspend');
    if (!rank) return;
    const target = await readTarget(interaction);
    if (await refuseTarget(interaction, rank, target)) return;
    const length = parseSuspensionLength(interaction.options.getString('length', true));
    if (!length) return interaction.reply({ content: 'I could not read that length. Try `1 series`, `3 series`, `2 weeks`, `1 season` or `indefinite`.', flags: EPHEMERAL });
    const ctx = baseContext(interaction, target);
    if (await maybeNotice(interaction, ctx, await store.memberSummary(target.id), 'suspend', { length })) return;
    await run(interaction, () => actions.suspend(ctx, length));
}

async function unsuspend(interaction) {
    if (!(await needSchema(interaction))) return;
    if (!(await requireAction(interaction, 'unsuspend'))) return;
    const target = await readTarget(interaction);
    await run(interaction, () => actions.unsuspend(baseContext(interaction, target)));
}

async function ban(interaction) {
    if (!(await needSchema(interaction))) return;
    // Any staff member may run it, but below Director what they get is a request.
    const rank = await requireAction(interaction, 'ban');
    if (!rank) return;
    const target = await readTarget(interaction);
    if (await refuseTarget(interaction, rank, target)) return;
    const type = interaction.options.getString('type', true);
    const lengthText = interaction.options.getString('length');
    const seconds = lengthText ? parseDuration(lengthText) : null;
    if (lengthText && !seconds) return interaction.reply({ content: 'I could not read that length. Try `30d`, `2w` or `6mo`.', flags: EPHEMERAL });
    if (type === 'temp' && !seconds) return interaction.reply({ content: 'A temp ban needs a length, for example `30d`.', flags: EPHEMERAL });
    const defaults = await defaultBan();
    const details = {
        type,
        unbanAt: type === 'temp' ? new Date(Date.now() + seconds * 1000).toISOString() : null,
        appealAfter: type === 'appealable'
            ? (seconds ? new Date(Date.now() + seconds * 1000).toISOString() : defaults.appealAfter)
            : null,
        deleteSeconds: parseInt(interaction.options.getString('delete_messages') || '0', 10) || 0,
    };
    await interaction.reply({ ...(await banDraftCard(baseContext(interaction, target), rank, details)), flags: EPHEMERAL });
}

async function unban(interaction) {
    if (!(await needSchema(interaction))) return;
    if (!(await requireAction(interaction, 'unban'))) return;
    const target = await readTarget(interaction);
    await run(interaction, () => actions.unban(baseContext(interaction, target)));
}

async function modlog(interaction) {
    if (!(await needSchema(interaction))) return;
    if (!(await requireAction(interaction, 'modlog'))) return;
    const target = await readTarget(interaction);
    await interaction.reply({ ...(await views.modlogView(target.id, target.name, interaction.user.id, 0)), flags: EPHEMERAL });
}

async function viewCase(interaction) {
    if (!(await needSchema(interaction))) return;
    const rank = await requireAction(interaction, 'case');
    if (!rank) return;
    const id = interaction.options.getInteger('id', true);
    const c = await store.getCase(id);
    if (!c) return interaction.reply({ content: `There is no case ${id}.`, flags: EPHEMERAL });
    const file = readAttachment(interaction);
    if (file) {
        const res = await store.addEvidenceFile({ caseId: c.id, attachment: file, actor: actorOf(interaction) });
        if (!res.ok) return interaction.reply({ content: `The evidence was not saved: ${res.error}`, flags: EPHEMERAL });
        await store.logEvent({
            discordId: c.discord_id, caseId: c.id, kind: 'evidence',
            summary: `${actorOf(interaction).name} added evidence to case ${c.id}.`,
            actorId: interaction.user.id, actorName: actorOf(interaction).name,
        });
    }
    await interaction.reply({ ...(await views.caseView(c, rank)), flags: EPHEMERAL });
}

async function reason(interaction) {
    if (!(await needSchema(interaction))) return;
    if (!(await requireAction(interaction, 'reason'))) return;
    const id = interaction.options.getInteger('id', true);
    const text = interaction.options.getString('reason', true).trim();
    await run(interaction, () => actions.changeReason({
        client: interaction.client, guild: interaction.guild, actor: actorOf(interaction),
    }, id, text));
}

async function myRecord(interaction) {
    if (!(await needSchema(interaction))) return;
    await interaction.reply({
        ...(await views.myRecordView(interaction.user.id, interaction.member?.displayName || interaction.user.username)),
        flags: EPHEMERAL,
    });
}

const DURATION_PRESETS = ['10m', '1h', '6h', '1d', '2d', '1w', '2w', '28d'];
const SUSPENSION_PRESETS = ['1 series', '3 series', '4 series', '8 series', '1 week', '2 weeks', '1 season', 'indefinite'];
const BAN_PRESETS = ['7d', '14d', '30d', '3mo', '6mo', '1y'];

function presetAutocomplete(presets) {
    return async (interaction) => {
        const typed = String(interaction.options.getFocused() || '').toLowerCase();
        const hits = presets.filter((p) => p.includes(typed)).slice(0, 25);
        if (typed && !hits.includes(typed)) hits.unshift(typed);
        await interaction.respond(hits.slice(0, 25).map((p) => ({ name: p.slice(0, 100), value: p.slice(0, 100) })));
    };
}

module.exports = {
    actorOf, outcomeText, mark, strikeDraftCard, banDraftCard, kickDraftCard, defaultBan,
    note, warn, timeout, untimeout, kick, strike, unstrike, suspend, unsuspend, ban, unban,
    modlog, viewCase, reason, myRecord,
    durationAutocomplete: presetAutocomplete(DURATION_PRESETS),
    suspensionAutocomplete: presetAutocomplete(SUSPENSION_PRESETS),
    banAutocomplete: presetAutocomplete(BAN_PRESETS),
};
