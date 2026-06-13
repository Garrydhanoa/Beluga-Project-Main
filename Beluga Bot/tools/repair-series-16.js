/**
 * One-off repair for series #16 (AA w1) — recorded flipped by the old
 * orientation bug: DB credits InTraCate (team 92) with Kingdom's (team 93)
 * 3–2 win. Ballchasing truth: group "Kingdom AA 3 - Intracate AA 2".
 *
 * ⚠️ WRITES TO THE LIVE DB. Run only with operator approval:
 *    node tools/repair-series-16.js --apply
 * Without --apply it prints what it would do (dry run).
 *
 * What it does: swaps home/away scores on the series, swaps per-game goals,
 * repoints winner_team_id on series + games, then recomputes season 6
 * aggregates. (No player rows exist for this series — all were skipped.)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const SERIES_ID = 16;
const HOME_ID = 92; // InTraCate AA
const AWAY_ID = 93; // Kingdom AA

const pool = new Pool({
    connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

(async () => {
    const apply = process.argv.includes('--apply');

    const s = (await pool.query('SELECT home_score, away_score, winner_team_id FROM stats_series WHERE id=$1', [SERIES_ID])).rows[0];
    const games = (await pool.query('SELECT id, game_number, home_goals, away_goals, winner_team_id FROM stats_games WHERE series_id=$1 ORDER BY game_number', [SERIES_ID])).rows;
    const players = (await pool.query('SELECT count(*)::int c FROM stats_game_players WHERE series_id=$1', [SERIES_ID])).rows[0].c;

    // Idempotency guard: this is a one-off, non-idempotent swap. If it already shows the
    // corrected result (Kingdom won, away_score > home_score), refuse so a re-run can't
    // flip it back. (Applied + verified 2026-06-13.)
    if (s.winner_team_id === AWAY_ID) {
        console.log('✅ Series #16 already shows the corrected result (winner Kingdom 2-3). Nothing to do.');
        await pool.end();
        return;
    }

    console.log(`Series #${SERIES_ID} now: home ${s.home_score}-${s.away_score} away, winner ${s.winner_team_id}, player rows: ${players}`);
    console.log(`After repair:      home ${s.away_score}-${s.home_score} away, winner ${s.winner_team_id === HOME_ID ? AWAY_ID : HOME_ID}`);
    for (const g of games) {
        console.log(`  game ${g.game_number}: ${g.home_goals}-${g.away_goals} → ${g.away_goals}-${g.home_goals}`);
    }
    if (players !== 0) {
        console.log('❌ ABORT: player rows exist now — re-audit before repairing.');
        process.exit(1);
    }
    if (!apply) { console.log('\nDry run only. Re-run with --apply to write.'); await pool.end(); return; }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE stats_series SET home_score = away_score, away_score = home_score,
                winner_team_id = CASE winner_team_id WHEN $2 THEN $3 ELSE $2 END
             WHERE id = $1`, [SERIES_ID, HOME_ID, AWAY_ID]
        );
        await client.query(
            `UPDATE stats_games SET home_goals = away_goals, away_goals = home_goals,
                winner_team_id = CASE WHEN away_goals > home_goals THEN $2::int ELSE $3::int END
             WHERE series_id = $1`, [SERIES_ID, HOME_ID, AWAY_ID]
        );
        // (away_goals/home_goals in the CASE refer to pre-update values per SQL semantics.)
        await client.query(
            `INSERT INTO stats_audit_log (series_id, action, detail)
             VALUES ($1, 'series_edited', '{"reason":"orientation repair — recorded flipped by the fixed homeIdx bug; verified vs Ballchasing group"}'::jsonb)`,
            [SERIES_ID]
        );
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    console.log('✅ series + games updated. Recomputing aggregates…');

    // statsStore -> src/utils/database.js builds its pool from DATABASE_URL, which on a
    // local machine is the internal Railway host (unreachable). Point it at the public
    // URL before requiring statsStore.
    if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;
    const statsStore = require('../src/stats/statsStore');
    // recomputeForSeries derives both teams from the series row, so it rebuilds standings
    // even though this series has 0 player rows. recomputeAllForSeason(SEASON_ID) would
    // NOT — it only visits teams found in stats_game_players, so it skips this series.
    await statsStore.recomputeForSeries(SERIES_ID);
    console.log('✅ recompute done.');

    const after = (await pool.query('SELECT home_score, away_score, winner_team_id FROM stats_series WHERE id=$1', [SERIES_ID])).rows[0];
    console.log('Series #16 after:', after);
    await pool.end();
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
