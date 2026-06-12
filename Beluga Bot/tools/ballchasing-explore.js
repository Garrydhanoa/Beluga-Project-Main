/**
 * Ballchasing exploration / analysis tool (DEV ONLY — reads, never writes).
 *
 * Purpose: pull the operator's real example groups and dump exactly how
 * Ballchasing structures groups / replays / players, plus a prototype of the
 * team-identification + series-score + edge-case detection the parser will use.
 *
 * Run:  node tools/ballchasing-explore.js            (all example groups)
 *       node tools/ballchasing-explore.js <url|id>   (one specific group)
 *
 * Output: tools/ballchasing-dumps/<label>.json  (full structured analysis)
 *         tools/ballchasing-dumps/SUMMARY.md     (human-readable overview)
 */

const fs = require('fs');
const path = require('path');

// ---- env bootstrap (local convenience) --------------------------------------
// Load the bot's .env, then fall back to the website's .env, then normalize the
// key name case (operator stored it as "Ballchasing_api_key"). Production uses
// the canonical BALLCHASING_API_KEY (set that on Railway for the bot service).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '..', 'beluga-league-main', '.env') });
if (!process.env.BALLCHASING_API_KEY) {
    for (const [k, v] of Object.entries(process.env)) {
        if (k.toLowerCase() === 'ballchasing_api_key' && v) {
            process.env.BALLCHASING_API_KEY = v;
            break;
        }
    }
}

const bc = require('../src/stats/ballchasingClient');

const EXAMPLE_GROUPS = require('./example-groups');

const OUT_DIR = path.join(__dirname, 'ballchasing-dumps');

function pkey(p) {
    const plat = p?.id?.platform ?? p?.platform ?? '?';
    const id = p?.id?.id ?? p?.platform_id ?? '?';
    return `${plat}:${id}`;
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function sideGoals(side) {
    if (side?.goals != null) return num(side.goals);
    if (side?.stats?.core?.goals != null) return num(side.stats.core.goals);
    return (side?.players || []).reduce((a, p) => a + num(p?.stats?.core?.goals), 0);
}

function playerLine(p, replayDuration) {
    const core = p?.stats?.core || {};
    const demo = p?.stats?.demo || {};
    const start = num(p?.start_time);
    const end = num(p?.end_time);
    const playedSeconds = Math.max(0, end - start);
    const playedPct = replayDuration > 0 ? Math.round((playedSeconds / replayDuration) * 100) : null;
    return {
        name: p?.name ?? '?',
        platform: p?.id?.platform ?? null,
        platformId: p?.id?.id ?? null,
        pkey: pkey(p),
        mvp: Boolean(p?.mvp ?? core?.mvp),
        score: num(core.score),
        goals: num(core.goals),
        assists: num(core.assists),
        saves: num(core.saves),
        shots: num(core.shots),
        shootingPct: core.shooting_percentage ?? null,
        demoInflicted: num(demo.inflicted),
        demoTaken: num(demo.taken),
        startTime: start,
        endTime: end,
        playedSeconds,
        playedPct,
        isGhostCandidate: num(core.score) === 0 || (playedPct !== null && playedPct < 10),
    };
}

function simplifyReplay(full) {
    const duration = num(full?.duration);
    const blue = full?.blue || {};
    const orange = full?.orange || {};
    return {
        id: full?.id,
        title: full?.title ?? full?.replay_title ?? null,
        date: full?.date ?? null,
        map: full?.map_name ?? full?.map_code ?? null,
        duration,
        overtime: Boolean(full?.overtime),
        overtimeSeconds: full?.overtime_seconds ?? null,
        blue: {
            name: blue?.name ?? null,
            goals: sideGoals(blue),
            playerCount: (blue?.players || []).length,
            players: (blue?.players || []).map((p) => playerLine(p, duration)),
        },
        orange: {
            name: orange?.name ?? null,
            goals: sideGoals(orange),
            playerCount: (orange?.players || []).length,
            players: (orange?.players || []).map((p) => playerLine(p, duration)),
        },
    };
}

/**
 * Prototype of the real team-identification algorithm:
 * cluster all players into exactly two teams across games (colors swap), then
 * tally per-game wins to derive the series score by TEAM (not by color).
 */
function identifyTeamsAndScore(replays) {
    if (!replays.length) return null;
    const team0 = new Set();
    const team1 = new Set();
    const seedBlue = new Set(replays[0].blue.players.map((p) => p.pkey));
    const seedOrange = new Set(replays[0].orange.players.map((p) => p.pkey));
    seedBlue.forEach((k) => team0.add(k));
    seedOrange.forEach((k) => team1.add(k));

    const overlap = (set, arr) => arr.reduce((a, k) => a + (set.has(k) ? 1 : 0), 0);

    const games = [];
    for (const r of replays) {
        const blueKeys = r.blue.players.map((p) => p.pkey);
        const orangeKeys = r.orange.players.map((p) => p.pkey);
        const straight = overlap(team0, blueKeys) + overlap(team1, orangeKeys);
        const swapped = overlap(team1, blueKeys) + overlap(team0, orangeKeys);
        const blueIsTeam0 = straight >= swapped;

        const team0Side = blueIsTeam0 ? 'blue' : 'orange';
        const team1Side = blueIsTeam0 ? 'orange' : 'blue';
        const team0Goals = blueIsTeam0 ? r.blue.goals : r.orange.goals;
        const team1Goals = blueIsTeam0 ? r.orange.goals : r.blue.goals;

        (blueIsTeam0 ? blueKeys : orangeKeys).forEach((k) => team0.add(k));
        (blueIsTeam0 ? orangeKeys : blueKeys).forEach((k) => team1.add(k));

        games.push({
            replayId: r.id,
            team0Side,
            team1Side,
            team0Goals,
            team1Goals,
            winner: team0Goals > team1Goals ? 'team0' : team1Goals > team0Goals ? 'team1' : 'tie',
        });
    }

    let team0Wins = 0;
    let team1Wins = 0;
    for (const g of games) {
        if (g.winner === 'team0') team0Wins += 1;
        else if (g.winner === 'team1') team1Wins += 1;
    }

    const crossTeam = [...team0].filter((k) => team1.has(k));

    return {
        team0Players: [...team0],
        team1Players: [...team1],
        team0Wins,
        team1Wins,
        seriesScore: `${team0Wins}-${team1Wins}`,
        games,
        crossTeamPlayers: crossTeam,
    };
}

function parseScoreFromName(name) {
    const m = String(name || '').match(/(\d+)\s*[-–]\s*(\d+)/);
    return m ? `${m[1]}-${m[2]}` : null;
}

async function analyzeGroup({ label, url }) {
    const groupId = bc.parseGroupId(url);
    const result = { label, url, groupId, error: null };
    try {
        const group = await bc.getGroup(groupId);
        result.group = {
            id: group?.id,
            name: group?.name,
            created: group?.created,
            status: group?.status,
            playerIdentification: group?.player_identification,
            teamIdentification: group?.team_identification,
            aggregatedPlayerCount: Array.isArray(group?.players) ? group.players.length : 0,
            aggregatedPlayers: (group?.players || []).map((p) => ({
                name: p?.name,
                pkey: pkey(p),
                team: p?.team ?? null,
                cumGames: p?.cumulative?.games ?? null,
                cumScore: p?.cumulative?.core?.score ?? null,
                cumGoals: p?.cumulative?.core?.goals ?? null,
            })),
        };

        const list = await bc.listGroupReplays(groupId);
        const ids = list.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);

        const replays = [];
        for (const id of uniqueIds) {
            const full = await bc.getReplay(id);
            replays.push(simplifyReplay(full));
        }
        // Sort by date for a stable series order.
        replays.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        result.replays = replays;

        const oversized = replays
            .filter((r) => r.blue.playerCount > 3 || r.orange.playerCount > 3)
            .map((r) => ({ id: r.id, blue: r.blue.playerCount, orange: r.orange.playerCount }));

        const ghosts = [];
        for (const r of replays) {
            for (const side of ['blue', 'orange']) {
                for (const p of r[side].players) {
                    if (p.isGhostCandidate) ghosts.push({ replayId: r.id, side, name: p.name, pkey: p.pkey, score: p.score, playedPct: p.playedPct });
                }
            }
        }

        const teamInfo = identifyTeamsAndScore(replays);
        const nameScore = parseScoreFromName(result.group.name);

        result.analysis = {
            replayCount: ids.length,
            uniqueReplayCount: uniqueIds.length,
            duplicateReplayIds: duplicates,
            computedSeriesScore: teamInfo ? teamInfo.seriesScore : null,
            nameScore,
            nameVsComputedMatch: nameScore && teamInfo
                ? (nameScore === teamInfo.seriesScore || nameScore === `${teamInfo.team1Wins}-${teamInfo.team0Wins}`)
                : null,
            oversizedTeams: oversized,
            crossTeamPlayers: teamInfo ? teamInfo.crossTeamPlayers : [],
            ghostCandidates: ghosts,
            perGame: teamInfo ? teamInfo.games.map((g) => `${g.team0Goals}-${g.team1Goals} (${g.winner})`) : [],
            distinctPlayerCount: teamInfo ? (teamInfo.team0Players.length + teamInfo.team1Players.length) : 0,
        };
    } catch (err) {
        result.error = { code: err.code || null, status: err.status || null, message: err.message };
    }
    return result;
}

function fmtSummaryLine(r) {
    if (r.error) {
        return `### ❌ ${r.label}\n- URL: ${r.url}\n- ERROR [${r.error.code}]: ${r.error.message}\n`;
    }
    const a = r.analysis;
    const flags = [];
    if (a.duplicateReplayIds.length) flags.push(`dupes:${a.duplicateReplayIds.length}`);
    if (a.oversizedTeams.length) flags.push(`>3players:${a.oversizedTeams.length}`);
    if (a.crossTeamPlayers.length) flags.push(`crossTeam:${a.crossTeamPlayers.length}`);
    if (a.ghostCandidates.length) flags.push(`ghosts:${a.ghostCandidates.length}`);
    if (a.nameVsComputedMatch === false) flags.push('NAME≠COMPUTED');
    return [
        `### ✅ ${r.label}`,
        `- Group name: \`${r.group.name}\``,
        `- Replays: ${a.replayCount} (unique ${a.uniqueReplayCount}) | distinct players: ${a.distinctPlayerCount}`,
        `- Computed series score (by team): **${a.computedSeriesScore}** | name says: ${a.nameScore || '—'} | match: ${a.nameVsComputedMatch}`,
        `- Per game (team0-team1): ${a.perGame.join(', ')}`,
        `- Flags: ${flags.length ? flags.join(', ') : 'none'}`,
        '',
    ].join('\n');
}

async function main() {
    if (!bc.hasApiKey()) {
        console.error('\n❌ BALLCHASING_API_KEY not found in env (checked bot + website .env).');
        console.error('   Add it as BALLCHASING_API_KEY, then re-run: node tools/ballchasing-explore.js\n');
        process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const cliArg = process.argv[2];
    const groups = cliArg
        ? [{ label: 'cli-' + (bc.parseGroupId(cliArg) || 'group'), url: cliArg }]
        : EXAMPLE_GROUPS;

    console.log(`Analyzing ${groups.length} group(s)…\n`);
    const summaries = [];
    for (let i = 0; i < groups.length; i += 1) {
        const g = groups[i];
        process.stdout.write(`[${i + 1}/${groups.length}] ${g.label} … `);
        // eslint-disable-next-line no-await-in-loop
        const r = await analyzeGroup(g);
        fs.writeFileSync(path.join(OUT_DIR, `${g.label}.json`), JSON.stringify(r, null, 2));
        summaries.push(r);
        console.log(r.error ? `ERROR (${r.error.code})` : `score ${r.analysis.computedSeriesScore}, ${r.analysis.replayCount} games`);
    }

    const md = [
        '# Ballchasing Group Analysis — Summary',
        `Generated: ${new Date().toISOString()}`,
        '',
        ...summaries.map(fmtSummaryLine),
    ].join('\n');
    fs.writeFileSync(path.join(OUT_DIR, 'SUMMARY.md'), md);

    console.log(`\n✅ Done. Per-group JSON + SUMMARY.md written to: ${OUT_DIR}`);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
