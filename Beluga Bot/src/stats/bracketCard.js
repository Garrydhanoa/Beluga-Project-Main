/**
 * Playoff bracket graphic — the thing the league used to make by hand in
 * Photoshop every round.
 *
 * Ocean/beluga theme: dark blue gradient ground, subtle wave band, cyan
 * connectors, franchise-colour team bars with the DB logo bleeding through,
 * seed chips, series scores, and a gold champion plate on the right.
 *
 * Returns a PNG Buffer, or null on any failure — the card is never load-bearing,
 * callers fall back to text.
 */

// Registers the bundled fonts. MUST come before anything measures or draws text —
// node-canvas resolves ctx.font at call time against whatever is registered, and
// Railway's nixpacks image ships no fonts of its own.
require('../utils/fontManager');
const { createCanvas, loadImage } = require('canvas');
const { getTeamLogoBuffer, getTeamColorInt } = require('../utils/teamRoles');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { loadBracket, shortRoundName } = require('./playoffBracket');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';
const DISPLAY = `Anton, ${FONT}`;

// ---- geometry ---------------------------------------------------------------

const PAD = 46;
const HEADER_H = 126;
const COL_GAP = 54;
const COL_W = 300;
const ROW_H = 38;          // one team bar
const CARD_H = ROW_H * 2 + 4;
const CHAMP_W = 250;

function intToHex(n) {
    if (!Number.isFinite(n)) return '#3b82f6';
    return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

function withAlpha(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    if (!Number.isFinite(n)) return `rgba(59,130,246,${a})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

/** Shrink-to-fit: layouts must survive a fallback face with different metrics. */
function fitFont(ctx, text, maxWidth, startPx, weight = 'bold', family = FONT) {
    let px = startPx;
    for (;;) {
        ctx.font = `${weight} ${px}px ${family}`;
        if (ctx.measureText(text).width <= maxWidth || px <= 9) return px;
        px -= 1;
    }
}

// ---- drawing ----------------------------------------------------------------

function drawBackground(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#050b18');
    g.addColorStop(0.5, '#0a1830');
    g.addColorStop(1, '#040910');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Wave band along the bottom — the league's ocean motif.
    ctx.save();
    for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        const base = H - 120 + i * 34;
        ctx.moveTo(0, base);
        for (let x = 0; x <= W; x += 24) {
            ctx.lineTo(x, base + Math.sin((x / W) * Math.PI * 3 + i * 1.1) * 16);
        }
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.closePath();
        ctx.fillStyle = `rgba(56, 132, 214, ${0.05 - i * 0.012})`;
        ctx.fill();
    }
    ctx.restore();

    // Faint grid for depth.
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 56) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
}

/** One team bar: seed chip, logo watermark, logo, name, score. */
async function drawTeamRow(ctx, x, y, w, team, { isWinner, decided, isFinal }) {
    const color = team?.colorHex || '#2b5a8c';
    const named = Boolean(team?.name);

    // Bar
    const g = ctx.createLinearGradient(x, y, x + w, y);
    if (named && isWinner) {
        g.addColorStop(0, withAlpha(color, 0.85));
        g.addColorStop(1, withAlpha(color, 0.35));
    } else if (named) {
        g.addColorStop(0, 'rgba(255,255,255,0.07)');
        g.addColorStop(1, 'rgba(255,255,255,0.03)');
    } else {
        g.addColorStop(0, 'rgba(255,255,255,0.035)');
        g.addColorStop(1, 'rgba(255,255,255,0.015)');
    }
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, ROW_H, 6);
    ctx.fill();

    // Winner accent bar on the left edge
    if (isWinner) {
        ctx.fillStyle = isFinal ? '#facc15' : '#34d399';
        roundRect(ctx, x, y, 4, ROW_H, 2);
        ctx.fill();
    }

    // Logo watermark
    if (team?.logo) {
        try {
            ctx.save();
            roundRect(ctx, x, y, w, ROW_H, 6);
            ctx.clip();
            ctx.globalAlpha = 0.16;
            const s = ROW_H * 1.7;
            ctx.drawImage(team.logo, x + w - s - 40, y + (ROW_H - s) / 2, s, s);
            ctx.restore();
        } catch { /* watermark is decorative */ }
    }

    // Seed chip
    if (team?.seed) {
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        roundRect(ctx, x + 9, y + 9, 21, ROW_H - 18, 4);
        ctx.fill();
        ctx.fillStyle = '#cfe4ff';
        ctx.font = `bold 13px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(team.seed), x + 19.5, y + ROW_H / 2 + 4.5);
    }

    // Logo
    if (team?.logo) {
        try {
            const s = ROW_H - 14;
            ctx.drawImage(team.logo, x + 37, y + 7, s, s);
        } catch { /* ignore */ }
    }

    // Name
    ctx.textAlign = 'left';
    ctx.globalAlpha = decided && !isWinner ? 0.5 : 1;
    ctx.fillStyle = named ? '#ffffff' : 'rgba(255,255,255,0.32)';
    const nameX = x + 37 + (team?.logo ? ROW_H - 14 + 9 : 0);
    const nameMax = w - (nameX - x) - 46;
    const px = fitFont(ctx, named ? team.name : 'TBD', nameMax, 17, isWinner ? 'bold' : '600');
    ctx.font = `${isWinner ? 'bold' : '600'} ${px}px ${FONT}`;
    ctx.fillText(named ? team.name : 'TBD', nameX, y + ROW_H / 2 + px * 0.35);

    // Score
    if (team?.score != null) {
        ctx.textAlign = 'right';
        ctx.fillStyle = isWinner ? (isFinal ? '#facc15' : '#6ee7b7') : 'rgba(255,255,255,0.55)';
        ctx.font = `bold 19px ${FONT}`;
        ctx.fillText(String(team.score), x + w - 14, y + ROW_H / 2 + 7);
    }
    ctx.globalAlpha = 1;
}

/**
 * Render a division's bracket.
 * @returns {Promise<Buffer|null>}
 */
async function buildBracketCard(seasonId, division, { seasonNumber = null } = {}) {
    try {
        const bracket = await loadBracket(seasonId, division);
        if (!bracket || !bracket.rounds.length) return null;

        const rounds = bracket.rounds;
        const firstCount = Math.max(rounds[0].matchups.length, 1);

        const W = PAD * 2 + rounds.length * COL_W + rounds.length * COL_GAP + CHAMP_W;
        const bodyH = Math.max(firstCount * (CARD_H + 26), 260);
        const H = HEADER_H + bodyH + PAD;

        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        drawBackground(ctx, W, H);

        // ---- header ----
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `44px ${DISPLAY}`;
        ctx.fillText(`${String(division).toUpperCase()} PLAYOFFS`, PAD, 60);

        ctx.fillStyle = '#7fb3e8';
        ctx.font = `bold 15px ${FONT}`;
        ctx.fillText(
            `${seasonNumber ? `SEASON ${seasonNumber}  ·  ` : ''}BELUGA LEAGUE`,
            PAD, 84
        );

        // ---- preload teams (logo + colour) ----
        const teamCache = new Map();
        const allIds = rounds.flatMap((r) => r.matchups)
            .flatMap((m) => [m.home_team_id, m.away_team_id]).filter(Boolean);
        for (const id of new Set(allIds)) {
            const [buf, colorInt] = await Promise.all([
                getTeamLogoBuffer(id).catch(() => null),
                getTeamColorInt(id).catch(() => 0x3498DB),
            ]);
            let logo = null;
            if (buf) logo = await loadImage(buf).catch(() => null);
            teamCache.set(id, { logo, colorHex: intToHex(colorInt) });
        }

        // Seeds are stored on round 1 only; carry them forward so a team keeps
        // its seed all the way to the final, as the league's own graphics do.
        const seedByTeam = new Map();
        for (const m of rounds[0].matchups) {
            if (m.home_team_id && m.home_seed) seedByTeam.set(m.home_team_id, m.home_seed);
            if (m.away_team_id && m.away_seed) seedByTeam.set(m.away_team_id, m.away_seed);
        }

        // ---- columns ----
        const centresByRound = [];

        for (let r = 0; r < rounds.length; r += 1) {
            const round = rounds[r];
            const x = PAD + r * (COL_W + COL_GAP);
            const slots = Math.max(round.matchups.length, 1);
            const slotH = bodyH / slots;

            // Round label
            ctx.textAlign = 'left';
            ctx.fillStyle = '#8ab4e8';
            ctx.font = `bold 13px ${FONT}`;
            ctx.fillText(`${shortRoundName(round.name).toUpperCase()}  ·  BO${round.best_of}`, x, HEADER_H - 16);

            const centres = [];
            for (let i = 0; i < round.matchups.length; i += 1) {
                const m = round.matchups[i];
                const cy = HEADER_H + slotH * i + slotH / 2;
                const top = cy - CARD_H / 2;
                centres.push(cy);

                const decided = Boolean(m.winner_team_id);
                const mk = (id, name, seed, score) => {
                    if (!id && !name) return { name: null, seed: null, score: null };
                    const cached = teamCache.get(id) || {};
                    return {
                        id, name, score, seed: seed || seedByTeam.get(id) || null,
                        logo: cached.logo, colorHex: cached.colorHex,
                    };
                };

                await drawTeamRow(ctx, x, top, COL_W,
                    mk(m.home_team_id, m.home_team_name, m.home_seed, m.home_score),
                    { isWinner: decided && m.winner_team_id === m.home_team_id, decided, isFinal: round.is_finals });
                await drawTeamRow(ctx, x, top + ROW_H + 4, COL_W,
                    mk(m.away_team_id, m.away_team_name, m.away_seed, m.away_score),
                    { isWinner: decided && m.winner_team_id === m.away_team_id, decided, isFinal: round.is_finals });

                // Forfeit note
                if (m.result_kind === 'ffw' || m.result_kind === 'double_ff') {
                    ctx.textAlign = 'left';
                    ctx.fillStyle = '#f0a868';
                    ctx.font = `bold 10px ${FONT}`;
                    ctx.fillText(m.result_kind === 'double_ff' ? 'DOUBLE FORFEIT' : 'WON BY FORFEIT', x + 6, top + CARD_H + 13);
                }
            }
            centresByRound.push(centres);
        }

        // ---- connectors ----
        ctx.strokeStyle = 'rgba(103, 202, 241, 0.32)';
        ctx.lineWidth = 2;
        for (let r = 0; r < rounds.length; r += 1) {
            const x = PAD + r * (COL_W + COL_GAP);
            const outX = x + COL_W;
            const centres = centresByRound[r];
            const next = centresByRound[r + 1];

            for (let i = 0; i < centres.length; i += 1) {
                const cy = centres[i];
                ctx.beginPath();
                ctx.moveTo(outX, cy);
                ctx.lineTo(outX + COL_GAP / 2, cy);
                ctx.stroke();

                if (next) {
                    const target = next[Math.floor(i / 2)];
                    if (target != null) {
                        ctx.beginPath();
                        ctx.moveTo(outX + COL_GAP / 2, cy);
                        ctx.lineTo(outX + COL_GAP / 2, target);
                        ctx.lineTo(outX + COL_GAP, target);
                        ctx.stroke();
                    }
                }
            }
        }

        // ---- champion plate ----
        const finalRound = rounds[rounds.length - 1];
        const finalMatch = finalRound.matchups[0];
        const championId = finalMatch?.winner_team_id || null;
        const championName = championId
            ? (championId === finalMatch.home_team_id ? finalMatch.home_team_name : finalMatch.away_team_name)
            : null;

        const cx = PAD + rounds.length * (COL_W + COL_GAP);
        const cyMid = HEADER_H + bodyH / 2;
        const plateH = 190;
        const plateY = cyMid - plateH / 2;

        // connector into the plate
        ctx.beginPath();
        ctx.moveTo(cx - COL_GAP / 2, centresByRound[rounds.length - 1][0] ?? cyMid);
        ctx.lineTo(cx - COL_GAP / 2, cyMid);
        ctx.lineTo(cx, cyMid);
        ctx.stroke();

        const pg = ctx.createLinearGradient(cx, plateY, cx, plateY + plateH);
        pg.addColorStop(0, 'rgba(250, 204, 21, 0.20)');
        pg.addColorStop(1, 'rgba(250, 204, 21, 0.03)');
        ctx.fillStyle = pg;
        roundRect(ctx, cx, plateY, CHAMP_W, plateH, 14);
        ctx.fill();
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)';
        ctx.lineWidth = 2;
        roundRect(ctx, cx, plateY, CHAMP_W, plateH, 14);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = '#facc15';
        ctx.font = `bold 12px ${FONT}`;
        ctx.fillText('CHAMPION', cx + CHAMP_W / 2, plateY + 26);

        if (championId) {
            const cached = teamCache.get(championId);
            if (cached?.logo) {
                try { ctx.drawImage(cached.logo, cx + CHAMP_W / 2 - 38, plateY + 42, 76, 76); } catch { /* ignore */ }
            }
            ctx.fillStyle = '#ffffff';
            const px = fitFont(ctx, championName || '', CHAMP_W - 28, 26, 'bold');
            ctx.font = `bold ${px}px ${FONT}`;
            ctx.fillText(championName || '', cx + CHAMP_W / 2, plateY + 152);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.30)';
            ctx.font = `bold 30px ${FONT}`;
            ctx.fillText('TBD', cx + CHAMP_W / 2, plateY + plateH / 2 + 10);
        }

        // ---- footer (no website URL — house style) ----
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = `bold 12px ${FONT}`;
        ctx.fillText('BELUGA LEAGUE', W / 2, H - 16);

        return canvas.toBuffer('image/png');
    } catch (err) {
        Logger.error('buildBracketCard failed', err);
        return null;
    }
}

module.exports = { buildBracketCard };
