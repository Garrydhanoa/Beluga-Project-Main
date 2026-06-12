/**
 * Auto power rankings — teams AND players, computed from recent results.
 *
 * Team form score (recency-weighted over the last N=5 series):
 *   win=+10/loss=-6, game diff ×2, goal diff ×0.5, opponent strength bonus
 *   (their series win% ×6), small Beluga team-rating tiebreak. FF wins count
 *   slightly less than played wins.
 * Player form score (last 10 games, recency-weighted): the operator-approved
 *   weighting — goals 30, assists 15, saves 20, shots 5, score/100 ×25,
 *   demos inflicted 5, demos taken −2, MVP +12.
 *
 * Rankings persist to the existing power_rankings table (entity_type
 * 'team'|'player', per division), with trend computed vs the previous run.
 * Recomputed on demand (/power-rankings, admin button) and when a week closes.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

const N_SERIES = 5;
const N_GAMES = 10;

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function computeTeamRankings(seasonId, division) {
    // Team aggregates for rating + win%.
    const agg = await pool.query(
        `SELECT ts.team_id, t.name, ts.series_wins, ts.series_losses, ts.beluga_score
         FROM stats_team_season ts JOIN teams t ON t.id = ts.team_id
         WHERE ts.season_id=$1 AND ts.division=$2 AND ts.is_playoff=FALSE`,
        [seasonId, division]
    );
    if (!agg.rows.length) return [];
    const info = new Map(agg.rows.map((r) => [r.team_id, {
        name: r.name,
        winPct: (Number(r.series_wins) + Number(r.series_losses)) > 0
            ? Number(r.series_wins) / (Number(r.series_wins) + Number(r.series_losses)) : 0.5,
        rating: Number(r.beluga_score || 0),
    }]));

    const series = await pool.query(
        `SELECT s.id, s.home_team_id, s.away_team_id, s.winner_team_id, s.is_forfeit,
            s.home_score, s.away_score,
            COALESCE(SUM(g.home_goals),0)::int AS hg, COALESCE(SUM(g.away_goals),0)::int AS ag
         FROM stats_series s LEFT JOIN stats_games g ON g.series_id = s.id
         WHERE s.season_id=$1 AND s.division=$2 AND s.is_playoff=FALSE AND s.status='confirmed'
         GROUP BY s.id ORDER BY s.id DESC`,
        [seasonId, division]
    );

    const results = [];
    for (const [teamId, meta] of info) {
        const mine = series.rows.filter((s) => s.home_team_id === teamId || s.away_team_id === teamId).slice(0, N_SERIES);
        let score = 0;
        let wins = 0;
        const notes = [];
        mine.forEach((s, i) => {
            const w = (N_SERIES - i) / N_SERIES; // most recent weighted highest
            const isHome = s.home_team_id === teamId;
            const won = s.winner_team_id === teamId;
            const gd = (isHome ? s.home_score - s.away_score : s.away_score - s.home_score);
            const goals = (isHome ? s.hg - s.ag : s.ag - s.hg);
            const oppId = isHome ? s.away_team_id : s.home_team_id;
            const oppPct = info.get(oppId)?.winPct ?? 0.5;
            const ffFactor = s.is_forfeit ? 0.6 : 1;
            score += w * ffFactor * ((won ? 10 : -6) + gd * 2 + goals * 0.5 + (won ? oppPct * 6 : 0));
            if (won) wins += 1;
        });
        score += meta.rating / 50; // small rating tiebreak
        const recent = mine.length ? `${wins}-${mine.length - wins} in last ${mine.length}` : 'no series yet';
        notes.push(recent);
        if (mine[0]) notes.push(mine[0].winner_team_id === teamId ? 'won their latest series' : 'dropped their latest series');
        if (meta.rating) notes.push(`team rating ${meta.rating.toFixed(1)}`);
        results.push({ teamId, name: meta.name, score: Math.round(score * 10) / 10, reason: notes.join(' · '), played: mine.length });
    }
    results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return results.map((r, i) => ({ ...r, rank: i + 1 }));
}

async function computePlayerRankings(seasonId, division, top = 10) {
    const rows = await pool.query(
        `SELECT gp.discord_id, gp.score, gp.goals, gp.assists, gp.saves, gp.shots,
            gp.demos_inflicted, gp.demos_taken, gp.mvp, gp.id,
            t.name AS team_name
         FROM stats_game_players gp
         LEFT JOIN teams t ON t.id = gp.team_id
         WHERE gp.season_id=$1 AND gp.division=$2 AND gp.is_playoff=FALSE AND gp.discord_id IS NOT NULL
         ORDER BY gp.id DESC`,
        [seasonId, division]
    );
    const byPlayer = new Map();
    for (const r of rows.rows) {
        if (!byPlayer.has(r.discord_id)) byPlayer.set(r.discord_id, { games: [], team: r.team_name });
        const p = byPlayer.get(r.discord_id);
        if (p.games.length < N_GAMES) p.games.push(r);
    }
    const out = [];
    for (const [discordId, p] of byPlayer) {
        if (p.games.length < 3) continue; // not enough recent sample
        let score = 0;
        p.games.forEach((g, i) => {
            const w = (p.games.length - i) / p.games.length;
            score += w * (
                Number(g.goals) * 30 + Number(g.assists) * 15 + Number(g.saves) * 20 +
                Number(g.shots) * 5 + Number(g.score) / 100 * 25 +
                Number(g.demos_inflicted) * 5 - Number(g.demos_taken) * 2 + (g.mvp ? 12 : 0)
            );
        });
        score = score / p.games.length;
        out.push({ discordId, team: p.team, games: p.games.length, score: Math.round(score * 10) / 10 });
    }
    out.sort((a, b) => b.score - a.score);
    // Resolve display names.
    const ids = out.slice(0, top).map((p) => p.discordId);
    const names = new Map();
    if (ids.length) {
        const r = await pool.query(
            `SELECT discord_id, display_name, username FROM discord_members WHERE discord_id = ANY($1)`, [ids]
        ).catch(() => ({ rows: [] }));
        for (const row of r.rows) names.set(String(row.discord_id), row.display_name || row.username);
    }
    return out.slice(0, top).map((p, i) => ({
        ...p, rank: i + 1,
        name: names.get(String(p.discordId)) || `User ${String(p.discordId).slice(-4)}`,
    }));
}

/** Persist team+player rankings with trend vs the previous saved run. */
async function savePowerRankings(seasonId, division, teams, players) {
    const prev = await pool.query(
        `SELECT entity_type, team_id, player_discord_id, rank FROM power_rankings
         WHERE season_id=$1 AND division=$2`,
        [seasonId, division]
    ).catch(() => ({ rows: [] }));
    const prevTeam = new Map(prev.rows.filter((r) => r.entity_type === 'team').map((r) => [r.team_id, r.rank]));
    const prevPlayer = new Map(prev.rows.filter((r) => r.entity_type === 'player').map((r) => [String(r.player_discord_id), r.rank]));
    const trend = (oldRank, newRank) => oldRank == null ? 'new' : oldRank > newRank ? 'up' : oldRank < newRank ? 'down' : 'same';

    await pool.query(`DELETE FROM power_rankings WHERE season_id=$1 AND division=$2`, [seasonId, division]);
    for (const t of teams) {
        await pool.query(
            `INSERT INTO power_rankings (season_id, entity_type, division, rank, team_id, note, trend, updated_by_username)
             VALUES ($1,'team',$2,$3,$4,$5,$6,'auto')`,
            [seasonId, division, t.rank, t.teamId, t.reason, trend(prevTeam.get(t.teamId), t.rank)]
        );
        t.trend = trend(prevTeam.get(t.teamId), t.rank);
    }
    for (const p of players) {
        await pool.query(
            `INSERT INTO power_rankings (season_id, entity_type, division, rank, player_discord_id, note, trend, updated_by_username)
             VALUES ($1,'player',$2,$3,$4,$5,$6,'auto')`,
            [seasonId, division, p.rank, String(p.discordId), `${p.team || ''} · form ${p.score}`, trend(prevPlayer.get(String(p.discordId)), p.rank)]
        );
        p.trend = trend(prevPlayer.get(String(p.discordId)), p.rank);
    }
}

/** Compute + save for one division. Returns { teams, players }. */
async function refreshPowerRankings(seasonId, division) {
    if (!db()) return { teams: [], players: [] };
    const teams = await computeTeamRankings(seasonId, division);
    const players = await computePlayerRankings(seasonId, division, 10);
    if (teams.length || players.length) await savePowerRankings(seasonId, division, teams, players);
    return { teams, players };
}

module.exports = { computeTeamRankings, computePlayerRankings, refreshPowerRankings };
