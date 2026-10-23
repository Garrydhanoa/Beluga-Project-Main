/**
 * The playoff bracket engine (BOT COPY).
 *
 * MUST stay behaviourally identical to `beluga-league-main/lib/playoffBracket.js`.
 * Same discipline as powerRankings.js / lib/powerRankingsAuto.js: the two copies
 * are diffed against the live DB before shipping. Keep the function order, the
 * SQL and the semantics aligned so that diff stays readable.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * `playoff_matchups` used to be two team ids and nothing else — no seed, no
 * score, no winner, and no pointer at the slot a winner belongs in. So nothing
 * could ever advance a bracket: round 2 had to be typed in by hand, into a save
 * that 500'd on every attempt. This module gives the bracket a real graph
 * (next_matchup_id/next_slot) and derives every result from confirmed
 * `stats_series` rows.
 *
 * `recomputeBracket` is the heart, and it is DERIVED and IDEMPOTENT: it computes
 * the desired state of every matchup from scratch (round 1 seeding + confirmed
 * series + manual overrides) and writes only the differences. Running it twice
 * is a no-op, and the bot and the website can both call it without drifting.
 *
 * Week numbers: a playoff round N lives at week 90 + N (91 = first round). Those
 * integers are load-bearing — threadContext.js:76 decides `is_playoff` from
 * `week >= 90`, and rankingWeek/gameOfWeek exclude weeks >= 90 — so they stay.
 * Only what humans READ is relabelled, via `weekLabel()`.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

const PLAYOFF_WEEK_FLOOR = 90;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

// ---------------------------------------------------------------------------
// Week <-> round
// ---------------------------------------------------------------------------

function isPlayoffWeek(week) {
    return week != null && Number(week) >= PLAYOFF_WEEK_FLOOR;
}

/** Round 1 -> week 91. Week 90 itself is a floor sentinel, never a round. */
function weekForRound(roundNumber) {
    return PLAYOFF_WEEK_FLOOR + Number(roundNumber);
}

function roundFromWeek(week) {
    return Number(week) - PLAYOFF_WEEK_FLOOR;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

function nextPowerOfTwo(n) {
    let size = 2;
    while (size < n) size *= 2;
    return size;
}

/**
 * Standard single-elimination slot order for a power-of-two bracket.
 *
 * Built by reflection: each round doubles the field, and every seed `s` is
 * paired with `size + 1 - s`. 8 -> [1,8,4,5,2,7,3,6], which is exactly the
 * 1v8 / 4v5 / 2v7 / 3v6 order the league already used and the order in the
 * Season 8 bracket graphic.
 */
function seedOrder(size) {
    let order = [1];
    while (order.length < size) {
        const round = order.length * 2;
        const next = [];
        for (const s of order) {
            next.push(s);
            next.push(round + 1 - s);
        }
        order = next;
    }
    return order;
}

/**
 * First-round pairings for `qualifierCount` teams.
 *
 * Non-powers of two are padded up to the next power of two and the surplus
 * slots become byes, so "top 10" is a 16-slot bracket in which seeds 1-6 get a
 * bye into round 2. Returns seed numbers; `null` means a bye.
 */
function seedPairs(qualifierCount) {
    const qualifiers = Math.max(2, Number(qualifierCount) || 8);
    const size = nextPowerOfTwo(qualifiers);
    const order = seedOrder(size);
    const pairs = [];
    for (let i = 0; i < order.length; i += 2) {
        const a = order[i] <= qualifiers ? order[i] : null;
        const b = order[i + 1] <= qualifiers ? order[i + 1] : null;
        pairs.push([a, b]);
    }
    return pairs;
}

function roundCountFor(qualifierCount) {
    return Math.log2(nextPowerOfTwo(Math.max(2, Number(qualifierCount) || 8)));
}

/** Name a round by how many teams enter it: 2 -> Finals, 8 -> Quarter-Finals. */
function roundNameFor(roundNumber, totalRounds) {
    const teams = 2 ** (totalRounds - roundNumber + 1);
    if (teams === 2) return 'Finals';
    if (teams === 4) return 'Semi-Finals';
    if (teams === 8) return 'Quarter-Finals';
    return `Round of ${teams}`;
}

function roundNames(totalRounds) {
    const names = [];
    for (let r = 1; r <= totalRounds; r += 1) names.push(roundNameFor(r, totalRounds));
    return names;
}

/** Compact label for thread names and tight UI. */
function shortRoundName(name) {
    if (!name) return 'Playoffs';
    if (/^finals$/i.test(name)) return 'Finals';
    if (/^semi/i.test(name)) return 'Semis';
    if (/^quarter/i.test(name)) return 'QF';
    const m = /^round of (\d+)$/i.exec(name);
    if (m) return `R${m[1]}`;
    return name;
}

/**
 * What a human should read for a week number.
 *
 * Every surface that used to print "Week 91" calls this. `totalRounds` is
 * optional: without it we fall back to the league's standard 3-round bracket,
 * which is right for every season run so far.
 */
function weekLabel(week, totalRounds = 3) {
    if (!isPlayoffWeek(week)) return `Week ${week}`;
    const round = roundFromWeek(week);
    if (round < 1) return 'Playoffs';
    if (round > totalRounds) return `Playoffs — Round ${round}`;
    return `Playoffs — ${roundNameFor(round, totalRounds)}`;
}

// ---------------------------------------------------------------------------
// Settings (site_config key 'playoffs', written by the website admin tab)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
    enabled: false,        // public /playoffs tab visible
    autoAdvance: true,     // confirmed series -> bracket
    autoThreads: true,     // round complete -> next round's threads
    autoChampion: true,    // finals -> season_champions
    autoAnnounce: true,    // post the bracket image when a round completes
};

/**
 * Read the automation switches. Degrades to "automation on" when the row or the
 * table is missing, so the bot survives being deployed ahead of the website —
 * same rule `ai_personas` follows.
 */
async function getPlayoffSettings() {
    if (!db()) return { ...DEFAULT_SETTINGS };
    try {
        const r = await pool.query(`SELECT value FROM site_config WHERE key = 'playoffs'`);
        if (!r.rows.length) return { ...DEFAULT_SETTINGS };
        return { ...DEFAULT_SETTINGS, ...(r.rows[0].value || {}) };
    } catch (err) {
        Logger.error(`playoff settings read failed (using defaults) — ${err.message}`);
        return { ...DEFAULT_SETTINGS };
    }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const MATCHUP_COLUMNS = `
  pm.id, pm.round_id, pm.home_team_id, pm.away_team_id, pm.home_seed, pm.away_seed,
  pm.home_score, pm.away_score, pm.winner_team_id, pm.result_kind, pm.series_id,
  pm.next_matchup_id, pm.next_slot, pm.manual_override, pm.is_bye,
  pm.best_of, pm.order_index, pm.match_order`;

/**
 * Full bracket for one division, rounds ascending, matchups in slot order.
 * Returns null when the division has no bracket yet.
 */
async function loadBracket(seasonId, division, q = pool) {
    if (!db()) return null;
    const br = await q.query(
        `SELECT id, season_id, division, name, is_published, display_order, qualifier_count
           FROM playoff_brackets
          WHERE season_id = $1 AND LOWER(division) = LOWER($2)
          ORDER BY id DESC LIMIT 1`,
        [seasonId, division]
    );
    if (!br.rows.length) return null;
    const bracket = br.rows[0];

    const rr = await q.query(
        `SELECT id, bracket_id, name, round_number, round_order, is_finals, best_of
           FROM playoff_rounds WHERE bracket_id = $1 ORDER BY round_number ASC, round_order ASC`,
        [bracket.id]
    );

    const mm = await q.query(
        `SELECT ${MATCHUP_COLUMNS},
                ht.name AS home_team_name, at.name AS away_team_name,
                wt.name AS winner_team_name
           FROM playoff_matchups pm
           JOIN playoff_rounds pr ON pr.id = pm.round_id
           LEFT JOIN teams ht ON ht.id = pm.home_team_id
           LEFT JOIN teams at ON at.id = pm.away_team_id
           LEFT JOIN teams wt ON wt.id = pm.winner_team_id
          WHERE pr.bracket_id = $1
          ORDER BY pr.round_number ASC, pm.order_index ASC, pm.id ASC`,
        [bracket.id]
    );

    const rounds = rr.rows.map((r) => ({
        ...r,
        matchups: mm.rows.filter((m) => m.round_id === r.id),
    }));

    return { ...bracket, rounds, totalRounds: rounds.length };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * Seed a division's bracket from the standings and wire the whole graph.
 *
 * `standings` is the ordered array from getStatsStandings (bot: statsStore
 * getStandings) — index 0 is seed 1. Destructive for that ONE division only:
 * other divisions are never touched (the old manual save wiped all three).
 */
async function generateBracket(seasonId, division, standings, { qualifierCount = 8, bestOfByRound = {} } = {}) {
    if (!db()) throw new Error('Database unavailable');
    const qualifiers = Math.max(2, Number(qualifierCount) || 8);
    if (standings.length < qualifiers) {
        throw new Error(`Need at least ${qualifiers} teams with results in ${division} (have ${standings.length}).`);
    }

    const totalRounds = roundCountFor(qualifiers);
    const names = roundNames(totalRounds);
    const pairs = seedPairs(qualifiers);
    const teamIdForSeed = (seed) => (seed == null ? null : (standings[seed - 1]?.teamId ?? null));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `DELETE FROM playoff_brackets WHERE season_id = $1 AND LOWER(division) = LOWER($2)`,
            [seasonId, division]
        );

        const br = await client.query(
            `INSERT INTO playoff_brackets (season_id, division, name, is_published, display_order, qualifier_count)
             VALUES ($1, $2, $3, TRUE, 0, $4) RETURNING id`,
            [seasonId, division, `${division} Playoffs`, qualifiers]
        );
        const bracketId = br.rows[0].id;

        // Create every round up front, so empty later rounds exist as real shells
        // the graph can point at.
        const roundIds = [];
        for (let r = 1; r <= totalRounds; r += 1) {
            const rr = await client.query(
                `INSERT INTO playoff_rounds (bracket_id, name, round_number, round_order, is_finals, best_of)
                 VALUES ($1, $2, $3, $3, $4, $5) RETURNING id`,
                [bracketId, names[r - 1], r, r === totalRounds, Number(bestOfByRound[r]) || 7]
            );
            roundIds.push(rr.rows[0].id);
        }

        // Matchups, round by round. Slot i of round r feeds slot floor(i/2) of
        // round r+1, into the home slot when i is even and away when odd.
        const idsByRound = [];
        for (let r = 1; r <= totalRounds; r += 1) {
            const count = 2 ** (totalRounds - r);
            const ids = [];
            for (let i = 0; i < count; i += 1) {
                const seedPair = r === 1 ? pairs[i] : [null, null];
                const homeSeed = seedPair[0];
                const awaySeed = seedPair[1];
                const homeId = r === 1 ? teamIdForSeed(homeSeed) : null;
                const awayId = r === 1 ? teamIdForSeed(awaySeed) : null;
                const isBye = r === 1 && (homeSeed == null || awaySeed == null);

                const m = await client.query(
                    `INSERT INTO playoff_matchups
                       (round_id, home_team_id, away_team_id, home_seed, away_seed,
                        best_of, order_index, match_order, is_bye)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8) RETURNING id`,
                    [roundIds[r - 1], homeId, awayId, homeSeed, awaySeed,
                        Number(bestOfByRound[r]) || 7, i + 1, isBye]
                );
                ids.push(m.rows[0].id);
            }
            idsByRound.push(ids);
        }

        for (let r = 1; r < totalRounds; r += 1) {
            const ids = idsByRound[r - 1];
            const nextIds = idsByRound[r];
            for (let i = 0; i < ids.length; i += 1) {
                await client.query(
                    `UPDATE playoff_matchups SET next_matchup_id = $2, next_slot = $3 WHERE id = $1`,
                    [ids[i], nextIds[Math.floor(i / 2)], i % 2 === 0 ? 'home' : 'away']
                );
            }
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    // Byes resolve themselves on the first recompute.
    return recomputeBracket(seasonId, division);
}

// ---------------------------------------------------------------------------
// Legacy bracket upgrade
// ---------------------------------------------------------------------------

/** True when a bracket already has its matchup rows, seeds and next pointers. */
function isFullyWired(bracket) {
    const rounds = bracket.rounds;
    if (!rounds.length) return false;
    for (let r = 1; r < rounds.length; r += 1) {
        if (rounds[r].matchups.length !== Math.floor(rounds[r - 1].matchups.length / 2)) return false;
    }
    for (let r = 0; r < rounds.length - 1; r += 1) {
        for (const m of rounds[r].matchups) {
            if (!m.next_matchup_id || !m.next_slot) return false;
        }
    }
    const first = rounds[0];
    if (first.matchups.length && first.matchups.every((m) => m.home_seed == null && m.away_seed == null)) return false;
    return true;
}

/**
 * Wire an already-existing bracket that predates the graph columns.
 *
 * Brackets seeded by the old auto-bracket route have teams but no seeds and no
 * next_matchup_id, so nothing can advance them. Re-seeding from today's
 * standings is NOT a safe repair — verified against the live S10 data, the
 * standings have moved since the bracket was drawn, so a re-seed silently
 * produces different pairings than the ones the league actually played.
 *
 * Instead we infer the graph from the structure that is already there: slot i of
 * round r feeds slot floor(i/2) of round r+1, and round 1's seeds come from the
 * standard pairing order the old route used ([1,8],[4,5],[2,7],[3,6]).
 *
 * Safe to run repeatedly: it only fills in what is missing.
 */
async function ensureBracketGraph(seasonId, division, q = pool) {
    if (!db()) return { wired: 0, seeded: 0 };
    const bracket = await loadBracket(seasonId, division, q);
    if (!bracket || !bracket.rounds.length) return { wired: 0, seeded: 0 };

    let wired = 0;
    let seeded = 0;
    let created = 0;

    // Already wired? Do nothing. This runs on every admin and public page load,
    // and re-issuing the same UPDATEs each time is pure waste — very visible
    // against a remote database where every round-trip costs real milliseconds.
    if (isFullyWired(bracket)) return { wired, seeded, created, skipped: true };

    // --- seeds for round 1 ---
    const first = bracket.rounds[0];
    const needsSeeds = first.matchups.length > 0 && first.matchups.every((m) => m.home_seed == null && m.away_seed == null);
    if (needsSeeds) {
        const size = first.matchups.length * 2;
        if (nextPowerOfTwo(size) === size) {
            const pairs = seedPairs(size);
            for (let i = 0; i < first.matchups.length; i += 1) {
                const m = first.matchups[i];
                const [hs, as] = pairs[i] || [null, null];
                await q.query(
                    `UPDATE playoff_matchups SET home_seed = $2, away_seed = $3 WHERE id = $1`,
                    [m.id, hs, as]
                );
                seeded += 1;
            }
            await q.query(
                `UPDATE playoff_brackets SET qualifier_count = $2 WHERE id = $1`,
                [bracket.id, size]
            );
        }
    }

    // --- materialize missing later-round matchups ---
    // The old auto-bracket created rounds 2 and 3 as EMPTY SHELLS with no matchup
    // rows at all, which is why round 2 had to be typed in by hand. A round needs
    // half as many matchups as the round before it; create whatever is missing so
    // there are real slots for winners to advance into.
    for (let r = 1; r < bracket.rounds.length; r += 1) {
        const prev = bracket.rounds[r - 1];
        const round = bracket.rounds[r];
        const expected = Math.floor(prev.matchups.length / 2);
        for (let i = round.matchups.length; i < expected; i += 1) {
            const ins = await q.query(
                `INSERT INTO playoff_matchups (round_id, best_of, order_index, match_order)
                 VALUES ($1, $2, $3, $3) RETURNING ${MATCHUP_COLUMNS.replace(/pm\./g, '')}`,
                [round.id, round.best_of || 7, i + 1]
            );
            round.matchups.push(ins.rows[0]);
            created += 1;
        }
    }

    // --- next pointers ---
    for (let r = 0; r < bracket.rounds.length - 1; r += 1) {
        const current = bracket.rounds[r].matchups;
        const next = bracket.rounds[r + 1].matchups;
        if (!current.length || !next.length) continue;
        for (let i = 0; i < current.length; i += 1) {
            const m = current[i];
            const target = next[Math.floor(i / 2)];
            if (!target) continue;
            const slot = i % 2 === 0 ? 'home' : 'away';
            if (m.next_matchup_id === target.id && m.next_slot === slot) continue;
            await q.query(
                `UPDATE playoff_matchups SET next_matchup_id = $2, next_slot = $3 WHERE id = $1`,
                [m.id, target.id, slot]
            );
            wired += 1;
        }
    }

    // The last round is the finals, whatever it was named.
    const last = bracket.rounds[bracket.rounds.length - 1];
    if (last && !last.is_finals) {
        await q.query(`UPDATE playoff_rounds SET is_finals = TRUE WHERE id = $1`, [last.id]);
    }

    return { wired, seeded, created };
}

// ---------------------------------------------------------------------------
// Recompute (derived + idempotent)
// ---------------------------------------------------------------------------

/**
 * Find the confirmed series that decided a matchup.
 *
 * Preference order: the explicit link (stats_series.playoff_series_id, a column
 * that already existed and was written by nothing), then a match on
 * season + division + the round's week + the team pair in either order. Matching
 * on the round's week matters: the live DB has a stray is_playoff series at
 * week 9 that must not be mistaken for a playoff result.
 */
async function findSeriesForMatchup(q, seasonId, division, matchup, weekNumber) {
    if (!matchup.home_team_id || !matchup.away_team_id) return null;

    const linked = await q.query(
        `SELECT id, home_team_id, away_team_id, home_score, away_score, winner_team_id,
                is_forfeit, forfeit_kind
           FROM stats_series
          WHERE playoff_series_id = $1 AND status = 'confirmed' LIMIT 1`,
        [matchup.id]
    );
    if (linked.rows.length) return linked.rows[0];

    const found = await q.query(
        `SELECT id, home_team_id, away_team_id, home_score, away_score, winner_team_id,
                is_forfeit, forfeit_kind
           FROM stats_series
          WHERE season_id = $1
            AND LOWER(division) = LOWER($2)
            AND status = 'confirmed'
            AND is_playoff = TRUE
            AND week = $3
            AND ((home_team_id = $4 AND away_team_id = $5)
              OR (home_team_id = $5 AND away_team_id = $4))
          ORDER BY id DESC LIMIT 1`,
        [seasonId, division, weekNumber, matchup.home_team_id, matchup.away_team_id]
    );
    return found.rows[0] || null;
}

/** Orient a series' score to the matchup's home/away, which may be reversed. */
function orientResult(matchup, series) {
    const sameOrientation = series.home_team_id === matchup.home_team_id;
    const homeScore = sameOrientation ? series.home_score : series.away_score;
    const awayScore = sameOrientation ? series.away_score : series.home_score;
    let resultKind = 'series';
    if (series.is_forfeit) resultKind = series.forfeit_kind === 'double' ? 'double_ff' : 'ffw';
    return {
        homeScore: homeScore == null ? null : Number(homeScore),
        awayScore: awayScore == null ? null : Number(awayScore),
        // A double forfeit has NO winner; that matchup blocks the bracket until
        // staff set one by hand (which is what manual_override is for).
        winnerTeamId: resultKind === 'double_ff' ? null : (series.winner_team_id || null),
        resultKind,
        seriesId: series.id,
    };
}

/**
 * Rebuild every matchup's teams, score and winner from first principles, then
 * write only what changed.
 *
 * Deterministic, so a second run changes nothing:
 *  - round 1 teams are whatever is stored (seeding, or a staff swap),
 *  - rounds 2+ teams are the winners of their two feeder matchups,
 *  - any matchup flagged manual_override keeps its stored teams AND result, but
 *    still propagates its winner forward.
 */
async function recomputeBracket(seasonId, division, { client = null } = {}) {
    if (!db()) return { changed: [], roundsCompleted: [], champion: null, totalRounds: 0 };
    const q = client || pool;

    const bracket = await loadBracket(seasonId, division, q);
    if (!bracket) return { changed: [], roundsCompleted: [], champion: null, totalRounds: 0 };

    const totalRounds = bracket.totalRounds;
    const changed = [];
    const roundsCompleted = [];
    let champion = null;

    // Feeder lookup: which matchups point at me, and into which slot.
    const allMatchups = bracket.rounds.flatMap((r) => r.matchups);
    const feedersOf = new Map();
    for (const m of allMatchups) {
        if (!m.next_matchup_id) continue;
        if (!feedersOf.has(m.next_matchup_id)) feedersOf.set(m.next_matchup_id, {});
        feedersOf.get(m.next_matchup_id)[m.next_slot === 'away' ? 'away' : 'home'] = m;
    }

    // Desired state, computed forward round by round.
    const desired = new Map();

    for (const round of bracket.rounds) {
        const weekNumber = weekForRound(round.round_number);
        let decided = 0;

        for (const m of round.matchups) {
            // --- teams ---
            let homeTeamId = m.home_team_id;
            let awayTeamId = m.away_team_id;
            if (round.round_number > 1 && !m.manual_override) {
                const feeders = feedersOf.get(m.id) || {};
                homeTeamId = feeders.home ? (desired.get(feeders.home.id)?.winnerTeamId ?? null) : null;
                awayTeamId = feeders.away ? (desired.get(feeders.away.id)?.winnerTeamId ?? null) : null;
            }

            // --- result ---
            let state = {
                homeTeamId, awayTeamId,
                homeScore: null, awayScore: null, winnerTeamId: null,
                resultKind: null, seriesId: null,
            };

            if (m.manual_override) {
                // Staff drove this one; trust the stored row completely.
                state = {
                    homeTeamId, awayTeamId,
                    homeScore: m.home_score, awayScore: m.away_score,
                    winnerTeamId: m.winner_team_id, resultKind: m.result_kind, seriesId: m.series_id,
                };
            } else if (m.is_bye && round.round_number === 1) {
                // A STRUCTURAL bye: seeding left this slot empty (e.g. top 10 in a
                // 16-slot bracket), so the present team walks through.
                //
                // This is deliberately restricted to round 1 and to the is_bye flag.
                // Treating "one slot empty" as a walkover in later rounds is wrong
                // and dangerous: a half-filled Semi is waiting on the other QF, not
                // a win. An earlier version did exactly that and marched the only
                // decided AAA quarter-finalist all the way to champion.
                state.winnerTeamId = homeTeamId || awayTeamId || null;
                state.resultKind = state.winnerTeamId ? 'bye' : null;
            } else if (homeTeamId && awayTeamId) {
                const series = await findSeriesForMatchup(
                    q, seasonId, division, { ...m, home_team_id: homeTeamId, away_team_id: awayTeamId }, weekNumber
                );
                if (series) {
                    Object.assign(state, orientResult({ home_team_id: homeTeamId }, series));
                    // Backfill the link so the next recompute is a direct hit.
                    if (series.id && series.id !== m.series_id) {
                        await q.query(
                            `UPDATE stats_series SET playoff_series_id = $2 WHERE id = $1`,
                            [series.id, m.id]
                        );
                    }
                }
            }

            desired.set(m.id, state);
            if (state.winnerTeamId) decided += 1;

            // --- persist the diff ---
            const diff = [];
            const set = [];
            const params = [m.id];
            const push = (col, value, was) => {
                if ((value ?? null) === (was ?? null)) return;
                params.push(value ?? null);
                set.push(`${col} = $${params.length}`);
                diff.push(col);
            };
            push('home_team_id', state.homeTeamId, m.home_team_id);
            push('away_team_id', state.awayTeamId, m.away_team_id);
            push('home_score', state.homeScore, m.home_score);
            push('away_score', state.awayScore, m.away_score);
            push('winner_team_id', state.winnerTeamId, m.winner_team_id);
            push('result_kind', state.resultKind, m.result_kind);
            push('series_id', state.seriesId, m.series_id);

            if (set.length) {
                await q.query(
                    `UPDATE playoff_matchups SET ${set.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    params
                );
                changed.push({ matchupId: m.id, round: round.round_number, fields: diff });
            }
        }

        // A round is complete only when EVERY matchup in it has a winner. A
        // half-filled round is waiting on the round before it, never finished.
        if (round.matchups.length > 0 && decided === round.matchups.length) {
            roundsCompleted.push(round.round_number);
            if (round.is_finals || round.round_number === totalRounds) {
                // Only a finals that was actually contested crowns a champion:
                // both teams present AND a real winner.
                const finalState = desired.get(round.matchups[0]?.id);
                if (finalState?.homeTeamId && finalState?.awayTeamId && finalState?.winnerTeamId) {
                    champion = finalState.winnerTeamId;
                }
            }
        }
    }

    return { changed, roundsCompleted, champion, totalRounds, bracketId: bracket.id };
}

module.exports = {
    PLAYOFF_WEEK_FLOOR,
    isPlayoffWeek,
    weekForRound,
    roundFromWeek,
    nextPowerOfTwo,
    seedOrder,
    seedPairs,
    roundCountFor,
    roundNameFor,
    roundNames,
    shortRoundName,
    weekLabel,
    getPlayoffSettings,
    DEFAULT_SETTINGS,
    loadBracket,
    generateBracket,
    ensureBracketGraph,
    recomputeBracket,
};
