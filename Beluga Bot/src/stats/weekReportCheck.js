/**
 * "Is every series in this week actually reported?" — the pre-flight run before
 * a week's threads are deleted (which is how the league closes a week).
 *
 * A week_threads row is the matchup; a confirmed `stats_series` row is the
 * report. Anything in the first without a match in the second is unreported, and
 * deleting it would destroy the only place that series can still be reported.
 *
 * Both entry points use this: `/week-thread action:Delete` and the website's
 * "Delete week N" (queued through `week_thread_actions`).
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const { ROLES } = require('../constants/roles');
const Logger = require('../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

/**
 * Week threads for `weekNumber` that have NO confirmed series.
 *
 * Team names are matched case-insensitively in EITHER order, because the thread
 * stores team1/team2 while the series stores home/away and those need not agree.
 *
 * @returns {Promise<Array<{id,division,team1,team2,match_number,thread_id}>>}
 */
async function getUnreportedMatches(weekNumber, seasonId = null) {
    if (!db()) return [];
    const r = await pool.query(
        `SELECT wt.id, wt.division, wt.team1, wt.team2, wt.match_number, wt.thread_id, wt.season_id
           FROM week_threads wt
          WHERE wt.week_number = $1
            AND ($2::int IS NULL OR wt.season_id = $2 OR wt.season_id IS NULL)
            AND NOT EXISTS (
              SELECT 1
                FROM stats_series s
                JOIN teams ht ON ht.id = s.home_team_id
                JOIN teams at ON at.id = s.away_team_id
               WHERE s.status = 'confirmed'
                 AND s.is_playoff = FALSE
                 AND s.week = wt.week_number
                 AND (wt.season_id IS NULL OR s.season_id = wt.season_id)
                 AND LOWER(s.division) = LOWER(wt.division)
                 AND (
                      (LOWER(ht.name) = LOWER(wt.team1) AND LOWER(at.name) = LOWER(wt.team2))
                   OR (LOWER(ht.name) = LOWER(wt.team2) AND LOWER(at.name) = LOWER(wt.team1))
                 )
            )
          ORDER BY CASE LOWER(wt.division)
                     WHEN 'majors' THEN 0 WHEN 'aaa' THEN 1 ELSE 2 END,
                   wt.match_number NULLS LAST, wt.team1`,
        [Number(weekNumber), seasonId == null ? null : Number(seasonId)]
    );
    return r.rows;
}

/** Total thread count for the week — used to phrase "3 of 40 reported". */
async function countWeekThreads(weekNumber, seasonId = null) {
    if (!db()) return 0;
    const r = await pool.query(
        `SELECT COUNT(*)::int AS n FROM week_threads
          WHERE week_number = $1 AND ($2::int IS NULL OR season_id = $2 OR season_id IS NULL)`,
        [Number(weekNumber), seasonId == null ? null : Number(seasonId)]
    ).catch(() => ({ rows: [{ n: 0 }] }));
    return r.rows[0]?.n || 0;
}

/** `**Majors** — Aviators vs Fallen Angels` lines, grouped in division order. */
function formatUnreportedList(rows, limit = 40) {
    const shown = rows.slice(0, limit);
    const lines = shown.map((r) => `• **${r.division}** — ${r.team1} vs ${r.team2}`);
    if (rows.length > shown.length) lines.push(`…and ${rows.length - shown.length} more`);
    return lines.join('\n');
}

/**
 * Ping salary crew inside each unreported thread so the nudge lands where the
 * series would actually be reported. Best-effort per thread: one dead thread
 * must not stop the rest.
 *
 * @returns {Promise<{pinged:number, failed:number}>}
 */
async function pingUnreportedThreads(client, rows, weekNumber, requestedBy = null) {
    let pinged = 0;
    let failed = 0;
    if (!client) return { pinged, failed };

    for (const row of rows) {
        if (!row.thread_id) { failed += 1; continue; }
        try {
            // eslint-disable-next-line no-await-in-loop
            const thread = await client.channels.fetch(String(row.thread_id));
            if (!thread?.isTextBased()) { failed += 1; continue; }
            // Unarchive first or the send silently fails on an archived thread.
            if (thread.archived) {
                // eslint-disable-next-line no-await-in-loop
                await thread.setArchived(false).catch(() => {});
            }
            // eslint-disable-next-line no-await-in-loop
            await thread.send({
                content:
                    `<@&${ROLES.SALARY_CREW}> **Week ${weekNumber} series not reported.**\n` +
                    `${row.division} — **${row.team1}** vs **${row.team2}**\n` +
                    `This thread was going to be deleted${requestedBy ? ` (requested by ${requestedBy})` : ''}, ` +
                    'but the series has no confirmed report yet. Report it here before the week is closed.',
                allowedMentions: { roles: [ROLES.SALARY_CREW] },
            });
            pinged += 1;
        } catch (err) {
            failed += 1;
            Logger.error(
                `Unreported ping failed for thread ${row.thread_id} — ` +
                `${err?.code || ''} ${err?.message || err}`
            );
        }
    }
    Logger.info(`Week ${weekNumber}: pinged salary crew in ${pinged} unreported thread(s), ${failed} failed`);
    return { pinged, failed };
}

module.exports = {
    getUnreportedMatches,
    countWeekThreads,
    formatUnreportedList,
    pingUnreportedThreads,
};
