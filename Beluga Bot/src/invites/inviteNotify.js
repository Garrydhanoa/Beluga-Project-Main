/**
 * Every message the invite campaign sends.
 *
 * Mention rules (enforced with allowedMentions on every send, never by hoping):
 *  - "your invitee registered"  → pings the INVITER only.
 *  - campaign end-date reminder → pings Salary Crew (operator's call; the one exception).
 *  - everything else            → pings nobody. The invited member is NEVER pinged.
 * Mentions still render as names, so <@id> is used for readability.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { config } = require('../config/config');
const { ROLES } = require('../constants/roles');
const { appendFooter, siteUrl } = require('../utils/siteFooter');
const { db, getSettings, logEvent, getActiveCampaign } = require('./inviteSchema');
const { personStats } = require('./inviteCounts');

const NO_PINGS = { parse: [] };

const FLAG_TEXT = {
    new_account: 'account is younger than the minimum age',
    rejoiner: 'has been in the server before',
    self_invite: 'used their own invite',
    ambiguous: 'the bot could not tell which invite was used',
    inviter_left: 'the inviter is no longer in the server',
    disagreement: "Discord's join data and the bot's invite count disagree",
    unverified: "Discord's join data was unavailable, so this is the bot's best guess",
    sheet_only: 'appeared in the SalSheet without running /register (already registered before, or added by staff)',
};

function getGuild(client) {
    return client.guilds.cache.get(config.discord.guildId) || client.guilds.cache.first() || null;
}

async function fetchChannel(client, id) {
    if (!id) return null;
    try {
        const ch = client.channels.cache.get(id) || await client.channels.fetch(id);
        return ch?.isTextBased?.() ? ch : null;
    } catch {
        return null;
    }
}

async function sourceLabel(row) {
    const s = row.source_type;
    if (s === 'vanity') return 'the vanity invite';
    if (s === 'discovery') return 'Server Discovery';
    if (s === 'oauth') return 'a bot that added them';
    if (s === 'integration') return 'a server integration';
    if (s === 'hub') return 'a Student Hub';
    if (s === 'bot_invite') return 'an invite created by a bot';
    if (s === 'manual') return 'a staff entry';
    if (s === 'general') {
        let label = null;
        if (row.invite_code && db()) {
            const r = await pool.query('SELECT label FROM invite_codes WHERE code = $1', [row.invite_code]).catch(() => null);
            label = r?.rows?.[0]?.label || null;
        }
        return label ? `the general link "${label}"` : 'a general invite link';
    }
    if (s === 'invite') return 'a personal invite';
    return 'an unknown source';
}

function flagList(flags) {
    return (flags || []).map((f) => FLAG_TEXT[f] || f).join('; ');
}

const ts = (d, style = 'f') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;

/** Count line: campaign count, or lifetime when the credit landed after its campaign ended. */
async function countLine(inviterId, creditedCampaignId) {
    const stats = await personStats(inviterId);
    const active = stats.campaign;
    if (active && creditedCampaignId === active.id) {
        return `You're at **${stats.campaignTotal} invite${stats.campaignTotal === 1 ? '' : 's'}**${stats.campaignRank ? ` (#${stats.campaignRank})` : ''}.`;
    }
    return `You're at **${stats.lifetimeTotal} lifetime invite${stats.lifetimeTotal === 1 ? '' : 's'}**.`;
}

/**
 * "The person you invited has registered." Claimed atomically on notified_at so a
 * retry, a sweep and a website approval can never double-post.
 */
async function sendRegistered(client, inviteeId) {
    if (!db()) return false;
    const claim = await pool.query(
        `UPDATE invites SET notified_at = NOW(), updated_at = NOW()
          WHERE invitee_id = $1 AND status = 'counted' AND notified_at IS NULL AND inviter_id IS NOT NULL
          RETURNING *`,
        [String(inviteeId)]
    );
    const row = claim.rows[0];
    if (!row) return false;

    const settings = await getSettings();
    const guild = getGuild(client);
    const line = await countLine(row.inviter_id, row.credited_campaign_id);
    const text = `<@${row.inviter_id}> — <@${row.invitee_id}>, who you invited, has registered. ${line}`;

    const channel = await fetchChannel(client, settings.invite_channel_id);
    if (channel) {
        try {
            await channel.send({ content: appendFooter(text, guild), allowedMentions: { users: [row.inviter_id] } });
        } catch (err) {
            Logger.error('invite: registered message failed', err);
            higgenLog.logFailure({ summary: `The bot could not post the "your invitee registered" message for <@${row.invitee_id}>.`, error: err, action: 'invites.notify', where: 'Invite channel' });
        }
    }

    if (String(settings.dm_inviter) !== 'false') {
        try {
            const user = await client.users.fetch(row.inviter_id);
            const name = guild?.members.cache.get(row.invitee_id)?.displayName || 'A player you invited';
            const dmText = `**${name}**, who you invited to Beluga League, has registered. ${line}`;
            const sent = await user.send({ content: appendFooter(dmText, guild) });
            try {
                const { recordOutgoing } = require('../dm/dmInbox');
                await recordOutgoing({ discordId: row.inviter_id, content: dmText, authorName: 'Beluga Bot', source: 'invites', discordMessageId: sent?.id ? String(sent.id) : null });
            } catch { /* DM Center mirror is best effort */ }
        } catch (err) {
            // Closed DMs are normal — note it, don't alarm.
            Logger.info(`invite: could not DM inviter ${row.inviter_id} (${err.code || err.message})`);
        }
    }

    await logEvent({ inviteeId: row.invitee_id, inviterId: row.inviter_id, kind: 'notified', summary: 'Announced in the invite channel: their invitee registered.' });
    return true;
}

async function sendClaimable(client, inviteeId) {
    if (!db()) return false;
    const claim = await pool.query(
        `UPDATE invites SET claim_posted_at = NOW(), updated_at = NOW()
          WHERE invitee_id = $1 AND status = 'claimable' AND claim_posted_at IS NULL RETURNING *`,
        [String(inviteeId)]
    );
    const row = claim.rows[0];
    if (!row) return false;
    const settings = await getSettings();
    const channel = await fetchChannel(client, settings.invite_channel_id);
    if (!channel) return false;
    const source = await sourceLabel(row);
    const text = `<@${row.invitee_id}> has registered and is claimable — they joined through ${source}. ` +
        `If you invited them, run \`/claim-invite\` before ${ts(row.claimable_until)}.`;
    try {
        await channel.send({ content: appendFooter(text, getGuild(client)), allowedMentions: NO_PINGS });
    } catch (err) {
        Logger.error('invite: claimable message failed', err);
    }
    return true;
}

async function sendLeft(client, row) {
    if (!row?.inviter_id) return;
    const settings = await getSettings();
    const channel = await fetchChannel(client, settings.invite_channel_id);
    if (!channel) return;
    const stats = await personStats(row.inviter_id);
    const active = stats.campaign && row.credited_campaign_id === stats.campaign.id;
    const n = active ? stats.campaignTotal : stats.lifetimeTotal;
    const text = `<@${row.invitee_id}> left the server, so <@${row.inviter_id}> is now at **${n}${active ? '' : ' lifetime'} invite${n === 1 ? '' : 's'}**.`;
    try {
        await channel.send({ content: text, allowedMentions: NO_PINGS });
    } catch (err) {
        Logger.error('invite: left message failed', err);
    }
}

/** Staff heads-up, no ping (operator's call). Claimed on review_posted_at. */
async function sendReviewNotice(client, inviteeId) {
    if (!db()) return false;
    const claim = await pool.query(
        `UPDATE invites SET review_posted_at = NOW(), updated_at = NOW()
          WHERE invitee_id = $1 AND status = 'pending_review' AND review_posted_at IS NULL RETURNING *`,
        [String(inviteeId)]
    );
    const row = claim.rows[0];
    if (!row) return false;
    const settings = await getSettings();
    const channel = await fetchChannel(client, settings.staff_channel_id);
    if (!channel) return false;
    const by = row.inviter_id ? `invited by <@${row.inviter_id}>` : 'no inviter recorded';
    const source = await sourceLabel(row);
    const text = `**Invite needs review:** <@${row.invitee_id}> registered — ${by}, through ${source}${row.invite_code ? ` (\`${row.invite_code}\`)` : ''}.\n` +
        `Why: ${flagList(row.flags)}.\n` +
        `Review it on the admin Invites tab: <${siteUrl('/admin/dashboard/invites')}>`;
    try {
        await channel.send({ content: text, allowedMentions: NO_PINGS });
    } catch (err) {
        Logger.error('invite: review notice failed', err);
    }
    return true;
}

async function sendClaimNotice(client, claimerId, inviteeId) {
    const settings = await getSettings();
    const channel = await fetchChannel(client, settings.staff_channel_id);
    if (!channel) return;
    const text = `**Invite claim:** <@${claimerId}> says they invited <@${inviteeId}>. ` +
        `Approve or reject it on the admin Invites tab: <${siteUrl('/admin/dashboard/invites')}>`;
    try { await channel.send({ content: text, allowedMentions: NO_PINGS }); } catch (err) { Logger.error('invite: claim notice failed', err); }
}

async function sendClaimRejected(client, claimerId, inviteeId, reason) {
    const settings = await getSettings();
    const channel = await fetchChannel(client, settings.invite_channel_id);
    if (!channel) return;
    const text = `<@${claimerId}>'s claim on <@${inviteeId}> was not approved${reason ? ` — ${reason}` : ''}.`;
    try { await channel.send({ content: text, allowedMentions: NO_PINGS }); } catch (err) { Logger.error('invite: claim rejected note failed', err); }
}

async function sendCampaignEndPing(client, campaign) {
    const settings = await getSettings();
    const channel = await fetchChannel(client, settings.staff_channel_id);
    if (!channel) return false;
    const text = `<@&${ROLES.SALARY_CREW}> The invite campaign **${campaign.name}** reached its end date (${ts(campaign.ends_at)}). ` +
        `End and archive it with \`/invite-reset\` or on the admin Invites tab: <${siteUrl('/admin/dashboard/invites')}>. Invites keep counting until then.`;
    try {
        await channel.send({ content: text, allowedMentions: { roles: [ROLES.SALARY_CREW] } });
        return true;
    } catch (err) {
        Logger.error('invite: campaign end ping failed', err);
        return false;
    }
}

async function sendCampaignFinal(client, campaign) {
    const settings = await getSettings();
    const channel = await fetchChannel(client, settings.invite_channel_id);
    if (!channel) return;
    const top = Array.isArray(campaign.final_top) ? campaign.final_top.slice(0, 3) : [];
    const lines = top.map((t, i) => `${['🥇', '🥈', '🥉'][i]} <@${t.id}> — **${t.total}**`);
    const prize = campaign.prize ? `\nPrize: ${campaign.prize}` : '';
    const text = `**${campaign.name}** has ended.${prize}\n${lines.length ? lines.join('\n') : 'No invites were counted this campaign.'}\n` +
        `Full results: <${siteUrl('/invites')}>`;
    try {
        await channel.send({ content: appendFooter(text, getGuild(client)), allowedMentions: NO_PINGS });
    } catch (err) {
        Logger.error('invite: campaign final post failed', err);
    }
}

module.exports = {
    FLAG_TEXT,
    getGuild,
    fetchChannel,
    sourceLabel,
    flagList,
    sendRegistered,
    sendClaimable,
    sendLeft,
    sendReviewNotice,
    sendClaimNotice,
    sendClaimRejected,
    sendCampaignEndPing,
    sendCampaignFinal,
    getActiveCampaign,
};
