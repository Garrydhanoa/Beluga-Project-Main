/**
 * Manual-report stats importer.
 *
 * Staff report a series from the website admin panel (teams, week, scores) and
 * supply EITHER one Ballchasing group link for the whole series OR one replay
 * link per game — or neither, and type the numbers. This module is what turns
 * those links into real per-player stats, so a hand-reported series ends up
 * indistinguishable from one reported through the normal captain flow.
 *
 * Why it lives in the bot: the Ballchasing API key, the rate limiter, the parser
 * and the side-matching logic are all here. The website enqueues a job row and
 * the poller (seriesImportPoller.js) calls in.
 *
 * Group link  → describes the WHOLE series, so it replaces every game row.
 * Replay links→ replace only the games they are attached to; games staff typed
 *               by hand with no link keep their scores.
 *
 * Identity: players are matched by remembered Ballchasing account → roster display
 * name, exactly as the captain flow does. Anything unmatched is written with a
 * NULL discord_id rather than discarded — the "Unlinked Players" panel on the
 * admin Players tab is where those get attached to the right person.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const statsStore = require('./statsStore');
const { parseSeries, parseReplayList } = require('./seriesParser');
const { getTeamRoster } = require('./report/threadContext');
const { assignSides, autoSuggest } = require('./report/sideMatch');
const { buildSalaryResolver, checkSeriesCaps } = require('./report/salaryCap');

function db() { return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable; }

/** Parsed team players → the slot shape autoSuggest() fills in. */
function initSlots(parsedTeam) {
    return (parsedTeam.players || []).map((p, i) => ({
        index: i,
        pkey: p.pkey,
        name: (p.names && p.names[0]) || null,
        platform: p.platform,
        platformId: p.platformId,
        discordId: null,
    }));
}

/**
 * Import Ballchasing stats into an existing series.
 * @param {number} seriesId
 * @param {object} [o]
 * @param {string|null} [o.actorDiscordId]  who asked (for identity linked_by + audit)
 * @param {string|null} [o.actorName]
 * @returns {Promise<object>} a result summary — safe to store as the job's JSON
 */
async function importSeriesStats(seriesId, { actorDiscordId = null, actorName = null } = {}) {
    if (!db()) throw new Error('Database not available.');

    const sres = await pool.query(`SELECT * FROM stats_series WHERE id = $1`, [seriesId]);
    if (!sres.rows.length) throw new Error(`Series #${seriesId} does not exist.`);
    const series = sres.rows[0];
    if (series.manual_override) {
        throw new Error('This series is locked (manual override). Unlock it before importing.');
    }

    const existingGames = (await pool.query(
        `SELECT id, game_number, ballchasing_replay_url FROM stats_games
         WHERE series_id = $1 ORDER BY game_number, id`,
        [seriesId]
    )).rows;
    const linked = existingGames.filter((g) => g.ballchasing_replay_url);

    const format = series.format === 'bo7' ? 'bo7' : 'bo5';

    // ---- fetch + parse ------------------------------------------------------
    // Per-game links are more specific than the group, so they win when present.
    let parsed;
    let source;
    if (linked.length) {
        source = 'replays';
        parsed = await parseReplayList({
            replayUrls: linked.map((g) => g.ballchasing_replay_url),
            format,
            requireComplete: false,
        });
    } else if (series.ballchasing_group_url) {
        source = 'group';
        parsed = await parseSeries({
            groupUrl: series.ballchasing_group_url,
            format,
            requireComplete: false,
        });
    } else {
        throw new Error('This series has no Ballchasing group link and no per-game replay links — nothing to import.');
    }

    if (parsed.fatal || !parsed.ok) {
        const why = (parsed.issues || []).filter((i) => i.severity === 'reject').map((i) => i.message);
        throw new Error(why.length ? why.join(' ') : 'Ballchasing could not be read.');
    }
    if (!parsed.games?.length) throw new Error('No games came back from Ballchasing.');

    // ---- which parsed cluster is the home team? -----------------------------
    const [homeRoster, awayRoster] = await Promise.all([
        getTeamRoster(series.season_id, series.home_team_id),
        getTeamRoster(series.season_id, series.away_team_id),
    ]);
    const { homeIdx, confident } = await assignSides(parsed, homeRoster, awayRoster);
    const awayIdx = homeIdx === 0 ? 1 : 0;

    // ---- match players ------------------------------------------------------
    const homeSlots = await autoSuggest(initSlots(parsed.teams[homeIdx]), homeRoster);
    const awaySlots = await autoSuggest(initSlots(parsed.teams[awayIdx]), awayRoster);
    const discordByPkey = new Map();
    for (const s of [...homeSlots, ...awaySlots]) if (s.discordId) discordByPkey.set(s.pkey, s.discordId);

    const homeRosterIds = new Set(homeRoster.map((m) => m.discordId));
    const awayRosterIds = new Set(awayRoster.map((m) => m.discordId));
    const unmatched = [...homeSlots, ...awaySlots].filter((s) => !s.discordId).map((s) => s.name || s.pkey);

    // ---- build the game payload --------------------------------------------
    const lineFor = (p, teamId, rosterIds) => {
        const discordId = discordByPkey.get(p.pkey) || null;
        return {
            teamId,
            discordId,
            platform: p.platform || null,
            platformId: p.platformId || null,
            ingameName: p.name || null,
            // No discord id means we can't prove they're rostered — treat as a sub,
            // same as the captain flow does for an unmatched player.
            isSub: discordId ? !rosterIds.has(discordId) : true,
            score: p.score, goals: p.goals, assists: p.assists, saves: p.saves, shots: p.shots,
            shootingPct: p.shootingPct,
            demosInflicted: p.demoInflicted, demosTaken: p.demoTaken,
            mvp: p.mvp, playedSeconds: p.playedSeconds,
        };
    };

    const games = parsed.games.map((g, i) => {
        const homePlayers = (homeIdx === 0 ? g.team0Players : g.team1Players) || [];
        const awayPlayers = (homeIdx === 0 ? g.team1Players : g.team0Players) || [];
        return {
            // Per-game links refit the row staff already made; a group rebuilds from scratch.
            existingGameId: source === 'replays' ? linked[i]?.id ?? null : null,
            gameNumber: source === 'replays' ? (linked[i]?.game_number ?? i + 1) : i + 1,
            replayId: g.replayId,
            replayUrl: g.url,
            durationSeconds: g.duration,
            overtime: Boolean(g.overtime),
            playedAt: g.date || null,
            homeGoals: homeIdx === 0 ? g.team0Goals : g.team1Goals,
            awayGoals: homeIdx === 0 ? g.team1Goals : g.team0Goals,
            players: [
                ...homePlayers.map((p) => lineFor(p, series.home_team_id, homeRosterIds)),
                ...awayPlayers.map((p) => lineFor(p, series.away_team_id, awayRosterIds)),
            ],
        };
    });

    // ---- salary cap: ADVISORY ONLY -----------------------------------------
    // Staff are backfilling history here. A cap violation from weeks ago is worth
    // telling them about, but it must never stop the record being written.
    let capWarnings = [];
    try {
        const caps = (await pool.query(`SELECT onfield_caps FROM season_config WHERE season_id = $1`, [series.season_id]))
            .rows[0]?.onfield_caps || {};
        const names = (await pool.query(`SELECT id, name FROM teams WHERE id IN ($1,$2)`, [series.home_team_id, series.away_team_id])).rows;
        const nameOf = new Map(names.map((t) => [t.id, t.name]));
        const { sourceOk, salaryOf } = await buildSalaryResolver();
        // Only Discord-linked players can be priced; unmatched ones are excluded so
        // they don't read as "no salary on file".
        const forSide = (g, teamId) => g.players
            .filter((p) => p.teamId === teamId && p.discordId)
            .map((p) => ({ discordId: p.discordId, name: p.ingameName }));
        const cap = checkSeriesCaps({
            division: series.division,
            caps,
            games: games.map((g) => ({
                gameNumber: g.gameNumber,
                homePlayers: forSide(g, series.home_team_id),
                awayPlayers: forSide(g, series.away_team_id),
            })),
            salaryOf,
            sourceOk,
            teamNames: { home: nameOf.get(series.home_team_id), away: nameOf.get(series.away_team_id) },
        });
        capWarnings = (cap.violations || []).map(
            (v) => `${v.team} were ${v.over} over the ${v.cap} cap in game ${v.game} (on-field total ${v.total}).`
        );
        if (cap.missing?.length) {
            const who = [...new Set(cap.missing.map((m) => m.name).filter(Boolean))];
            capWarnings.push(`No salary on file for ${who.length || cap.missing.length} player(s)${who.length ? ` (${who.slice(0, 5).join(', ')})` : ''}, so those games could not be cap-checked.`);
        }
    } catch (err) {
        Logger.error(`salary cap check failed during import of series ${seriesId} (advisory only)`, err);
    }

    // ---- write --------------------------------------------------------------
    const written = await statsStore.replaceSeriesGames(seriesId, {
        games,
        wipeOtherGames: source === 'group',
        rescore: true,
        actorDiscordId,
    });

    const warnings = [
        ...(parsed.issues || []).filter((i) => i.severity !== 'info').map((i) => i.message),
        ...(confident ? [] : ['Home/away sides were a low-confidence guess — check them, and use "Swap sides" if they are the wrong way round.']),
        ...(unmatched.length ? [`${unmatched.length} player(s) could not be matched to a Discord account (${unmatched.slice(0, 6).join(', ')}). Their stats were kept — attach them from the Unlinked Players panel on the Players tab.`] : []),
        ...capWarnings.map((w) => `Salary cap: ${w}`),
    ];

    await statsStore.logAudit({
        seriesId,
        action: 'series_imported',
        actorDiscordId,
        actorName,
        actorSource: 'website',
        detail: {
            source,
            games: written.gamesWritten,
            playerRows: written.playerRows,
            score: `${written.homeScore}-${written.awayScore}`,
            unmatched: unmatched.length,
        },
    });

    return {
        source,
        gamesWritten: written.gamesWritten,
        playerRows: written.playerRows,
        homeScore: written.homeScore,
        awayScore: written.awayScore,
        sidesConfident: confident,
        unmatchedPlayers: unmatched,
        warnings,
    };
}

module.exports = { importSeriesStats };
