/**
 * Power-rankings graphic — beluga/ocean themed: top 10 TEAMS (left, with logos,
 * franchise-color accents, trend pills, a one-line reason, form score) and
 * top 10 PLAYERS (right, with team + trend + form score).
 *
 * Full visual overhaul: two paneled columns, per-team franchise-color accent
 * bars + logo rings, reason line under each team, and clearer trend pills.
 */
const { createCanvas, loadImage } = require('canvas');
const { getTeamLogoBuffer, getTeamColorInt } = require('../utils/teamRoles');
const { config } = require('../config/config');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';

function intToHex(n) {
    if (!Number.isFinite(n)) return '#3b82f6';
    return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
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

function trendGlyph(t) {
    if (t === 'up') return { text: '▲', color: '#2ecc71', bg: 'rgba(46,204,113,0.18)' };
    if (t === 'down') return { text: '▼', color: '#e74c3c', bg: 'rgba(231,76,60,0.18)' };
    if (t === 'new') return { text: '★', color: '#f1c40f', bg: 'rgba(241,196,15,0.18)' };
    return { text: '–', color: '#7f97b5', bg: 'rgba(127,151,181,0.15)' };
}

function rankColor(rank) {
    if (rank === 1) return '#FFD700';
    if (rank === 2) return '#C0C0C0';
    if (rank === 3) return '#CD7F32';
    return 'rgba(125,211,252,0.9)';
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
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

function drawRank(ctx, x, cy, rank) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, cy, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, cy, 17, 0, Math.PI * 2);
    ctx.fillStyle = rankColor(rank); ctx.fill();
    if (rank <= 3) { ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.stroke(); }
    ctx.fillStyle = '#0b1f3a';
    ctx.font = `bold 17px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(rank), x, cy + 1); ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

function drawTrendPill(ctx, x, cy, t) {
    const g = trendGlyph(t);
    ctx.save();
    roundRect(ctx, x - 14, cy - 13, 28, 26, 8);
    ctx.fillStyle = g.bg; ctx.fill();
    ctx.fillStyle = g.color; ctx.font = `bold 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(g.text, x, cy + 1); ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

async function buildPowerRankingsImage({ division, seasonNumber, teams, players }) {
    const rows = Math.max(teams.length, players.length, 1);
    const W = 1240;
    const headerH = 138;
    const rowH = 70;
    const rowGap = 10;
    const padTop = 14;
    const footerH = 50;
    const H = headerH + padTop + rows * (rowH + rowGap) + footerH;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#06101f'); grad.addColorStop(0.55, '#0b1f3a'); grad.addColorStop(1, '#102a52');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    waves(ctx, W, H);
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#a78bfa'); bar.addColorStop(1, '#7dd3fc');
    ctx.fillStyle = bar; ctx.fillRect(0, 0, W, 8);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#c4b5fd'; ctx.font = `bold 22px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE', W / 2, 48);
    ctx.fillStyle = '#FFFFFF'; ctx.font = `bold 42px ${FONT}`;
    ctx.fillText(`${String(division).toUpperCase()} POWER RANKINGS`, W / 2, 96);
    if (seasonNumber != null) {
        ctx.fillStyle = '#8aa8cc'; ctx.font = `18px ${FONT}`;
        ctx.fillText(`Season ${seasonNumber}`, W / 2, 122);
    }

    const gutter = 24;
    const colTeams = { x: gutter, w: 700 };
    const colPlayers = { x: colTeams.x + colTeams.w + gutter, w: W - (colTeams.x + colTeams.w + gutter) - gutter };

    // Column titles.
    ctx.font = `bold 14px ${FONT}`; ctx.fillStyle = '#7dd3fc'; ctx.textAlign = 'left';
    ctx.fillText('TEAMS', colTeams.x + 6, headerH - 6);
    ctx.fillText('PLAYERS  ·  FORM', colPlayers.x + 6, headerH - 6);

    // Center divider.
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(colTeams.x + colTeams.w + gutter / 2, headerH);
    ctx.lineTo(colTeams.x + colTeams.w + gutter / 2, H - footerH);
    ctx.stroke();

    for (let i = 0; i < rows; i += 1) {
        const y = headerH + padTop + i * (rowH + rowGap);
        const cy = y + rowH / 2;

        // ---- TEAM ----
        const t = teams[i];
        if (t) {
            let accent = '#3b82f6';
            try {
                // eslint-disable-next-line no-await-in-loop
                accent = intToHex(await getTeamColorInt(t.teamId));
            } catch { /* default */ }

            ctx.save();
            roundRect(ctx, colTeams.x, y, colTeams.w, rowH, 14);
            const g = ctx.createLinearGradient(colTeams.x, y, colTeams.x + colTeams.w, y);
            g.addColorStop(0, withAlpha(accent, 0.16));
            g.addColorStop(0.3, 'rgba(255,255,255,0.035)');
            g.addColorStop(1, 'rgba(255,255,255,0.02)');
            ctx.fillStyle = g; ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
            ctx.restore();

            // accent bar
            ctx.save(); roundRect(ctx, colTeams.x, y, 5, rowH, 3); ctx.fillStyle = accent; ctx.fill(); ctx.restore();

            drawRank(ctx, colTeams.x + 32, cy, t.rank);

            // logo ring
            try {
                // eslint-disable-next-line no-await-in-loop
                const buf = await getTeamLogoBuffer(t.teamId);
                if (buf) {
                    // eslint-disable-next-line no-await-in-loop
                    const img = await loadImage(buf);
                    ctx.save();
                    ctx.beginPath(); ctx.arc(colTeams.x + 78, cy, 23, 0, Math.PI * 2);
                    ctx.fillStyle = withAlpha(accent, 0.35); ctx.fill();
                    ctx.beginPath(); ctx.arc(colTeams.x + 78, cy, 20, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(img, colTeams.x + 58, cy - 20, 40, 40);
                    ctx.restore();
                }
            } catch { /* logo optional */ }

            // name + reason
            ctx.fillStyle = '#fff'; ctx.font = `bold 22px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(String(t.name).slice(0, 20), colTeams.x + 110, cy - 4);
            if (t.reason) {
                ctx.fillStyle = '#9bb3d4'; ctx.font = `13px ${FONT}`;
                ctx.fillText(String(t.reason).slice(0, 52), colTeams.x + 110, cy + 17);
            }

            // trend pill + score (right)
            drawTrendPill(ctx, colTeams.x + colTeams.w - 96, cy, t.trend);
            ctx.fillStyle = '#c4b5fd'; ctx.font = `bold 22px ${FONT}`; ctx.textAlign = 'right';
            ctx.fillText(String(t.score), colTeams.x + colTeams.w - 18, cy + 8);
            ctx.fillStyle = '#5c7aa3'; ctx.font = `10px ${FONT}`;
            ctx.fillText('FORM', colTeams.x + colTeams.w - 18, cy - 12);
        }

        // ---- PLAYER ----
        const p = players[i];
        if (p) {
            ctx.save();
            roundRect(ctx, colPlayers.x, y, colPlayers.w, rowH, 14);
            ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
            ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
            ctx.restore();

            drawRank(ctx, colPlayers.x + 32, cy, p.rank);

            // Avatar (DB/Discord) in a cyan ring; falls back to nothing if absent.
            const avX = colPlayers.x + 78;
            if (p.avatarBuffer) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const img = await loadImage(p.avatarBuffer);
                    ctx.save();
                    ctx.beginPath(); ctx.arc(avX, cy, 21, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(125,211,252,0.35)'; ctx.fill();
                    ctx.beginPath(); ctx.arc(avX, cy, 18, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(img, avX - 18, cy - 18, 36, 36);
                    ctx.restore();
                } catch { /* avatar optional */ }
            } else {
                // placeholder dot ring so the column stays aligned
                ctx.save();
                ctx.beginPath(); ctx.arc(avX, cy, 18, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
                ctx.restore();
            }

            const nameX = colPlayers.x + 108;
            ctx.fillStyle = '#fff'; ctx.font = `bold 21px ${FONT}`; ctx.textAlign = 'left';
            ctx.fillText(String(p.name).slice(0, 16), nameX, cy - 4);
            ctx.fillStyle = '#8aa8cc'; ctx.font = `13px ${FONT}`;
            ctx.fillText(String(p.team || '').slice(0, 22), nameX, cy + 17);

            drawTrendPill(ctx, colPlayers.x + colPlayers.w - 96, cy, p.trend);
            ctx.fillStyle = '#9fc3ff'; ctx.font = `bold 22px ${FONT}`; ctx.textAlign = 'right';
            ctx.fillText(String(p.score), colPlayers.x + colPlayers.w - 18, cy + 8);
            ctx.fillStyle = '#5c7aa3'; ctx.font = `10px ${FONT}`;
            ctx.fillText('FORM', colPlayers.x + colPlayers.w - 18, cy - 12);
        }
    }

    ctx.fillStyle = '#5c7aa3'; ctx.font = `13px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('Form-based: recent series & per-game performance, recency-weighted   ·   ▲ up   ▼ down   ★ new', W / 2, H - 18);
    return canvas.toBuffer('image/png');
}

module.exports = { buildPowerRankingsImage };
