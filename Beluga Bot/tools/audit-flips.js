/**
 * Ground-truth flip audit (READ-ONLY).
 *
 * For every confirmed non-FF series with a Ballchasing group, re-fetch and
 * re-parse the group, anchor each parsed cluster to the DB home/away team via
 * the players' platform IDs recorded in stats_game_players, and compare the
 * recorded per-game goals + series score against Ballchasing truth.
 *
 * Output per series: PASS / FLIPPED / PARTIAL / UNVERIFIABLE (+ details).
 * Never writes to the database.
 *
 * Run: node tools/audit-flips.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const { parseSeries } = require('../src/stats/seriesParser');

const pool = new Pool({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

const pk = (platform, platformId) => `${platform}:${platformId}`;

async function auditSeries(s) {
    const games = (await pool.query(
        `SELECT id, game_number, ballchasing_replay_id, home_goals, away_goals
         FROM stats_games WHERE series_id = $1 ORDER BY game_number`, [s.id]
    )).rows;
    const players = (await pool.query(
        `SELECT game_id, team_id, platform, platform_id
         FROM stats_game_players WHERE series_id = $1`, [s.id]
    )).rows;

    let parsed;
    try {
        parsed = await parseSeries({ groupUrl: s.ballchasing_group_url, format: s.format || (s.is_playoff ? 'bo7' : 'bo5') });
    } catch (err) {
        return { verdict: 'UNVERIFIABLE', note: `parse threw: ${err.message}` };
    }
    if (parsed.fatal || !parsed.teams || parsed.teams.length !== 2) {
        return { verdict: 'UNVERIFIABLE', note: `parse failed: ${(parsed.issues || []).map((i) => i.code).join(',') || 'unknown'}` };
    }

    // Anchor: which cluster is the DB home team, voted by recorded platform IDs.
    const cluster0 = new Set(parsed.teams[0].players.map((p) => pk(p.platform, p.platformId)));
    const cluster1 = new Set(parsed.teams[1].players.map((p) => pk(p.platform, p.platformId)));
    let homeIn0 = 0; let homeIn1 = 0;
    for (const p of players) {
        const key = pk(p.platform, p.platform_id);
        if (p.team_id === s.home_team_id) {
            if (cluster0.has(key)) homeIn0 += 1;
            if (cluster1.has(key)) homeIn1 += 1;
        } else if (p.team_id === s.away_team_id) {
            if (cluster0.has(key)) homeIn1 += 1; // away player in cluster0 ⇒ home is cluster1
            if (cluster1.has(key)) homeIn0 += 1;
        }
    }
    if (homeIn0 === homeIn1) {
        return { verdict: 'UNVERIFIABLE', note: `cannot anchor clusters (votes ${homeIn0}:${homeIn1})` };
    }
    const homeIsT0 = homeIn0 > homeIn1;

    const parsedByReplay = new Map(parsed.games.map((g) => [g.replayId, g]));
    const rows = [];
    let flipped = 0; let ok = 0; let missing = 0;
    for (const g of games) {
        const truth = parsedByReplay.get(g.ballchasing_replay_id);
        if (!truth) { missing += 1; rows.push(`  game ${g.game_number}: replay not in group (edited?)`); continue; }
        const expHome = homeIsT0 ? truth.team0Goals : truth.team1Goals;
        const expAway = homeIsT0 ? truth.team1Goals : truth.team0Goals;
        if (g.home_goals === expHome && g.away_goals === expAway) { ok += 1; continue; }
        if (g.home_goals === expAway && g.away_goals === expHome && expHome !== expAway) {
            flipped += 1;
            rows.push(`  game ${g.game_number}: FLIPPED — recorded ${g.home_goals}-${g.away_goals}, truth ${expHome}-${expAway}`);
        } else {
            rows.push(`  game ${g.game_number}: MISMATCH — recorded ${g.home_goals}-${g.away_goals}, truth ${expHome}-${expAway} (manual edit?)`);
        }
    }

    const expHomeScore = homeIsT0 ? parsed.seriesScore.team0 : parsed.seriesScore.team1;
    const expAwayScore = homeIsT0 ? parsed.seriesScore.team1 : parsed.seriesScore.team0;
    const seriesOk = s.home_score === expHomeScore && s.away_score === expAwayScore;
    if (!seriesOk) rows.push(`  series score: recorded ${s.home_score}-${s.away_score}, truth ${expHomeScore}-${expAwayScore}`);

    let verdict = 'PASS';
    if (flipped === games.length - missing && flipped > 0) verdict = 'FLIPPED';
    else if (flipped > 0 || !seriesOk || rows.length) verdict = 'PARTIAL';
    return { verdict, note: `${ok}/${games.length} games match (anchor votes ${homeIn0}:${homeIn1})`, rows };
}

(async () => {
    const series = (await pool.query(
        `SELECT s.id, s.division, s.week, s.is_playoff, s.format, s.home_team_id, s.away_team_id,
                s.home_score, s.away_score, s.ballchasing_group_url,
                th.name AS home_name, ta.name AS away_name
         FROM stats_series s
         JOIN teams th ON th.id = s.home_team_id
         JOIN teams ta ON ta.id = s.away_team_id
         WHERE s.is_forfeit = FALSE AND s.ballchasing_group_url IS NOT NULL
         ORDER BY s.id`
    )).rows;

    console.log(`Auditing ${series.length} series against Ballchasing ground truth…\n`);
    const summary = { PASS: 0, FLIPPED: 0, PARTIAL: 0, UNVERIFIABLE: 0 };
    for (const s of series) {
        // eslint-disable-next-line no-await-in-loop
        const r = await auditSeries(s);
        summary[r.verdict] += 1;
        const icon = { PASS: '✅', FLIPPED: '🔄', PARTIAL: '⚠️', UNVERIFIABLE: '❓' }[r.verdict];
        console.log(`${icon} #${s.id} ${s.division} w${s.week} ${s.home_name} ${s.home_score}-${s.away_score} ${s.away_name} — ${r.verdict} (${r.note})`);
        for (const line of r.rows || []) console.log(line);
    }
    console.log(`\nSummary: ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    await pool.end();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
