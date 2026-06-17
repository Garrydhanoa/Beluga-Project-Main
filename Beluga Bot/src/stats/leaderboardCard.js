/**
 * Leaderboard image — beluga/ocean themed per-division stat-leader card for the
 * /leaderboard command. Renders the top AVERAGE leaders (min-games gated) in a
 * hero Beluga Score column plus a grid of per-stat boards, matching the website
 * leaderboards page and the standings/power-ranking card brand.
 */

const { createCanvas } = require('canvas');
const { pool, isDatabaseAvailable } = require('../utils/database');
const { config } = require('../../src/config/config');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';
const MIN_GAMES = 25; // matches the website leaderboards gate

function db() { return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable; }

function drawWaves(ctx, W, H) {
    for (let i = 0; i < 4; i += 1) {
        const baseY = H * (0.3 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, baseY + Math.sin((x / W) * Math.PI * 3 + i * 1.3) * 16);
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        ctx.fillStyle = `rgba(40, 90, 160, ${0.04 + i * 0.02})`;
        ctx.fill();
    }
}

function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

const rankColor = (i) => (i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'rgba(125,211,252,0.85)');
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);

/**
 * Fetch the average leaders for a division (season-scoped), min-games gated.
 * Returns { beluga, goals, assists, saves } each an array of {name, value}.
 */
async function getDivisionLeaders(seasonId, division, top = 6) {
    if (!db()) return null;
    // Per-player season totals joined to a display name (discord_members → fallback).
    const res = await pool.query(
        `SELECT sps.discord_id, sps.games,
                sps.score, sps.goals, sps.assists, sps.saves, sps.shots, sps.demos_inflicted, sps.beluga_score,
                COALESCE(dm.display_name, dm.username, 'User ' || RIGHT(sps.discord_id, 4)) AS name
           FROM stats_player_season sps
           LEFT JOIN discord_members dm ON dm.discord_id = sps.discord_id
          WHERE sps.season_id = $1 AND sps.division = $2 AND sps.is_playoff = FALSE AND sps.games >= $3`,
        [seasonId, division, MIN_GAMES]
    );
    const rows = res.rows.map((r) => {
        const g = Number(r.games) || 1;
        return {
            name: r.name,
            beluga: Number(r.beluga_score || 0),
            goals: Number(r.goals || 0) / g,
            assists: Number(r.assists || 0) / g,
            saves: Number(r.saves || 0) / g,
        };
    });
    const board = (key, dp) => [...rows]
        .sort((a, b) => b[key] - a[key])
        .slice(0, top)
        .map((r) => ({ name: r.name, value: r[key].toFixed(dp) }));
    return {
        beluga: board('beluga', 2),
        goals: board('goals', 2),
        assists: board('assists', 2),
        saves: board('saves', 2),
        qualifiers: rows.length,
    };
}

function drawBoard(ctx, x, y, w, title, rows, accent) {
    roundRect(ctx, x, y, w, 240, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.18)'; ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = accent; ctx.font = `bold 16px ${FONT}`;
    ctx.fillText(title, x + 16, y + 28);
    let ry = y + 58;
    if (!rows || rows.length === 0) {
        ctx.fillStyle = '#7d93b3'; ctx.font = `italic 14px ${FONT}`;
        ctx.fillText('No qualifiers yet', x + 16, ry);
        return;
    }
    for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        ctx.textAlign = 'left';
        ctx.fillStyle = rankColor(i); ctx.font = `bold 15px ${FONT}`;
        ctx.fillText(medal(i), x + 16, ry);
        ctx.fillStyle = '#dbe7ff'; ctx.font = `15px ${FONT}`;
        const name = String(r.name).length > 16 ? `${String(r.name).slice(0, 15)}…` : r.name;
        ctx.fillText(name, x + 46, ry);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff'; ctx.font = `bold 15px ${FONT}`;
        ctx.fillText(String(r.value), x + w - 16, ry);
        ry += 30;
    }
}

/**
 * @param {object} leaders  result of getDivisionLeaders
 * @param {{division, seasonNumber}} meta
 * @returns {Promise<Buffer>}
 */
async function buildLeaderboardImage(leaders, meta) {
    const W = 1140; const H = 700;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#06101f'); grad.addColorStop(0.55, '#0b1f3a'); grad.addColorStop(1, '#0e2a4f');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    drawWaves(ctx, W, H);

    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#3b82f6'); bar.addColorStop(1, '#7dd3fc');
    ctx.fillStyle = bar; ctx.fillRect(0, 0, W, 8);

    // Header
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7dd3fc'; ctx.font = `bold 18px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE  ·  LEADERBOARD', 40, 50);
    ctx.fillStyle = '#ffffff'; ctx.font = `bold 40px ${FONT}`;
    ctx.fillText(`${meta.division} Division`, 40, 96);
    if (meta.seasonNumber != null) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#9fb6d8'; ctx.font = `bold 22px ${FONT}`;
        ctx.fillText(`Season ${meta.seasonNumber}`, W - 40, 60);
        ctx.fillStyle = '#6f8fb8'; ctx.font = `14px ${FONT}`;
        ctx.fillText(`min. ${MIN_GAMES} games · ${leaders?.qualifiers ?? 0} qualifiers`, W - 40, 86);
    }

    // Hero Beluga Score board (left, taller) + 3 stat boards (right grid).
    const top = 130; const gap = 20;
    const heroW = 420;
    // Hero panel — tall enough to balance the two stacked right-column boards.
    roundRect(ctx, 40, top, heroW, 510, 18);
    ctx.fillStyle = 'rgba(34,211,238,0.08)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(34,211,238,0.35)'; ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#67e8f9'; ctx.font = `bold 18px ${FONT}`;
    ctx.fillText('🐳 BELUGA SCORE', 60, top + 32);
    let hy = top + 70;
    const bel = leaders?.beluga || [];
    if (!bel.length) {
        ctx.fillStyle = '#7d93b3'; ctx.font = `italic 15px ${FONT}`;
        ctx.fillText('No players have reached the min games yet.', 60, hy);
    } else {
        for (let i = 0; i < bel.length; i += 1) {
            const r = bel[i];
            ctx.textAlign = 'left';
            ctx.fillStyle = rankColor(i); ctx.font = `bold 20px ${FONT}`;
            ctx.fillText(medal(i), 60, hy);
            ctx.fillStyle = '#eaf2ff'; ctx.font = `${i === 0 ? 'bold ' : ''}18px ${FONT}`;
            const name = String(r.name).length > 18 ? `${String(r.name).slice(0, 17)}…` : r.name;
            ctx.fillText(name, 94, hy);
            ctx.textAlign = 'right';
            ctx.fillStyle = '#67e8f9'; ctx.font = `bold 20px ${FONT}`;
            ctx.fillText(String(r.value), 40 + heroW - 20, hy);
            hy += 44;
        }
    }

    // Right grid: goals, assists, saves
    const gx = 40 + heroW + gap;
    const gw = (W - gx - 40 - gap) / 2;
    drawBoard(ctx, gx, top, gw, 'AVG GOALS', leaders?.goals, '#7CFC9B');
    drawBoard(ctx, gx + gw + gap, top, gw, 'AVG ASSISTS', leaders?.assists, '#FFD27D');
    drawBoard(ctx, gx, top + 240 + 30, gw, 'AVG SAVES', leaders?.saves, '#7dd3fc');

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5a7398'; ctx.font = `14px ${FONT}`;
    ctx.fillText('🐳 Beluga League — average leaders (min. ' + MIN_GAMES + ' games)', W / 2, H - 22);

    return canvas.toBuffer('image/png');
}

module.exports = { getDivisionLeaders, buildLeaderboardImage, MIN_GAMES };
