/**
 * Central dispatch for every `inv:` interaction (leaderboard buttons + select,
 * /invite-reset confirm). Routed from the single interactionCreate choke point in
 * bot.js — never a collector — so every click lands in higgenlogs. Errors are
 * swallowed here, so outcomes are reported back via markSubRouterOutcome.
 */

const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { ROLES } = require('../constants/roles');
const { buildLeaderboard, buildPersonCard } = require('./inviteViews');

const EPHEMERAL = 64;

function isInviteId(customId) {
    return typeof customId === 'string' && customId.startsWith('inv:');
}

async function denyNotOwner(interaction, what) {
    higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: `They tried to use someone else's ${what}.` });
    await interaction.reply({ content: `These controls belong to whoever ran the command. Run \`${what === 'reset confirmation' ? '/invite-reset' : '/invite-leaderboard'}\` yourself.`, flags: EPHEMERAL });
}

const HANDLERS = {
    // inv:lb:<owner>:<view>:<page>
    async lb(interaction, [ownerId, view, page]) {
        if (interaction.user.id !== ownerId) return denyNotOwner(interaction, 'leaderboard');
        await interaction.deferUpdate();
        await interaction.editReply(await buildLeaderboard(interaction.guild, ownerId, view, parseInt(page, 10) || 0));
    },
    // inv:lbp:<owner>:<view>:<page> — value is the person to show
    async lbp(interaction, [ownerId]) {
        if (interaction.user.id !== ownerId) return denyNotOwner(interaction, 'leaderboard');
        const target = interaction.values?.[0];
        if (!target) return interaction.reply({ content: 'Pick a person from the list.', flags: EPHEMERAL });
        await interaction.reply({ ...(await buildPersonCard(interaction.guild, target)), flags: EPHEMERAL });
    },
    // inv:reset:<owner>:<campaignId>
    async reset(interaction, [ownerId, campaignId]) {
        if (interaction.user.id !== ownerId) return denyNotOwner(interaction, 'reset confirmation');
        if (!interaction.member?.roles?.cache?.has(ROLES.SALARY_CREW)) {
            higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: 'They are not Salary Crew.' });
            return interaction.reply({ content: 'Only Salary Crew can reset the invite campaign.', flags: EPHEMERAL });
        }
        await interaction.deferUpdate();
        const { archiveAndReset } = require('./inviteCampaign');
        const res = await archiveAndReset({
            actorId: interaction.user.id,
            actorName: interaction.member?.displayName || interaction.user.username,
            expectCampaignId: parseInt(campaignId, 10) || null,
        });
        if (!res.ok) {
            higgenLog.markSubRouterOutcome(interaction, { outcome: 'failed', note: res.reason });
            return interaction.editReply({ content: res.reason, components: [] });
        }
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'success', note: `Ended ${res.ended.name} and started ${res.next.name}.` });
        const { sendCampaignFinal } = require('./inviteNotify');
        await sendCampaignFinal(interaction.client, res.ended);
        const { refreshBoard } = require('./liveBoard');
        refreshBoard(interaction.client).catch(() => {});
        await interaction.editReply({
            content: `**${res.ended.name}** is archived and campaign counts are back to 0. **${res.next.name}** has started — rename it or set a prize and end date on the admin Invites tab. Lifetime counts are unchanged.`,
            components: [],
        });
    },
    async resetx(interaction, [ownerId]) {
        if (interaction.user.id !== ownerId) return denyNotOwner(interaction, 'reset confirmation');
        await interaction.update({ content: 'Reset cancelled. Nothing was changed.', components: [] });
    },
};

async function route(interaction) {
    const [, action, ...parts] = interaction.customId.split(':');
    const handler = HANDLERS[action];
    if (!handler) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'unhandled', note: `No handler is registered for the invite action "${action}".` });
        return;
    }
    try {
        await handler(interaction, parts);
    } catch (err) {
        if (err?.code === 10062 || err?.code === 40060) {
            higgenLog.markSubRouterOutcome(interaction, { outcome: 'expired', note: 'The control was used after its interaction had timed out.' });
            return;
        }
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'failed', note: `The invite control "${action}" threw an error.`, error: err });
        Logger.error(`invite router error on '${action}'`, err);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Something went wrong. Try again in a moment.', flags: EPHEMERAL });
            }
        } catch { /* ignore secondary failures */ }
    }
}

module.exports = { isInviteId, route };
