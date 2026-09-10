/**
 * Drains stats_import_jobs — the website's "pull the real stats in from Ballchasing"
 * queue for hand-reported series.
 *
 * The website can write stats_* directly, but it has no Ballchasing key, no rate
 * limiter and no parser, so it queues a row here and polls for the outcome. Every
 * job terminates in exactly one status write ('done' or 'failed') so the admin
 * panel never spins forever.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { importSeriesStats } = require('./seriesIngest');

let timer = null;

async function processImportJobs() {
    if (!isDatabaseAvailable()) return;

    let rows;
    try {
        const r = await pool.query(
            `SELECT id, series_id, requested_by_discord_id, requested_by_username
             FROM stats_import_jobs
             WHERE status = 'pending'
             ORDER BY requested_at
             LIMIT 3`
        );
        rows = r.rows;
    } catch {
        return; // table may not exist yet (website deployed after the bot)
    }
    if (!rows.length) return;

    for (const job of rows) {
        // Claim it first so a slow import isn't picked up twice by the next tick.
        const claimed = await pool.query(
            `UPDATE stats_import_jobs SET status = 'running', started_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'pending' RETURNING id`,
            [job.id]
        ).catch(() => ({ rowCount: 0 }));
        if (!claimed.rowCount) continue;

        try {
            const result = await importSeriesStats(job.series_id, {
                actorDiscordId: job.requested_by_discord_id || null,
                actorName: job.requested_by_username || null,
            });
            await pool.query(
                `UPDATE stats_import_jobs SET status = 'done', source = $2, result = $3::jsonb,
                    error = NULL, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [job.id, result.source, JSON.stringify(result)]
            );
            Logger.info(`Ballchasing import for series #${job.series_id}: ${result.gamesWritten} game(s), ${result.playerRows} player line(s) from ${result.source}.`);
            higgenLog.logInteraction({
                eventType: 'job',
                action: 'stats-series.import',
                actor: { name: job.requested_by_username || 'admin', id: job.requested_by_discord_id || null },
                what: `imported Ballchasing stats into series #${job.series_id}`,
                target: `series #${job.series_id}`,
                details: [
                    ['Source', result.source === 'group' ? 'replay group link' : 'per-game replay links'],
                    ['Games written', String(result.gamesWritten)],
                    ['Player stat lines', String(result.playerRows)],
                    ['Series score', `${result.homeScore}-${result.awayScore}`],
                    ['Unmatched players', String(result.unmatchedPlayers.length)],
                ],
            }, { note: result.warnings.length ? result.warnings.join(' ') : null });
        } catch (err) {
            await pool.query(
                `UPDATE stats_import_jobs SET status = 'failed', error = $2, finished_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [job.id, String(err.message || err).slice(0, 500)]
            ).catch(() => {});
            Logger.error(`Ballchasing import failed for series #${job.series_id}`, err);
            higgenLog.logFailure({
                summary: `Ballchasing import failed for series #${job.series_id}.`,
                error: err,
                action: 'stats-series.import',
                where: 'seriesImportPoller',
                details: [
                    ['Series', `#${job.series_id}`],
                    ['Requested by', job.requested_by_username || 'admin'],
                ],
            });
        }
    }
}

function startSeriesImportPoller(client, intervalMs = 10 * 1000) {
    if (timer) return;
    // Staff are watching the admin panel for this, so poll tight.
    timer = setInterval(() => { processImportJobs().catch(() => {}); }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
    setTimeout(() => { processImportJobs().catch(() => {}); }, 5000);
    Logger.info(`Series import poller started (every ${Math.round(intervalMs / 1000)}s)`);
}

function stopSeriesImportPoller() {
    if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { startSeriesImportPoller, stopSeriesImportPoller, processImportJobs };
