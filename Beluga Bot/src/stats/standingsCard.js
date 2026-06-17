/**
 * Standings image — beluga/ocean themed, rendered from the DATABASE standings
 * (same data + tiebreakers as the website). Replaces the old Google-Sheet +
 * static-background generator.
 *
 * Full visual overhaul: per-team franchise-color accent bar, large rank
 * medallions with rings, combined W-L record + win% bar, game/goal diff and
 * rating columns, and a clear playoff cutoff divider.
 */

const { createCanvas, loadImage } = require('canvas');
const { getTeamLogoBuffer, getTeamColorInt } = require('../utils/teamRoles');
const { config } = require('../../src/config/config');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';

function intToHex(n) {
    if (!Number.isFinite(n)) return '#3b82f6';
    return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function rankBadgeColor(rank) {
    if (rank === 1) return '#FFD700';
    if (rank === 2) return '#C0C0C0';
    if (rank === 3) return '#CD7F32';
    return 'rgba(125,211,252,0.9)';
}

function withAlpha(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    if (!Number.isFinite(n)) return `rgba(59,130,246,${a})`;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
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

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

/**
 * @param {Array<{rank,teamId,teamName,wins,losses,gameDiff,goalDiff,rating}>} rows
 * @param {{division:string, seasonNumber:number|string|null, playoffLine?:number}} meta
 * @returns {Promise<Buffer>}
 */
async function buildStandingsImage(rows, meta) {
    const W = 1140;
    const headerH = 140;
    const rowH = 74;
    const rowGap = 10;
    const footerH = 56;
    const padTop = 16;
    const H = headerH + padTop + rows.length * (rowH + rowGap) + footerH;
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

    // Top accent bar.
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#3b82f6');
    bar.addColorStop(1, '#7dd3fc');
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, 8);

    // Header.
    ctx.textAlign = 'center';
    ctx.fillStyle = '#7dd3fc';
    ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE', W / 2, 50);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 44px ${FONT}`;
    ctx.fillText(`${String(meta.division).toUpperCase()} STANDINGS`, W / 2, 98);
    if (meta.seasonNumber != null) {
        ctx.fillStyle = '#8aa8cc';
        ctx.font = `20px ${FONT}`;
        ctx.fillText(`Season ${meta.seasonNumber}`, W / 2, 124);
    }

    // Column anchors.
    const colX = { rank: 60, logo: 124, name: 168, record: 612, pct: 760, gd: 880, goal: 980, rating: 1085 };

    // Column header strip.
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = 'rgba(125,211,252,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText('TEAM', colX.name, headerH - 6);
    ctx.textAlign = 'center';
    ctx.fillText('RECORD', colX.record, headerH - 6);
    ctx.fillText('WIN %', colX.pct, headerH - 6);
    ctx.fillText('GD', colX.gd, headerH - 6);
    ctx.fillText('GOAL D', colX.goal, headerH - 6);
    ctx.fillText('RATING', colX.rating, headerH - 6);

    // Rows.
    for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const y = headerH + padTop + i * (rowH + rowGap);
        const cy = y + rowH / 2;

        // Resolve franchise color (accent) for this team.
        let accent = '#3b82f6';
        try {
            // eslint-disable-next-line no-await-in-loop
            const ci = await getTeamColorInt(r.teamId);
            accent = intToHex(ci);
        } catch { /* default accent */ }

        // Row card.
        ctx.save();
        roundRect(ctx, 28, y, W - 56, rowH, 16);
        const rowGrad = ctx.createLinearGradient(28, y, W - 28, y);
        rowGrad.addColorStop(0, withAlpha(accent, 0.16));
        rowGrad.addColorStop(0.25, 'rgba(255,255,255,0.035)');
        rowGrad.addColorStop(1, 'rgba(255,255,255,0.02)');
        ctx.fillStyle = rowGrad;
        ctx.fill();
        // subtle border
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.stroke();
        ctx.restore();

        // Left accent bar (franchise color).
        ctx.save();
        roundRect(ctx, 28, y, 6, rowH, 3);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.restore();

        // Playoff cutoff divider (drawn above the first non-playoff row).
        if (meta.playoffLine && r.rank === meta.playoffLine + 1) {
            ctx.save();
            ctx.strokeStyle = 'rgba(125,211,252,0.6)';
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 7]);
            ctx.beginPath();
            ctx.moveTo(28, y - rowGap / 2);
            ctx.lineTo(W - 28, y - rowGap / 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(125,211,252,0.8)';
            ctx.font = `bold 11px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.fillText('PLAYOFF CUTOFF', W / 2, y - rowGap / 2 - 4);
            ctx.restore();
        }

        // Rank medallion with ring.
        const badge = rankBadgeColor(r.rank);
        ctx.save();
        ctx.beginPath();
        ctx.arc(colX.rank, cy, 24, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(colX.rank, cy, 21, 0, Math.PI * 2);
        ctx.fillStyle = badge;
        ctx.fill();
        if (r.rank <= 3) {
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.45)';
            ctx.stroke();
        }
        ctx.fillStyle = r.rank <= 3 ? '#0b1f3a' : '#0b1f3a';
        ctx.font = `bold 20px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(r.rank), colX.rank, cy + 1);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();

        // Logo (DB) in a colored ring.
        try {
            // eslint-disable-next-line no-await-in-loop
            const buf = await getTeamLogoBuffer(r.teamId);
            if (buf) {
                // eslint-disable-next-line no-await-in-loop
                const img = await loadImage(buf);
                ctx.save();
                ctx.beginPath();
                ctx.arc(colX.logo, cy, 25, 0, Math.PI * 2);
                ctx.fillStyle = withAlpha(accent, 0.35);
                ctx.fill();
                ctx.beginPath();
                ctx.arc(colX.logo, cy, 22, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(img, colX.logo - 22, cy - 22, 44, 44);
                ctx.restore();
            }
        } catch { /* logo optional */ }

        // Team name.
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 26px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText(String(r.teamName || '?').slice(0, 22), colX.name, cy + 9);

        // Record (W-L) + win% bar.
        const wins = Number(r.wins || 0);
        const losses = Number(r.losses || 0);
        const total = wins + losses;
        const pct = total ? wins / total : 0;
        ctx.textAlign = 'center';
        ctx.font = `bold 24px ${FONT}`;
        ctx.fillStyle = '#7CFC9B';
        ctx.fillText(String(wins), colX.record - 22, cy + 1);
        ctx.fillStyle = '#6f86a8';
        ctx.font = `bold 18px ${FONT}`;
        ctx.fillText('–', colX.record, cy + 1);
        ctx.fillStyle = '#ff9b9b';
        ctx.font = `bold 24px ${FONT}`;
        ctx.fillText(String(losses), colX.record + 22, cy + 1);

        // Win% bar.
        const barX = colX.pct - 42;
        const barW = 84;
        const barY = cy + 8;
        ctx.save();
        roundRect(ctx, barX, barY, barW, 6, 3);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();
        roundRect(ctx, barX, barY, Math.max(4, barW * pct), 6, 3);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#dbe7ff';
        ctx.font = `bold 16px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(`${(pct * 100).toFixed(0)}%`, colX.pct, cy - 6);

        // Diffs + rating.
        ctx.font = `22px ${FONT}`;
        ctx.fillStyle = r.gameDiff >= 0 ? '#9fdcff' : '#c0c9d6';
        ctx.fillText((r.gameDiff > 0 ? '+' : '') + r.gameDiff, colX.gd, cy + 8);
        ctx.fillStyle = r.goalDiff >= 0 ? '#9fdcff' : '#c0c9d6';
        ctx.fillText((r.goalDiff > 0 ? '+' : '') + r.goalDiff, colX.goal, cy + 8);
        ctx.fillStyle = '#c4b5fd';
        ctx.font = `bold 20px ${FONT}`;
        ctx.fillText(r.rating ? Number(r.rating).toFixed(1) : '—', colX.rating, cy + 8);
    }

    // Footer.
    ctx.fillStyle = '#5c7aa3';
    ctx.font = `14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(
        `Tiebreakers: Wins → Losses → Head-to-Head → Game Diff → Goal Diff → Rating${meta.playoffLine ? `   ·   top ${meta.playoffLine} make playoffs` : ''}`,
        W / 2, H - 22
    );

    return canvas.toBuffer('image/png');
}

module.exports = { buildStandingsImage };
