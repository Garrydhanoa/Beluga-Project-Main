/**
 * Standings image — beluga/ocean themed, rendered from the DATABASE standings
 * (same data + tiebreakers as the website). Replaces the old Google-Sheet +
 * static-background generator.
 */

const { createCanvas, loadImage } = require('canvas');
const { getTeamLogoBuffer } = require('../utils/teamRoles');
const { config } = require('../../src/config/config');
const Logger = require('../utils/logger');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';

function rankBadgeColor(rank) {
    if (rank === 1) return '#FFD700';
    if (rank === 2) return '#C0C0C0';
    if (rank === 3) return '#CD7F32';
    return 'rgba(59,130,246,0.85)';
}

function drawWaves(ctx, W, H) {
    for (let i = 0; i < 4; i += 1) {
        const baseY = H * (0.3 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= W; x += 20) {
            ctx.lineTo(x, baseY + Math.sin((x / W) * Math.PI * 3 + i * 1.3) * 16);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = `rgba(40, 90, 160, ${0.04 + i * 0.02})`;
        ctx.fill();
    }
}

/**
 * @param {Array<{rank,teamId,teamName,wins,losses,gameDiff,goalDiff,rating}>} rows
 * @param {{division:string, seasonNumber:number|string|null, playoffLine?:number}} meta
 * @returns {Promise<Buffer>}
 */
async function buildStandingsImage(rows, meta) {
    const W = 1100;
    const headerH = 120;
    const rowH = 64;
    const footerH = 46;
    const H = headerH + rows.length * rowH + footerH;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background.
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#06101f');
    grad.addColorStop(0.55, '#0b1f3a');
    grad.addColorStop(1, '#0e2a4f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    drawWaves(ctx, W, H);
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#3b82f6');
    bar.addColorStop(1, '#7dd3fc');
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, 7);

    // Header.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7dd3fc';
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE', W / 2, 44);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 40px ${FONT}`;
    ctx.fillText(`${String(meta.division).toUpperCase()} STANDINGS`, W / 2, 88);
    if (meta.seasonNumber != null) {
        ctx.fillStyle = '#8aa8cc';
        ctx.font = `20px ${FONT}`;
        ctx.fillText(`Season ${meta.seasonNumber}`, W / 2, 112);
    }

    // Column headers.
    const colX = { rank: 56, logo: 110, name: 160, w: 660, l: 740, gd: 830, goal: 930, rating: 1035 };
    ctx.fillStyle = '#7dd3fc';
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('TEAM', colX.name, headerH - 2);
    ctx.textAlign = 'center';
    ctx.fillText('WINS', colX.w, headerH - 2);
    ctx.fillText('LOSSES', colX.l, headerH - 2);
    ctx.fillText('GAME DIFF', colX.gd, headerH - 2);
    ctx.fillText('GOAL DIFF', colX.goal, headerH - 2);
    ctx.fillText('RATING', colX.rating, headerH - 2);

    // Rows.
    for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const y = headerH + 8 + i * rowH;
        const cy = y + rowH / 2 - 4;

        // Row background (zebra) + playoff cutoff line.
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)';
        ctx.beginPath();
        ctx.roundRect(28, y - 4, W - 56, rowH - 8, 12);
        ctx.fill();
        if (meta.playoffLine && r.rank === meta.playoffLine + 1) {
            ctx.strokeStyle = 'rgba(125,211,252,0.6)';
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(28, y - 6);
            ctx.lineTo(W - 28, y - 6);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Rank badge.
        ctx.beginPath();
        ctx.arc(colX.rank, cy, 19, 0, Math.PI * 2);
        ctx.fillStyle = rankBadgeColor(r.rank);
        ctx.fill();
        ctx.fillStyle = r.rank <= 3 ? '#0b1f3a' : '#FFFFFF';
        ctx.font = `bold 19px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(r.rank), colX.rank, cy + 1);
        ctx.textBaseline = 'alphabetic';

        // Logo (DB).
        try {
            // eslint-disable-next-line no-await-in-loop
            const buf = await getTeamLogoBuffer(r.teamId);
            if (buf) {
                // eslint-disable-next-line no-await-in-loop
                const img = await loadImage(buf);
                ctx.save();
                ctx.beginPath();
                ctx.arc(colX.logo, cy, 21, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(img, colX.logo - 21, cy - 21, 42, 42);
                ctx.restore();
            }
        } catch { /* logo optional */ }

        // Name + numbers.
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 24px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(String(r.teamName || '?').slice(0, 24), colX.name, cy + 8);

        ctx.textAlign = 'center';
        ctx.fillStyle = '#7CFC9B';
        ctx.font = `bold 24px ${FONT}`;
        ctx.fillText(String(r.wins), colX.w, cy + 8);
        ctx.fillStyle = '#ff9b9b';
        ctx.fillText(String(r.losses), colX.l, cy + 8);
        ctx.fillStyle = '#dbe7ff';
        ctx.font = `22px ${FONT}`;
        ctx.fillText((r.gameDiff > 0 ? '+' : '') + r.gameDiff, colX.gd, cy + 8);
        ctx.fillText((r.goalDiff > 0 ? '+' : '') + r.goalDiff, colX.goal, cy + 8);
        ctx.fillStyle = '#9fc3ff';
        ctx.fillText(r.rating ? Number(r.rating).toFixed(1) : '—', colX.rating, cy + 8);
    }

    // Footer.
    ctx.fillStyle = '#5c7aa3';
    ctx.font = `15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(
        `Tiebreakers: Wins → Losses → Head-to-Head → Game Diff → Goal Diff → Rating${meta.playoffLine ? `  ·  top ${meta.playoffLine} make playoffs` : ''}`,
        W / 2, H - 18
    );

    return canvas.toBuffer('image/png');
}

module.exports = { buildStandingsImage };
