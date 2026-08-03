/**
 * Welcome card — the graphic that rides along with the join message (channel + DM).
 *
 * DESIGN: "Prism". An iridescent rainbow band sweeps across a dark stage, the
 * headline is set in chromatic-aberration type (cyan and magenta ghosts offset
 * behind white), and the new member's avatar sits in a glowing multi-hue ring.
 * Below: their name, a member/joined chip pair, a gradient rule, the three
 * onboarding steps, and every franchise in the league.
 *
 * The steps mirror the real onboarding path in welcome.js buildJoinText —
 * verify for server access, register for the league, support if stuck. If that
 * copy changes, change STEPS too.
 *
 * Team logos ALWAYS come from Postgres via getTeamLogoBuffer (team → franchise);
 * the only static asset is the league mark.
 */

const fs = require('fs');
const path = require('path');
// Registers the bundled fonts. MUST come before anything measures or draws
// text — node-canvas resolves ctx.font at call time against whatever is
// registered, and Railway's image ships no fonts of its own.
require('./fontManager');
const { createCanvas, loadImage } = require('canvas');
const { config } = require('../config/config');
const { getActiveTeams, getTeamLogoBuffer } = require('./teamRoles');
const Logger = require('./logger');

const FONT = (config && config.images && config.images.fontFamily) ? config.images.fontFamily : 'sans-serif';
const DISPLAY = (config && config.images && config.images.displayFontFamily) ? config.images.displayFontFamily : FONT;

const W = 1200;
const H = 630;

// Saturated palette — the card is deliberately vibrant, not the muted ocean
// scheme used by the stat/standings cards.
const CYAN = '#22d3ee';
const AQUA = '#67e8f9';
const MAGENTA = '#ec4899';
const PINK = '#f472b6';
const VIOLET = '#8b5cf6';
const LIME = '#a3e635';
const WHITE = '#ffffff';
const DIM = 'rgba(255,255,255,0.65)';

const STEPS = [
    { n: '1', title: 'VERIFY', sub: 'Unlock the server', color: CYAN },
    { n: '2', title: 'REGISTER', sub: 'Join the league', color: PINK },
    { n: '3', title: 'SUPPORT', sub: 'Stuck? Ask us', color: LIME },
];

const LOGO_STRIP_TTL_MS = 10 * 60 * 1000;
let _stripCache = null;     // { at, entries: [{ name, color, img }] }
let _leagueLogo = null;     // Image | null (loaded once)
let _leagueLogoTried = false;

/** The league mark — the one surviving static PNG (see CLAUDE.md logo rules). */
async function leagueLogo() {
    if (_leagueLogoTried) return _leagueLogo;
    _leagueLogoTried = true;
    try {
        const p = path.join(__dirname, '..', '..', 'IMAGES', 'logos', 'league_logo.png');
        if (fs.existsSync(p)) _leagueLogo = await loadImage(fs.readFileSync(p));
    } catch (err) {
        Logger.warning(`welcomeCard: league logo unavailable — ${err.message}`);
    }
    return _leagueLogo;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
}

/** Handles 3- and 6-digit hex; falls back to cyan rather than throwing. */
function withAlpha(hex, a) {
    const h = String(hex || '').replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full, 16);
    if (full.length !== 6 || !Number.isFinite(n)) return `rgba(34,211,238,${a})`;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Shrink a font until the text fits `maxW`, never below `min`.
 * Every headline goes through this: the production host renders in a different
 * face than a dev machine, so fixed sizes would overflow there and nowhere else.
 */
function fitFont(ctx, text, maxW, start, min, weight = 'bold', family = FONT) {
    let size = start;
    const set = () => { ctx.font = `${weight ? `${weight} ` : ''}${size}px ${family}`; };
    set();
    while (size > min && ctx.measureText(text).width > maxW) { size -= 2; set(); }
    return size;
}

/** Text with a coloured bloom. Resets shadow state — it leaks otherwise. */
function glowText(ctx, text, x, y, color, blur = 20) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = blur * 0.5; ctx.fillText(text, x, y);
    ctx.restore();
}

/** Soft colour blob, meant to be composited with 'lighter' so overlaps bloom. */
function blob(ctx, cx, cy, r, color, alpha) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(0.45, withAlpha(color, alpha * 0.45));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** Fine grain so the large gradients don't band on Discord's re-encode. */
function grain(ctx, amount = 0.04, step = 3) {
    ctx.save();
    for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
            if (Math.random() > 0.5) continue;
            ctx.fillStyle = `rgba(255,255,255,${Math.random() * amount})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    ctx.restore();
}

/**
 * Draw an image clipped to a circle. Guards a null buffer on purpose:
 * loadImage(null) HANGS forever on some node-canvas builds, which would stall the
 * whole join handler (see statCard.js).
 */
async function drawCircleImage(ctx, buf, cx, cy, r) {
    if (!buf) return false;
    try {
        const img = await loadImage(buf);
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
        return true;
    } catch {
        return false;
    }
}

/** Initials placeholder for a member with no usable avatar. */
function drawInitials(ctx, name, cx, cy, r) {
    const initials = String(name || '?')
        .split(/[\s_.-]+/).filter(Boolean).slice(0, 2)
        .map((w) => w[0].toUpperCase()).join('') || '?';
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, withAlpha(AQUA, 0.35)); g.addColorStop(1, withAlpha(MAGENTA, 0.35));
    ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = WHITE;
    ctx.font = `bold ${Math.round(r * 0.72)}px ${DISPLAY}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials, cx, cy);
    ctx.restore();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/**
 * One decoded logo per FRANCHISE, cached ~10 min so a join burst doesn't re-decode
 * 14 PNGs each time. Deduped by team name — a franchise fields one team per
 * division, so the raw list is ~3x too long.
 */
async function franchiseLogos() {
    if (_stripCache && Date.now() - _stripCache.at < LOGO_STRIP_TTL_MS) return _stripCache.entries;
    const entries = [];
    try {
        const teams = await getActiveTeams();
        const seen = new Set();
        for (const t of teams) {
            const key = String(t.name || '').toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            let img = null;
            try {
                const buf = await getTeamLogoBuffer(t.id);
                if (buf) img = await loadImage(buf);
            } catch { /* one missing logo must not drop the strip */ }
            entries.push({ name: t.name, color: t.color || CYAN, img });
        }
    } catch (err) {
        Logger.error('welcomeCard: franchise logo strip failed', err);
    }
    _stripCache = { at: Date.now(), entries };
    return entries;
}

/** Franchise disc. The neutral white lift goes UNDER the colour tint because
 *  several franchise colours are near-black (MNML is #000000) and a dark logo on
 *  a dark tint disappears entirely. */
function drawLogoDisc(ctx, entry, cx, cy, dia) {
    const r = dia / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
    ctx.fillStyle = withAlpha(entry.color, 0.28); ctx.fill();
    ctx.lineWidth = 1.6; ctx.strokeStyle = withAlpha(entry.color, 0.8); ctx.stroke();
    ctx.restore();
    if (entry.img) {
        try {
            ctx.save();
            ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(entry.img, cx - r + 3, cy - r + 3, dia - 6, dia - 6);
            ctx.restore();
        } catch { /* optional */ }
    }
}

/** A pill. Returns its width so callers can lay several out. */
function chipWidth(ctx, label, fontSize = 15, padX = 18) {
    ctx.font = `bold ${fontSize}px ${FONT}`;
    return ctx.measureText(label).width + padX * 2;
}

function drawChip(ctx, x, y, label, color, { h = 36, padX = 18, fontSize = 15 } = {}) {
    const w = chipWidth(ctx, label, fontSize, padX);
    ctx.save();
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = withAlpha(color, 0.22); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = withAlpha(color, 0.75); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + padX, y + h / 2 + 1);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    return w;
}

/**
 * @param {object} o
 * @param {string} o.displayName      server display name
 * @param {string} o.username         discord username (no @)
 * @param {Buffer|null} o.avatarBuffer PNG bytes — a URL string renders BLANK on canvas
 * @param {number|null} o.memberNumber guild.memberCount at join
 * @param {string|null} o.seasonLabel  e.g. "Season 10"
 * @param {Date|null} o.joinedAt
 * @returns {Promise<Buffer>} PNG
 */
async function buildWelcomeCard({ displayName, username, avatarBuffer, memberNumber, seasonLabel, joinedAt } = {}) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ---- Stage
    ctx.fillStyle = '#05030f';
    ctx.fillRect(0, 0, W, H);

    // Iridescent band sweeping across the upper half.
    ctx.save();
    ctx.translate(0, -40); ctx.rotate(-0.14);
    const rain = ctx.createLinearGradient(0, 0, W * 1.2, 0);
    rain.addColorStop(0.00, '#22d3ee');
    rain.addColorStop(0.22, '#818cf8');
    rain.addColorStop(0.44, '#ec4899');
    rain.addColorStop(0.66, '#fb923c');
    rain.addColorStop(0.85, '#a3e635');
    rain.addColorStop(1.00, '#22d3ee');
    ctx.fillStyle = rain;
    ctx.fillRect(-60, 120, W + 240, 300);
    ctx.restore();

    // Additive blooms give the band depth instead of a flat stripe.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    blob(ctx, 200, 300, 400, CYAN, 0.45);
    blob(ctx, 1000, 260, 400, MAGENTA, 0.45);
    blob(ctx, 620, 200, 380, VIOLET, 0.35);
    ctx.restore();

    // Veil only where the copy sits — a full-canvas scrim flattened the band.
    const veil = ctx.createLinearGradient(0, 0, 0, H);
    veil.addColorStop(0, 'rgba(5,3,15,0.55)');
    veil.addColorStop(0.34, 'rgba(5,3,15,0.30)');
    veil.addColorStop(0.62, 'rgba(5,3,15,0.86)');
    veil.addColorStop(1, 'rgba(5,3,15,0.95)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, W, H);
    grain(ctx);

    const logos = await franchiseLogos();
    const mark = await leagueLogo();

    // ---- Header
    let hx = 44;
    if (mark) {
        try { ctx.drawImage(mark, hx, 28, 38, 38); hx += 50; } catch { /* optional */ }
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = WHITE; ctx.font = `bold 20px ${FONT}`;
    ctx.fillText('BELUGA LEAGUE', hx, 54);
    if (seasonLabel) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `bold 18px ${FONT}`;
        ctx.fillText(String(seasonLabel).toUpperCase(), W - 44, 54);
    }

    // ---- Avatar (right), drawn before the headline so the type can sit over it.
    const acx = 985; const acy = 232; const ar = 100;
    ctx.save();
    ctx.shadowColor = withAlpha(AQUA, 0.9); ctx.shadowBlur = 44;
    ctx.beginPath(); ctx.arc(acx, acy, ar + 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    ctx.restore();

    if (!await drawCircleImage(ctx, avatarBuffer, acx, acy, ar)) {
        drawInitials(ctx, displayName || username, acx, acy, ar);
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(acx, acy, ar, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    const ring = ctx.createLinearGradient(acx - ar, acy - ar, acx + ar, acy + ar);
    ring.addColorStop(0, AQUA); ring.addColorStop(0.5, WHITE); ring.addColorStop(1, MAGENTA);
    ctx.strokeStyle = ring;
    ctx.shadowColor = withAlpha(MAGENTA, 0.8); ctx.shadowBlur = 44;
    ctx.stroke();
    ctx.restore();

    // ---- Chromatic headline
    ctx.textAlign = 'left';
    const hSize = fitFont(ctx, 'WELCOME', W - 420, 132, 70, 'bold', DISPLAY);
    ctx.font = `bold ${hSize}px ${DISPLAY}`;
    // Cyan and magenta ghosts offset a few px, added together, then crisp white
    // on top — a cheap chromatic-aberration read.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlpha(CYAN, 0.85); ctx.fillText('WELCOME', 44, 200);
    ctx.fillStyle = withAlpha(MAGENTA, 0.85); ctx.fillText('WELCOME', 50, 204);
    ctx.restore();
    ctx.fillStyle = WHITE;
    ctx.fillText('WELCOME', 47, 202);

    const aSize = Math.round(hSize * 0.46);
    ctx.font = `bold ${aSize}px ${DISPLAY}`;
    ctx.fillStyle = AQUA;
    glowText(ctx, 'ABOARD', 47, 202 + Math.round(aSize * 1.0), withAlpha(CYAN, 0.8), 20);

    // ---- Member chips, right-aligned. Laid out FIRST so the name below can be
    // constrained to whatever width is left — a long name used to run under them.
    const joined = joinedAt instanceof Date && !Number.isNaN(joinedAt.getTime()) ? joinedAt : new Date();
    const joinedText = joined.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const chips = [
        [`MEMBER ${memberNumber ? `#${Number(memberNumber).toLocaleString()}` : '—'}`, AQUA],
        [`JOINED ${joinedText}`, PINK],
    ];
    const chipsW = chips.reduce((sum, c) => sum + chipWidth(ctx, c[0]) + 12, 0) - 12;
    let chipX = W - 44 - chipsW;
    const chipsLeft = chipX;
    for (const [label, color] of chips) {
        chipX += drawChip(ctx, chipX, 352, label, color) + 12;
    }

    // ---- Name
    const name = String(displayName || username || 'New member');
    const nameMax = Math.max(320, chipsLeft - 44 - 32);
    const nSize = fitFont(ctx, name, nameMax, 56, 26, 'bold', DISPLAY);
    ctx.font = `bold ${nSize}px ${DISPLAY}`;
    ctx.fillStyle = WHITE;
    ctx.textAlign = 'left';
    ctx.fillText(name, 44, 372);

    if (username && username.toLowerCase() !== name.toLowerCase()) {
        const handle = `@${username}`;
        const hs = fitFont(ctx, handle, nameMax, 18, 12, '');
        ctx.font = `${hs}px ${FONT}`;
        ctx.fillStyle = DIM;
        ctx.fillText(handle, 44, 400);
    }

    // ---- Gradient rule
    const rule = ctx.createLinearGradient(44, 0, W - 44, 0);
    rule.addColorStop(0, CYAN); rule.addColorStop(0.5, MAGENTA); rule.addColorStop(1, LIME);
    ctx.save();
    ctx.strokeStyle = rule; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(44, 428); ctx.lineTo(W - 44, 428); ctx.stroke();
    ctx.restore();

    // ---- Steps
    const stepGap = (W - 88) / STEPS.length;
    STEPS.forEach((s, i) => {
        const x = 44 + i * stepGap;
        ctx.save();
        ctx.beginPath(); ctx.arc(x + 18, 470, 18, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(s.color, 0.25); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = s.color;
        ctx.shadowColor = withAlpha(s.color, 0.9); ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = s.color; ctx.font = `bold 17px ${FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.n, x + 18, 471);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

        const labelMax = stepGap - 60;
        ctx.fillStyle = WHITE;
        const ts = fitFont(ctx, s.title, labelMax, 22, 14, 'bold', DISPLAY);
        ctx.font = `bold ${ts}px ${DISPLAY}`;
        ctx.fillText(s.title, x + 46, 467);
        ctx.fillStyle = DIM;
        const ss = fitFont(ctx, s.sub, labelMax, 13, 10, '');
        ctx.font = `${ss}px ${FONT}`;
        ctx.fillText(s.sub, x + 46, 486);
    });

    // ---- Franchise rail. No website domain here — see CLAUDE.md graphics rules.
    if (logos.length) {
        const bandY = H - 58;
        const dia = 44;
        const step = Math.min(dia + 12, (W - 400) / logos.length);
        let lx = 44 + dia / 2;
        for (const e of logos) { drawLogoDisc(ctx, e, lx, bandY, dia); lx += step; }
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `bold 13px ${FONT}`;
        ctx.fillText(`${logos.length} FRANCHISES  ·  AA  ·  AAA  ·  MAJORS`, W - 44, bandY + 5);
    } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `bold 13px ${FONT}`;
        ctx.fillText('AA  ·  AAA  ·  MAJORS', W / 2, H - 30);
    }

    return canvas.toBuffer('image/png');
}

/** Drop the cached franchise strip (used when logos/teams change mid-season). */
function clearWelcomeCardCache() {
    _stripCache = null;
}

module.exports = { buildWelcomeCard, clearWelcomeCardCache };
