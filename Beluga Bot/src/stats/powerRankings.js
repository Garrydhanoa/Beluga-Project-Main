/**
 * Auto power rankings — teams AND players, computed from RECENT performance.
 *
 * Both boards are centred on 100 = an exactly average showing in that division.
 *
 * PLAYER form (each player's most recent N=5 reported series):
 *   Every stat is first divided by that division's per-game average, so the
 *   operator weights below actually carry their stated importance. (Applying
 *   them to raw per-game values makes `score` ~99% of the rating, because score
 *   is ~376 while goals are ~0.75 — that was the old bug.)
 *     goals 30 · score 25 · saves 20 · assists 15 · shots 5 · demos inflicted 5
 *     · demos taken -5 · MVP +6 · win x1.12 / loss x0.88
 *   Recency weight is per SERIES (all games in a series share it), the weighted
 *   mean divides by the SUM OF WEIGHTS, and the result is regressed toward the
 *   division average so a 3-game sample cannot fluke its way into the top 10.
 *
 * TEAM form (last N=5 series): win 10 / loss -10, both adjusted by opponent
 *   strength (their series win% x6), plus game diff x2 and goal diff x0.5.
 *   Averaged per series so playing more series is not itself worth points.
 *   Forfeits count at 0.6 weight. Teams yet to play sort below teams that have.
 *
 * WEEK SNAPSHOTS: every computation is capped at a week — the form window AND
 *   the supporting numbers (division per-game averages, team series win %, team
 *   Beluga rating) only see series with week <= N. Ranking week 5 therefore looks
 *   at week 5, then walks back through week 4, 3 … until it has 5 series.
 *   Recalculating week 3 leaves weeks 2 and 4 untouched, and redoing an old week
 *   reproduces the numbers it gave at the time. Series with NO week set (staff
 *   reports may omit it) sort last and count toward every week — callers surface
 *   that count rather than letting it skew an early week silently.
 *
 * Rankings persist to power_rankings (entity_type 'team'|'player', per division,
 * per week) with trend vs the PREVIOUS WEEK. Recomputed on demand
 * (/power-rankings, admin button) and when a week closes.
 *
 * KEEP IN LOCK-STEP with the website copy at
 * beluga-league-main/lib/powerRankingsAuto.js — same weights, notes and trend.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const { belugaFromTotals } = require('./statsStore');
const Logger = require('../utils/logger');

const N_SERIES = 5;          // form window, for both players and teams
const BASELINE = 100;        // "exactly average" on both boards
const WIN_BONUS = 0.12;      // per-game win/loss multiplier (+/-12%)
const MVP_BONUS = 6;         // flat, on the 100 scale
const SHRINK_K = 5;          // games of regression toward the division average
const RATIO_CAP = 3;         // no single game counts as more than 3x average

// Operator weights, applied to division-normalised ratios (not raw stats).
const W = { goals: 30, score: 25, saves: 20, assists: 15, shots: 5, demos: 5 };
const W_DEMOS_TAKEN = 5; // subtracted
const W_TOTAL = Object.values(W).reduce((a, b) => a + b, 0); // 100

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

const num = (v) => Number(v || 0);

/** stat / division average, capped so one freak game cannot dominate. */
function ratio(value, average) {
    if (!(average > 0)) return 0;
    return Math.min(num(value) / average, RATIO_CAP);
}

/**
 * Recency weight for the i-th most recent of `total` series (0 = newest).
 * Newest = 1.0, oldest = 1/total.
 */
function seriesWeight(i, total) {
    return (total - i) / total;
}

/** Regress a raw form score toward the baseline based on sample size. */
function shrink(raw, games) {
    const n = Math.max(0, games);
    return (n / (n + SHRINK_K)) * raw + (SHRINK_K / (n + SHRINK_K)) * BASELINE;
}

const round1 = (n) => Math.round(n * 10) / 10;

// ---- teams ------------------------------------------------------------------

async function computeTeamRankings(seasonId, division, week = null) {
    // The week ceiling. null = the whole season (every week that exists).
    const cap = week == null ? Number.MAX_SAFE_INTEGER : Number(week);

    // The team UNIVERSE stays season-wide so the board doesn't shrink on early
    // weeks — a team with no series yet falls into the `unplayed` branch below.
    // Its win% and rating, however, are recomputed at the week cap so a snapshot
    // of week 2 isn't contaminated by weeks 3+.
    const agg = await pool.query(
        `SELECT ts.team_id, t.name
         FROM stats_team_season ts JOIN teams t ON t.id = ts.team_id
         WHERE ts.season_id=$1 AND ts.division=$2 AND ts.is_playoff=FALSE`,
        [seasonId, division]
    );
    if (!agg.rows.length) return [];
    const info = new Map(agg.rows.map((r) => [r.team_id, {
        name: r.name,
        winPct: 0.5,  // filled from the week-capped series below
        rating: 0,    // filled from the week-capped stat totals below
    }]));

    // Newest first. Row id is NOT chronological (a late-reported week 1 series
    // gets a higher id than week 2), so week leads the ordering. COALESCE puts
    // week-less staff reports at 0 so they stay eligible for every week, still
    // sorted last by NULLS LAST.
    const series = await pool.query(
        `SELECT s.id, s.week, s.home_team_id, s.away_team_id, s.winner_team_id, s.is_forfeit, s.forfeit_kind,
            s.home_score, s.away_score,
            COALESCE(SUM(g.home_goals),0)::int AS hg, COALESCE(SUM(g.away_goals),0)::int AS ag
         FROM stats_series s LEFT JOIN stats_games g ON g.series_id = s.id
         WHERE s.season_id=$1 AND s.division=$2 AND s.is_playoff=FALSE AND s.status='confirmed'
           AND COALESCE(s.week, 0) <= $3
         GROUP BY s.id ORDER BY s.week DESC NULLS LAST, s.id DESC`,
        [seasonId, division, cap]
    );

    // Series record THROUGH the cap — this is the opponent-strength input, so it
    // must reflect what was known that week, not the final standings.
    const record = new Map();
    for (const s of series.rows) {
        for (const teamId of [s.home_team_id, s.away_team_id]) {
            if (teamId == null || !info.has(teamId)) continue;
            if (!record.has(teamId)) record.set(teamId, { w: 0, l: 0 });
            if (s.winner_team_id === teamId) record.get(teamId).w += 1;
            else if (s.winner_team_id != null) record.get(teamId).l += 1;
        }
    }
    for (const [teamId, meta] of info) {
        const r = record.get(teamId);
        const n = r ? r.w + r.l : 0;
        meta.winPct = n > 0 ? r.w / n : 0.5;
    }

    // Team Beluga rating THROUGH the cap. Same helper the stats recompute uses,
    // so at the latest week this reproduces stats_team_season.beluga_score exactly.
    const totals = await pool.query(
        `SELECT gp.team_id,
            COUNT(DISTINCT gp.game_id)::int AS games,
            COALESCE(SUM(gp.score),0)::int AS score,
            COALESCE(SUM(gp.goals),0)::int AS goals,
            COALESCE(SUM(gp.assists),0)::int AS assists,
            COALESCE(SUM(gp.saves),0)::int AS saves,
            COALESCE(SUM(gp.shots),0)::int AS shots,
            COALESCE(SUM(gp.demos_inflicted),0)::int AS demos_inflicted
         FROM stats_game_players gp JOIN stats_series s ON s.id = gp.series_id
         WHERE gp.season_id=$1 AND gp.division=$2 AND gp.is_playoff=FALSE
           AND s.status='confirmed' AND COALESCE(s.week, 0) <= $3
         GROUP BY gp.team_id`,
        [seasonId, division, cap]
    );
    for (const r of totals.rows) {
        const meta = info.get(r.team_id);
        if (meta) meta.rating = Number(belugaFromTotals(r, r.games) || 0);
    }

    const played = [];
    const unplayed = [];
    for (const [teamId, meta] of info) {
        const mine = series.rows
            .filter((s) => s.home_team_id === teamId || s.away_team_id === teamId)
            .slice(0, N_SERIES);

        if (!mine.length) {
            unplayed.push({
                teamId,
                name: meta.name,
                score: null,
                rating: meta.rating,
                reason: 'no series played yet',
                played: 0,
            });
            continue;
        }

        let total = 0;
        let weightSum = 0;
        let wins = 0;
        let gameDiff = 0;
        mine.forEach((s, i) => {
            const w = seriesWeight(i, mine.length);
            const isHome = s.home_team_id === teamId;
            const won = s.winner_team_id === teamId;
            const gd = isHome ? s.home_score - s.away_score : s.away_score - s.home_score;
            const goals = isHome ? s.hg - s.ag : s.ag - s.hg;
            const oppId = isHome ? s.away_team_id : s.home_team_id;
            const oppPct = info.get(oppId)?.winPct ?? 0.5;
            const ffFactor = s.is_forfeit ? 0.6 : 1;
            // Opponent strength applies BOTH ways: beating the best team is worth
            // more, losing to the best team costs less.
            const result = (won ? 10 : -10) + oppPct * 6;
            total += w * ffFactor * (result + gd * 2 + goals * 0.5);
            weightSum += w * ffFactor;
            if (won) wins += 1;
            gameDiff += gd;
        });

        // Average per series — playing more series must not by itself score more.
        const raw = weightSum > 0 ? total / weightSum : 0;
        const score = BASELINE + raw + meta.rating / 50;

        // Kept compact — this line also renders on the card, which clips it.
        const notes = [`${wins}-${mine.length - wins} in last ${mine.length}`];
        // A double forfeit has no winner, so "lost latest" would be technically
        // right but read as if they were beaten — name it for what it was.
        notes.push(mine[0].winner_team_id === teamId ? 'won latest'
            : (mine[0].is_forfeit && mine[0].forfeit_kind === 'double') ? 'double FF latest'
            : 'lost latest');
        if (gameDiff !== 0) notes.push(`${gameDiff > 0 ? '+' : ''}${gameDiff} GD`);
        if (meta.rating) notes.push(`rating ${meta.rating.toFixed(1)}`);

        played.push({
            teamId,
            name: meta.name,
            score: round1(score),
            reason: notes.join(' · '),
            played: mine.length,
        });
    }

    played.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    unplayed.sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

    return [...played, ...unplayed.map(({ rating, ...t }) => t)]
        .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---- players ----------------------------------------------------------------

/** Per-game division averages — the denominators that make the weights meaningful. */
function divisionAverages(rows) {
    const n = rows.length;
    if (!n) return null;
    const sum = { score: 0, goals: 0, assists: 0, saves: 0, shots: 0, demos: 0, demosTaken: 0 };
    for (const r of rows) {
        sum.score += num(r.score);
        sum.goals += num(r.goals);
        sum.assists += num(r.assists);
        sum.saves += num(r.saves);
        sum.shots += num(r.shots);
        sum.demos += num(r.demos_inflicted);
        sum.demosTaken += num(r.demos_taken);
    }
    return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / n]));
}

/** One game line scored against the division baseline. 100 = dead average. */
function gamePerformance(g, avg) {
    const raw =
        W.goals * ratio(g.goals, avg.goals) +
        W.score * ratio(g.score, avg.score) +
        W.saves * ratio(g.saves, avg.saves) +
        W.assists * ratio(g.assists, avg.assists) +
        W.shots * ratio(g.shots, avg.shots) +
        W.demos * ratio(g.demos_inflicted, avg.demos) -
        W_DEMOS_TAKEN * ratio(g.demos_taken, avg.demosTaken);

    let perf = (raw / W_TOTAL) * BASELINE;
    if (g.mvp) perf += MVP_BONUS;
    // Result matters: a big stat line in a loss is worth less than the same
    // line in a win. Forfeited series produce no game rows, so they never
    // reach here — players are unaffected by forfeits.
    const won = g.team_id != null && g.game_winner_team_id === g.team_id;
    return perf * (won ? 1 + WIN_BONUS : 1 - WIN_BONUS);
}

async function computePlayerRankings(seasonId, division, week = null, top = 10) {
    const cap = week == null ? Number.MAX_SAFE_INTEGER : Number(week);
    const rows = await pool.query(
        `SELECT gp.discord_id, gp.team_id, gp.score, gp.goals, gp.assists, gp.saves, gp.shots,
            gp.demos_inflicted, gp.demos_taken, gp.mvp, gp.series_id,
            s.week, gm.game_number, gm.winner_team_id AS game_winner_team_id,
            t.name AS team_name
         FROM stats_game_players gp
         JOIN stats_series s ON s.id = gp.series_id
         JOIN stats_games gm ON gm.id = gp.game_id
         LEFT JOIN teams t ON t.id = gp.team_id
         WHERE gp.season_id=$1 AND gp.division=$2 AND gp.is_playoff=FALSE
           AND s.status='confirmed' AND gp.discord_id IS NOT NULL
           AND COALESCE(s.week, 0) <= $3
         ORDER BY s.week DESC NULLS LAST, s.id DESC, gm.game_number DESC`,
        [seasonId, division, cap]
    );
    if (!rows.rows.length) return [];

    // Baselines come from the division's whole season UP TO THE WEEK CAP, not
    // just each player's window, so the denominators are stable week to week —
    // and a re-run of an old week uses the averages that week actually had.
    const avg = divisionAverages(rows.rows);
    if (!avg) return [];

    // Rows arrive newest-first, so the first N_SERIES distinct series ids we
    // see for a player ARE their most recent ones.
    const byPlayer = new Map();
    for (const r of rows.rows) {
        if (!byPlayer.has(r.discord_id)) {
            byPlayer.set(r.discord_id, { games: [], team: r.team_name, seriesIds: [] });
        }
        const p = byPlayer.get(r.discord_id);
        if (!p.seriesIds.includes(r.series_id)) {
            if (p.seriesIds.length >= N_SERIES) continue;
            p.seriesIds.push(r.series_id);
        }
        p.games.push(r);
    }

    const out = [];
    for (const [discordId, p] of byPlayer) {
        if (p.games.length < 3) continue; // not enough recent sample

        let total = 0;
        let weightSum = 0;
        let wins = 0;
        let goals = 0;
        for (const g of p.games) {
            // All games inside a series share that series' recency weight.
            const w = seriesWeight(p.seriesIds.indexOf(g.series_id), p.seriesIds.length);
            total += w * gamePerformance(g, avg);
            weightSum += w;
            if (g.team_id != null && g.game_winner_team_id === g.team_id) wins += 1;
            goals += num(g.goals);
        }

        // Divide by the SUM OF WEIGHTS, not the game count — dividing by the
        // count silently inflated small samples by ~21%.
        const raw = weightSum > 0 ? total / weightSum : BASELINE;
        const score = round1(shrink(raw, p.games.length));

        out.push({
            discordId,
            team: p.team,
            games: p.games.length,
            series: p.seriesIds.length,
            record: `${wins}-${p.games.length - wins}`,
            goalsPerGame: goals / p.games.length,
            score,
        });
    }

    out.sort((a, b) => b.score - a.score);

    // Resolve display names for the ones we are about to publish.
    const shortlist = out.slice(0, top);
    const ids = shortlist.map((p) => p.discordId);
    const names = new Map();
    if (ids.length) {
        const r = await pool.query(
            `SELECT discord_id, display_name, username FROM discord_members WHERE discord_id = ANY($1)`, [ids]
        ).catch((err) => {
            Logger.warning(`power rankings: name lookup failed — ${err.message}`);
            return { rows: [] };
        });
        for (const row of r.rows) names.set(String(row.discord_id), row.display_name || row.username);
    }

    return shortlist.map((p, i) => ({
        ...p,
        rank: i + 1,
        name: names.get(String(p.discordId)) || `User ${String(p.discordId).slice(-4)}`,
    }));
}

/** The note line shown under a player on the website and the card. */
function playerNote(p) {
    const bits = [];
    if (p.team) bits.push(p.team);
    bits.push(`form ${p.score} (100 = division avg)`);
    bits.push(`${p.record} in last ${p.games} games`);
    bits.push(`${p.goalsPerGame.toFixed(1)} goals/game`);
    return bits.join(' · ');
}

// ---- persistence ------------------------------------------------------------

/**
 * Persist one WEEK's team+player rankings, with trend vs the PREVIOUS WEEK.
 *
 * Trend used to compare against "whatever was stored last", which meant
 * re-running the same week marked every entry 'same'. Comparing against the
 * newest stored week strictly BEFORE this one makes a redo idempotent: running
 * week 6 twice still shows movement against week 5.
 */
async function savePowerRankings(seasonId, division, week, teams, players) {
    const prev = await pool.query(
        `SELECT entity_type, team_id, player_discord_id, rank FROM power_rankings
         WHERE season_id=$1 AND division=$2
           AND week = (SELECT MAX(week) FROM power_rankings
                        WHERE season_id=$1 AND division=$2 AND week IS NOT NULL AND week < $3)`,
        [seasonId, division, week]
    ).catch(() => ({ rows: [] }));
    const prevTeam = new Map(prev.rows.filter((r) => r.entity_type === 'team').map((r) => [r.team_id, r.rank]));
    const prevPlayer = new Map(prev.rows.filter((r) => r.entity_type === 'player').map((r) => [String(r.player_discord_id), r.rank]));
    const trend = (oldRank, newRank) => oldRank == null ? 'new' : oldRank > newRank ? 'up' : oldRank < newRank ? 'down' : 'same';

    // Only THIS week is replaced — weeks either side are left alone. The NULL
    // sweep clears legacy pre-week rows once; the backfill supersedes them.
    await pool.query(
        `DELETE FROM power_rankings WHERE season_id=$1 AND division=$2 AND (week = $3 OR week IS NULL)`,
        [seasonId, division, week]
    );
    for (const t of teams) {
        await pool.query(
            `INSERT INTO power_rankings (season_id, entity_type, division, week, rank, team_id, note, trend, updated_by_username)
             VALUES ($1,'team',$2,$3,$4,$5,$6,$7,'auto')`,
            [seasonId, division, week, t.rank, t.teamId, t.reason, trend(prevTeam.get(t.teamId), t.rank)]
        );
        t.trend = trend(prevTeam.get(t.teamId), t.rank);
    }
    for (const p of players) {
        await pool.query(
            `INSERT INTO power_rankings (season_id, entity_type, division, week, rank, player_discord_id, note, trend, updated_by_username)
             VALUES ($1,'player',$2,$3,$4,$5,$6,$7,'auto')`,
            [seasonId, division, week, p.rank, String(p.discordId), playerNote(p), trend(prevPlayer.get(String(p.discordId)), p.rank)]
        );
        p.trend = trend(prevPlayer.get(String(p.discordId)), p.rank);
    }
}

/**
 * Compute + save ONE division for ONE week. Returns { teams, players, week }.
 * A null week means "the latest week with results" (resolved here so callers
 * that don't care — e.g. the week-close hook passes its own — stay simple).
 */
async function refreshPowerRankings(seasonId, division, week = null) {
    if (!db()) return { teams: [], players: [], week: null };
    // Required lazily: rankingWeek pulls in weekNumber, and this keeps the
    // module cheap for callers that already know their week.
    const { resolveRankingWeek } = require('./rankingWeek');
    const wk = await resolveRankingWeek(seasonId, week);
    const teams = await computeTeamRankings(seasonId, division, wk);
    const players = await computePlayerRankings(seasonId, division, wk, 10);
    if (teams.length || players.length) await savePowerRankings(seasonId, division, wk, teams, players);
    return { teams, players, week: wk };
}

module.exports = { computeTeamRankings, computePlayerRankings, refreshPowerRankings, savePowerRankings, playerNote };
