/**
 * GM / AGM rulebook certification — the bot half.
 *
 *   1. A passed test (cert_requests row, no notice yet) → a NO-PING notice in the
 *      staff channel (site_config.certification.noticeChannelId) with ✅ / ❌
 *      seeded. Salary Crew reactions are tallied onto the row — ADVISORY only.
 *   2. A super admin approves / denies in higgenlogs → Tests (status 'approving' /
 *      'denying'). The bot claims the row, grants the franchise GM/AGM role + the
 *      generic GM/AGM role, DMs the applicant, edits the notice (no ping), and
 *      records the result. Any failure → 'approve_failed' / 'deny_failed' so the
 *      tab offers a retry.
 *   3. A retake request → a no-ping notice; edited once it's granted / dismissed.
 *
 * Woken by NOTIFY cert_actions (website) with a 15s poll fallback; claims use
 * FOR UPDATE SKIP LOCKED so a restart mid-run can't double-grant.
 * Reactions arrive through messageReactionAdd/Remove (the same precedent as
 * seasonApprovals) — nothing here touches interactionCreate.
 */

const { EmbedBuilder } = require('discord.js');
const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { ROLES } = require('../constants/roles');
const { config } = require('../config/config');
const { db, ensureCertSchema, getCertSettings, recordCertEvent } = require('./certSchema');

const NO_PING = { parse: [] };
const ROLE_WORD = { gm: 'GM', agm: 'Assistant GM' };
const CREW_TARGET = 5; // shown as guidance; the decision is the super admin's

let running = false;
let listenClient = null;

// ── helpers ──────────────────────────────────────────────────────────────────

async function resolveGuild(client, channel = null) {
    if (channel?.guild) return channel.guild;
    const id = config.discord?.guildId || process.env.GUILD_ID;
    if (id) {
        const g = client.guilds.cache.get(id) || await client.guilds.fetch(id).catch(() => null);
        if (g) return g;
    }
    return client.guilds.cache.first() || null;
}

async function fetchNotice(client, channelId, messageId) {
    if (!channelId || !messageId) return null;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return null;
    return channel.messages.fetch(messageId).catch(() => null);
}

const voters = (list) => (Array.isArray(list) && list.length ? list.map((v) => v.name || v.id).join(', ') : '—');

function statusLine(req) {
    switch (req.status) {
        case 'approved': return `Approved by ${req.decided_by_name || 'staff'}.`;
        case 'denied': return `Denied by ${req.decided_by_name || 'staff'}.`;
        case 'approving': case 'approve_running': return 'Being approved…';
        case 'denying': case 'deny_running': return 'Being denied…';
        case 'approve_failed': return 'Approval failed — retry from the admin panel.';
        case 'deny_failed': return 'Denial failed — retry from the admin panel.';
        default: return 'Waiting for the final decision in the admin panel.';
    }
}

function requestEmbed(req, attempt) {
    const role = ROLE_WORD[req.test] || 'GM';
    const color = req.status === 'approved' ? 0x2ECC71 : req.status === 'denied' ? 0xE74C3C : /failed/.test(req.status) ? 0xE67E22 : 0x3498DB;
    const appr = Array.isArray(req.crew_approvals) ? req.crew_approvals : [];
    const deny = Array.isArray(req.crew_denials) ? req.crew_denials : [];
    const fields = [
        { name: 'Score', value: attempt ? `${attempt.score}/${attempt.total} (${Number(attempt.pct)}%)` : '—', inline: true },
        { name: 'Signed', value: String(attempt?.signature || '—').slice(0, 100), inline: true },
        { name: 'Salary Crew', value: `✅ ${appr.length}/${CREW_TARGET} · ❌ ${deny.length}`, inline: true },
    ];
    if (appr.length) fields.push({ name: 'Approved by', value: voters(appr).slice(0, 1024), inline: false });
    if (deny.length) fields.push({ name: 'Denied by', value: voters(deny).slice(0, 1024), inline: false });
    fields.push({ name: 'Status', value: statusLine(req).slice(0, 1024), inline: false });
    return new EmbedBuilder()
        .setTitle(`${role} rulebook test passed`)
        .setColor(color)
        .setDescription(`<@${req.discord_id}> (\`${req.username || req.discord_id}\`) requested **${role} of ${req.franchise_name || 'a franchise'}** and passed the rulebook test.`)
        .addFields(fields)
        .setFooter({ text: 'Salary Crew: react ✅ / ❌ to vote. The final decision is made in the admin panel.' })
        .setTimestamp(new Date(req.created_at || Date.now()));
}

function retakeEmbed(rt, lastAttempt) {
    const role = ROLE_WORD[rt.test] || 'GM';
    const status = rt.status === 'granted'
        ? `Granted by ${rt.resolved_by_name || 'staff'}.`
        : rt.status === 'dismissed' ? `Dismissed by ${rt.resolved_by_name || 'staff'}.` : 'Grant or dismiss it in the admin panel.';
    const embed = new EmbedBuilder()
        .setTitle(`${role} rulebook test — another attempt requested`)
        .setColor(rt.status === 'granted' ? 0x2ECC71 : rt.status === 'dismissed' ? 0x95A5A6 : 0xF1C40F)
        .setDescription(`<@${rt.discord_id}> (\`${rt.username || rt.discord_id}\`) asked for another attempt at the ${role} rulebook test.`)
        .addFields(
            { name: 'Last score', value: lastAttempt ? `${lastAttempt.score}/${lastAttempt.total} (${Number(lastAttempt.pct)}%)` : '—', inline: true },
            { name: 'Status', value: status, inline: true },
        )
        .setTimestamp(new Date(rt.created_at || Date.now()));
    if (rt.note) embed.addFields({ name: 'Their note', value: String(rt.note).slice(0, 1024), inline: false });
    return embed;
}

async function loadAttempt(id) {
    if (!id) return null;
    const r = await pool.query('SELECT id, score, total, pct, signature FROM cert_attempts WHERE id = $1', [id]).catch(() => ({ rows: [] }));
    return r.rows[0] || null;
}

async function refreshRequestNotice(client, req) {
    const msg = await fetchNotice(client, req.notice_channel_id, req.notice_message_id);
    if (!msg) return;
    await msg.edit({ embeds: [requestEmbed(req, await loadAttempt(req.attempt_id))], allowedMentions: NO_PING }).catch(() => {});
}

// ── 1. notices ───────────────────────────────────────────────────────────────

async function postRequestNotices(client, settings) {
    const rows = await pool.query(
        `SELECT * FROM cert_requests WHERE notice_message_id IS NULL AND notice_failed = FALSE ORDER BY id LIMIT 5`
    );
    for (const req of rows.rows) {
        try {
            const channel = await client.channels.fetch(settings.noticeChannelId).catch(() => null);
            if (!channel?.isTextBased?.()) throw new Error(`notice channel ${settings.noticeChannelId} unavailable`);
            const msg = await channel.send({ embeds: [requestEmbed(req, await loadAttempt(req.attempt_id))], allowedMentions: NO_PING });
            await msg.react('✅').catch(() => {});
            await msg.react('❌').catch(() => {});
            await pool.query(
                `UPDATE cert_requests SET notice_channel_id = $2, notice_message_id = $3, updated_at = NOW() WHERE id = $1`,
                [req.id, channel.id, msg.id]
            );
        } catch (err) {
            await pool.query(`UPDATE cert_requests SET notice_failed = TRUE, updated_at = NOW() WHERE id = $1`, [req.id]).catch(() => {});
            Logger.error(`cert notice failed for request ${req.id}`, err);
            higgenLog.logFailure({
                summary: `The staff notice for ${req.username || req.discord_id}'s passed ${ROLE_WORD[req.test]} rulebook test (${req.franchise_name}) could not be posted: ${err.message}`,
                error: err, action: 'certs.notice', where: 'Rulebook test notices',
            });
        }
    }
}

async function postRetakeNotices(client, settings) {
    const fresh = await pool.query(
        `SELECT * FROM cert_retake_requests WHERE notice_message_id IS NULL AND notice_failed = FALSE ORDER BY id LIMIT 5`
    );
    for (const rt of fresh.rows) {
        try {
            const channel = await client.channels.fetch(settings.noticeChannelId).catch(() => null);
            if (!channel?.isTextBased?.()) throw new Error(`notice channel ${settings.noticeChannelId} unavailable`);
            const msg = await channel.send({ embeds: [retakeEmbed(rt, await loadAttempt(rt.attempt_id))], allowedMentions: NO_PING });
            await pool.query(
                `UPDATE cert_retake_requests SET notice_channel_id = $2, notice_message_id = $3, notice_synced = TRUE WHERE id = $1`,
                [rt.id, channel.id, msg.id]
            );
        } catch (err) {
            await pool.query(`UPDATE cert_retake_requests SET notice_failed = TRUE WHERE id = $1`, [rt.id]).catch(() => {});
            Logger.error(`cert retake notice failed for ${rt.id}`, err);
            higgenLog.logFailure({
                summary: `The staff notice for ${rt.username || rt.discord_id}'s request for another ${ROLE_WORD[rt.test]} test attempt could not be posted: ${err.message}`,
                error: err, action: 'certs.retake-notice', where: 'Rulebook test notices',
            });
        }
    }
    // Granted / dismissed on the website → refresh the notice once.
    const stale = await pool.query(
        `SELECT * FROM cert_retake_requests WHERE notice_synced = FALSE AND notice_message_id IS NOT NULL ORDER BY id LIMIT 10`
    );
    for (const rt of stale.rows) {
        const msg = await fetchNotice(client, rt.notice_channel_id, rt.notice_message_id);
        if (msg) await msg.edit({ embeds: [retakeEmbed(rt, await loadAttempt(rt.attempt_id))], allowedMentions: NO_PING }).catch(() => {});
        await pool.query(`UPDATE cert_retake_requests SET notice_synced = TRUE WHERE id = $1`, [rt.id]).catch(() => {});
    }
}

// ── 2. decisions ─────────────────────────────────────────────────────────────

async function claim(from, to) {
    const r = await pool.query(
        `UPDATE cert_requests SET status = $2, updated_at = NOW()
         WHERE id = (SELECT id FROM cert_requests WHERE status = $1 ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING *`,
        [from, to]
    );
    return r.rows[0] || null;
}

async function dm(client, discordId, text) {
    try {
        const user = await client.users.fetch(discordId);
        await user.send({ content: text, allowedMentions: NO_PING });
        return true;
    } catch {
        return false;
    }
}

async function approve(client, req, settings) {
    const role = ROLE_WORD[req.test] || 'GM';
    const f = await pool.query(
        `SELECT name, gm_role_id, (to_jsonb(team_franchises) ->> 'agm_role_id') AS agm_role_id FROM team_franchises WHERE id = $1`,
        [req.franchise_id]
    ).catch(() => ({ rows: [] }));
    const franchise = f.rows[0] || null;
    const franchiseRoleId = req.test === 'agm' ? franchise?.agm_role_id : franchise?.gm_role_id;
    if (!franchiseRoleId) {
        throw new Error(`${req.franchise_name || 'This franchise'} has no ${role} role ID set (Teams & Franchises → Discord). Set it, then retry.`);
    }
    const genericRoleId = req.test === 'agm' ? settings.agmRoleId : settings.gmRoleId;
    const roleIds = [...new Set([franchiseRoleId, genericRoleId].filter(Boolean))];

    const channel = req.notice_channel_id ? await client.channels.fetch(req.notice_channel_id).catch(() => null) : null;
    const guild = await resolveGuild(client, channel);
    if (!guild) throw new Error('The bot could not find the league server.');
    const member = await guild.members.fetch(req.discord_id).catch(() => null);
    if (!member) throw new Error(`${req.username || req.discord_id} is no longer in the server, so no roles were given.`);

    const granted = [];
    const problems = [];
    for (const id of roleIds) {
        const r = guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null);
        if (!r) { problems.push(`role ${id} does not exist`); continue; }
        if (member.roles.cache.has(id)) { granted.push({ id, name: r.name, already: true }); continue; }
        try {
            await member.roles.add(id, `Passed the ${role} rulebook test — approved by ${req.decided_by_name || 'a super admin'}`);
            granted.push({ id, name: r.name });
        } catch (err) {
            problems.push(`${r.name}: ${err.code ? `${err.code} ` : ''}${err.message}`);
        }
    }

    await pool.query(`UPDATE cert_requests SET roles_granted = $2::jsonb, updated_at = NOW() WHERE id = $1`, [req.id, JSON.stringify(granted)]);
    if (problems.length) {
        const e = new Error(`Some roles could not be given — ${problems.join('; ')}. Granted so far: ${granted.map((g) => g.name).join(', ') || 'none'}.`);
        e.granted = granted;
        throw e;
    }

    const names = granted.map((g) => g.name).join(', ');
    const dmOk = await dm(client, req.discord_id,
        `**Beluga League** — your request to be **${role} of ${req.franchise_name}** was approved. You now have: ${names}.`
        + (req.decision_note ? `\nNote from staff: ${req.decision_note}` : ''));
    return { granted, dmOk, member };
}

async function processDecisions(client, settings) {
    for (;;) {
        const req = await claim('approving', 'approve_running');
        if (!req) break;
        const role = ROLE_WORD[req.test] || 'GM';
        try {
            const { granted, dmOk, member } = await approve(client, req, settings);
            const result = `Gave ${granted.map((g) => (g.already ? `${g.name} (already had it)` : g.name)).join(', ')}.${dmOk ? ' DM sent.' : ' Their DMs are closed, so no DM was sent.'}`;
            const upd = await pool.query(`UPDATE cert_requests SET status = 'approved', result = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [req.id, result]);
            await refreshRequestNotice(client, upd.rows[0]);
            await recordCertEvent({
                seasonId: req.season_id, attemptId: req.attempt_id, discordId: req.discord_id, username: req.username, test: req.test,
                event: 'approved', details: [['Roles given', granted.map((g) => g.name).join(', ')], ['Approved by', req.decided_by_name || '—'], ['DM', dmOk ? 'sent' : 'DMs closed']],
            });
            higgenLog.logInteraction({
                eventType: 'job', action: 'certs.approved',
                actor: { name: req.decided_by_name || 'super admin', id: req.decided_by || null },
                what: `approved ${member.displayName || req.username} as ${role} of ${req.franchise_name}, and the bot gave them ${granted.map((g) => g.name).join(' + ')}`,
                target: req.discord_id,
                details: [['Applicant', member.displayName || req.username || req.discord_id], ['Franchise', req.franchise_name || '—'], ['Roles', granted.map((g) => g.name).join(', ')], ['DM', dmOk ? 'Sent' : 'DMs closed']],
            });
        } catch (err) {
            await pool.query(`UPDATE cert_requests SET status = 'approve_failed', result = $2, updated_at = NOW() WHERE id = $1`, [req.id, String(err.message || err).slice(0, 500)]).catch(() => {});
            const fresh = await pool.query('SELECT * FROM cert_requests WHERE id = $1', [req.id]).catch(() => ({ rows: [] }));
            if (fresh.rows[0]) await refreshRequestNotice(client, fresh.rows[0]);
            await recordCertEvent({
                seasonId: req.season_id, attemptId: req.attempt_id, discordId: req.discord_id, username: req.username, test: req.test,
                event: 'role_failed', details: [['Problem', String(err.message || err).slice(0, 400)]],
            });
            higgenLog.logFailure({
                summary: `Approving ${req.username || req.discord_id} as ${role} of ${req.franchise_name} FAILED: ${err.message}`,
                error: err, action: 'certs.approve', where: 'Rulebook test approvals',
            });
        }
    }

    for (;;) {
        const req = await claim('denying', 'deny_running');
        if (!req) break;
        const role = ROLE_WORD[req.test] || 'GM';
        try {
            const dmOk = await dm(client, req.discord_id,
                `**Beluga League** — your request to be **${role} of ${req.franchise_name}** was not approved.`
                + (req.decision_note ? `\nNote from staff: ${req.decision_note}` : ''));
            const upd = await pool.query(
                `UPDATE cert_requests SET status = 'denied', result = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
                [req.id, dmOk ? 'Denied. DM sent.' : 'Denied. Their DMs are closed, so no DM was sent.']
            );
            await refreshRequestNotice(client, upd.rows[0]);
            await recordCertEvent({
                seasonId: req.season_id, attemptId: req.attempt_id, discordId: req.discord_id, username: req.username, test: req.test,
                event: 'denied', details: [['Denied by', req.decided_by_name || '—'], ['DM', dmOk ? 'sent' : 'DMs closed']],
            });
            higgenLog.logInteraction({
                eventType: 'job', action: 'certs.denied',
                actor: { name: req.decided_by_name || 'super admin', id: req.decided_by || null },
                what: `denied ${req.username || req.discord_id}'s request to be ${role} of ${req.franchise_name}`,
                target: req.discord_id,
                details: [['Franchise', req.franchise_name || '—'], ['Note', req.decision_note || '—'], ['DM', dmOk ? 'Sent' : 'DMs closed']],
            });
        } catch (err) {
            await pool.query(`UPDATE cert_requests SET status = 'deny_failed', result = $2, updated_at = NOW() WHERE id = $1`, [req.id, String(err.message || err).slice(0, 500)]).catch(() => {});
            higgenLog.logFailure({ summary: `Denying ${req.username || req.discord_id}'s ${role} request FAILED: ${err.message}`, error: err, action: 'certs.deny', where: 'Rulebook test approvals' });
        }
    }
}

// ── drain loop ───────────────────────────────────────────────────────────────

async function drain(client) {
    if (running || !db() || !client?.isReady?.()) return;
    running = true;
    try {
        if (!(await ensureCertSchema())) return;
        const settings = await getCertSettings();
        await postRequestNotices(client, settings);
        await processDecisions(client, settings);
        await postRetakeNotices(client, settings);
    } catch (err) {
        Logger.error('cert drain failed', err);
    } finally {
        running = false;
    }
}

async function startListener(client) {
    try {
        listenClient = await pool.connect();
        listenClient.on('notification', () => { drain(client); });
        listenClient.on('error', (err) => {
            Logger.warning(`Cert action listener dropped (${err.message}); polling continues.`);
            try { listenClient.release(err); } catch { /* already gone */ }
            listenClient = null;
            setTimeout(() => startListener(client), 10 * 1000);
        });
        await listenClient.query('LISTEN cert_actions');
    } catch (err) {
        Logger.warning(`Cert action listener could not start (${err.message}); polling only.`);
        listenClient = null;
    }
}

// ── 3. Salary Crew reactions (advisory tally) ────────────────────────────────

async function crewReactors(message, emojiName) {
    const reaction = message.reactions.cache.find((r) => r.emoji?.name === emojiName);
    if (!reaction) return [];
    const users = await reaction.users.fetch().catch(() => null);
    if (!users) return [];
    const out = [];
    for (const [, u] of users) {
        if (u.bot) continue;
        const member = await message.guild.members.fetch(u.id).catch(() => null);
        if (member?.roles.cache.has(ROLES.SALARY_CREW)) out.push({ id: u.id, name: member.displayName || u.username });
    }
    return out;
}

async function recount(client, req, message) {
    const [approvals, denials] = await Promise.all([crewReactors(message, '✅'), crewReactors(message, '❌')]);
    const before = `${(req.crew_approvals || []).map((v) => v.id).sort()}|${(req.crew_denials || []).map((v) => v.id).sort()}`;
    const after = `${approvals.map((v) => v.id).sort()}|${denials.map((v) => v.id).sort()}`;
    if (before === after) return null;
    const upd = await pool.query(
        `UPDATE cert_requests SET crew_approvals = $2::jsonb, crew_denials = $3::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [req.id, JSON.stringify(approvals), JSON.stringify(denials)]
    );
    const row = upd.rows[0];
    await message.edit({ embeds: [requestEmbed(row, await loadAttempt(row.attempt_id))], allowedMentions: NO_PING }).catch(() => {});
    return row;
}

async function handleReaction(reaction, user, client, added) {
    try {
        if (user?.bot || !db()) return;
        if (reaction.partial) await reaction.fetch().catch(() => null);
        if (reaction.message?.partial) await reaction.message.fetch().catch(() => null);
        const emoji = reaction.emoji?.name;
        if (emoji !== '✅' && emoji !== '❌') return;
        const r = await pool.query('SELECT * FROM cert_requests WHERE notice_message_id = $1 LIMIT 1', [String(reaction.message.id)]).catch(() => ({ rows: [] }));
        const req = r.rows[0];
        if (!req) return;
        const row = await recount(client, req, reaction.message);
        if (!row) return; // not a Salary Crew vote, or nothing changed

        const member = await reaction.message.guild.members.fetch(user.id).catch(() => null);
        const who = member?.displayName || user.username;
        const vote = emoji === '✅' ? 'approve' : 'deny';
        await recordCertEvent({
            seasonId: row.season_id, attemptId: row.attempt_id, discordId: row.discord_id, username: row.username, test: row.test,
            event: 'crew_vote',
            details: [['Salary Crew', who], ['Vote', `${added ? 'added' : 'removed'} ${vote}`], ['Tally', `✅ ${row.crew_approvals.length} · ❌ ${row.crew_denials.length}`]],
        });
        // Adds are already in higgenlogs via bot.js's reaction listener; removals aren't.
        if (!added) {
            higgenLog.logInteraction({
                eventType: 'reaction', action: 'certs.crew-vote-removed',
                actor: { name: who, id: user.id },
                what: `took back their ${vote} vote on ${row.username || row.discord_id}'s ${ROLE_WORD[row.test]} request for ${row.franchise_name}`,
                target: row.discord_id,
                details: [['Tally now', `✅ ${row.crew_approvals.length} · ❌ ${row.crew_denials.length}`]],
            });
        }
    } catch (err) {
        Logger.error(`cert reaction handler error: ${err?.code || ''} ${err?.message || err}`);
    }
}

/** Votes cast while the bot was down only show up on the next reaction — re-count open requests every few minutes. */
async function resyncVotes(client) {
    if (!db() || !client?.isReady?.()) return;
    try {
        if (!(await ensureCertSchema())) return;
        const open = await pool.query(
            `SELECT * FROM cert_requests WHERE notice_message_id IS NOT NULL
               AND status IN ('pending', 'approve_failed', 'deny_failed') ORDER BY id DESC LIMIT 25`
        );
        for (const req of open.rows) {
            const msg = await fetchNotice(client, req.notice_channel_id, req.notice_message_id);
            if (msg) await recount(client, req, msg);
        }
    } catch (err) {
        Logger.warning(`cert vote resync failed: ${err.message}`);
    }
}

function startCertBridge(client) {
    startListener(client);
    client.on('messageReactionAdd', (reaction, user) => handleReaction(reaction, user, client, true));
    client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, client, false));
    setInterval(() => drain(client), 15 * 1000);
    setTimeout(() => drain(client), 8 * 1000);
    setInterval(() => resyncVotes(client), 5 * 60 * 1000);
    setTimeout(() => resyncVotes(client), 60 * 1000);
    Logger.info('Rulebook test bridge started (notices, Salary Crew tally, approvals)');
}

module.exports = { startCertBridge, drain };
