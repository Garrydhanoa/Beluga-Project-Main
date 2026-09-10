/**
 * Stats write + recompute layer (the domain core).
 *
 * Responsibilities:
 *   - commitSeries(): write a confirmed, player-matched series → stats_series,
 *     stats_games, stats_game_players (the source of truth) + identity upserts,
 *     all in one transaction, then recompute affected aggregates.
 *   - recompute*(): rebuild player season/lifetime + team season aggregates from
 *     the per-game rows (so edits/deletes/recalc all stay consistent). Rows with
 *     manual_override = true are preserved (staff edits win).
 *   - getStandings(): ordered standings with the H2H tiebreaker (FF excluded).
 *   - Beluga Score: weighted average of per-game averages (operator weights).
 *
 * All functions are no-ops / safe when the DB is unavailable.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

// Beluga Score weights (operator round-2): applied to per-game AVERAGES, then
// divided by the total weight (an AVERAGE.WEIGHTED, matching the old sheet).
// "demos" here = demos inflicted (the metric the old sheet's rating used).
const BELUGA_WEIGHTS = { score: 25, goals: 30, assists: 15, saves: 20, shots: 5, demos: 5 };
const BELUGA_WEIGHT_TOTAL = Object.values(BELUGA_WEIGHTS).reduce((a, b) => a + b, 0); // 100

// stats_series.forfeit_kind values.
//   'full'   — one team forfeited: a 1-0 series win, carried by one synthetic game row.
//   'double' — BOTH teams forfeited: no winner, no game rows, and each team is charged
//              the same 0-1 loss the loser of a full FF takes (see recomputeTeamSeason).
const FULL_FORFEIT = 'full';
const DOUBLE_FORFEIT = 'double';

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

/**
 * Beluga Score from per-game AVERAGES.
 * @param {{score,goals,assists,saves,shots,demos}} avg per-game averages
 * @returns {number} rounded to 2dp
 */
function belugaScore(avg) {
    const w = BELUGA_WEIGHTS;
    const raw =
        (Number(avg.score || 0) * w.score) +
        (Number(avg.goals || 0) * w.goals) +
        (Number(avg.assists || 0) * w.assists) +
        (Number(avg.saves || 0) * w.saves) +
        (Number(avg.shots || 0) * w.shots) +
        (Number(avg.demos || 0) * w.demos);
    return Math.round((raw / BELUGA_WEIGHT_TOTAL) * 100) / 100;
}

/** Beluga Score from TOTALS + games (computes the averages first). */
function belugaFromTotals(totals, games) {
    if (!games) return 0;
    return belugaScore({
        score: totals.score / games,
        goals: totals.goals / games,
        assists: totals.assists / games,
        saves: totals.saves / games,
        shots: totals.shots / games,
        demos: totals.demos_inflicted / games,
    });
}

// ---- identity ---------------------------------------------------------------

/** Look up a discord id by a Ballchasing account (for match auto-suggest). */
async function resolveDiscordByAccount(platform, platformId) {
    if (!db() || !platform || !platformId) return null;
    try {
        const r = await pool.query(
            `SELECT discord_id FROM stats_player_accounts WHERE platform = $1 AND platform_id = $2 LIMIT 1`,
            [platform, platformId]
        );
        return r.rows[0]?.discord_id || null;
    } catch (e) {
        Logger.error('resolveDiscordByAccount failed', e);
        return null;
    }
}

/** Upsert a ballchasing account → discord link and log name history (uses a txn client). */
async function upsertAccount(client, { discordId, platform, platformId, name, linkedBy }) {
    if (!discordId || !platform || !platformId) return;
    const existing = await client.query(
        `SELECT id, current_name FROM stats_player_accounts WHERE platform = $1 AND platform_id = $2 LIMIT 1`,
        [platform, platformId]
    );
    if (existing.rows.length) {
        const prevName = existing.rows[0].current_name;
        await client.query(
            `UPDATE stats_player_accounts
             SET discord_id = $1, current_name = COALESCE($2, current_name), last_seen = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [discordId, name || null, existing.rows[0].id]
        );
        if (name && name !== prevName) {
            await client.query(
                `INSERT INTO stats_name_history (discord_id, name, platform, platform_id, source) VALUES ($1,$2,$3,$4,'ballchasing')`,
                [discordId, name, platform, platformId]
            );
        }
    } else {
        await client.query(
            `INSERT INTO stats_player_accounts (discord_id, platform, platform_id, current_name, linked_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [discordId, platform, platformId, name || null, linkedBy || null]
        );
        await client.query(
            `INSERT INTO stats_name_history (discord_id, name, platform, platform_id, source) VALUES ($1,$2,$3,$4,'ballchasing')`,
            [discordId, name || null, platform, platformId]
        );
    }
}

// ---- audit ------------------------------------------------------------------

async function logAudit({ seriesId = null, action, actorDiscordId = null, actorName = null, actorSource = 'bot', detail = null }, client = null) {
    if (!db()) return;
    const q = (client || pool).query.bind(client || pool);
    try {
        await q(
            `INSERT INTO stats_audit_log (series_id, action, actor_discord_id, actor_name, actor_source, detail)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
            [seriesId, action, actorDiscordId, actorName, actorSource, detail ? JSON.stringify(detail) : null]
        );
    } catch (e) {
        Logger.error('logAudit failed', e);
    }
}

// ---- commit a series --------------------------------------------------------

/**
 * Write a fully-resolved series. Expects teamIds + discordIds already matched.
 * @returns {Promise<{seriesId:number, homeScore:number, awayScore:number}>}
 */
async function commitSeries(payload) {
    if (!db()) throw new Error('Database not available.');
    const {
        seasonId, division, week = null, isPlayoff = false, format = 'bo5',
        homeTeamId, awayTeamId, scheduleMatchId = null, threadId = null,
        group = {}, reportedByDiscordId = null, reportedVia = 'captain',
        isForfeit = false, forfeitKind = null, games = [],
    } = payload;

    // Series game score from the games (unless an explicit FF override is given).
    let homeScore = payload.homeScore;
    let awayScore = payload.awayScore;
    if (homeScore == null || awayScore == null) {
        homeScore = games.filter((g) => Number(g.homeGoals) > Number(g.awayGoals)).length;
        awayScore = games.filter((g) => Number(g.awayGoals) > Number(g.homeGoals)).length;
    }
    const winnerTeamId = homeScore > awayScore ? homeTeamId : awayScore > homeScore ? awayTeamId : null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const seriesRes = await client.query(
            `INSERT INTO stats_series (
                season_id, division, week, is_playoff, schedule_match_id, thread_id,
                home_team_id, away_team_id, home_score, away_score, winner_team_id,
                format, is_forfeit, forfeit_kind,
                ballchasing_group_id, ballchasing_group_url, ballchasing_group_name,
                status, reported_by_discord_id, reported_via, confirmed_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'confirmed',$18,$19,CURRENT_TIMESTAMP)
             RETURNING id`,
            [
                seasonId, division, week, isPlayoff, scheduleMatchId, threadId,
                homeTeamId, awayTeamId, homeScore, awayScore, winnerTeamId,
                format, isForfeit, forfeitKind,
                group.id || null, group.url || null, group.name || null,
                reportedByDiscordId, reportedVia,
            ]
        );
        const seriesId = seriesRes.rows[0].id;

        for (let gi = 0; gi < games.length; gi += 1) {
            const g = games[gi];
            const gWinner = Number(g.homeGoals) > Number(g.awayGoals) ? homeTeamId
                : Number(g.awayGoals) > Number(g.homeGoals) ? awayTeamId : null;
            const gameRes = await client.query(
                `INSERT INTO stats_games (
                    series_id, game_number, ballchasing_replay_id, ballchasing_replay_url,
                    map, duration_seconds, overtime, home_goals, away_goals, winner_team_id, is_forfeit, played_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                 RETURNING id`,
                [
                    seriesId, g.gameNumber ?? gi + 1, g.replayId || null, g.replayUrl || null,
                    g.map || null, g.durationSeconds || null, Boolean(g.overtime),
                    Number(g.homeGoals) || 0, Number(g.awayGoals) || 0, gWinner, Boolean(g.isForfeit),
                    g.playedAt ? new Date(g.playedAt) : null,
                ]
            );
            const gameId = gameRes.rows[0].id;

            for (const p of (g.players || [])) {
                await client.query(
                    `INSERT INTO stats_game_players (
                        game_id, series_id, season_id, division, is_playoff, team_id,
                        discord_id, platform, platform_id, ingame_name, is_sub,
                        score, goals, assists, saves, shots, shooting_pct,
                        demos_inflicted, demos_taken, mvp, played_seconds
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
                    [
                        gameId, seriesId, seasonId, division, isPlayoff, p.teamId || null,
                        p.discordId || null, p.platform || null, p.platformId || null, p.ingameName || null, Boolean(p.isSub),
                        Number(p.score) || 0, Number(p.goals) || 0, Number(p.assists) || 0, Number(p.saves) || 0, Number(p.shots) || 0,
                        p.shootingPct != null ? Number(p.shootingPct) : null,
                        Number(p.demosInflicted) || 0, Number(p.demosTaken) || 0, Boolean(p.mvp),
                        p.playedSeconds != null ? Math.round(Number(p.playedSeconds)) : null,
                    ]
                );
                if (p.discordId && p.platform && p.platformId) {
                    await upsertAccount(client, {
                        discordId: p.discordId, platform: p.platform, platformId: p.platformId,
                        name: p.ingameName, linkedBy: reportedByDiscordId,
                    });
                }
            }
        }

        await logAudit({
            seriesId, action: 'series_reported', actorDiscordId: reportedByDiscordId,
            actorSource: reportedVia === 'website' ? 'website' : 'bot',
            detail: { homeScore, awayScore, isForfeit, group: group.url || null },
        }, client);

        await client.query('COMMIT');

        // Recompute outside the txn (idempotent; reads committed data). Best-effort:
        // the series is already saved, so a recompute hiccup must not fail the report
        // (aggregates can always be rebuilt with recomputeAllForSeason).
        try {
            await recomputeForSeries(seriesId);
        } catch (recomputeErr) {
            Logger.error(`recompute after commit failed (series ${seriesId} is saved; rebuild later)`, recomputeErr);
        }

        return { seriesId, homeScore, awayScore, winnerTeamId };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Replace game rows (and their player stat lines) on an EXISTING series with
 * freshly parsed data. This is the manual-report importer's write path: staff
 * created the series by hand, then supplied a Ballchasing group or per-game
 * replay links, and the real stats replace whatever placeholder was there.
 *
 * commitSeries() creates a series; this one refits an existing one, sharing the
 * same player-row and identity-upsert handling.
 *
 * @param {number} seriesId
 * @param {object} o
 * @param {Array} o.games   same per-game shape commitSeries takes, plus an optional
 *                          `existingGameId` to refit that row instead of adding one.
 * @param {boolean} [o.wipeOtherGames=false]  drop every game row not listed (a group
 *                          link describes the WHOLE series, so it replaces everything;
 *                          per-game links only replace the games they belong to).
 * @param {boolean} [o.rescore=true]  re-derive series score + winner from the games
 *                          afterwards. Skipped for forfeits and staff-locked rows.
 * @param {string|null} [o.actorDiscordId]
 * @returns {Promise<{gamesWritten:number, playerRows:number, homeScore:number, awayScore:number}>}
 */
async function replaceSeriesGames(seriesId, {
    games = [], wipeOtherGames = false, rescore = true, actorDiscordId = null,
} = {}) {
    if (!db()) throw new Error('Database not available.');

    const sres = await pool.query(`SELECT * FROM stats_series WHERE id = $1`, [seriesId]);
    if (!sres.rows.length) throw new Error(`Series #${seriesId} does not exist.`);
    const series = sres.rows[0];
    const { season_id: seasonId, division, is_playoff: isPlayoff } = series;
    const homeTeamId = series.home_team_id;
    const awayTeamId = series.away_team_id;

    const client = await pool.connect();
    let playerRows = 0;
    try {
        await client.query('BEGIN');

        const keepIds = games.map((g) => g.existingGameId).filter((id) => id != null);
        if (wipeOtherGames) {
            if (keepIds.length) {
                await client.query(`DELETE FROM stats_games WHERE series_id = $1 AND id <> ALL($2::int[])`, [seriesId, keepIds]);
            } else {
                await client.query(`DELETE FROM stats_games WHERE series_id = $1`, [seriesId]);
            }
        }

        for (let gi = 0; gi < games.length; gi += 1) {
            const g = games[gi];
            const homeGoals = Number(g.homeGoals) || 0;
            const awayGoals = Number(g.awayGoals) || 0;
            const gWinner = homeGoals > awayGoals ? homeTeamId : awayGoals > homeGoals ? awayTeamId : null;
            const gameNumber = g.gameNumber ?? gi + 1;
            const vals = [
                g.replayId || null, g.replayUrl || null, g.map || null,
                g.durationSeconds || null, Boolean(g.overtime),
                homeGoals, awayGoals, gWinner, Boolean(g.isForfeit),
                g.playedAt ? new Date(g.playedAt) : null,
            ];

            let gameId = g.existingGameId ?? null;
            if (gameId != null) {
                // Refit the row staff already created for this game, keeping its id
                // (so anything referencing it stays valid) and dropping its old lines.
                await client.query(
                    `UPDATE stats_games SET
                        ballchasing_replay_id=$1, ballchasing_replay_url=$2, map=$3,
                        duration_seconds=$4, overtime=$5, home_goals=$6, away_goals=$7,
                        winner_team_id=$8, is_forfeit=$9, played_at=$10, game_number=$11
                     WHERE id=$12 AND series_id=$13`,
                    [...vals, gameNumber, gameId, seriesId]
                );
                await client.query(`DELETE FROM stats_game_players WHERE game_id = $1`, [gameId]);
            } else {
                const ins = await client.query(
                    `INSERT INTO stats_games (
                        series_id, game_number, ballchasing_replay_id, ballchasing_replay_url,
                        map, duration_seconds, overtime, home_goals, away_goals, winner_team_id, is_forfeit, played_at
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
                    [seriesId, gameNumber, ...vals]
                );
                gameId = ins.rows[0].id;
            }

            for (const p of (g.players || [])) {
                await client.query(
                    `INSERT INTO stats_game_players (
                        game_id, series_id, season_id, division, is_playoff, team_id,
                        discord_id, platform, platform_id, ingame_name, is_sub,
                        score, goals, assists, saves, shots, shooting_pct,
                        demos_inflicted, demos_taken, mvp, played_seconds
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
                    [
                        gameId, seriesId, seasonId, division, isPlayoff, p.teamId || null,
                        p.discordId || null, p.platform || null, p.platformId || null, p.ingameName || null, Boolean(p.isSub),
                        Number(p.score) || 0, Number(p.goals) || 0, Number(p.assists) || 0, Number(p.saves) || 0, Number(p.shots) || 0,
                        p.shootingPct != null ? Number(p.shootingPct) : null,
                        Number(p.demosInflicted) || 0, Number(p.demosTaken) || 0, Boolean(p.mvp),
                        p.playedSeconds != null ? Math.round(Number(p.playedSeconds)) : null,
                    ]
                );
                playerRows += 1;
                if (p.discordId && p.platform && p.platformId) {
                    await upsertAccount(client, {
                        discordId: p.discordId, platform: p.platform, platformId: p.platformId,
                        name: p.ingameName, linkedBy: actorDiscordId,
                    });
                }
            }
        }

        // Re-derive the series score from ALL its games (imported + any left alone).
        // Forfeits keep their fixed score, and a staff-locked row is never touched.
        let homeScore = series.home_score;
        let awayScore = series.away_score;
        if (rescore && !series.is_forfeit && !series.manual_override) {
            const tally = await client.query(
                `SELECT COUNT(*) FILTER (WHERE winner_team_id = $2)::int AS hw,
                        COUNT(*) FILTER (WHERE winner_team_id = $3)::int AS aw
                 FROM stats_games WHERE series_id = $1`,
                [seriesId, homeTeamId, awayTeamId]
            );
            homeScore = tally.rows[0]?.hw || 0;
            awayScore = tally.rows[0]?.aw || 0;
            const winner = homeScore > awayScore ? homeTeamId : awayScore > homeScore ? awayTeamId : null;
            await client.query(
                `UPDATE stats_series SET home_score=$1, away_score=$2, winner_team_id=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
                [homeScore, awayScore, winner, seriesId]
            );
        }

        await client.query('COMMIT');

        // Same contract as commitSeries: the write is already durable, so a recompute
        // hiccup must not fail the import (rebuild later with recomputeAllForSeason).
        try {
            await recomputeForSeries(seriesId);
        } catch (recomputeErr) {
            Logger.error(`recompute after import failed (series ${seriesId} is saved; rebuild later)`, recomputeErr);
        }

        return { gamesWritten: games.length, playerRows, homeScore, awayScore };
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        client.release();
    }
}

// ---- recompute --------------------------------------------------------------

/** Recompute everything touched by a series (its two teams + all its players). */
async function recomputeForSeries(seriesId) {
    if (!db()) return;
    const s = await pool.query(`SELECT * FROM stats_series WHERE id = $1`, [seriesId]);
    if (!s.rows.length) return;
    const series = s.rows[0];
    const players = await pool.query(
        `SELECT DISTINCT discord_id FROM stats_game_players WHERE series_id = $1 AND discord_id IS NOT NULL`,
        [seriesId]
    );
    await recomputeTeamSeason(series.season_id, series.division, series.home_team_id, series.is_playoff);
    await recomputeTeamSeason(series.season_id, series.division, series.away_team_id, series.is_playoff);
    for (const row of players.rows) {
        // eslint-disable-next-line no-await-in-loop
        await recomputePlayer(row.discord_id);
    }
}

/** Rebuild a player's per-season and lifetime aggregates from their game rows. */
async function recomputePlayer(discordId) {
    if (!db() || !discordId) return;
    // Per-season/division/playoff aggregates from the source rows.
    const agg = await pool.query(
        `SELECT season_id, division, is_playoff,
            (ARRAY_AGG(team_id ORDER BY id DESC))[1] AS team_id,
            COUNT(*)::int AS games,
            COALESCE(SUM(score),0)::int AS score, COALESCE(SUM(goals),0)::int AS goals,
            COALESCE(SUM(assists),0)::int AS assists, COALESCE(SUM(saves),0)::int AS saves,
            COALESCE(SUM(shots),0)::int AS shots,
            COALESCE(SUM(demos_inflicted),0)::int AS demos_inflicted,
            COALESCE(SUM(demos_taken),0)::int AS demos_taken,
            COALESCE(SUM(CASE WHEN mvp THEN 1 ELSE 0 END),0)::int AS mvps
         FROM stats_game_players
         WHERE discord_id = $1
         GROUP BY season_id, division, is_playoff`,
        [discordId]
    );

    // Replace non-overridden season rows; preserve manual_override rows.
    await pool.query(`DELETE FROM stats_player_season WHERE discord_id = $1 AND manual_override = FALSE`, [discordId]);
    for (const r of agg.rows) {
        const beluga = belugaFromTotals(r, r.games);
        // eslint-disable-next-line no-await-in-loop
        await pool.query(
            `INSERT INTO stats_player_season (
                discord_id, season_id, division, is_playoff, team_id, games,
                score, goals, assists, saves, shots, demos_inflicted, demos_taken, mvps, beluga_score, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CURRENT_TIMESTAMP)
             ON CONFLICT (discord_id, season_id, division, is_playoff) DO NOTHING`,
            [discordId, r.season_id, r.division, r.is_playoff, r.team_id, r.games,
             r.score, r.goals, r.assists, r.saves, r.shots, r.demos_inflicted, r.demos_taken, r.mvps, beluga]
        );
    }

    // Lifetime aggregates (split regular vs playoff), seasons_played = distinct seasons.
    const life = await pool.query(
        `SELECT is_playoff,
            COUNT(*)::int AS games,
            COUNT(DISTINCT season_id)::int AS seasons_played,
            COALESCE(SUM(score),0)::int AS score, COALESCE(SUM(goals),0)::int AS goals,
            COALESCE(SUM(assists),0)::int AS assists, COALESCE(SUM(saves),0)::int AS saves,
            COALESCE(SUM(shots),0)::int AS shots,
            COALESCE(SUM(demos_inflicted),0)::int AS demos_inflicted,
            COALESCE(SUM(demos_taken),0)::int AS demos_taken,
            COALESCE(SUM(CASE WHEN mvp THEN 1 ELSE 0 END),0)::int AS mvps
         FROM stats_game_players WHERE discord_id = $1 GROUP BY is_playoff`,
        [discordId]
    );
    await pool.query(`DELETE FROM stats_player_lifetime WHERE discord_id = $1`, [discordId]);
    for (const r of life.rows) {
        const beluga = belugaFromTotals(r, r.games);
        // eslint-disable-next-line no-await-in-loop
        await pool.query(
            `INSERT INTO stats_player_lifetime (
                discord_id, is_playoff, games, seasons_played, score, goals, assists, saves, shots,
                demos_inflicted, demos_taken, mvps, beluga_score, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)`,
            [discordId, r.is_playoff, r.games, r.seasons_played, r.score, r.goals, r.assists, r.saves, r.shots,
             r.demos_inflicted, r.demos_taken, r.mvps, beluga]
        );
    }
}

/** Rebuild a team's season aggregate (totals + series/game W-L + goals) from source rows. */
async function recomputeTeamSeason(seasonId, division, teamId, isPlayoff) {
    if (!db() || !teamId) return;

    // Preserve a staff-frozen row.
    const ov = await pool.query(
        `SELECT manual_override FROM stats_team_season WHERE season_id=$1 AND division=$2 AND team_id=$3 AND is_playoff=$4`,
        [seasonId, division, teamId, isPlayoff]
    );
    if (ov.rows[0]?.manual_override) return;

    // Player-derived team stat totals + games played (distinct games this team appears in).
    const totals = await pool.query(
        `SELECT COUNT(DISTINCT game_id)::int AS games_played,
            COALESCE(SUM(score),0)::int AS score, COALESCE(SUM(goals),0)::int AS goals,
            COALESCE(SUM(assists),0)::int AS assists, COALESCE(SUM(saves),0)::int AS saves,
            COALESCE(SUM(shots),0)::int AS shots,
            COALESCE(SUM(demos_inflicted),0)::int AS demos_inflicted,
            COALESCE(SUM(demos_taken),0)::int AS demos_taken
         FROM stats_game_players
         WHERE team_id=$1 AND season_id=$2 AND division=$3 AND is_playoff=$4`,
        [teamId, seasonId, division, isPlayoff]
    );
    const t = totals.rows[0];

    // Series + game W/L + goals from confirmed series for this team.
    const sres = await pool.query(
        `SELECT s.id, s.home_team_id, s.away_team_id, s.winner_team_id, s.is_forfeit, s.forfeit_kind
         FROM stats_series s
         WHERE s.season_id=$1 AND s.division=$2 AND s.is_playoff=$3 AND s.status='confirmed'
           AND (s.home_team_id=$4 OR s.away_team_id=$4)`,
        [seasonId, division, isPlayoff, teamId]
    );
    let seriesWins = 0; let seriesLosses = 0;
    let gameWins = 0; let gameLosses = 0; let goalsFor = 0; let goalsAgainst = 0;
    for (const s of sres.rows) {
        // Double forfeit: nobody won, so BOTH teams are charged the same 0-1 loss a
        // normal FF's loser takes. It has no game rows, so the +1 game loss and the
        // +1 goal against are applied here — a NULL winner would otherwise fall
        // through both branches below and count as nothing at all.
        if (s.is_forfeit && s.forfeit_kind === DOUBLE_FORFEIT) {
            seriesLosses += 1; gameLosses += 1; goalsAgainst += 1;
            continue;
        }
        if (s.winner_team_id === teamId) seriesWins += 1;
        else if (s.winner_team_id != null) seriesLosses += 1;
        // eslint-disable-next-line no-await-in-loop
        const gms = await pool.query(`SELECT home_goals, away_goals, winner_team_id FROM stats_games WHERE series_id=$1`, [s.id]);
        for (const g of gms.rows) {
            const isHome = s.home_team_id === teamId; // home/away is on the series, not the game

            const forGoals = isHome ? g.home_goals : g.away_goals;
            const againstGoals = isHome ? g.away_goals : g.home_goals;
            goalsFor += Number(forGoals) || 0;
            goalsAgainst += Number(againstGoals) || 0;
            if (g.winner_team_id === teamId) gameWins += 1;
            else if (g.winner_team_id != null) gameLosses += 1;
        }
    }

    const beluga = belugaFromTotals(t, t.games_played);
    await pool.query(
        `INSERT INTO stats_team_season (
            season_id, division, team_id, is_playoff,
            series_wins, series_losses, game_wins, game_losses, goals_for, goals_against, games_played,
            score, goals, assists, saves, shots, demos_inflicted, demos_taken, beluga_score, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,CURRENT_TIMESTAMP)
         ON CONFLICT (season_id, division, team_id, is_playoff) DO UPDATE SET
            series_wins=EXCLUDED.series_wins, series_losses=EXCLUDED.series_losses,
            game_wins=EXCLUDED.game_wins, game_losses=EXCLUDED.game_losses,
            goals_for=EXCLUDED.goals_for, goals_against=EXCLUDED.goals_against, games_played=EXCLUDED.games_played,
            score=EXCLUDED.score, goals=EXCLUDED.goals, assists=EXCLUDED.assists, saves=EXCLUDED.saves,
            shots=EXCLUDED.shots, demos_inflicted=EXCLUDED.demos_inflicted, demos_taken=EXCLUDED.demos_taken,
            beluga_score=EXCLUDED.beluga_score, updated_at=CURRENT_TIMESTAMP`,
        [seasonId, division, teamId, isPlayoff,
         seriesWins, seriesLosses, gameWins, gameLosses, goalsFor, goalsAgainst, t.games_played,
         t.score, t.goals, t.assists, t.saves, t.shots, t.demos_inflicted, t.demos_taken, beluga]
    );
}

/** Full rebuild for a season (the staff "recalculate" button). */
async function recomputeAllForSeason(seasonId) {
    if (!db()) return;
    // Discover teams from BOTH the per-player rows AND the series themselves, so a team
    // whose only series has no player rows (all-skipped, or FF-only — /report-ff makes a
    // synthetic game with no player rows) still gets its standings rebuilt. Discovering
    // only via stats_game_players silently skips such teams. recomputeForSeries already
    // derives teams from the series row; this keeps "Recalculate all" consistent with it.
    const teams = await pool.query(
        `SELECT DISTINCT season_id, division, team_id, is_playoff FROM (
            SELECT season_id, division, team_id, is_playoff
              FROM stats_game_players WHERE season_id=$1 AND team_id IS NOT NULL
            UNION
            SELECT season_id, division, home_team_id AS team_id, is_playoff
              FROM stats_series WHERE season_id=$1 AND status='confirmed' AND home_team_id IS NOT NULL
            UNION
            SELECT season_id, division, away_team_id AS team_id, is_playoff
              FROM stats_series WHERE season_id=$1 AND status='confirmed' AND away_team_id IS NOT NULL
        ) u`, [seasonId]
    );
    for (const r of teams.rows) {
        // eslint-disable-next-line no-await-in-loop
        await recomputeTeamSeason(r.season_id, r.division, r.team_id, r.is_playoff);
    }
    const players = await pool.query(
        `SELECT DISTINCT discord_id FROM stats_game_players WHERE season_id=$1 AND discord_id IS NOT NULL`, [seasonId]
    );
    for (const r of players.rows) {
        // eslint-disable-next-line no-await-in-loop
        await recomputePlayer(r.discord_id);
    }
}

// ---- standings (with H2H tiebreaker) ----------------------------------------

/**
 * Ordered regular-season standings for a division.
 * Tiebreak: Wins ↓ → Losses ↑ → H2H (FF excluded; mini-table for 3+) →
 *           Game Diff ↓ → Goal Diff ↓ → Beluga rating ↓.
 */
async function getStandings(seasonId, division) {
    if (!db()) return [];
    const rowsRes = await pool.query(
        `SELECT ts.team_id, t.name AS team_name,
            ts.series_wins AS wins, ts.series_losses AS losses,
            (ts.game_wins - ts.game_losses) AS game_diff,
            (ts.goals_for - ts.goals_against) AS goal_diff,
            ts.beluga_score AS rating
         FROM stats_team_season ts
         LEFT JOIN teams t ON t.id = ts.team_id
         WHERE ts.season_id=$1 AND ts.division=$2 AND ts.is_playoff=FALSE`,
        [seasonId, division]
    );
    const teams = rowsRes.rows.map((r) => ({
        teamId: r.team_id, teamName: r.team_name,
        wins: Number(r.wins || 0), losses: Number(r.losses || 0),
        gameDiff: Number(r.game_diff || 0), goalDiff: Number(r.goal_diff || 0),
        rating: Number(r.rating || 0),
    }));
    if (teams.length <= 1) return teams.map((t, i) => ({ ...t, place: i + 1 }));

    // Non-FF confirmed series for H2H (scores included for the in-H2H game diff).
    const seriesRes = await pool.query(
        `SELECT home_team_id, away_team_id, winner_team_id, home_score, away_score
         FROM stats_series
         WHERE season_id=$1 AND division=$2 AND is_playoff=FALSE AND status='confirmed' AND is_forfeit=FALSE`,
        [seasonId, division]
    );
    const series = seriesRes.rows;

    // H2H record + game diff of team A vs a SET of opponents (excludes FF already).
    // Operator rule D4: tied teams rank by H2H record; if still tied, by game
    // differential WITHIN the H2H matchups (not overall).
    const h2hWinsWithin = (teamId, group) => {
        const ids = new Set(group.map((t) => t.teamId));
        let wins = 0; let losses = 0; let gameDiff = 0;
        for (const s of series) {
            const isHome = s.home_team_id === teamId && ids.has(s.away_team_id);
            const isAway = s.away_team_id === teamId && ids.has(s.home_team_id);
            if (!isHome && !isAway) continue;
            if (s.winner_team_id === teamId) wins += 1;
            else if (s.winner_team_id != null) losses += 1;
            const own = Number(isHome ? s.home_score : s.away_score) || 0;
            const opp = Number(isHome ? s.away_score : s.home_score) || 0;
            gameDiff += own - opp;
        }
        return { wins, losses, gameDiff };
    };

    const cmpBase = (a, b) =>
        b.wins - a.wins || a.losses - b.losses; // primary: W ↓, L ↑

    const cmpFallback = (a, b) =>
        b.gameDiff - a.gameDiff || b.goalDiff - a.goalDiff || b.rating - a.rating;

    // Sort: first by W/L, then resolve each tie-cluster by H2H, then fallbacks.
    teams.sort((a, b) => cmpBase(a, b) || cmpFallback(a, b));
    const out = [];
    let i = 0;
    while (i < teams.length) {
        let j = i + 1;
        while (j < teams.length && teams[j].wins === teams[i].wins && teams[j].losses === teams[i].losses) j += 1;
        const cluster = teams.slice(i, j);
        if (cluster.length > 1) {
            const withH2H = cluster.map((t) => ({ ...t, _h2h: h2hWinsWithin(t.teamId, cluster) }));
            withH2H.sort((a, b) =>
                (b._h2h.wins - b._h2h.losses) - (a._h2h.wins - a._h2h.losses)
                || b._h2h.gameDiff - a._h2h.gameDiff
                || cmpFallback(a, b));
            out.push(...withH2H.map(({ _h2h, ...t }) => t));
        } else {
            out.push(cluster[0]);
        }
        i = j;
    }
    return out.map((t, idx) => ({ ...t, place: idx + 1 }));
}

module.exports = {
    BELUGA_WEIGHTS,
    FULL_FORFEIT,
    DOUBLE_FORFEIT,
    belugaScore,
    belugaFromTotals,
    resolveDiscordByAccount,
    commitSeries,
    replaceSeriesGames,
    recomputeForSeries,
    recomputePlayer,
    recomputeTeamSeason,
    recomputeAllForSeason,
    getStandings,
    logAudit,
};
