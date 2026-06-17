/**
 * Canvas "result card" for a confirmed series — beluga/ocean themed.
 *   Top:    winning team (logo + name) on the left, loser on the right, big
 *           series score in the middle, division/week strip.
 *   Bottom: one tile per game — THAT game's winner logo on the left, loser on
 *           the right, logos only (no names), with the game score between.
 * Returns a PNG Buffer, or null on any failure (caller falls back to a plain
 * embed — the card is never load-bearing).
 */

const { createCanvas, loadImage } = require('canvas');
const { getTeamLogoBufferByName } = require('../../utils/teamRoles');
const { config } = require('../../config/config');
const Logger = require('../../utils/logger');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';

function truncate(s, n) { const v = String(s ?? ''); return v.length > n ? `${v.slice(0, n - 1)}…` : v; }

async function loadLogo(teamName) {
    // DB only (teams/franchise logo_data). Static PNGs were deleted; a missing
    // logo just renders team initials in drawLogo — never load a null buffer
    // (loadImage(null) hangs node-canvas).
    try {
        const buf = await getTeamLogoBufferByName(teamName);
        if (buf) return await loadImage(buf);
    } catch { /* missing logo is fine */ }
    return null;
}

function drawLogo(ctx, img, name, cx, cy, size) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img) {
        ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    } else {
        ctx.fillStyle = '#143055';
        ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
        ctx.fillStyle = '#9fc3ff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.round(size * 0.5)}px ${FONT}`;
        ctx.fillText((name || '?').slice(0, 1).toUpperCase(), cx, cy);
    }
    ctx.restore();
    // Thin ring around every logo.
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(120,170,255,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
}

/** Soft "ocean wave" bands across the background for the beluga theme. */
function drawWaves(ctx, W, H) {
    for (let i = 0; i < 4; i += 1) {
        const baseY = H * (0.35 + i * 0.18);
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= W; x += 20) {
            ctx.lineTo(x, baseY + Math.sin((x / W) * Math.PI * 3 + i * 1.4) * 14);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = `rgba(40, 90, 160, ${0.05 + i * 0.02})`;
        ctx.fill();
    }
}

/**
 * @param {object} o
 * @param {string} o.winnerName @param {string} o.loserName
 * @param {number} o.winnerScore @param {number} o.loserScore
 * @param {string} o.division @param {number|null} o.week
 * @param {boolean} [o.isForfeit]
 * @param {Array<{wName:string,lName:string,wGoals:number,lGoals:number}>} [o.games]
 *        Per game, already oriented: that game's winner first.
 * @returns {Promise<Buffer|null>}
 */
async function buildResultCard(o) {
    try {
        const games = Array.isArray(o.games) ? o.games.slice(0, 7) : [];
        const W = 1000;
        const TOP_H = 360;
        const GAMES_H = games.length ? 150 : 0;
        const H = TOP_H + GAMES_H;

        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        // Deep-ocean gradient + waves.
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#06101f');
        grad.addColorStop(0.5, '#0b1f3a');
        grad.addColorStop(1, '#0e2a4f');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        drawWaves(ctx, W, H);

        // Accent top bar.
        const bar = ctx.createLinearGradient(0, 0, W, 0);
        bar.addColorStop(0, '#3b82f6');
        bar.addColorStop(1, '#7dd3fc');
        ctx.fillStyle = bar;
        ctx.fillRect(0, 0, W, 7);

        // Header: league + division/week.
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#7dd3fc';
        ctx.font = `bold 20px ${FONT}`;
        ctx.fillText('🐳 BELUGA LEAGUE', W / 2, 38);
        ctx.fillStyle = '#8aa8cc';
        ctx.font = `22px ${FONT}`;
        ctx.fillText(`${o.division} · ${o.week != null ? `Week ${o.week}` : 'Series'}${o.isForfeit ? '  ·  FORFEIT' : ''}`, W / 2, 66);

        // Main: winner left, loser right.
        const logoSize = 170;
        const logoY = 175;
        const leftX = 175;
        const rightX = W - 175;
        const [wLogo, lLogo] = await Promise.all([loadLogo(o.winnerName), loadLogo(o.loserName)]);
        drawLogo(ctx, wLogo, o.winnerName, leftX, logoY, logoSize);
        drawLogo(ctx, lLogo, o.loserName, rightX, logoY, logoSize);

        ctx.fillStyle = '#34d399';
        ctx.font = `bold 22px ${FONT}`;
        ctx.fillText('WINNER', leftX, 95);

        ctx.font = `bold 30px ${FONT}`;
        ctx.fillStyle = '#FFD700';
        ctx.fillText(truncate(o.winnerName, 16), leftX, logoY + logoSize / 2 + 42);
        ctx.fillStyle = '#b9c8dd';
        ctx.fillText(truncate(o.loserName, 16), rightX, logoY + logoSize / 2 + 42);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 96px ${FONT}`;
        ctx.fillText(`${o.winnerScore} – ${o.loserScore}`, W / 2, logoY + 28);
        ctx.fillStyle = '#7dd3fc';
        ctx.font = `18px ${FONT}`;
        ctx.fillText('SERIES', W / 2, logoY + 58);

        // Per-game strip: winner-of-that-game logo left, loser right, logos only.
        if (games.length) {
            ctx.strokeStyle = 'rgba(125,211,252,0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(40, TOP_H - 5);
            ctx.lineTo(W - 40, TOP_H - 5);
            ctx.stroke();

            const tileW = Math.min(150, (W - 80) / games.length);
            const totalW = tileW * games.length;
            const startX = (W - totalW) / 2;
            const tileY = TOP_H + 18;
            const gLogo = 44;

            const logoCache = new Map();
            const getLogo = async (name) => {
                if (!logoCache.has(name)) logoCache.set(name, await loadLogo(name));
                return logoCache.get(name);
            };

            for (let i = 0; i < games.length; i += 1) {
                const g = games[i];
                const cx = startX + i * tileW + tileW / 2;

                // Tile background.
                ctx.fillStyle = 'rgba(255,255,255,0.04)';
                const tx = startX + i * tileW + 6;
                ctx.beginPath();
                ctx.roundRect(tx, tileY - 8, tileW - 12, 116, 10);
                ctx.fill();

                ctx.fillStyle = '#7dd3fc';
                ctx.font = `bold 14px ${FONT}`;
                ctx.fillText(`GAME ${i + 1}`, cx, tileY + 8);

                // eslint-disable-next-line no-await-in-loop
                const wImg = await getLogo(g.wName);
                // eslint-disable-next-line no-await-in-loop
                const lImg = await getLogo(g.lName);
                drawLogo(ctx, wImg, g.wName, cx - tileW / 4, tileY + 48, gLogo);
                drawLogo(ctx, lImg, g.lName, cx + tileW / 4, tileY + 48, gLogo);

                ctx.fillStyle = '#FFFFFF';
                ctx.font = `bold 22px ${FONT}`;
                ctx.fillText(`${g.wGoals}–${g.lGoals}`, cx, tileY + 98);
            }
        }

        return canvas.toBuffer('image/png');
    } catch (err) {
        Logger.error('buildResultCard failed (falling back to embed)', err);
        return null;
    }
}

module.exports = { buildResultCard };
