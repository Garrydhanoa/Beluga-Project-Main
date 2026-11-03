/**
 * Builds the week's Insider packet on Tuesday evening, Eastern. The cloud writer
 * collects it shortly after. Everything before `insider_issues.status = 'ready'`
 * happens here, on Railway, so the writer never holds a Discord or database login.
 *
 * A 5-minute tick rather than a timer, so a restart at 6:29 PM can't skip a week.
 * `issue_date` is unique, which makes a second tick that evening a no-op. Off until
 * site_config.insider.enabled is true.
 */

const { pool } = require('../utils/database');
const { LEAGUE_TZ, zonedParts } = require('../utils/leagueWeek');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { db, ensureInsiderSchema, getInsiderSettings } = require('./insiderSchema');
const { resolvePeriod, buildPacket } = require('./collect');

const TUESDAY = 2;
const RUN_HOUR = 18;
const RUN_MINUTE = 30;
const TICK_MS = 5 * 60 * 1000;
const STALE_DAYS = 14;
const ACTOR = { name: 'Beluga League BOT', id: null };

let running = false;
let failedDate = null;

/** The Eastern date of `now` when a packet is due, otherwise null. */
function dueDate(now = new Date()) {
    const p = zonedParts(now, LEAGUE_TZ);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    if (weekday !== TUESDAY) return null;
    if (p.hour < RUN_HOUR || (p.hour === RUN_HOUR && p.minute < RUN_MINUTE)) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Last issue's end, so a skipped week is covered rather than lost. Null past two weeks. */
async function previousEnd(now) {
    const r = await pool.query(
        `SELECT period_end FROM insider_issues WHERE status <> 'failed' ORDER BY issue_date DESC LIMIT 1`
    );
    const end = r.rows[0]?.period_end;
    if (!end) return null;
    return now.getTime() - new Date(end).getTime() > STALE_DAYS * 24 * 60 * 60 * 1000 ? null : end;
}

async function buildIssue(issueDate, settings, now) {
    const period = await resolvePeriod(now, await previousEnd(now));
    const claimed = await pool.query(
        `INSERT INTO insider_issues (issue_date, season_id, week, edition, period_start, period_end, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'collecting')
         ON CONFLICT (issue_date) DO UPDATE SET
            season_id = EXCLUDED.season_id, week = EXCLUDED.week, edition = EXCLUDED.edition,
            period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
            status = 'collecting', updated_at = NOW()
         WHERE insider_issues.status = 'failed'
         RETURNING id`,
        [issueDate, period.season?.id ?? null, period.week, period.edition, period.from, period.to]
    );
    const issueId = claimed.rows[0]?.id;
    if (!issueId) return;

    try {
        const { packet } = await buildPacket(period, { guildId: process.env.GUILD_ID, settings });
        await pool.query(
            `UPDATE insider_issues SET packet = $2::jsonb, status = 'ready', updated_at = NOW() WHERE id = $1`,
            [issueId, JSON.stringify(packet)]
        );
        const { messages } = packet.chat.totals;
        higgenLog.logInteraction({
            eventType: 'job',
            action: 'insider.collected',
            actor: ACTOR,
            what: `gathered the ${period.edition === 'season' ? `Week ${period.week}` : 'off-season'} facts for The Beluga Insider, including ${messages} messages`,
            location: 'Beluga Insider',
            details: [['Edition', period.edition], ['Messages read', messages], ['Could not read', packet.chat.gaps.length]],
        });
    } catch (err) {
        await pool.query(`UPDATE insider_issues SET status = 'failed', updated_at = NOW() WHERE id = $1`, [issueId]).catch(() => {});
        throw err;
    }
}

async function tick() {
    if (running || !db()) return;
    const now = new Date();
    const issueDate = dueDate(now);
    if (!issueDate) return;
    running = true;
    try {
        const settings = await getInsiderSettings();
        if (!settings.enabled || !(await ensureInsiderSchema())) return;
        await buildIssue(issueDate, settings, now);
    } catch (err) {
        Logger.error('Could not build the Insider packet', err);
        if (failedDate !== issueDate) {
            failedDate = issueDate;
            higgenLog.logFailure({
                summary: 'The Beluga Insider could not gather its facts this week, so no draft will arrive until this is fixed.',
                error: err,
                action: 'insider.collect_failed',
                where: 'Beluga Insider',
                eventType: 'job',
            });
        }
    } finally {
        running = false;
    }
}

function startInsiderScheduler() {
    setInterval(() => tick(), TICK_MS);
    tick();
}

module.exports = { startInsiderScheduler, dueDate };
