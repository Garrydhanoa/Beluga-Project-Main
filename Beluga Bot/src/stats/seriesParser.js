/**
 * Series parser — turns a Ballchasing group link into a structured, validated
 * series result the rest of the stats system consumes.
 *
 * What it does (and does NOT do):
 *   - Reads a group, dedupes replays, clusters the players into the two teams
 *     by who-plays-with-whom across games (colors swap, so we never trust color),
 *     computes the series score by team, extracts per-game per-player stats, and
 *     flags every anomaly (ghost players, 4-on-a-team, cross-team, incomplete
 *     series / forfeits, duplicate replays, name/score mismatch).
 *   - It does NOT decide what to do about anomalies (block vs. ping salary crew
 *     vs. ask captain) — that's the report-flow layer. The parser only reports,
 *     each issue tagged with a suggested severity.
 *   - It does NOT know Discord identities yet. Teams are "team0/team1" keyed by
 *     player account ids; the matching step maps those to rosters/discord ids.
 *
 * Validated against the operator's real example groups (see tools/ballchasing-explore.js).
 */

const bc = require('./ballchasingClient');

const FORMAT_THRESHOLD = { bo5: 3, bo7: 4 };
const TEAM_SIZE = 3; // all divisions are 3v3
// A player is a "ghost" (joined briefly / didn't really play) if they scored 0
// AND were on the field for under this fraction of the game.
const GHOST_PLAYTIME_PCT = 10;

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function pkeyOf(p) {
    const plat = p?.id?.platform ?? p?.platform ?? '?';
    const id = p?.id?.id ?? p?.platform_id ?? '?';
    return `${plat}:${id}`;
}

function sideGoals(side) {
    if (side?.goals != null) return num(side.goals);
    if (side?.stats?.core?.goals != null) return num(side.stats.core.goals);
    return (side?.players || []).reduce((a, p) => a + num(p?.stats?.core?.goals), 0);
}

/** Normalize one Ballchasing player object into our flat per-game stat line. */
function extractPlayerLine(p, replayDuration) {
    const core = p?.stats?.core || {};
    const demo = p?.stats?.demo || {};
    const start = num(p?.start_time);
    const end = num(p?.end_time);
    const playedSeconds = Math.max(0, end - start);
    const playedPct = replayDuration > 0 ? Math.round((playedSeconds / replayDuration) * 100) : null;
    const score = num(core.score);
    return {
        name: p?.name ?? null,
        platform: p?.id?.platform ?? null,
        platformId: p?.id?.id ?? null,
        pkey: pkeyOf(p),
        mvp: Boolean(p?.mvp ?? core?.mvp),
        score,
        goals: num(core.goals),
        assists: num(core.assists),
        saves: num(core.saves),
        shots: num(core.shots),
        shootingPct: core.shooting_percentage != null ? num(core.shooting_percentage) : null,
        demoInflicted: num(demo.inflicted),
        demoTaken: num(demo.taken),
        playedSeconds,
        playedPct,
        // Suspected non-participant — flagged, not auto-dropped (operator: continue
        // the report but ping salary crew; they can correct it later).
        ghost: score === 0 && playedPct !== null && playedPct < GHOST_PLAYTIME_PCT,
    };
}

/** Reduce a full Ballchasing replay to the fields we need. */
function simplifyReplay(full) {
    const duration = num(full?.duration);
    const blue = full?.blue || {};
    const orange = full?.orange || {};
    const mk = (side) => ({
        name: side?.name ?? null,
        goals: sideGoals(side),
        players: (side?.players || []).map((p) => extractPlayerLine(p, duration)),
    });
    return {
        id: full?.id,
        url: full?.id ? `https://ballchasing.com/replay/${full.id}` : null,
        title: full?.title ?? full?.replay_title ?? null,
        date: full?.date ?? full?.created ?? null,
        map: full?.map_name ?? full?.map_code ?? null,
        duration,
        overtime: Boolean(full?.overtime),
        blue: mk(blue),
        orange: mk(orange),
    };
}

/**
 * Cluster all players into exactly two teams across the games and decide, per
 * game, which color is team0 vs team1 (since colors swap). Absorbs subs by
 * unioning each game's players into the team they best overlap with.
 */
function clusterTeams(replays) {
    const team0 = new Set();
    const team1 = new Set();
    if (!replays.length) return { team0, team1, games: [], crossTeam: [] };

    replays[0].blue.players.forEach((p) => team0.add(p.pkey));
    replays[0].orange.players.forEach((p) => team1.add(p.pkey));

    const overlap = (set, arr) => arr.reduce((a, k) => a + (set.has(k) ? 1 : 0), 0);
    const games = [];

    for (const r of replays) {
        const blueKeys = r.blue.players.map((p) => p.pkey);
        const orangeKeys = r.orange.players.map((p) => p.pkey);
        const straight = overlap(team0, blueKeys) + overlap(team1, orangeKeys);
        const swapped = overlap(team1, blueKeys) + overlap(team0, orangeKeys);
        const blueIsTeam0 = straight >= swapped;

        (blueIsTeam0 ? blueKeys : orangeKeys).forEach((k) => team0.add(k));
        (blueIsTeam0 ? orangeKeys : blueKeys).forEach((k) => team1.add(k));

        const team0Goals = blueIsTeam0 ? r.blue.goals : r.orange.goals;
        const team1Goals = blueIsTeam0 ? r.orange.goals : r.blue.goals;
        games.push({
            replayId: r.id,
            url: r.url,
            date: r.date,
            duration: r.duration,
            overtime: r.overtime,
            team0Side: blueIsTeam0 ? 'blue' : 'orange',
            team1Side: blueIsTeam0 ? 'orange' : 'blue',
            team0Goals,
            team1Goals,
            team0Players: blueIsTeam0 ? r.blue.players : r.orange.players,
            team1Players: blueIsTeam0 ? r.orange.players : r.blue.players,
            winner: team0Goals > team1Goals ? 'team0' : team1Goals > team0Goals ? 'team1' : 'tie',
        });
    }

    const crossTeam = [...team0].filter((k) => team1.has(k));
    return { team0, team1, games, crossTeam };
}

/** Aggregate each team's players (series totals) from the per-game lines. */
function aggregateTeamPlayers(games, teamKey) {
    const byPlayer = new Map();
    for (const g of games) {
        for (const p of g[`${teamKey}Players`]) {
            if (p.ghost) continue; // ghosts contribute no stats / no game-played credit
            let agg = byPlayer.get(p.pkey);
            if (!agg) {
                agg = {
                    pkey: p.pkey, platform: p.platform, platformId: p.platformId,
                    names: new Set(), games: 0,
                    score: 0, goals: 0, assists: 0, saves: 0, shots: 0,
                    demoInflicted: 0, demoTaken: 0, mvps: 0,
                };
                byPlayer.set(p.pkey, agg);
            }
            if (p.name) agg.names.add(p.name);
            agg.games += 1;
            agg.score += p.score; agg.goals += p.goals; agg.assists += p.assists;
            agg.saves += p.saves; agg.shots += p.shots;
            agg.demoInflicted += p.demoInflicted; agg.demoTaken += p.demoTaken;
            if (p.mvp) agg.mvps += 1;
        }
    }
    return [...byPlayer.values()].map((a) => ({ ...a, names: [...a.names] }));
}

function parseScoreFromName(name) {
    const m = String(name || '').match(/(\d+)\s*[-–]\s*(\d+)/);
    return m ? { a: Number(m[1]), b: Number(m[2]) } : null;
}

/**
 * Cluster + validate a set of already-fetched replays into a series result.
 * This is the shared tail of every ingest path — the group path and the
 * one-replay-link-per-game path differ only in how they obtain `replays`.
 *
 * @param {Array} replays              simplifyReplay() output, in game order
 * @param {object} o
 * @param {'bo5'|'bo7'} o.format
 * @param {string|null} [o.groupId] @param {string|null} [o.groupUrl] @param {string|null} [o.groupName]
 * @param {number} [o.replayCount]    replays seen before de-duplication
 * @param {Array} [o.issues]          issues accumulated by the fetch stage
 * @param {boolean} [o.requireComplete=true]
 *        true  — a series that doesn't reach a clean result is REJECTED (captain flow).
 *        false — every reject is downgraded to a warning (staff manual/admin flow):
 *                staff are backfilling history and have already asserted the teams
 *                and the score, so an incomplete or odd series must be reportable.
 */
function buildSeriesFromReplays(replays, {
    format = 'bo5', groupId = null, groupUrl = null, groupName = null,
    replayCount = null, issues = [], requireComplete = true,
} = {}) {
    const threshold = FORMAT_THRESHOLD[format] || 3;
    // Downgrade rejects when the caller has authority over the result already.
    const sev = (severity) => (requireComplete || severity !== 'reject' ? severity : 'warn');
    const addIssue = (severity, code, message, data = null) =>
        issues.push({ severity: sev(severity), code, message, data });

    const { team0, team1, games, crossTeam } = clusterTeams(replays);

    // --- validations ---------------------------------------------------------
    for (const g of games) {
        const t0 = g.team0Players.length;
        const t1 = g.team1Players.length;
        if (t0 > TEAM_SIZE || t1 > TEAM_SIZE) {
            addIssue('reject', 'OVERSIZED_TEAM',
                `A game has more than ${TEAM_SIZE} players on a team (${t0}v${t1}). Reject and check the replay.`,
                { replayId: g.replayId, team0: t0, team1: t1 });
        } else if (t0 < TEAM_SIZE || t1 < TEAM_SIZE) {
            addIssue('warn', 'UNDERSIZED_TEAM',
                `A game has fewer than ${TEAM_SIZE} players on a team (${t0}v${t1}).`,
                { replayId: g.replayId, team0: t0, team1: t1 });
        }
        if (g.winner === 'tie') {
            addIssue('warn', 'TIE_GAME', 'A game ended without a winner (0-0 / abandoned replay).', { replayId: g.replayId });
        }
        for (const side of ['team0Players', 'team1Players']) {
            for (const p of g[side]) {
                if (p.ghost) {
                    addIssue('warn', 'GHOST_PLAYER',
                        `Possible ghost player "${p.name}" (0 score, ${p.playedPct}% playtime) — continuing, salary crew should verify.`,
                        { replayId: g.replayId, pkey: p.pkey, name: p.name });
                }
            }
        }
    }
    if (crossTeam.length) {
        addIssue('reject', 'CROSS_TEAM_PLAYER',
            'A player appears on BOTH teams across the series — cannot determine sides reliably.',
            { crossTeam });
    }

    const team0Wins = games.filter((g) => g.winner === 'team0').length;
    const team1Wins = games.filter((g) => g.winner === 'team1').length;
    const decisive = team0Wins + team1Wins;
    const maxWins = Math.max(team0Wins, team1Wins);

    const complete = maxWins === threshold && decisive === games.length && games.length <= 2 * threshold - 1;
    if (maxWins > threshold || games.length > 2 * threshold - 1) {
        addIssue('warn', 'TOO_MANY_GAMES',
            `More games than a ${format.toUpperCase()} should have (${games.length}). Captain must confirm which replays count.`,
            { games: games.length, maxWins, threshold });
    } else if (maxWins < threshold) {
        addIssue('reject', 'INCOMPLETE_SERIES',
            `No team reached ${threshold} wins (current ${team0Wins}-${team1Wins}). Looks incomplete or a forfeit — salary crew must handle.`,
            { team0Wins, team1Wins, threshold });
    }

    const nameScore = parseScoreFromName(groupName);
    let nameMatchesComputed = null;
    if (nameScore) {
        nameMatchesComputed =
            (nameScore.a === team0Wins && nameScore.b === team1Wins) ||
            (nameScore.a === team1Wins && nameScore.b === team0Wins);
        if (!nameMatchesComputed) {
            addIssue('info', 'NAME_SCORE_MISMATCH',
                `Group name score (${nameScore.a}-${nameScore.b}) differs from counted score (${team0Wins}-${team1Wins}); often means a forfeited game. Confirm with captain.`,
                { nameScore, computed: { team0Wins, team1Wins } });
        }
    }

    const hasReject = issues.some((i) => i.severity === 'reject');

    return {
        ok: !hasReject,
        fatal: false,
        complete,
        groupId,
        groupUrl,
        groupName: groupName ?? null,
        format,
        winThreshold: threshold,
        replayCount: replayCount ?? replays.length,
        uniqueReplayCount: replays.length,
        seriesScore: { team0: team0Wins, team1: team1Wins, label: `${team0Wins}-${team1Wins}` },
        teams: [
            { index: 0, playerKeys: [...team0], players: aggregateTeamPlayers(games, 'team0'), seriesWins: team0Wins },
            { index: 1, playerKeys: [...team1], players: aggregateTeamPlayers(games, 'team1'), seriesWins: team1Wins },
        ],
        games: games.map((g) => ({
            replayId: g.replayId,
            url: g.url,
            date: g.date,
            duration: g.duration,
            overtime: g.overtime,
            team0Goals: g.team0Goals,
            team1Goals: g.team1Goals,
            winner: g.winner,
            team0Players: g.team0Players,
            team1Players: g.team1Players,
        })),
        nameScore: nameScore ? `${nameScore.a}-${nameScore.b}` : null,
        nameMatchesComputed,
        issues,
    };
}

/**
 * High-level: group URL → validated series result.
 * @param {object} opts
 * @param {string} opts.groupUrl  Ballchasing group URL (or id)
 * @param {'bo5'|'bo7'} [opts.format='bo5']
 * @param {object} [opts.client=bc]  injectable for tests
 * @param {boolean} [opts.requireComplete=true] see buildSeriesFromReplays
 */
async function parseSeries({ groupUrl, format = 'bo5', client = bc, requireComplete = true }) {
    const issues = [];
    const addIssue = (severity, code, message, data = null) => issues.push({ severity, code, message, data });

    if (!client.isGroupUrl(groupUrl) && !/^[A-Za-z0-9_-]+$/.test(String(groupUrl || '').trim())) {
        addIssue('reject', 'INVALID_URL', 'That is not a Ballchasing group link. Only a replay GROUP link is accepted.');
        return { ok: false, fatal: true, issues, groupUrl };
    }
    const groupId = client.parseGroupId(groupUrl);
    if (!groupId) {
        addIssue('reject', 'INVALID_URL', 'Could not read a group id from that link.');
        return { ok: false, fatal: true, issues, groupUrl };
    }

    let group;
    try {
        group = await client.getGroup(groupId);
    } catch (err) {
        const code = err.code === 'not_found' ? 'GROUP_NOT_FOUND'
            : err.code === 'private' ? 'GROUP_PRIVATE'
            : err.code === 'no_key' ? 'NO_API_KEY'
            : 'GROUP_FETCH_FAILED';
        const msg = code === 'GROUP_PRIVATE'
            ? 'The group is private — set it to public or unlisted, then resubmit.'
            : code === 'GROUP_NOT_FOUND'
            ? 'That group does not exist (deleted or wrong link).'
            : `Could not read the group: ${err.message}`;
        addIssue('reject', code, msg, { ballchasing: err.message });
        return { ok: false, fatal: true, issues, groupId, groupUrl };
    }

    let listed;
    try {
        listed = await client.listGroupReplays(groupId);
    } catch (err) {
        addIssue('reject', 'REPLAY_LIST_FAILED', `Could not list the group's replays: ${err.message}`);
        return { ok: false, fatal: true, issues, groupId, groupUrl, groupName: group?.name };
    }

    const ids = listed.map((r) => r.id);
    const uniqueIds = [...new Set(ids)];
    const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicateIds.length) {
        addIssue('info', 'DUPLICATE_REPLAYS', `${duplicateIds.length} duplicate replay(s) ignored.`, { duplicateIds });
    }
    if (!uniqueIds.length) {
        addIssue('reject', 'NO_REPLAYS', 'The group has no replays.');
        return { ok: false, fatal: true, issues, groupId, groupUrl, groupName: group?.name };
    }

    const replays = [];
    for (const id of uniqueIds) {
        // eslint-disable-next-line no-await-in-loop
        const full = await client.getReplay(id);
        replays.push(simplifyReplay(full));
    }
    replays.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    return buildSeriesFromReplays(replays, {
        format, groupId, groupUrl, groupName: group?.name ?? null,
        replayCount: ids.length, issues, requireComplete,
    });
}

/**
 * High-level: an ORDERED list of individual replay links → series result.
 * The manual/admin report path, for a series that never had a group: staff give
 * one replay link per game and the same clustering + stat extraction runs.
 *
 * Unlike the group path this does NOT sort by date — the caller said which
 * replay is game 1, and that ordering is authoritative.
 *
 * @param {object} opts
 * @param {string[]} opts.replayUrls  replay URLs (or bare ids), in game order
 * @param {'bo5'|'bo7'} [opts.format='bo5']
 * @param {object} [opts.client=bc]
 * @param {boolean} [opts.requireComplete=false]
 */
async function parseReplayList({ replayUrls, format = 'bo5', client = bc, requireComplete = false }) {
    const issues = [];
    const addIssue = (severity, code, message, data = null) => issues.push({ severity, code, message, data });

    const raw = (Array.isArray(replayUrls) ? replayUrls : []).map((u) => String(u || '').trim()).filter(Boolean);
    if (!raw.length) {
        addIssue('reject', 'NO_REPLAYS', 'No replay links were supplied.');
        return { ok: false, fatal: true, issues };
    }

    // Resolve ids, keeping the caller's order and reporting each bad link by name.
    const ids = [];
    for (const link of raw) {
        const id = client.parseReplayId(link);
        if (!id) addIssue('reject', 'INVALID_URL', `Not a Ballchasing replay link: ${link}`, { link });
        else ids.push(id);
    }
    const seen = new Set();
    const uniqueIds = ids.filter((id) => (seen.has(id) ? false : seen.add(id)));
    if (uniqueIds.length < ids.length) {
        addIssue('info', 'DUPLICATE_REPLAYS', `${ids.length - uniqueIds.length} duplicate replay link(s) ignored.`);
    }
    if (!uniqueIds.length) {
        addIssue('reject', 'NO_REPLAYS', 'None of the supplied links were usable replay links.');
        return { ok: false, fatal: true, issues };
    }

    // One bad replay must not lose the rest — record it and carry on.
    const replays = [];
    for (const id of uniqueIds) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const full = await client.getReplay(id);
            replays.push(simplifyReplay(full));
        } catch (err) {
            const why = err.code === 'not_found' ? 'it does not exist (deleted or wrong link)'
                : err.code === 'private' ? 'it is private — set it to public or unlisted'
                : err.code === 'no_key' ? 'the bot has no Ballchasing API key configured'
                : err.message;
            addIssue('reject', 'REPLAY_FETCH_FAILED', `Could not read replay ${id}: ${why}`, { replayId: id });
        }
    }
    if (!replays.length) {
        addIssue('reject', 'NO_REPLAYS', 'None of the supplied replays could be read.');
        return { ok: false, fatal: true, issues, replayCount: raw.length };
    }

    return buildSeriesFromReplays(replays, {
        format, groupId: null, groupUrl: null, groupName: null,
        replayCount: raw.length, issues, requireComplete,
    });
}

module.exports = {
    FORMAT_THRESHOLD,
    TEAM_SIZE,
    extractPlayerLine,
    simplifyReplay,
    clusterTeams,
    aggregateTeamPlayers,
    parseScoreFromName,
    buildSeriesFromReplays,
    parseSeries,
    parseReplayList,
};
