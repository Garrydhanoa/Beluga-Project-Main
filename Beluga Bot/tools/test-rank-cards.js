/**
 * Dev-only: render the standings + power-rankings + welcome cards to PNG using
 * stubbed team colors/logos (no DB needed) so the layout can be eyeballed.
 * Run from the Beluga Bot folder:  node tools/test-rank-cards.js
 * Output: tools/_cards/{standings,power,welcome}.png
 *
 * Set REAL_DB=1 (with DATABASE_PUBLIC_URL in .env) to render the welcome card
 * against the live franchise logos instead of the stubs.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { createCanvas } = require('canvas');

// ---- Stub teamRoles so cards render offline with deterministic colors/logos.
const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f1c40f', '#1abc9c', '#e67e22', '#ff6b9d', '#5dade2', '#16a085'];

function stubLogo(teamId) {
    // tiny circular logo so the ring/clip path is exercised
    const c = createCanvas(64, 64);
    const x = c.getContext('2d');
    x.fillStyle = PALETTE[teamId % PALETTE.length];
    x.beginPath(); x.arc(32, 32, 30, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 28px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String(teamId), 32, 33);
    return c.toBuffer('image/png');
}

const REAL_DB = process.env.REAL_DB === '1';

const FRANCHISES = [
    'Aviators', 'Fallen Angels', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance', 'MNML',
    'Panthers', 'Sublunary', 'Surge', 'Vaelix Esports', 'Valkyries', 'Vipers', 'Voltage',
];

const teamRolesPath = require.resolve('../src/utils/teamRoles');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    // welcomeCard lives in src/utils, so it requires './teamRoles' not '../utils/teamRoles'.
    const wantsTeamRoles = request === '../utils/teamRoles' || request === './teamRoles';
    const stubbable = REAL_DB ? /standingsCard|powerCard/ : /standingsCard|powerCard|welcomeCard/;
    if (parent && stubbable.test(parent.filename) && wantsTeamRoles) {
        return {
            getTeamLogoBuffer: async (id) => (id == null ? null : stubLogo(id)),
            getTeamColorInt: async (id) => parseInt(PALETTE[(id || 0) % PALETTE.length].slice(1), 16),
            getActiveTeams: async () => FRANCHISES.flatMap((name, i) => (
                ['Majors', 'AAA', 'AA'].map((division) => ({
                    id: i + 1, name, division, franchiseId: i + 1, color: PALETTE[i % PALETTE.length],
                }))
            )),
        };
    }
    return originalLoad(request, parent, isMain);
};

if (REAL_DB) require('dotenv').config();

const { buildStandingsImage } = require('../src/stats/standingsCard');
const { buildPowerRankingsImage } = require('../src/stats/powerCard');
const { buildWelcomeCard } = require('../src/utils/welcomeCard');

const TEAMS = ['Lotus', 'Clovis Esports', 'Sublunary', 'Immortals', 'Surge', 'Panthers', 'Aviators', 'InTraCate', 'Malfeasance', '6 Speed'];

const standingsRows = TEAMS.map((name, i) => ({
    rank: i + 1,
    teamId: i + 1,
    teamName: name,
    wins: 9 - i,
    losses: i,
    gameDiff: 14 - i * 3,
    goalDiff: 38 - i * 8,
    rating: 88 - i * 4.2,
}));

const prTeams = TEAMS.map((name, i) => ({
    rank: i + 1,
    teamId: i + 1,
    name,
    score: Math.round((92 - i * 6.4) * 10) / 10,
    reason: ['won their latest series', `${5 - Math.min(i, 4)}-${Math.min(i, 4)} in last 5`, `team rating ${(88 - i * 4).toFixed(1)}`][i % 3] + ' · strong run',
    trend: ['up', 'down', 'new', 'same', 'up'][i % 5],
}));

// stub avatar buffer so the player-row avatar ring/clip path is exercised
function stubAvatar(i) {
    const c = createCanvas(48, 48);
    const x = c.getContext('2d');
    x.fillStyle = PALETTE[(i + 3) % PALETTE.length];
    x.fillRect(0, 0, 48, 48);
    x.fillStyle = '#fff'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(String.fromCharCode(65 + i), 24, 25);
    return c.toBuffer('image/png');
}

// bigger stub for the welcome card's 176px hero circle
function bigStubAvatar(letter) {
    const c = createCanvas(256, 256);
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, '#5dade2'); g.addColorStop(1, '#9b59b6');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    x.fillStyle = '#fff'; x.font = 'bold 130px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(letter, 128, 134);
    return c.toBuffer('image/png');
}

const prPlayers = ['Twizz', 'Acro', 'Vortex', 'Nyx', 'Blaze', 'Echo', 'Frost', 'Glide', 'Halo', 'Ion'].map((name, i) => ({
    rank: i + 1,
    name,
    team: TEAMS[i],
    score: Math.round((310 - i * 18.5) * 10) / 10,
    trend: ['up', 'same', 'down', 'new', 'up'][i % 5],
    avatarBuffer: i === 9 ? null : stubAvatar(i), // last one null to test the placeholder
}));

(async () => {
    const outDir = path.join(__dirname, '_cards');
    fs.mkdirSync(outDir, { recursive: true });

    const s = await buildStandingsImage(standingsRows, { division: 'Majors', seasonNumber: 9, playoffLine: 8 });
    fs.writeFileSync(path.join(outDir, 'standings.png'), s);
    console.log('wrote', path.join(outDir, 'standings.png'), s.length, 'bytes');

    // week drives the "Season N · Week N" stamp and the footer legend.
    const p = await buildPowerRankingsImage({ division: 'Majors', seasonNumber: 9, week: 6, teams: prTeams, players: prPlayers });
    fs.writeFileSync(path.join(outDir, 'power.png'), p);
    console.log('wrote', path.join(outDir, 'power.png'), p.length, 'bytes');

    // Welcome card — typical case, then the two edge cases that break layouts:
    // a very long display name and a member with no usable avatar.
    const w = await buildWelcomeCard({
        displayName: 'GurryDhanoa', username: 'gurry.d', avatarBuffer: bigStubAvatar('G'),
        memberNumber: 268, seasonLabel: 'Season 10', joinedAt: new Date(),
    });
    fs.writeFileSync(path.join(outDir, 'welcome.png'), w);
    console.log('wrote', path.join(outDir, 'welcome.png'), w.length, 'bytes');

    const w2 = await buildWelcomeCard({
        displayName: 'xX_TheLongestPossibleNameEver_Xx', username: 'thelongestpossiblenameever',
        avatarBuffer: null, memberNumber: 1204, seasonLabel: 'Season 10', joinedAt: new Date(),
    });
    fs.writeFileSync(path.join(outDir, 'welcome-edge.png'), w2);
    console.log('wrote', path.join(outDir, 'welcome-edge.png'), w2.length, 'bytes');
})().catch((e) => { console.error(e); process.exit(1); });
