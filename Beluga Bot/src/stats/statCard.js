/**
 * Player / team stat cards — beluga/ocean themed canvas graphics for /stats.
 * Matches the standings/result-card brand (gradient + waves + cyan accents) and
 * pulls team logos from the DB. Designed to look like a pro broadcast stat panel.
 */

// Registers the bundled fonts. MUST come before anything measures or draws
// text — node-canvas resolves ctx.font at call time against whatever is
// registered, and Railway's image ships no fonts of its own.
require('../utils/fontManager');
const { createCanvas, loadImage } = require('canvas');
const { config } = require('../../src/config/config');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';

const CYAN = '#7dd3fc';
const SUBTLE = '#8aa8cc';
const GREEN = '#7CFC9B';
const RED = '#ff9b9b';

function fmt(n) { return Number(n || 0).toLocaleString(); }
function avg(total, games) { return games ? (Number(total) / Number(games)).toFixed(2) : '0.00'; }

function oceanBackground(ctx, W, H) {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#06101f');
    grad.addColorStop(0.55, '#0b1f3a');
    grad.addColorStop(1, '#0e2a4f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // waves
    for (let i = 0; i < 4; i += 1) {
        const baseY = H * (0.32 + i * 0.18);
        ctx.beginPath();
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= W; x += 20) ctx.lineTo(x, baseY + Math.sin((x / W) * Math.PI * 3 + i * 1.3) * 14);
        ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
        ctx.fillStyle = `rgba(40, 90, 160, ${0.04 + i * 0.02})`;
        ctx.fill();
    }
    // top accent bar
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, '#3b82f6'); bar.addColorStop(1, '#7dd3fc');
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, 7);
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

/** Faint giant logo watermark on the right side. */
async function drawWatermark(ctx, logoBuf, W, H) {
    if (!logoBuf) return;
    try {
        const img = await loadImage(logoBuf);
        ctx.save();
        ctx.globalAlpha = 0.06;
        const s = Math.min(H * 1.1, 560);
        ctx.drawImage(img, W - s * 0.72, H / 2 - s / 2, s, s);
        ctx.restore();
    } catch { /* optional */ }
}

async function drawCircleImage(ctx, buf, cx, cy, r, ringColor) {
    // Guard against a null/empty buffer: loadImage(null) HANGS forever on some
    // node-canvas versions (never resolves/rejects), which would stall the whole
    // card render and silently fall back to the embed. Just draw the ring.
    if (buf) {
        try {
            const img = await loadImage(buf);
            ctx.save();
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
            ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
            ctx.restore();
        } catch { /* optional */ }
    }
    if (ringColor) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = ringColor; ctx.stroke();
    }
}

// One stat panel (season or lifetime): header + rows of label / total / (avg).
function drawStatPanel(ctx, x, y, w, h, title, subtitle, t, accent) {
    roundRectPath(ctx, x, y, w, h, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.18)'; ctx.stroke();

    // header strip
    roundRectPath(ctx, x, y, w, 46, 18);
    ctx.fillStyle = accent; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.fillStyle = accent; ctx.font = `bold 19px ${FONT}`;
    ctx.fillText(title, x + 18, y + 30);
    if (subtitle) {
        ctx.textAlign = 'right';
        ctx.fillStyle = SUBTLE; ctx.font = `15px ${FONT}`;
        ctx.fillText(subtitle, x + w - 18, y + 29);
    }

    const games = Number(t.games || 0);
    const rows = [
        ['Games', fmt(games), null, '#dbe7ff'],
        ['MVPs', fmt(t.mvps), null, '#FFD700'],
        ['Goals', fmt(t.goals), avg(t.goals, games), '#fff'],
        ['Assists', fmt(t.assists), avg(t.assists, games), '#fff'],
        ['Saves', fmt(t.saves), avg(t.saves, games), '#fff'],
        ['Shots', fmt(t.shots), avg(t.shots, games), '#fff'],
        ['Score', fmt(t.score), avg(t.score, games), '#fff'],
        ['Demos in / taken', `${fmt(t.demos_inflicted)} / ${fmt(t.demos_taken)}`, null, '#dbe7ff'],
    ];
    let ry = y + 46 + 30;
    const rowGap = (h - 46 - 56) / rows.length;
    ctx.font = `17px ${FONT}`;
    for (const [label, total, average, color] of rows) {
        ctx.textAlign = 'left'; ctx.fillStyle = SUBTLE; ctx.font = `16px ${FONT}`;
        ctx.fillText(label, x + 20, ry);
        ctx.textAlign = 'right'; ctx.fillStyle = color || '#fff';
        ctx.font = `bold 19px ${FONT}`;
        // Reserve the real width of the "/g" column instead of a fixed 70px —
        // a 4-digit Score (e.g. 5,646) used to overlap its own average.
        let valX = x + w - 20;
        if (average) {
            const avgText = `${average}/g`;
            ctx.font = `14px ${FONT}`;
            const avgW = ctx.measureText(avgText).width;
            ctx.font = `bold 19px ${FONT}`;
            valX = x + w - 18 - avgW - 10;
        }
        ctx.fillText(String(total), valX, ry);
        if (average) {
            ctx.textAlign = 'right'; ctx.fillStyle = '#6f8fb8'; ctx.font = `14px ${FONT}`;
            ctx.fillText(`${average}/g`, x + w - 18, ry);
        }
        ry += rowGap;
    }
}

/**
 * @param {object} p { name, avatarBuffer, teamName, teamLogoBuffer, division,
 *   seasonLabel, belugaScopeLabel, season (row), lifetime (row) }
 */
async function buildPlayerStatCard(p) {
    const W = 1040, H = 620;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    oceanBackground(ctx, W, H);
    await drawWatermark(ctx, p.teamLogoBuffer, W, H);

    // Header
    ctx.textAlign = 'left';
    ctx.fillStyle = CYAN; ctx.font = `bold 16px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE  ·  PLAYER STATS', 40, 42);

    await drawCircleImage(ctx, p.avatarBuffer, 92, 118, 50, CYAN);

    ctx.fillStyle = '#FFFFFF'; ctx.font = `bold 44px ${FONT}`;
    ctx.fillText(String(p.name || 'Unknown').slice(0, 22), 162, 112);
    ctx.fillStyle = CYAN; ctx.font = `21px ${FONT}`;
    const sub = [p.teamName, p.division].filter(Boolean).join('  ·  ');
    if (sub) ctx.fillText(sub, 164, 144);

    // Beluga Score hero (top-right glowing tile).
    // SEASON-SCOPED ONLY — never falls back to lifetime. ~31 players have a
    // lifetime row but no row for the current season; the old `?? lifetime`
    // fallback silently showed their career number under a "BELUGA SCORE"
    // label. The scope caption under the number says which season it is.
    const beluga = p.season?.beluga_score;
    const bx = W - 280, by = 70, bw = 240, bh = 116;
    roundRectPath(ctx, bx, by, bw, bh, 18);
    ctx.fillStyle = 'rgba(59,130,246,0.16)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.45)'; ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = SUBTLE; ctx.font = `bold 14px ${FONT}`;
    ctx.fillText('BELUGA SCORE', bx + bw / 2, by + 26);
    ctx.fillStyle = '#bfe6ff'; ctx.font = `bold 46px ${FONT}`;
    ctx.shadowColor = 'rgba(125,211,252,0.6)'; ctx.shadowBlur = 18;
    ctx.fillText(beluga != null ? Number(beluga).toFixed(2) : '—', bx + bw / 2, by + 76);
    ctx.shadowBlur = 0;
    if (p.belugaScopeLabel) {
        ctx.fillStyle = '#6f8fb8'; ctx.font = `12px ${FONT}`;
        ctx.fillText(String(p.belugaScopeLabel).toUpperCase().slice(0, 30), bx + bw / 2, by + 100);
    }

    // Panels
    const panY = 200, panH = H - panY - 56, gap = 24;
    const panW = (W - 80 - gap) / 2;
    drawStatPanel(ctx, 40, panY, panW, panH,
        p.seasonLabel || 'THIS SEASON', p.division || '', p.season || {}, CYAN);
    drawStatPanel(ctx, 40 + panW + gap, panY, panW, panH,
        'LIFETIME', p.lifetime?.seasons_played ? `${p.lifetime.seasons_played} season${p.lifetime.seasons_played === 1 ? '' : 's'}` : '', p.lifetime || {}, '#a78bfa');

    // Footer — brand only, no domain.
    ctx.textAlign = 'center'; ctx.fillStyle = '#5c7aa3'; ctx.font = `14px ${FONT}`;
    ctx.fillText('🐳 Beluga League', W / 2, H - 20);

    return canvas.toBuffer('image/png');
}

/**
 * @param {object} tm { teamName, teamLogoBuffer, division, seasonLabel, record:
 *   {seriesW, seriesL, gameW, gameL, goalsFor, goalsAgainst}, totals (row) }
 */
async function buildTeamStatCard(tm) {
    const W = 1040, H = 560;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    oceanBackground(ctx, W, H);
    await drawWatermark(ctx, tm.teamLogoBuffer, W, H);

    ctx.textAlign = 'left';
    ctx.fillStyle = CYAN; ctx.font = `bold 16px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE  ·  TEAM STATS', 40, 42);

    await drawCircleImage(ctx, tm.teamLogoBuffer, 98, 122, 56, CYAN);
    ctx.fillStyle = '#FFFFFF'; ctx.font = `bold 46px ${FONT}`;
    ctx.fillText(String(tm.teamName || 'Team').slice(0, 22), 176, 116);
    ctx.fillStyle = CYAN; ctx.font = `21px ${FONT}`;
    ctx.fillText([tm.division, tm.seasonLabel].filter(Boolean).join('  ·  '), 178, 148);

    // Beluga team score hero tile (top-right) — matches the player card layout
    // so the team's headline number is prominent instead of cramped at the bottom.
    const tt = tm.totals || {};
    if (tt.beluga_score != null) {
        const bw = 240, bh = 96, bx = W - bw - 40, by = 60;
        roundRectPath(ctx, bx, by, bw, bh, 18);
        ctx.fillStyle = 'rgba(59,130,246,0.16)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.45)'; ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = SUBTLE; ctx.font = `bold 14px ${FONT}`;
        ctx.fillText('TEAM BELUGA SCORE', bx + bw / 2, by + 26);
        ctx.fillStyle = '#bfe6ff'; ctx.font = `bold 46px ${FONT}`;
        ctx.shadowColor = 'rgba(125,211,252,0.6)'; ctx.shadowBlur = 18;
        ctx.fillText(Number(tt.beluga_score).toFixed(2), bx + bw / 2, by + 74);
        ctx.shadowBlur = 0;
    }

    // Record tiles (series / games / goal diff)
    const r = tm.record || {};
    const goalDiff = (Number(r.goalsFor || 0) - Number(r.goalsAgainst || 0));
    const tiles = [
        ['SERIES', `${r.seriesW ?? 0}-${r.seriesL ?? 0}`, GREEN],
        ['GAMES', `${r.gameW ?? 0}-${r.gameL ?? 0}`, '#bfe6ff'],
        ['GOALS', `${r.goalsFor ?? 0}-${r.goalsAgainst ?? 0}`, '#dbe7ff'],
        ['GOAL DIFF', `${goalDiff >= 0 ? '+' : ''}${goalDiff}`, goalDiff >= 0 ? GREEN : RED],
    ];
    const tY = 196, tH = 96, tGap = 20, tW = (W - 80 - tGap * 3) / 4;
    tiles.forEach(([label, val, color], i) => {
        const x = 40 + i * (tW + tGap);
        roundRectPath(ctx, x, tY, tW, tH, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.18)'; ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = SUBTLE; ctx.font = `bold 13px ${FONT}`;
        ctx.fillText(label, x + tW / 2, tY + 28);
        ctx.fillStyle = color; ctx.font = `bold 34px ${FONT}`;
        ctx.fillText(String(val), x + tW / 2, tY + 70);
    });

    // Team totals panel (full width)
    const t = tm.totals || {};
    const pY = tY + tH + 26, pH = H - pY - 50;
    roundRectPath(ctx, 40, pY, W - 80, pH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.18)'; ctx.stroke();
    roundRectPath(ctx, 40, pY, W - 80, 44, 18);
    ctx.fillStyle = 'rgba(59,130,246,0.16)'; ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = CYAN; ctx.font = `bold 18px ${FONT}`;
    ctx.fillText('TEAM TOTALS', 60, pY + 29);
    ctx.textAlign = 'right'; ctx.fillStyle = SUBTLE; ctx.font = `15px ${FONT}`;
    ctx.fillText(`${fmt(t.games_played)} games`, W - 60, pY + 28);

    const games = Number(t.games_played || 0);
    const cells = [
        ['Goals', t.goals], ['Assists', t.assists], ['Saves', t.saves],
        ['Shots', t.shots], ['Score', t.score], ['Demos', t.demos_inflicted],
    ];
    const cols = 3, cellW = (W - 80) / cols, rowsN = Math.ceil(cells.length / cols);
    const gridY = pY + 44 + 18, gridH = pH - 44 - 30;
    cells.forEach(([label, val], i) => {
        const cx = 40 + (i % cols) * cellW + cellW / 2;
        const cy = gridY + Math.floor(i / cols) * (gridH / rowsN) + 34;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff'; ctx.font = `bold 30px ${FONT}`;
        ctx.fillText(fmt(val), cx, cy);
        ctx.fillStyle = SUBTLE; ctx.font = `15px ${FONT}`;
        ctx.fillText(`${label}  ·  ${avg(val, games)}/g`, cx, cy + 24);
    });

    // Footer — brand only, no domain. (The Beluga score now lives in the
    // top-right hero tile, not cramped above this footer.)
    ctx.textAlign = 'center'; ctx.fillStyle = '#5c7aa3'; ctx.font = `14px ${FONT}`;
    ctx.fillText('🐳 Beluga League', W / 2, H - 20);

    return canvas.toBuffer('image/png');
}

function hexToRgb(hex) {
    const h = String(hex || '#3b82f6').replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return { r: parseInt(v.slice(0, 2), 16) || 59, g: parseInt(v.slice(2, 4), 16) || 130, b: parseInt(v.slice(4, 6), 16) || 246 };
}

function statusChip(ctx, x, y, label, color) {
    ctx.font = `bold 15px ${FONT}`;
    const w = ctx.measureText(label).width + 28;
    roundRectPath(ctx, x, y, w, 30, 15);
    const { r, g, b } = hexToRgb(color);
    ctx.fillStyle = `rgba(${r},${g},${b},0.18)`; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(${r},${g},${b},0.7)`; ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = color;
    ctx.fillText(label, x + 14, y + 20);
    return x + w + 10;
}

/** Small "label: value" line used in the Discord-membership panel. */
function kvLine(ctx, x, y, label, value) {
    ctx.textAlign = 'left';
    ctx.fillStyle = SUBTLE; ctx.font = `13px ${FONT}`;
    ctx.fillText(label, x, y);
    ctx.fillStyle = '#dbe7ff'; ctx.font = `bold 15px ${FONT}`;
    ctx.fillText(String(value ?? '—').slice(0, 40), x, y + 20);
}

/**
 * @param {object} w { name, avatarBuffer, teamName, teamLogoBuffer, division,
 *   teamColor, salary, statuses:[{label,color}], roles:[str], career:
 *   {games,goals,assists,saves,mvps}, trackerNames:[str], siteUrl,
 *   discord:{joinedAt, createdAt, nickname, userId, roleNames:[str]} }
 */
async function buildWhoisCard(w) {
    const W = 1040;
    // Pre-measure the status + role chips so the card can GROW when they wrap to
    // extra rows (otherwise wrapped chips would overlap the career tiles / squeeze
    // the Discord panel on a fixed-height card).
    const chipItems = [
        ...(w.statuses || []).map((s) => ({ label: s.label, color: s.color })),
        ...(w.roles || []).map((role) => ({ label: role, color: '#FFD700' })),
    ];
    const chipMaxX = W - 40; const chipRowH = 38;
    let chipRows = 1;
    {
        const mctx = createCanvas(10, 10).getContext('2d');
        let chx = 40;
        for (const it of chipItems) {
            mctx.font = `bold 15px ${FONT}`;
            const chipW = mctx.measureText(String(it.label)).width + 28;
            if (chx + chipW > chipMaxX && chx > 40) { chx = 40; chipRows += 1; }
            chx = chx + chipW + 10;
        }
    }
    const chipShift = (chipRows - 1) * chipRowH;
    const H = 720 + chipShift;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const teamColor = w.teamColor || '#3b82f6';
    const { r, g, b } = hexToRgb(teamColor);

    oceanBackground(ctx, W, H);
    // team-color top bar overrides the default cyan bar
    const bar = ctx.createLinearGradient(0, 0, W, 0);
    bar.addColorStop(0, `rgba(${r},${g},${b},0.95)`); bar.addColorStop(1, `rgba(${r},${g},${b},0.45)`);
    ctx.fillStyle = bar; ctx.fillRect(0, 0, W, 7);
    // team-color glow behind header
    const glow = ctx.createRadialGradient(110, 120, 10, 110, 120, 240);
    glow.addColorStop(0, `rgba(${r},${g},${b},0.18)`); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 30, 480, 240);
    await drawWatermark(ctx, w.teamLogoBuffer, W, H);

    ctx.textAlign = 'left';
    ctx.fillStyle = teamColor; ctx.font = `bold 16px ${FONT}`;
    ctx.fillText('🐳 BELUGA LEAGUE  ·  PLAYER PROFILE', 40, 42);

    await drawCircleImage(ctx, w.avatarBuffer, 96, 122, 52, teamColor);
    ctx.fillStyle = '#FFFFFF'; ctx.font = `bold 46px ${FONT}`;
    ctx.fillText(String(w.name || 'Player').slice(0, 22), 170, 116);
    // team + division line (with small logo)
    let tx = 172;
    if (w.teamLogoBuffer) { await drawCircleImage(ctx, w.teamLogoBuffer, tx + 13, 142, 13, null); tx += 34; }
    ctx.fillStyle = teamColor; ctx.font = `21px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText([w.teamName || 'Free Agent', w.division].filter(Boolean).join('  ·  '), tx, 149);

    // Salary tile (top-right)
    if (w.salary) {
        const sw = 200, sx = W - sw - 40, sy = 70, sh = 70;
        roundRectPath(ctx, sx, sy, sw, sh, 16);
        ctx.fillStyle = `rgba(${r},${g},${b},0.16)`; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`; ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = SUBTLE; ctx.font = `bold 13px ${FONT}`;
        ctx.fillText('SALARY', sx + sw / 2, sy + 24);
        ctx.fillStyle = '#fff'; ctx.font = `bold 30px ${FONT}`;
        ctx.fillText(String(w.salary).startsWith('$') ? String(w.salary) : `$${w.salary}`, sx + sw / 2, sy + 56);
    }

    // Status + role chips — WRAP across rows (rows pre-measured above) so every
    // award role shows; a single unwrapped row used to run off the card edge.
    const cyTop = 190;
    if (chipItems.length) {
        let chx = 40; let chy = cyTop;
        for (const it of chipItems) {
            ctx.font = `bold 15px ${FONT}`;
            const chipW = ctx.measureText(String(it.label)).width + 28;
            if (chx + chipW > chipMaxX && chx > 40) { chx = 40; chy += chipRowH; } // wrap
            chx = statusChip(ctx, chx, chy, String(it.label), it.color);
        }
    } else {
        ctx.textAlign = 'left'; ctx.fillStyle = SUBTLE; ctx.font = `16px ${FONT}`;
        ctx.fillText('Active roster player', 40, cyTop + 20);
    }

    // Career stat tiles
    const c = w.career || {};
    const cells = [['Games', c.games], ['Goals', c.goals], ['Assists', c.assists], ['Saves', c.saves], ['MVPs', c.mvps]];
    const gy = 252 + chipShift, gh = 110, gGap = 18, gw = (W - 80 - gGap * 4) / 5;
    cells.forEach(([label, val], i) => {
        const x = 40 + i * (gw + gGap);
        roundRectPath(ctx, x, gy, gw, gh, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.16)'; ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = label === 'MVPs' ? '#FFD700' : '#fff'; ctx.font = `bold 38px ${FONT}`;
        ctx.fillText(String(val ?? 0), x + gw / 2, gy + 58);
        ctx.fillStyle = SUBTLE; ctx.font = `bold 14px ${FONT}`;
        ctx.fillText(String(label).toUpperCase(), x + gw / 2, gy + 88);
    });
    ctx.textAlign = 'left'; ctx.fillStyle = '#6f8fb8'; ctx.font = `14px ${FONT}`;
    ctx.fillText('CAREER (LIFETIME)', 42, gy - 10);

    // Trackers (names only — links go in the message text)
    let cursorY = gy + gh + 36;
    if ((w.trackerNames || []).length) {
        ctx.textAlign = 'left'; ctx.fillStyle = '#6f8fb8'; ctx.font = `14px ${FONT}`;
        ctx.fillText('TRACKERS', 42, cursorY - 14);
        let trx = 42;
        for (const name of w.trackerNames.slice(0, 5)) trx = statusChip(ctx, trx, cursorY, name, CYAN);
        cursorY += 50;
    }

    // ---- Discord membership panel (everything a normal /whois shows) ----
    const d = w.discord || {};
    const dpY = cursorY + 6;
    const dpH = H - dpY - 50;
    roundRectPath(ctx, 40, dpY, W - 80, dpH, 18);
    ctx.fillStyle = 'rgba(88,101,242,0.10)'; ctx.fill(); // discord-blurple tint
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(125,211,252,0.18)'; ctx.stroke();
    roundRectPath(ctx, 40, dpY, W - 80, 42, 18);
    ctx.fillStyle = 'rgba(88,101,242,0.18)'; ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = '#bcc6ff'; ctx.font = `bold 16px ${FONT}`;
    ctx.fillText('DISCORD', 60, dpY + 28);

    // key/value columns
    const kvY = dpY + 42 + 28;
    const col1 = 60, col2 = 60 + (W - 80) / 3, col3 = 60 + ((W - 80) / 3) * 2;
    kvLine(ctx, col1, kvY, 'Nickname', d.nickname || w.name);
    kvLine(ctx, col2, kvY, 'User ID', d.userId || '—');
    kvLine(ctx, col3, kvY, 'Joined server', d.joinedAt || '—');
    kvLine(ctx, col1, kvY + 54, 'Account made', d.createdAt || '—');
    kvLine(ctx, col2, kvY + 54, 'Team', w.teamName || 'Free Agent');
    kvLine(ctx, col3, kvY + 54, 'Division', w.division || '—');

    // role chips (server roles relevant to the league)
    if ((d.roleNames || []).length) {
        const ry = kvY + 54 + 48;
        ctx.textAlign = 'left'; ctx.fillStyle = '#6f8fb8'; ctx.font = `12px ${FONT}`;
        ctx.fillText('ROLES', col1, ry - 12);
        let rx = col1;
        const maxRx = W - 80;
        for (const role of d.roleNames.slice(0, 8)) {
            ctx.font = `bold 13px ${FONT}`;
            const chipW = ctx.measureText(role).width + 26;
            if (rx + chipW > maxRx) break;
            rx = statusChip(ctx, rx, ry, role, '#8b9bff');
        }
    }

    return canvas.toBuffer('image/png');
}

module.exports = { buildPlayerStatCard, buildTeamStatCard, buildWhoisCard };
