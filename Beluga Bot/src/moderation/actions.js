/**
 * The moderation engine. Slash commands, staff panels, the website queue and the
 * chat filter all call these, so an action behaves the same wherever it started.
 *
 * Every action opens a case first, then runs its Discord steps through once(), which
 * records each step on the case. A website action that gets retried after a crash
 * finds its case by `action_id` and skips what already happened, so nobody is
 * double-DMed, double-posted or double-banned.
 *
 * A failed step never rolls the case back: the punishment is on record and the step
 * shows under "Not completed" in the log so staff can see exactly what didn't land.
 *
 * ctx = { client, guild, target: {id, name}, actor: {id, name, source}, rule, reason,
 *         actionId?, silent?, attachment? }
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const store = require('./modStore');
const posting = require('./modPosting');
const { MAX_TIMEOUT_SECONDS } = require('./modConfig');

class ModError extends Error {}

/** Run a step once per case. The step counts as done even when it reports a problem. */
async function once(c, name, problems, fn) {
    const done = c.steps?.[name];
    if (done) {
        if (done.problem) problems.push(done.problem);
        return done.value;
    }
    let record;
    try {
        const out = await fn();
        record = { value: out?.value ?? null, problem: out?.problem || null };
    } catch (err) {
        Logger.error(`moderation case ${c.id}: step "${name}" failed`, err);
        record = { value: null, problem: `${name}: ${err.message}` };
    }
    if (record.problem) problems.push(record.problem);
    c.steps = { ...(c.steps || {}), [name]: record };
    await store.setStep(c.id, name, record).catch((err) => Logger.warning(`moderation step save failed: ${err.message}`));
    return record.value;
}

async function open(ctx, fields) {
    if (ctx.actionId) {
        const existing = await store.getCaseByAction(ctx.actionId);
        if (existing) return existing;
    }
    const c = await store.createCase({
        discordId: ctx.target.id, targetName: ctx.target.name, rule: ctx.rule, reason: ctx.reason,
        actor: ctx.actor, actionId: ctx.actionId || null, ...fields,
    });
    await store.logEvent({
        discordId: ctx.target.id, caseId: c.id, kind: fields.kind,
        summary: `${ctx.actor?.name || 'System'} opened case ${c.id} (${posting.KIND_LABEL[fields.kind] || fields.kind}): ${ctx.reason}`,
        actorId: ctx.actor?.id, actorName: ctx.actor?.name,
    });
    return c;
}

async function saveEvidence(ctx, c, problems) {
    if (!ctx.attachment) return;
    await once(c, 'evidence', problems, async () => {
        const res = await store.addEvidenceFile({ caseId: c.id, attachment: ctx.attachment, actor: ctx.actor });
        return res.ok ? { value: true } : { problem: `Evidence was not saved: ${res.error}` };
    });
}

function dmStep(ctx, c, problems, content) {
    if (ctx.silent) return Promise.resolve();
    return once(c, 'dm', problems, async () => {
        const res = await posting.dmMember(ctx.client, ctx.target.id, content);
        return res.ok ? { value: true } : { problem: `The DM was not delivered: ${res.error}` };
    });
}

async function logStep(ctx, c, problems, opts = {}) {
    await once(c, 'log', [], async () => {
        const fresh = (await store.getCase(c.id)) || c;
        const msg = await posting.postLog(ctx.client, fresh, { problems, ...opts });
        if (msg) await store.setMessageId(c.id, 'log', msg.id);
        return { value: msg?.id || null };
    });
}

async function fetchMember(ctx) {
    if (ctx.member !== undefined) return ctx.member;
    return ctx.guild.members.fetch(ctx.target.id).catch(() => null);
}

function result(c, problems, summary) {
    return { ok: true, case: c, problems, summary };
}

function ruleLine(ctx) {
    return ctx.rule ? `\nRule: ${ctx.rule.label}` : '';
}

// ── note / warn ───────────────────────────────────────────────────────────────

async function note(ctx) {
    const c = await open(ctx, { kind: 'note', status: 'ended' });
    const problems = [];
    await saveEvidence(ctx, c, problems);
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: note added for ${ctx.target.name}.`);
}

async function warn(ctx) {
    const c = await open(ctx, { kind: 'warn' });
    const problems = [];
    await saveEvidence(ctx, c, problems);
    await once(c, 'count', problems, async () => { await store.markWarned(ctx.target.id); return { value: true }; });
    await once(c, 'post', problems, async () => {
        const msg = await posting.postWarning(ctx.client, c);
        if (msg) await store.setMessageId(c.id, 'strikes', msg.id);
        return msg ? { value: msg.id } : { problem: 'The warning was not posted in #strike-channel.' };
    });
    await dmStep(ctx, c, problems, `You have received a warning in Beluga League.\n\nReason: ${ctx.reason}${ruleLine(ctx)}\n\nPlayers get one warning. Further rule breaks can lead to strikes.`);
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: warned ${ctx.target.name}.`);
}

// ── timeouts ──────────────────────────────────────────────────────────────────

/** @returns {string|null} what went wrong */
async function applyTimeout(member, seconds, auditReason) {
    if (!member) return 'They are not in the server, so no Discord timeout was applied.';
    if (!member.moderatable) return 'Discord refused the timeout: they have Administrator or sit above the bot.';
    await member.timeout(seconds * 1000, auditReason.slice(0, 512));
    return null;
}

async function timeout(ctx, { seconds, kind = 'timeout', dmText = null }) {
    const safe = Math.min(Math.max(1, seconds), MAX_TIMEOUT_SECONDS);
    const expiresAt = new Date(Date.now() + safe * 1000);
    const c = await open(ctx, { kind, durationSeconds: safe, expiresAt });
    const problems = [];
    await saveEvidence(ctx, c, problems);
    const member = await fetchMember(ctx);
    await once(c, 'timeout', problems, async () => {
        const problem = await applyTimeout(member, safe, `Case ${c.id}: ${ctx.reason}`);
        return problem ? { problem } : { value: true };
    });
    await dmStep(ctx, c, problems, dmText || `You have been timed out in Beluga League for ${posting.formatDuration(safe)}.\n\nReason: ${ctx.reason}${ruleLine(ctx)}`);
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: timed out ${ctx.target.name} for ${posting.formatDuration(safe)}.`);
}

async function untimeout(ctx) {
    const member = await fetchMember(ctx);
    if (!member) throw new ModError('They are not in the server.');
    const c = await open(ctx, { kind: 'untimeout', status: 'ended' });
    const problems = [];
    await once(c, 'timeout', problems, async () => {
        if (!member.moderatable) return { problem: 'Discord refused: they have Administrator or sit above the bot.' };
        await member.timeout(null, `Case ${c.id}: ${ctx.reason}`.slice(0, 512));
        return { value: true };
    });
    await pool.query(
        `UPDATE mod_cases SET status = 'ended', updated_at = NOW()
          WHERE discord_id = $1 AND kind IN ('timeout','filter') AND status = 'active'`,
        [ctx.target.id],
    );
    await dmStep(ctx, c, problems, `Your timeout in Beluga League has been removed.\n\nReason: ${ctx.reason}`);
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: removed the timeout on ${ctx.target.name}.`);
}

// ── kick ──────────────────────────────────────────────────────────────────────

async function kick(ctx) {
    const member = await fetchMember(ctx);
    if (!member) throw new ModError('They are not in the server.');
    const c = await open(ctx, { kind: 'kick', status: 'ended' });
    const problems = [];
    await saveEvidence(ctx, c, problems);
    // The DM has to land first: once they're out the bot can't reach them.
    await dmStep(ctx, c, problems, `You have been kicked from Beluga League.\n\nReason: ${ctx.reason}${ruleLine(ctx)}`);
    await once(c, 'kick', problems, async () => {
        if (!member.kickable) return { problem: 'Discord refused the kick: they have higher permissions than the bot.' };
        await member.kick(`Case ${c.id}: ${ctx.reason}`.slice(0, 512));
        return { value: true };
    });
    await once(c, 'post', problems, async () => {
        const msg = await posting.postKick(ctx.client, c);
        if (msg) await store.setMessageId(c.id, 'strikes', msg.id);
        return msg ? { value: msg.id } : { problem: 'The kick was not posted in #strike-channel.' };
    });
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: kicked ${ctx.target.name}.`);
}

// ── strikes ───────────────────────────────────────────────────────────────────

/**
 * pkg = { timeoutSeconds, suspension: {unit,total}|null, ban: {type,unbanAt,appealAfter,deleteSeconds}|null }
 */
async function strike(ctx, pkg) {
    const c = await open(ctx, {
        kind: 'strike', durationSeconds: pkg.timeoutSeconds || null,
        expiresAt: pkg.timeoutSeconds ? new Date(Date.now() + pkg.timeoutSeconds * 1000) : null,
    });
    const problems = [];
    await saveEvidence(ctx, c, problems);

    const number = await once(c, 'count', problems, async () => ({ value: await store.addStrike(ctx.target.id) }));
    if (number && c.strike_number !== number) {
        await pool.query('UPDATE mod_cases SET strike_number = $2, updated_at = NOW() WHERE id = $1', [c.id, number]);
        c.strike_number = number;
    }

    await once(c, 'post', problems, async () => {
        const msg = await posting.postStrike(ctx.client, c);
        if (msg) await store.setMessageId(c.id, 'strikes', msg.id);
        return msg ? { value: msg.id } : { problem: 'The strike was not posted in #strike-channel.' };
    });

    const parts = [];
    if (pkg.ban) {
        parts.push('Server ban');
    } else {
        if (pkg.timeoutSeconds) {
            const member = await fetchMember(ctx);
            await once(c, 'timeout', problems, async () => {
                const problem = await applyTimeout(member, Math.min(pkg.timeoutSeconds, MAX_TIMEOUT_SECONDS), `Case ${c.id}: ${ctx.reason}`);
                return problem ? { problem } : { value: true };
            });
            parts.push(`${posting.formatDuration(pkg.timeoutSeconds)} server timeout`);
        }
        if (pkg.suspension) {
            const { startSuspension } = require('./suspensions');
            await startSuspension(ctx, c, pkg.suspension, problems);
            parts.push(`${posting.suspensionLengthText(pkg.suspension.unit, pkg.suspension.total)} suspension`);
        }
        await dmStep(ctx, c, problems,
            `You have received Strike ${number}/${store.STRIKE_LIMIT} in Beluga League.\n\nReason: ${ctx.reason}${ruleLine(ctx)}`
            + `${parts.length ? `\n\nThis comes with:\n${parts.map((p) => `- ${p}`).join('\n')}` : ''}`
            + `\n\nStrikes are permanent. Strike ${store.STRIKE_LIMIT} is a server ban.`);
    }

    if (pkg.ban) {
        const { banForCase } = require('./bans');
        await banForCase(ctx, c, pkg.ban, problems);
    }
    await logStep(ctx, c, problems, {
        extra: pkg.suspension && !pkg.ban ? [{ name: 'Suspension', value: posting.suspensionLengthText(pkg.suspension.unit, pkg.suspension.total) }] : [],
        components: ctx.components || [],
    });
    return result(c, problems, `Case ${c.id}: Strike ${number}/${store.STRIKE_LIMIT} for ${ctx.target.name}${parts.length ? ` (${parts.join(', ')})` : ''}.`);
}

/** Directors only. Removes one strike; the original case stays on record. */
async function unstrike(ctx) {
    const state = await store.getState(ctx.target.id);
    if (state.strikes < 1) throw new ModError('They have no strikes to remove.');
    const c = await open(ctx, { kind: 'unstrike', status: 'ended' });
    const problems = [];
    const removed = state.strikes;
    await once(c, 'count', problems, async () => {
        await store.removeStrike(ctx.target.id);
        await pool.query(
            `UPDATE mod_cases SET status = 'removed', updated_at = NOW()
              WHERE id = (SELECT id FROM mod_cases WHERE discord_id = $1 AND kind = 'strike' AND counts = TRUE AND status = 'active'
                           ORDER BY id DESC LIMIT 1)`,
            [ctx.target.id],
        );
        return { value: removed };
    });
    await once(c, 'post', problems, async () => {
        const msg = await posting.postStrikeRemoval(ctx.client, c, removed);
        if (msg) await store.setMessageId(c.id, 'strikes', msg.id);
        return msg ? { value: msg.id } : { problem: 'The removal was not posted in #strike-channel.' };
    });
    await dmStep(ctx, c, problems, `Strike ${removed} has been removed from your Beluga League record.\n\nReason: ${ctx.reason}`);
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: removed Strike ${removed} from ${ctx.target.name}.`);
}

async function setStrikes(ctx, count) {
    const before = await store.getState(ctx.target.id);
    const n = await store.setStrikes(ctx.target.id, count);
    const c = await open(ctx, { kind: 'note', status: 'ended', details: { strikes_set: { from: before.strikes, to: n } } });
    await store.logEvent({
        discordId: ctx.target.id, caseId: c.id, kind: 'strikes_set',
        summary: `${ctx.actor?.name || 'Staff'} set the strike count from ${before.strikes} to ${n}: ${ctx.reason}`,
        actorId: ctx.actor?.id, actorName: ctx.actor?.name,
    });
    const problems = [];
    await logStep(ctx, c, problems, { extra: [{ name: 'Strike count', value: `${before.strikes} → ${n}` }] });
    return result(c, problems, `Case ${c.id}: set ${ctx.target.name}'s strikes to ${n}.`);
}

// ── suspensions (thin wrappers; the logic lives in suspensions.js) ────────────

async function suspend(ctx, length) {
    const c = await open(ctx, { kind: 'suspend' });
    const problems = [];
    await saveEvidence(ctx, c, problems);
    const { startSuspension, suspensionDm } = require('./suspensions');
    await startSuspension(ctx, c, length, problems);
    await dmStep(ctx, c, problems, suspensionDm(ctx, length));
    await logStep(ctx, c, problems, {
        extra: [{ name: 'Length', value: posting.suspensionLengthText(length.unit, length.total) }],
        components: ctx.components || [],
    });
    return result(c, problems, `Case ${c.id}: suspended ${ctx.target.name} (${posting.suspensionLengthText(length.unit, length.total)}).`);
}

async function unsuspend(ctx) {
    const { liftAllFor } = require('./suspensions');
    const active = (await store.memberSummary(ctx.target.id)).suspensions;
    if (!active.length) throw new ModError('They have no active suspension.');
    const c = await open(ctx, { kind: 'unsuspend', status: 'ended' });
    const problems = [];
    await once(c, 'lift', problems, async () => {
        await liftAllFor(ctx, active, { reason: ctx.reason, problems });
        return { value: true };
    });
    await dmStep(ctx, c, problems, `Your Beluga League suspension has been lifted.\n\nReason: ${ctx.reason}`);
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: lifted the suspension on ${ctx.target.name}.`);
}

// ── ban wrappers ──────────────────────────────────────────────────────────────

async function ban(ctx, opts) {
    const c = await open(ctx, { kind: 'ban' });
    const problems = [];
    await saveEvidence(ctx, c, problems);
    const { banForCase } = require('./bans');
    await banForCase(ctx, c, opts, problems);
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: banned ${ctx.target.name}.`);
}

async function unban(ctx, opts = {}) {
    const c = await open(ctx, { kind: 'unban', status: 'ended' });
    const problems = [];
    const { liftBan } = require('./bans');
    await once(c, 'unban', problems, async () => {
        const problem = await liftBan(ctx.guild, ctx.target.id, ctx.reason, opts);
        return problem ? { problem } : { value: true };
    });
    await logStep(ctx, c, problems);
    return result(c, problems, `Case ${c.id}: unbanned ${ctx.target.name}.`);
}

// ── case edits ────────────────────────────────────────────────────────────────

async function changeReason(ctx, caseId, reason) {
    const row = await store.updateReason(caseId, reason, ctx.actor);
    if (!row) throw new ModError(`There is no case ${caseId}.`);
    await posting.sendTo(ctx.client, require('./modConfig').CHANNELS.TIMEOUT_LOG, {
        content: `Case ${caseId}: reason changed by ${ctx.actor?.name || 'staff'}.`,
        embeds: [posting.caseEmbed(row)],
        allowedMentions: { parse: [] },
    }, 'a reason change');
    return { ok: true, case: row, problems: [], summary: `Case ${caseId}: reason updated.` };
}

/** Voiding undoes a case's effect but keeps the record. Directors only. */
async function voidCase(ctx, caseId) {
    const c = await store.getCase(caseId);
    if (!c) throw new ModError(`There is no case ${caseId}.`);
    if (c.status === 'voided') throw new ModError(`Case ${caseId} is already voided.`);
    if (!c.counts) throw new ModError('Imported history cannot be voided, because it never counted.');
    const problems = [];
    const member = await ctx.guild.members.fetch(c.discord_id).catch(() => null);
    const auditReason = `Case ${c.id} voided: ${ctx.reason}`.slice(0, 512);

    // A strike /unstrike already removed has nothing left to take off the count.
    if (c.kind === 'strike' && c.status !== 'removed') await store.removeStrike(c.discord_id);
    if (c.kind === 'warn') {
        const { rows } = await pool.query(
            `SELECT 1 FROM mod_cases WHERE discord_id = $1 AND kind = 'warn' AND counts = TRUE AND status = 'active' AND id <> $2 LIMIT 1`,
            [c.discord_id, c.id],
        );
        if (!rows.length) await store.clearWarned(c.discord_id);
    }
    if (['timeout', 'filter', 'strike'].includes(c.kind) && c.expires_at && new Date(c.expires_at) > new Date()) {
        if (member?.moderatable) await member.timeout(null, auditReason).catch((err) => problems.push(`Timeout was not removed: ${err.message}`));
    }
    const { rows: sus } = await pool.query(
        `SELECT * FROM mod_suspensions WHERE case_id = $1 AND status IN ('active','queued')`,
        [c.id],
    );
    if (sus.length) {
        const { liftAllFor } = require('./suspensions');
        await liftAllFor({ ...ctx, target: { id: c.discord_id, name: c.target_name } }, sus, { reason: ctx.reason, problems, quiet: true });
    }
    const { rows: bans } = await pool.query(`SELECT 1 FROM mod_bans WHERE case_id = $1 AND status = 'active'`, [c.id]);
    if (bans.length) {
        const { liftBan } = require('./bans');
        const problem = await liftBan(ctx.guild, c.discord_id, auditReason, {});
        if (problem) problems.push(problem);
    }

    const row = await store.markVoided(c.id, ctx.reason, ctx.actor);
    await store.logEvent({
        discordId: c.discord_id, caseId: c.id, kind: 'void',
        summary: `${ctx.actor?.name || 'Staff'} voided case ${c.id}: ${ctx.reason}`,
        actorId: ctx.actor?.id, actorName: ctx.actor?.name,
    });
    await posting.sendTo(ctx.client, require('./modConfig').CHANNELS.TIMEOUT_LOG, {
        embeds: [posting.caseEmbed(row || c, { problems })],
        allowedMentions: { parse: [] },
    }, 'a voided case');
    return { ok: true, case: row || c, problems, summary: `Case ${c.id} voided.` };
}

/** For anything that isn't an interaction, which bot.js would otherwise log. */
function logJob(action, what, { actor = null, target = null, details = [] } = {}) {
    try {
        higgenLog.logInteraction({
            eventType: 'job', action,
            actor: actor || { name: 'Moderation system', id: null },
            what, target, details,
        });
    } catch { /* audit logging never blocks moderation */ }
}

module.exports = {
    ModError, once, open, applyTimeout, logJob,
    note, warn, timeout, untimeout, kick, strike, unstrike, setStrikes,
    suspend, unsuspend, ban, unban, changeReason, voidCase,
};
