/**
 * Recompute aggregates for a single series via statsStore.recomputeForSeries().
 * Usage:  node tools/recompute-series.js <seriesId>
 *
 * recomputeForSeries derives the two teams from the series row (home/away team id),
 * so it correctly rebuilds team standings even when a series has NO player rows
 * (all-skipped or forfeit) — unlike recomputeAllForSeason, which only visits teams
 * found in stats_game_players and therefore can't reach such a series.
 *
 * Local-machine note: src/utils/database.js builds its pool from DATABASE_URL,
 * which here is the internal Railway host (unreachable). Point it at the public URL
 * before requiring statsStore. Read-only on series/game rows (recompute only).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;

const seriesId = Number(process.argv[2]);
if (!Number.isInteger(seriesId)) { console.error('Pass a numeric series id.'); process.exit(1); }

const statsStore = require('../src/stats/statsStore');

(async () => {
    console.log(`Recomputing aggregates for series #${seriesId}…`);
    await statsStore.recomputeForSeries(seriesId);
    console.log('✅ recompute done.');
    process.exit(0);
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
