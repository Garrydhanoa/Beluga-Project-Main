/**
 * DM Center → Discord sender.
 *
 * The website admin panel composes a blast and queues it into `dm_jobs` +
 * `dm_job_targets` (see beluga-league-main/lib/dmStore.js). This is the BOT half:
 * it claims a queued job, expands role targets LIVE from the guild, and DMs each
 * recipient with the message exactly as typed — raw Discord markdown, <#channel>
 * tags and custom emoji all pass through untouched.
 *
 * Delivery is near-instant: a dedicated client sits on `LISTEN dm_jobs` and wakes
 * the moment the website NOTIFYs. A slow poll runs alongside it purely as a safety
 * net for a dropped listener connection.
 *
 * Sending is deliberately throttled (see RATE_PER_SEC). Mass DMs are the fastest
 * way to get a bot rate-limited or flagged, so this trades speed for safety and
 * honours Discord's own `retry_after` on a 429.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const { recordOutgoing } = require('./dmInbox');
const Logger = require('../utils/logger');

// Discord's hard limit for a single message.
const MAX_LEN = 2000;

// ~2 DMs/second. 1,200 recipients ≈ 10 minutes.
const RATE_PER_SEC = 2;
const GAP_MS = Math.ceil(1000 / RATE_PER_SEC);

// How often to flush progress back to the DB so the admin's bar moves without
// us doing a round-trip per recipient.
const FLUSH_EVERY = 10;

let running = false;
let listenClient = null;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Render one recipient's message. MUST stay in sync with `renderMessage` in
 * beluga-league-main/lib/dmStore.js — the admin preview relies on them matching.
 */
function renderMessage(job, recipient, seasonNumber) {
    const parts = [];
    if (job.include_default && String(job.default_text || '').trim()) {
        parts.push(String(job.default_text).trim());
    }
    if (String(job.body || '').trim()) parts.push(String(job.body).trim());
    let text = parts.join('\n\n');

    const values = {
        name: recipient.display_name || 'there',
        team: recipient.team || 'Free Agent',
        franchise: recipient.franchise || 'Free Agent',
        division: recipient.division || '—',
        season: seasonNumber ? `S${seasonNumber}` : '—',
    };
    text = text.replace(/\{(name|team|franchise|division|season)\}/g, (_m, k) => values[k]);

    if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN - 1)}…`;
    return text;
}

/** Turn a discord.js error into a short, human reason for the delivery report. */
function failureReason(err) {
    const code = err?.code;
    if (code === 50007) return 'DMs closed (blocked or privacy settings)';
    if (code === 10013) return 'Unknown user — account deleted?';
    if (code === 50001) return 'Missing access';
    return String(err?.message || err || 'Unknown error').slice(0, 200);
}

/**
 * Roles are stored as ids on the job; the member↔role mirror the website used for
 * its preview can be stale, so re-expand them from the LIVE guild here and add
 * any newcomers as pending targets. This is the authoritative expansion.
 */
async function reconcileRoleTargets(client, job) {
    const roleIds = Array.isArray(job.targets?.roles) ? job.targets.roles : [];
    if (!roleIds.length || job.test_only) return;

    try {
        const guild = client.guilds.cache.first();
        if (!guild) return;

        const live = new Set();
        for (const roleId of roleIds) {
            const role = guild.roles.cache.get(String(roleId));
            if (!role) {
                Logger.warning(`DM job ${job.id}: role ${roleId} no longer exists`);
                continue;
            }
            for (const member of role.members.values()) {
                if (!member.user.bot) live.add(member.user.id);
            }
        }
        if (!live.size) return;

        // Exclusions still apply to anyone the live expansion turned up.
        const excluded = new Set((job.targets?.excludeUsers || []).map(String));
        const additions = [...live].filter((id) => !excluded.has(id));
        if (!additions.length) return;

        const CHUNK = 500;
        for (let i = 0; i < additions.length; i += CHUNK) {
            const slice = additions.slice(i, i + CHUNK);
            const values = slice.map((_, idx) => `($1, $${idx + 2})`);
            // eslint-disable-next-line no-await-in-loop
            await pool.query(
                `INSERT INTO dm_job_targets (job_id, discord_id)
                 VALUES ${values.join(', ')} ON CONFLICT (job_id, discord_id) DO NOTHING`,
                [job.id, ...slice]
            );
        }
        await pool.query(
            `UPDATE dm_jobs SET total = (SELECT COUNT(*) FROM dm_job_targets WHERE job_id = $1) WHERE id = $1`,
            [job.id]
        );
    } catch (err) {
        Logger.error(`DM job ${job.id}: live role expansion failed — ${err?.code || ''} ${err?.message || err}`);
    }
}

/** Attach team/franchise/division for the personalization tokens. */
async function loadLeagueContext(discordIds) {
    const map = new Map();
    if (!discordIds.length) return map;
    try {
        const r = await pool.query(
            `SELECT trm.discord_id, tm.name AS team_name, tm.division, f.name AS franchise_name
               FROM team_roster_members trm
               JOIN teams tm ON tm.id = trm.team_id
               JOIN seasons s ON s.id = trm.season_id AND s.status = 'active'
               LEFT JOIN team_franchises f ON f.id = tm.franchise_id
              WHERE trm.is_active = TRUE AND trm.discord_id = ANY($1::text[])`,
            [discordIds]
        );
        for (const row of r.rows) {
            map.set(String(row.discord_id), {
                team: row.team_name,
                franchise: row.franchise_name,
                division: row.division,
            });
        }
    } catch { /* tokens degrade to "Free Agent" */ }
    return map;
}

async function processJob(client, job) {
    Logger.info(`DM job ${job.id}: starting (${job.total} target(s), test=${job.test_only})`);
    await reconcileRoleTargets(client, job);

    let seasonNumber = null;
    try {
        const s = await pool.query(`SELECT season_number FROM seasons WHERE status = 'active' LIMIT 1`);
        seasonNumber = s.rows[0]?.season_number ?? null;
    } catch { /* optional */ }

    const pending = await pool.query(
        `SELECT t.discord_id, COALESCE(t.display_name, m.display_name, m.username) AS display_name
           FROM dm_job_targets t
           LEFT JOIN discord_members m ON m.discord_id = t.discord_id
          WHERE t.job_id = $1 AND t.status = 'pending'
          ORDER BY t.id`,
        [job.id]
    );

    const context = await loadLeagueContext(pending.rows.map((r) => String(r.discord_id)));

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = false;
    let sinceFlush = 0;

    const flush = async () => {
        await pool.query(
            `UPDATE dm_jobs SET sent_count = $2, failed_count = $3, skipped_count = $4 WHERE id = $1`,
            [job.id, sent, failed, skipped]
        ).catch(() => {});
        sinceFlush = 0;
    };

    for (const row of pending.rows) {
        const discordId = String(row.discord_id);

        // Cancellation is checked between sends — DMs already delivered stand.
        if (sinceFlush === 0) {
            // eslint-disable-next-line no-await-in-loop
            const c = await pool.query(`SELECT cancel_requested FROM dm_jobs WHERE id = $1`, [job.id]).catch(() => null);
            if (c?.rows[0]?.cancel_requested) { cancelled = true; break; }
        }

        const recipient = {
            display_name: row.display_name,
            ...(context.get(discordId) || {}),
        };
        const content = renderMessage(job, recipient, seasonNumber);

        try {
            // eslint-disable-next-line no-await-in-loop
            const user = await client.users.fetch(discordId);
            // eslint-disable-next-line no-await-in-loop
            const msg = await user.send({ content, allowedMentions: { parse: [] } });
            sent += 1;
            // eslint-disable-next-line no-await-in-loop
            await pool.query(
                `UPDATE dm_job_targets SET status = 'sent', sent_at = CURRENT_TIMESTAMP, reason = NULL
                  WHERE job_id = $1 AND discord_id = $2`,
                [job.id, discordId]
            ).catch(() => {});
            // Mirror into the inbox so the conversation shows the full history.
            // eslint-disable-next-line no-await-in-loop
            await recordOutgoing({
                discordId,
                content,
                authorName: job.created_by_name,
                authorDiscordId: job.created_by,
                source: 'blast',
                discordMessageId: msg?.id ? String(msg.id) : null,
            });
        } catch (err) {
            // Honour Discord's own backoff, then retry this recipient once.
            if (err?.status === 429) {
                const waitMs = Math.ceil((err?.retry_after ?? err?.rawError?.retry_after ?? 5) * 1000);
                Logger.warning(`DM job ${job.id}: rate limited, backing off ${waitMs}ms`);
                // eslint-disable-next-line no-await-in-loop
                await sleep(waitMs);
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const user = await client.users.fetch(discordId);
                    // eslint-disable-next-line no-await-in-loop
                    await user.send({ content, allowedMentions: { parse: [] } });
                    sent += 1;
                    // eslint-disable-next-line no-await-in-loop
                    await pool.query(
                        `UPDATE dm_job_targets SET status = 'sent', sent_at = CURRENT_TIMESTAMP, reason = NULL
                          WHERE job_id = $1 AND discord_id = $2`,
                        [job.id, discordId]
                    ).catch(() => {});
                    // eslint-disable-next-line no-await-in-loop
                    await sleep(GAP_MS);
                    sinceFlush += 1;
                    if (sinceFlush >= FLUSH_EVERY) await flush();
                    continue;
                } catch (retryErr) {
                    err = retryErr; // fall through to the failure path
                }
            }

            failed += 1;
            Logger.error(
                `DM job ${job.id}: send to ${discordId} failed — ` +
                `${err?.code || ''} ${err?.message || err} ${JSON.stringify(err?.rawError || {})}`
            );
            // eslint-disable-next-line no-await-in-loop
            await pool.query(
                `UPDATE dm_job_targets SET status = 'failed', reason = $3, rendered = $4
                  WHERE job_id = $1 AND discord_id = $2`,
                [job.id, discordId, failureReason(err), content.slice(0, 2000)]
            ).catch(() => {});
        }

        sinceFlush += 1;
        if (sinceFlush >= FLUSH_EVERY) {
            // eslint-disable-next-line no-await-in-loop
            await flush();
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(GAP_MS);
    }

    if (cancelled) {
        const rest = await pool.query(
            `UPDATE dm_job_targets SET status = 'skipped', reason = 'Cancelled by staff'
              WHERE job_id = $1 AND status = 'pending' RETURNING id`,
            [job.id]
        ).catch(() => ({ rows: [] }));
        skipped += rest.rows.length;
    }

    await pool.query(
        `UPDATE dm_jobs
            SET status = $2, sent_count = $3, failed_count = $4, skipped_count = $5,
                finished_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [job.id, cancelled ? 'cancelled' : 'done', sent, failed, skipped]
    );

    Logger.success(
        `DM job ${job.id}: ${cancelled ? 'CANCELLED' : 'done'} — ${sent} sent, ${failed} failed, ${skipped} skipped`
    );
}

/**
 * Claim and run every queued job, one at a time.
 * `FOR UPDATE SKIP LOCKED` means a second bot instance can never double-send.
 */
async function drainQueue(client) {
    if (running || !db()) return;
    running = true;
    try {
        for (;;) {
            const claimed = await pool.query(`
                UPDATE dm_jobs SET status = 'sending', started_at = CURRENT_TIMESTAMP
                 WHERE id = (
                    SELECT id FROM dm_jobs WHERE status = 'queued'
                     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
                 )
                 RETURNING *
            `);
            const job = claimed.rows[0];
            if (!job) break;

            try {
                await processJob(client, job);
            } catch (err) {
                Logger.error(`DM job ${job.id} crashed — ${err?.code || ''} ${err?.message || err}`);
                await pool.query(
                    `UPDATE dm_jobs SET status = 'failed', error = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [job.id, String(err?.message || err).slice(0, 500)]
                ).catch(() => {});
            }
        }
    } catch (err) {
        // The dm_* tables only exist once the website has deployed its schema.
        if (!/relation .* does not exist/.test(String(err.message))) {
            Logger.error('DM queue drain failed', err);
        }
    } finally {
        running = false;
    }
}

/** Dedicated LISTEN connection so a queued job fires immediately. */
async function startListener(client) {
    try {
        listenClient = await pool.connect();
        listenClient.on('notification', () => { drainQueue(client); });
        listenClient.on('error', (err) => {
            Logger.warning(`DM listener dropped (${err.message}); the poll fallback keeps jobs moving.`);
            try { listenClient.release(err); } catch { /* already gone */ }
            listenClient = null;
            setTimeout(() => startListener(client), 10 * 1000);
        });
        await listenClient.query('LISTEN dm_jobs');
        Logger.info('DM sender listening on dm_jobs');
    } catch (err) {
        Logger.warning(`DM listener could not start (${err.message}); falling back to polling.`);
        listenClient = null;
    }
}

function startDmSender(client, pollMs = 5 * 1000) {
    if (!db()) {
        Logger.warning('DM sender not started (no database).');
        return;
    }
    startListener(client);
    setInterval(() => drainQueue(client), pollMs);
    setTimeout(() => drainQueue(client), 8 * 1000);
    Logger.info('DM sender started');
}

module.exports = { startDmSender, drainQueue, renderMessage };
