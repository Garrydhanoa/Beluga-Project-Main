/**
 * Bans (rulebook 6.1.4). Two types:
 *   temp        auto-unbans on the date; the DM carries a permanent invite
 *   appealable  stays until appealed; the DM carries the date and the form link
 *
 * Order matters. The DM goes before the ban because a banned person shares no server
 * with the bot and can't be reached afterwards, and the team is snapshotted first
 * because the ban takes their roles with it. Everything a banned person needs is also
 * on the website, so a closed-DM failure doesn't leave them with nothing.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const { siteUrl, siteLabel } = require('../utils/siteFooter');
const { CHANNELS } = require('./modConfig');
const store = require('./modStore');
const posting = require('./modPosting');
const { resolveTeam, releasePlayer } = require('./release');

const INVITE_KEY = 'return_invite_code';

/**
 * The single permanent invite banned members come back through. It's tagged
 * `is_moderation` so the invite campaign never credits or offers a claim on it.
 */
async function getReturnInvite(guild) {
    const saved = await pool.query('SELECT value FROM mod_settings WHERE key = $1', [INVITE_KEY]);
    const code = saved.rows[0]?.value;
    if (code) {
        const existing = await guild.invites.fetch({ code, cache: false }).catch(() => null);
        if (existing) return `https://discord.gg/${code}`;
    }
    const channel = await guild.channels.fetch(CHANNELS.WELCOME);
    const invite = await channel.createInvite({
        maxAge: 0, maxUses: 0, unique: true, reason: 'Return invite for banned members',
    });
    await pool.query(
        `INSERT INTO mod_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [INVITE_KEY, invite.code],
    );
    await pool.query(
        `INSERT INTO invite_codes (code, inviter_id, inviter_is_bot, channel_id, is_moderation, label)
         VALUES ($1, $2, TRUE, $3, TRUE, 'Moderation return invite')
         ON CONFLICT (code) DO UPDATE SET is_moderation = TRUE`,
        [invite.code, guild.client.user.id, channel.id],
    ).catch((err) => Logger.warning(`return invite could not be tagged: ${err.message}`));
    return invite.url;
}

function banDm(ctx, c, opts, inviteUrl) {
    const rule = ctx.rule ? `\nRule: ${ctx.rule.label}` : '';
    const strike = c.kind === 'strike' ? `This is Strike ${c.strike_number}/${store.STRIKE_LIMIT}.\n\n` : '';
    if (opts.type === 'temp') {
        return `You have been banned from Beluga League until ${posting.stamp(opts.unbanAt)}.\n\n${strike}Reason: ${ctx.reason}${rule}`
            + `\n\nYou can rejoin after that date:\n${inviteUrl}\n\n${siteLabel()}`;
    }
    return `You have been banned from Beluga League.\n\n${strike}Reason: ${ctx.reason}${rule}`
        + `\n\nYou can appeal from ${posting.stamp(opts.appealAfter, 'D')}. Bans can only be appealed once:\n${siteUrl('/applications/appeal')}`;
}

async function banForCase(ctx, c, opts, problems) {
    const { once } = require('./actions');
    const team = await once(c, 'team_snapshot', [], async () => ({ value: await resolveTeam(ctx.target.id).catch(() => null) }));

    await once(c, 'identity_snapshot', [], async () => {
        const { rememberIdentities } = require('./banEvasion');
        return { value: await rememberIdentities(ctx.target.id) };
    });

    await once(c, 'ban_row', problems, async () => {
        await pool.query(
            `INSERT INTO mod_bans (case_id, discord_id, ban_type, unban_at, appeal_after, team_snapshot)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (case_id) DO NOTHING`,
            [c.id, ctx.target.id, opts.type, opts.unbanAt || null, opts.appealAfter || null, JSON.stringify(team || null)],
        );
        return { value: true };
    });

    let inviteUrl = null;
    if (opts.type === 'temp') {
        inviteUrl = await once(c, 'invite', problems, async () => {
            const url = await getReturnInvite(ctx.guild);
            await pool.query('UPDATE mod_bans SET invite_url = $2 WHERE case_id = $1', [c.id, url]);
            return { value: url };
        });
    }

    if (!ctx.silent) {
        await once(c, 'dm', problems, async () => {
            const res = await posting.dmMember(ctx.client, ctx.target.id, banDm(ctx, c, opts, inviteUrl));
            await pool.query('UPDATE mod_bans SET dm_status = $2, dm_error = $3 WHERE case_id = $1', [c.id, res.ok ? 'sent' : 'failed', res.ok ? null : res.error]);
            return res.ok ? { value: true } : { problem: `The DM was not delivered: ${res.error}` };
        });
    }

    await once(c, 'ban', problems, async () => {
        try {
            await ctx.guild.members.ban(ctx.target.id, {
                reason: `Case ${c.id}: ${ctx.reason}`.slice(0, 512),
                deleteMessageSeconds: opts.deleteSeconds || 0,
            });
            return { value: true };
        } catch (err) {
            await pool.query(`UPDATE mod_bans SET status = 'failed' WHERE case_id = $1`, [c.id]);
            return { problem: `Discord refused the ban: ${err.message}` };
        }
    });

    if (c.kind === 'ban') {
        await once(c, 'post', problems, async () => {
            const msg = await posting.postBan(ctx.client, c);
            if (msg) await store.setMessageId(c.id, 'strikes', msg.id);
            return msg ? { value: msg.id } : { problem: 'The ban was not posted in #strike-channel.' };
        });
    }

    await once(c, 'release', problems, async () => {
        if (!team) return { value: 'unsigned' };
        const res = await releasePlayer({
            client: ctx.client, guild: ctx.guild, discordId: ctx.target.id, playerName: ctx.target.name,
            actor: ctx.actor, reason: `Banned: ${ctx.reason}`, team,
        });
        if (res.skipped) return { problem: `Not released from ${team.teamName}: ${res.skipped}` };
        return { value: team.teamName, problem: res.problems.join(' ') || null };
    });

    await once(c, 'banned_list', problems, async () => {
        const { postToBannedList } = require('./banEvasion');
        const posted = await postToBannedList(ctx.client, ctx.target);
        return posted ? { value: true } : { problem: 'The entry was not posted in #beluga-banned.' };
    });
}

/** @returns {string|null} what went wrong */
async function liftBan(guild, discordId, reason, { status = 'lifted', caseId = null } = {}) {
    let problem = null;
    try {
        await guild.bans.remove(String(discordId), String(reason).slice(0, 512));
    } catch (err) {
        // 10026: they aren't banned any more, which is the outcome we wanted.
        if (err?.code !== 10026) problem = `Discord refused the unban: ${err.message}`;
    }
    if (!problem) {
        await pool.query(
            `UPDATE mod_bans SET status = $2, unbanned_at = NOW(), unban_reason = $3
              WHERE discord_id = $1 AND status = 'active' AND ($4::int IS NULL OR case_id = $4)`,
            [String(discordId), status, String(reason).slice(0, 500), caseId],
        );
    }
    return problem;
}

/** Temp bans due to end. Called from the ticker, so a restart can't skip one. */
async function tickBans(client, guild) {
    const { rows } = await pool.query(
        `SELECT b.*, c.target_name FROM mod_bans b JOIN mod_cases c ON c.id = b.case_id
          WHERE b.status = 'active' AND b.ban_type = 'temp' AND b.unban_at <= NOW()`,
    );
    for (const ban of rows) {
        try {
            const problem = await liftBan(guild, ban.discord_id, `Temp ban ended (case ${ban.case_id})`, { status: 'expired', caseId: ban.case_id });
            await store.logEvent({
                discordId: ban.discord_id, caseId: ban.case_id, kind: 'ban_end',
                summary: problem ? `The temp ban on case ${ban.case_id} could not be lifted: ${problem}` : `The temp ban on case ${ban.case_id} ended.`,
            });
            await posting.sendTo(client, CHANNELS.TIMEOUT_LOG, {
                content: problem
                    ? `Case ${ban.case_id}: the temp ban on <@${ban.discord_id}> is due to end, but ${problem}`
                    : `Case ${ban.case_id}: the temp ban on <@${ban.discord_id}> has ended and they can rejoin.`,
                allowedMentions: { parse: [] },
            }, 'a temp ban ending');
            require('./actions').logJob('moderation.ban-expired', `the temp ban on ${ban.target_name || ban.discord_id} ended`, {
                target: ban.discord_id, details: [['Case', String(ban.case_id)], ['Result', problem || 'Unbanned']],
            });
        } catch (err) {
            Logger.error(`temp ban ${ban.case_id} could not be processed`, err);
        }
    }
}

module.exports = { getReturnInvite, banForCase, liftBan, tickBans };
