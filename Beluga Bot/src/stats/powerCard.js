/**
 * Power-rankings graphic — beluga/ocean themed: top 10 TEAMS (left, with logos,
 * trend arrows, form score) and top 10 PLAYERS (right, with team + form score).
 */
const { createCanvas, loadImage } = require('canvas');
const { getTeamLogoBuffer } = require('../utils/teamRoles');
const { config } = require('../config/config');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';

function trendGlyph(t) {
    if (t === 'up') return { text: '▲', color: '#2ecc71' };
    if (t === 'down') return { text: '▼', color: '#e74c3c' };
    if (t === 'new') return { text: '★', color: '#f1c40f' };
    return { text: '–', color: '#7f97b5' };
}

function rankColor(rank) {
    if (rank === 1) return '#FFD700';
    if (rank === 2) return '#C0C0C0';
    if (rank === 3) return '#CD7F32';
    return 'rgba(59,130,246,0.85)';
}

function waves(ctx, W, H) {
    for (let i = 0; i < 4; i += 1) {
        const baseY = H * (0.3 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, baseY + Math.sin((x / W) * Math.PI * 3 + i * 1.3) * 16);
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        ctx.fillStyle = `rgba(40,90,160,${0.04 + i * 0.02})`;
        ctx.fill();
    }
}

async function buildPowerRankingsImage({ division, seasonNumber, teams, players }) {
    const rows = Math.max(teams.length, players.length, 1);
    const W = 1200;
    const headerH = 120;
    const rowH = 58;
    const H = headerH + rows * rowH + 40;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#06101f'); grad.addColorStop(0.55, '#0b1f3a'); grad.addColorStop(1, '#102a52');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    waves(ctx, W, H);
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#a78bfa'); bar.addColorStop(1, '#7dd3fc');
    ctx.fillStyle = bar; ctx.fillRect(0, 0, W, 7);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c4b5fd'; ctx.font = `bold 20px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE', W / 2, 42);
    ctx.fillStyle = '#FFFFFF'; ctx.font = `bold 38px ${FONT}`;
    ctx.fillText(`${String(division).toUpperCase()} POWER RANKINGS`, W / 2, 84);
    if (seasonNumber != null) {
        ctx.fillStyle = '#8aa8cc'; ctx.font = `18px ${FONT}`;
        ctx.fillText(`Season ${seasonNumber}`, W / 2, 108);
    }

    const colTeams = { x: 30, w: 600 };
    const colPlayers = { x: 650, w: 520 };
    ctx.font = `bold 15px ${FONT}`; ctx.fillStyle = '#7dd3fc';
    ctx.textAlign = 'left';
    ctx.fillText('TEAMS', colTeams.x + 8, headerH - 4);
    ctx.fillText('PLAYERS (form)', colPlayers.x + 8, headerH - 4);

    const drawRowBg = (x, w, y) => {
        ctx.fillStyle = 'rgba(255,255,255,0.035)';
        ctx.beginPath(); ctx.roundRect(x, y - 2, w, rowH - 8, 10); ctx.fill();
    };
    const drawRank = (x, cy, rank) => {
        ctx.beginPath(); ctx.arc(x, cy, 16, 0, Math.PI * 2);
        ctx.fillStyle = rankColor(rank); ctx.fill();
        ctx.fillStyle = rank <= 3 ? '#0b1f3a' : '#fff';
        ctx.font = `bold 16px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(rank), x, cy + 1); ctx.textBaseline = 'alphabetic';
    };
    const drawTrend = (x, cy, t) => {
        const g = trendGlyph(t);
        ctx.fillStyle = g.color; ctx.font = `bold 18px ${FONT}`; ctx.textAlign = 'center';
        ctx.fillText(g.text, x, cy + 6);
    };

    for (let i = 0; i < rows; i += 1) {
        const y = headerH + 6 + i * rowH;
        const cy = y + rowH / 2 - 5;

        const t = teams[i];
        if (t) {
            drawRowBg(colTeams.x, colTeams.w, y);
            drawRank(colTeams.x + 28, cy, t.rank);
            try {
                // eslint-disable-next-line no-await-in-loop
                const buf = await getTeamLogoBuffer(t.teamId);
                if (buf) {
                    // eslint-disable-next-line no-await-in-loop
                    const img = await loadImage(buf);
                    ctx.save(); ctx.beginPath(); ctx.arc(colTeams.x + 70, cy, 18, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(img, colTeams.x + 52, cy - 18, 36, 36); ctx.restore();
                }
            } catch { /* logo optional */ }
            ctx.fillStyle = '#fff'; ctx.font = `bold 20px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(String(t.name).slice(0, 18), colTeams.x + 98, cy + 7);
            drawTrend(colTeams.x + colTeams.w - 90, cy, t.trend);
            ctx.fillStyle = '#9fc3ff'; ctx.font = `bold 18px ${FONT}`; ctx.textAlign = 'right';
            ctx.fillText(String(t.score), colTeams.x + colTeams.w - 18, cy + 7);
        }

        const p = players[i];
        if (p) {
            drawRowBg(colPlayers.x, colPlayers.w, y);
            drawRank(colPlayers.x + 28, cy, p.rank);
            ctx.fillStyle = '#fff'; ctx.font = `bold 19px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(String(p.name).slice(0, 16), colPlayers.x + 56, cy + 2);
            ctx.fillStyle = '#8aa8cc'; ctx.font = `13px ${FONT}`;
            ctx.fillText(String(p.team || '').slice(0, 22), colPlayers.x + 56, cy + 19);
            drawTrend(colPlayers.x + colPlayers.w - 90, cy, p.trend);
            ctx.fillStyle = '#9fc3ff'; ctx.font = `bold 18px ${FONT}`; ctx.textAlign = 'right';
            ctx.fillText(String(p.score), colPlayers.x + colPlayers.w - 18, cy + 7);
        }
    }

    ctx.fillStyle = '#5c7aa3'; ctx.font = `14px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('Form-based: recent series & per-game performance, recency-weighted · ▲ up ▼ down ★ new', W / 2, H - 14);
    return canvas.toBuffer('image/png');
}

module.exports = { buildPowerRankingsImage };
