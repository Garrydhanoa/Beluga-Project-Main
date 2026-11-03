/**
 * Staff decisions on chat filter alerts, posted in #automod-log.
 *
 *   slur   "Is this bad?"  Yes opens a panel to pick the punishment.
 *                          No lifts the timeout, voids the case, offers the allow-list.
 *                          Slurs the AI caught use this same path (layer 'slur' with a model).
 *   AI     "Is this timeoutable?"  Yes asks how long. No dismisses it.
 *
 * These are buttons rather than emoji reactions so each decision is attributed to a
 * person, checked against their rank, and recorded in higgenlogs.
 */

const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { pool } = require('../../utils/database');
const higgenLog = require('../../utils/higgenLog');
const { ruleChoices, ruleByCode } = require('../modConfig');
const { rankOf, isAllowed, isFrozen, targetProblem } = require('../modPerms');
const { parseDuration, parseSuspensionLength } = require('../modParse');
const actions = require('../actions');
const posting = require('../modPosting');
const matcher = require('./matcher');

const EPHEMERAL = 64;
const TIMEOUT_CHOICES = [[600, '10m'], [3600, '1h'], [21600, '6h'], [86400, '24h'], [172800, '2d'], [604800, '1w']];

async function getFlag(id) {
    const { rows } = await pool.query('SELECT * FROM mod_flags WHERE id = $1', [parseInt(id, 10)]);
    return rows[0] || null;
}

function denied(interaction, content) {
    higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: content });
    return interaction.reply({ content, flags: EPHEMERAL });
}

function actorOf(interaction) {
    return { id: interaction.user.id, name: interaction.member?.displayName || interaction.user.username, source: 'command' };
}

async function allowed(interaction, action) {
    if (!isAllowed(rankOf(interaction.member), action) || await isFrozen(interaction.user.id)) {
        await denied(interaction, 'You do not have the rank for this.');
        return false;
    }
    return true;
}

async function close(flagId, status, interaction) {
    const { rows } = await pool.query(
        `UPDATE mod_flags SET status = $2, reviewed_by_id = $3, reviewed_by_name = $4, reviewed_at = NOW()
          WHERE id = $1 AND status = 'open' RETURNING *`,
        [flagId, status, interaction.user.id, actorOf(interaction).name],
    );
    return rows[0] || null;
}

async function target(interaction, flag) {
    const member = await interaction.guild.members.fetch(flag.author_id).catch(() => null);
    return { id: flag.author_id, name: member?.displayName || flag.author_name, member };
}

function context(interaction, tgt, reason, rule) {
    return {
        client: interaction.client,
        guild: interaction.guild,
        target: { id: tgt.id, name: tgt.name },
        member: tgt.member,
        actor: actorOf(interaction),
        rule,
        reason,
    };
}

function flagRule(flag) {
    const code = flag.verdict?.rule || (flag.layer === 'slur' || flag.matched === 'discrimination' ? 'coc4' : 'coc1');
    return ruleByCode(code);
}

function defaultReason(flag) {
    const quote = posting.clip(flag.content, 200);
    return flag.layer === 'ai' || flag.model ? `AI flag confirmed by staff: ${quote}` : `Banned word confirmed by staff: ${quote}`;
}

function outcome(interaction, res) {
    const problems = res.problems?.length ? ` Not completed: ${res.problems.join(' ')}` : '';
    higgenLog.markSubRouterOutcome(interaction, { outcome: res.problems?.length ? 'partial' : 'success', note: `${res.summary}${problems}` });
    return `${res.summary}${problems}`.slice(0, 1900);
}

function punishmentPanel(flag) {
    const rule = flagRule(flag);
    return {
        content: 'Pick the rule, then the punishment.',
        components: [
            new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                .setCustomId(`md:fl:rule:${flag.id}`)
                .setPlaceholder(rule.label.slice(0, 100))
                .addOptions(ruleChoices().map((c) => ({ label: c.name, value: c.value, default: c.value === rule.code })))),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`md:fl:act:${flag.id}:warn`).setLabel('Warn').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`md:fl:act:${flag.id}:timeout`).setLabel('Timeout').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`md:fl:act:${flag.id}:strike`).setLabel('Strike').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`md:fl:act:${flag.id}:suspend`).setLabel('Suspend').setStyle(ButtonStyle.Danger),
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`md:fl:act:${flag.id}:kick`).setLabel('Kick').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`md:fl:act:${flag.id}:ban`).setLabel('Ban').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`md:fl:done:${flag.id}`).setLabel('No further action').setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

function actionModal(flag, action) {
    const modal = new ModalBuilder().setCustomId(`md:flm:act:${flag.id}:${action}`).setTitle(`${action[0].toUpperCase()}${action.slice(1)}`);
    if (action === 'timeout' || action === 'suspend') {
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('length').setStyle(TextInputStyle.Short).setRequired(true)
            .setLabel(action === 'timeout' ? 'How long (e.g. 1h, 2d, 1w)' : 'How long (e.g. 1 series, 2 weeks)')));
    }
    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(true)
        .setMaxLength(1000).setValue(defaultReason(flag).slice(0, 1000))));
    return modal;
}

const SUB = {
    // Slur alert: yes, it's bad.
    async bad(interaction, [id]) {
        if (!(await allowed(interaction, 'note'))) return undefined;
        const flag = await close(id, 'confirmed', interaction);
        if (!flag) return denied(interaction, 'Someone already reviewed this.');
        await interaction.update({ content: `Confirmed bad by ${actorOf(interaction).name}.`, components: [] });
        await interaction.followUp({ ...punishmentPanel(flag), flags: EPHEMERAL });
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `Confirmed flag ${id} as bad.` });
        return undefined;
    },

    // Slur or spam alert: false alarm.
    async ok(interaction, [id]) {
        if (!(await allowed(interaction, 'note'))) return undefined;
        await interaction.deferUpdate();
        const flag = await close(id, 'dismissed', interaction);
        if (!flag) return interaction.followUp({ content: 'Someone already reviewed this.', flags: EPHEMERAL });
        let text = 'Marked as a false alarm.';
        if (flag.case_id) {
            const res = await actions.voidCase({
                client: interaction.client, guild: interaction.guild, actor: actorOf(interaction),
                reason: 'Chat filter false alarm',
            }, flag.case_id);
            text = `${res.summary} The timeout was lifted.`;
        }
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `False alarm on flag ${id}. ${text}` });
        await interaction.editReply({ content: `False alarm, confirmed by ${actorOf(interaction).name}.`, components: [] });
        const components = flag.layer === 'slur' ? [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`md:fl:allow:${flag.id}`).setLabel('Add to allow-list').setStyle(ButtonStyle.Primary),
        )] : [];
        return interaction.followUp({ content: text, components, flags: EPHEMERAL });
    },

    async allow(interaction, [id]) {
        if (!(await allowed(interaction, 'filter'))) return undefined;
        const flag = await getFlag(id);
        return interaction.showModal(new ModalBuilder()
            .setCustomId(`md:flm:allow:${id}`)
            .setTitle('Add to allow-list')
            .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
                .setCustomId('phrase').setLabel('Word or phrase that should be allowed').setStyle(TextInputStyle.Short)
                .setRequired(true).setMaxLength(100).setValue(String(flag?.matched || '').slice(0, 100)))));
    },

    // AI alert: yes, timeoutable. Asks how long.
    async yes(interaction, [id]) {
        if (!(await allowed(interaction, 'timeout'))) return undefined;
        const row = new ActionRowBuilder().addComponents(TIMEOUT_CHOICES.slice(0, 5).map(([seconds, label]) => (
            new ButtonBuilder().setCustomId(`md:fl:t:${id}:${seconds}`).setLabel(label).setStyle(ButtonStyle.Danger)
        )));
        const more = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`md:fl:t:${id}:604800`).setLabel('1w').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`md:fl:tc:${id}`).setLabel('Custom').setStyle(ButtonStyle.Secondary),
        );
        return interaction.reply({ content: 'How long?', components: [row, more], flags: EPHEMERAL });
    },

    async no(interaction, [id]) {
        if (!(await allowed(interaction, 'note'))) return undefined;
        const flag = await close(id, 'dismissed', interaction);
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `Dismissed AI flag ${id}.` });
        return interaction.update({ content: flag ? `Dismissed by ${actorOf(interaction).name}.` : 'Someone already reviewed this.', components: [] });
    },

    // md:fl:t:<id>:<seconds>
    async t(interaction, [id, seconds]) {
        if (!(await allowed(interaction, 'timeout'))) return undefined;
        await interaction.deferUpdate();
        const flag = await close(id, 'actioned', interaction);
        if (!flag) return interaction.editReply({ content: 'Someone already reviewed this.', components: [] });
        const tgt = await target(interaction, flag);
        const problem = targetProblem(interaction.user.id, rankOf(interaction.member), tgt.id, rankOf(tgt.member));
        if (problem) return interaction.editReply({ content: problem, components: [] });
        const res = await actions.timeout(context(interaction, tgt, defaultReason(flag), flagRule(flag)), { seconds: parseInt(seconds, 10) });
        await pool.query('UPDATE mod_flags SET case_id = $2 WHERE id = $1', [flag.id, res.case.id]);
        await store(res.case.id, flag);
        if (flag.alert_message_id) await clearAlert(interaction, flag, `Timed out by ${actorOf(interaction).name}.`);
        return interaction.editReply({ content: outcome(interaction, res), components: [] });
    },

    async tc(interaction, [id]) {
        if (!(await allowed(interaction, 'timeout'))) return undefined;
        const flag = await getFlag(id);
        return interaction.showModal(actionModal(flag, 'timeout'));
    },

    // Panel: rule dropdown.
    async rule(interaction, [id]) {
        const code = interaction.values?.[0];
        await pool.query(
            `UPDATE mod_flags SET verdict = COALESCE(verdict, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
            [parseInt(id, 10), JSON.stringify({ rule: code })],
        );
        return interaction.deferUpdate();
    },

    async done(interaction) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: 'No further action on the flag.' });
        return interaction.update({ content: 'No further action.', components: [] });
    },

    // Panel: punishment button. Strike, kick and ban go through their normal confirm cards.
    async act(interaction, [id, action]) {
        const need = { warn: 'warn', timeout: 'timeout', strike: 'strike', suspend: 'suspend', kick: 'kick', ban: 'ban' }[action];
        if (!(await allowed(interaction, need))) return undefined;
        const flag = await getFlag(id);
        if (!flag) return denied(interaction, 'That flag no longer exists.');
        const tgt = await target(interaction, flag);
        const rank = rankOf(interaction.member);
        const problem = targetProblem(interaction.user.id, rank, tgt.id, rankOf(tgt.member));
        if (problem) return denied(interaction, problem);
        if (['strike', 'kick', 'ban'].includes(action)) {
            const mod = require('../modCommands');
            const ctx = context(interaction, tgt, defaultReason(flag), flagRule(flag));
            if (action === 'strike') return interaction.reply({ ...(await mod.strikeDraftCard(ctx, rank)), flags: EPHEMERAL });
            if (action === 'kick') return interaction.reply({ ...(await mod.kickDraftCard(ctx, rank)), flags: EPHEMERAL });
            const details = await mod.defaultBan();
            return interaction.reply({ ...(await mod.banDraftCard(ctx, rank, details)), flags: EPHEMERAL });
        }
        return interaction.showModal(actionModal(flag, action));
    },
};

async function store(caseId, flag) {
    const { addEvidenceText } = require('../modStore');
    await addEvidenceText({ caseId, text: flag.content, sourceMessageId: flag.message_id }).catch(() => {});
}

async function clearAlert(interaction, flag, text) {
    const message = await interaction.channel?.messages?.fetch(flag.alert_message_id).catch(() => null);
    if (message) await message.edit({ content: text, components: [] }).catch(() => {});
}

async function route(interaction, [sub, ...parts]) {
    const handler = Object.prototype.hasOwnProperty.call(SUB, sub) ? SUB[sub] : null;
    if (!handler) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'unhandled', note: `No filter control is registered for "${sub}".` });
        return undefined;
    }
    return handler(interaction, parts);
}

async function runAction(interaction, flag, action) {
    const tgt = await target(interaction, flag);
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const ctx = context(interaction, tgt, reason, flagRule(flag));
    if (action === 'warn') return actions.warn(ctx);
    const lengthText = interaction.fields.getTextInputValue('length');
    if (action === 'timeout') {
        const seconds = parseDuration(lengthText);
        if (!seconds) throw new actions.ModError('I could not read that length. Try `1h` or `2d`.');
        return actions.timeout(ctx, { seconds });
    }
    const length = parseSuspensionLength(lengthText);
    if (!length) throw new actions.ModError('I could not read that length. Try `1 series` or `2 weeks`.');
    return actions.suspend(ctx, length);
}

// md:flm:act:<id>:<action> and md:flm:allow:<id>
async function routeModal(interaction, [sub, id, action]) {
    if (sub === 'allow') {
        if (!(await allowed(interaction, 'filter'))) return undefined;
        const phrase = interaction.fields.getTextInputValue('phrase').trim().toLowerCase();
        await pool.query(
            `INSERT INTO mod_allowlist (phrase, added_by) VALUES ($1, $2) ON CONFLICT (phrase) DO NOTHING`,
            [phrase, actorOf(interaction).name],
        );
        await matcher.reload();
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `Added "${phrase}" to the chat filter allow-list.` });
        return interaction.reply({ content: `"${phrase}" is now allowed.`, flags: EPHEMERAL });
    }
    if (sub !== 'act') return undefined;
    const need = { warn: 'warn', timeout: 'timeout', suspend: 'suspend' }[action];
    if (!need || !(await allowed(interaction, need))) return undefined;
    await interaction.deferReply({ flags: EPHEMERAL });
    const flag = await getFlag(id);
    if (!flag) return interaction.editReply({ content: 'That flag no longer exists.' });
    const res = await runAction(interaction, flag, action);
    await store(res.case.id, flag);
    await pool.query(`UPDATE mod_flags SET status = 'actioned', case_id = COALESCE(case_id, $2) WHERE id = $1`, [flag.id, res.case.id]);
    if (flag.alert_message_id) await clearAlert(interaction, flag, `Actioned by ${actorOf(interaction).name}.`);
    return interaction.editReply({ content: outcome(interaction, res) });
}

module.exports = { route, routeModal };
