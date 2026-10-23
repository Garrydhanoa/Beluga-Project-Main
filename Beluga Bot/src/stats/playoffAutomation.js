/**
 * What happens after a playoff series is confirmed.
 *
 * One entry point — `onPlayoffSeriesConfirmed` — called from every path that can
 * produce a confirmed playoff result: the in-thread report flow, the in-thread
 * forfeit button, and /report-ff. It:
 *
 *   1. links the series to its bracket matchup and recomputes the bracket,
 *   2. opens the next round's threads once a round is fully decided,
 *   3. records the division champion when the Finals is decided,
 *   4. posts the updated bracket image.
 *
 * Each step is independently switchable from the website's Playoffs tab, and
 * each is wrapped: playoff automation must never be able to fail a report that
 * has already been committed to stats_series.
 *
 * Nothing here creates Discord threads directly — it writes `week_threads` rows
 * exactly like the website does, and the bot's existing watcher turns them into
 * real threads on its next tick. That keeps ONE creation path, which is a
 * standing rule for week threads.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const {
    recomputeBracket, ensureBracketGraph, loadBracket, getPlayoffSettings,
    weekForRound, roundNameFor,
} = require('./playoffBracket');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

/**
 * Materialize week_threads rows for a round's matchups.
 * Skips anything already threaded or already decided. Returns how many it queued.
 */
async function createThreadsForRound(seasonId, division, roundNumber) {
    const bracket = await loadBracket(seasonId, division);
    if (!bracket) return { created: 0 };

    const round = bracket.rounds.find((r) => r.round_number === Number(roundNumber));
    if (!round) return { created: 0 };

    const weekNumber = weekForRound(round.round_number);
    let created = 0;

    for (const m of round.matchups) {
        if (!m.home_team_name || !m.away_team_name) continue;
        if (m.winner_team_id) continue;

        const dupe = await pool.query(
            `SELECT 1 FROM week_threads
              WHERE season_id = $1 AND week_number = $2 AND LOWER(division) = LOWER($3)
                AND ((LOWER(team1) = LOWER($4) AND LOWER(team2) = LOWER($5))
                  OR (LOWER(team1) = LOWER($5) AND LOWER(team2) = LOWER($4)))`,
            [seasonId, weekNumber, division, m.home_team_name, m.away_team_name]
        );
        if (dupe.rows.length) continue;

        // match_number is set from the bracket slot, so playoff threads stop all
        // reporting themselves as "Match: 1".
        await pool.query(
            `INSERT INTO week_threads (season_id, week_number, division, team1, team2, match_number)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [seasonId, weekNumber, division, m.home_team_name, m.away_team_name, m.order_index]
        );
        created += 1;
    }

    return { created, round: round.name, week: weekNumber };
}

/** Record the division champion. Never overwrites one that is already set. */
async function recordChampion(seasonId, division, teamId) {
    const exists = await pool.query(
        `SELECT id FROM season_champions WHERE season_id = $1 AND division = $2`,
        [seasonId, division]
    );
    if (exists.rows.length) return false; // manual wins

    await pool.query(
        `INSERT INTO season_champions (season_id, division, team_id, notes)
         VALUES ($1, $2, $3, 'Auto-recorded from the reported playoff finals series')`,
        [seasonId, division, teamId]
    );
    return true;
}

/** Post the bracket image (and a line of context) into the configured stats channel. */
async function announceBracket(client, seasonId, division, { headline }) {
    if (!client) return;
    try {
        const { getConfig } = require('../utils/appConfig');
        const channelId = await getConfig('stats_channel_id');
        if (!channelId) return;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) return;

        const { buildBracketCard } = require('./bracketCard');
        const card = await buildBracketCard(seasonId, division).catch(() => null);

        const { AttachmentBuilder } = require('discord.js');
        await channel.send({
            content: headline,
            files: card ? [new AttachmentBuilder(card, { name: 'bracket.png' })] : [],
        });
    } catch (err) {
        Logger.error(`playoff announce failed (${division}) — ${err.message}`);
    }
}

/**
 * The whole post-confirmation chain for a playoff series.
 *
 * `series` needs { seasonId, division, week, homeTeamId, awayTeamId, seriesId }.
 * Safe to call for a non-playoff series (it returns immediately), and safe to
 * call twice — recomputeBracket is idempotent.
 */
async function onPlayoffSeriesConfirmed(client, series) {
    if (!db()) return null;
    const { seasonId, division } = series || {};
    if (!seasonId || !division) return null;

    try {
        const settings = await getPlayoffSettings();
        if (!settings.autoAdvance) {
            Logger.info(`Playoff auto-advance is OFF — ${division} bracket left alone.`);
            return null;
        }

        // A bracket drawn before the graph columns existed has no next_matchup_id,
        // so wire it first. Idempotent.
        await ensureBracketGraph(seasonId, division);
        const result = await recomputeBracket(seasonId, division);
        if (!result.totalRounds) return null;

        const bracket = await loadBracket(seasonId, division);

        // --- next round's threads ---
        if (settings.autoThreads && result.roundsCompleted.length) {
            const highest = Math.max(...result.roundsCompleted);
            const nextRound = highest + 1;
            if (nextRound <= result.totalRounds) {
                const made = await createThreadsForRound(seasonId, division, nextRound);
                if (made.created) {
                    Logger.success(`${division}: round ${highest} complete — queued ${made.created} ${made.round} thread(s)`);
                    if (settings.autoAnnounce) {
                        await announceBracket(client, seasonId, division, {
                            headline: `**${division} ${roundNameFor(highest, result.totalRounds)} are complete.** `
                                + `${made.round} threads are being created now.`,
                        });
                    }
                }
            }
        }

        // --- champion ---
        if (settings.autoChampion && result.champion) {
            const recorded = await recordChampion(seasonId, division, result.champion);
            if (recorded) {
                const name = bracket?.rounds?.[bracket.rounds.length - 1]?.matchups?.[0]?.winner_team_name || 'The winner';
                Logger.success(`${division}: champion recorded — team ${result.champion}`);
                if (settings.autoAnnounce) {
                    await announceBracket(client, seasonId, division, {
                        headline: `**${name} are the ${division} champions.**`,
                    });
                }
            }
        }

        return result;
    } catch (err) {
        // Never let bracket automation fail a report that is already recorded.
        Logger.error(`playoff automation failed (${division}) — ${err.message}`);
        return null;
    }
}

module.exports = {
    onPlayoffSeriesConfirmed,
    createThreadsForRound,
    recordChampion,
    announceBracket,
};
