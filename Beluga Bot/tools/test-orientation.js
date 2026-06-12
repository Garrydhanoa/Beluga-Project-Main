/**
 * Orientation regression test (offline, no API / no DB).
 *
 * Guards the fix for the flipped result-card bug: buildCommitPayload must take
 * home/away orientation ONLY from the session's stored homeIdx, and the
 * confirmation-card tile math must agree with the commit payload for both
 * orientations — including the old failure case where every home player was
 * skipped during matching.
 *
 * Run: node tools/test-orientation.js
 */
const { buildCommitPayload } = require('../src/stats/report/flow');

let failures = 0;
function assert(cond, label) {
    if (cond) { console.log(`  ✅ ${label}`); } else { failures += 1; console.log(`  ❌ ${label}`); }
}

// Synthetic parsed series in cluster order (mirrors seriesParser output):
// cluster0 = A1..A3, cluster1 = B1..B3; cluster0 wins the series 3–2.
const mkPlayer = (pkey, name) => ({
    pkey, platform: 'steam', platformId: pkey, name, names: [name],
    score: 300, goals: 1, assists: 0, saves: 1, shots: 2, shootingPct: 50,
    demoInflicted: 0, demoTaken: 0, mvp: false, playedSeconds: 300,
});
const A = ['a1', 'a2', 'a3'].map((k) => mkPlayer(k, k.toUpperCase()));
const B = ['b1', 'b2', 'b3'].map((k) => mkPlayer(k, k.toUpperCase()));
const GOALS = [[3, 1], [2, 4], [1, 0], [0, 2], [5, 4]]; // cluster0 vs cluster1 per game
const parsed = {
    teams: [
        { index: 0, players: A, playerKeys: A.map((p) => p.pkey), seriesWins: 3 },
        { index: 1, players: B, playerKeys: B.map((p) => p.pkey), seriesWins: 2 },
    ],
    seriesScore: { team0: 3, team1: 2, label: '3–2' },
    games: GOALS.map(([g0, g1], i) => ({
        replayId: `r${i}`, url: `https://example/r${i}`, map: 'map', duration: 300,
        overtime: false, date: null, team0Goals: g0, team1Goals: g1,
        team0Players: A, team1Players: B,
        winner: g0 > g1 ? 'team0' : 'team1',
    })),
};

const slotsFor = (players, prefix, { skipped = false } = {}) => players.map((p, i) => ({
    pkey: p.pkey, name: p.name, platform: p.platform, platformId: p.platformId,
    discordId: skipped ? null : `${prefix}${i}`, skipped,
}));

function makeSession({ homeIdx, homeSlots, awaySlots }) {
    return {
        id: 1, home_team_id: 100, away_team_id: 200, parsed,
        message_ids: { homeIdx, homeName: 'HOME', awayName: 'AWAY' },
        home_matches: { slots: homeSlots, submitted: true, confirmed: false, page: 0 },
        away_matches: { slots: awaySlots, submitted: true, confirmed: false, page: 0 },
    };
}

// Mirrors postConfirmation()'s per-game tile math in flow.js.
function tilesFor(session) {
    const b = session.message_ids;
    const homeIsT0 = (b.homeIdx ?? 0) === 0;
    return parsed.games.map((g) => {
        const homeGoals = homeIsT0 ? g.team0Goals : g.team1Goals;
        const awayGoals = homeIsT0 ? g.team1Goals : g.team0Goals;
        const homeWonGame = Number(homeGoals) > Number(awayGoals);
        return { wName: homeWonGame ? b.homeName : b.awayName, wGoals: homeWonGame ? homeGoals : awayGoals, lGoals: homeWonGame ? awayGoals : homeGoals };
    });
}

function checkConsistency(session, expectHomeGoals, label) {
    console.log(`\n${label}`);
    const { games } = buildCommitPayload(session, new Set(['h0', 'h1', 'h2']), new Set(['w0', 'w1', 'w2']));
    const payloadHome = games.map((g) => g.homeGoals);
    assert(JSON.stringify(payloadHome) === JSON.stringify(expectHomeGoals),
        `commit payload home goals = [${expectHomeGoals}] (got [${payloadHome}])`);

    // Card tiles must name the same per-game winner the payload implies.
    const tiles = tilesFor(session);
    const agree = games.every((g, i) => {
        const homeWon = g.homeGoals > g.awayGoals;
        return tiles[i].wName === (homeWon ? 'HOME' : 'AWAY')
            && tiles[i].wGoals === Math.max(g.homeGoals, g.awayGoals)
            && tiles[i].lGoals === Math.min(g.homeGoals, g.awayGoals);
    });
    assert(agree, 'card tiles agree with commit payload for every game');

    // Series score derived from games must match the stored orientation.
    const homeWins = games.filter((g) => g.homeGoals > g.awayGoals).length;
    const awayWins = games.length - homeWins;
    const b = session.message_ids;
    const expHome = (b.homeIdx === 0) ? parsed.seriesScore.team0 : parsed.seriesScore.team1;
    const expAway = (b.homeIdx === 0) ? parsed.seriesScore.team1 : parsed.seriesScore.team0;
    assert(homeWins === expHome && awayWins === expAway,
        `series score ${homeWins}–${awayWins} matches stored orientation ${expHome}–${expAway}`);
}

// 1) HOME is cluster 0 (normal case).
checkConsistency(
    makeSession({ homeIdx: 0, homeSlots: slotsFor(A, 'h'), awaySlots: slotsFor(B, 'w') }),
    GOALS.map(([g0]) => g0),
    'homeIdx=0, all players matched'
);

// 2) HOME is cluster 1 (sides swapped by the reporter).
checkConsistency(
    makeSession({ homeIdx: 1, homeSlots: slotsFor(B, 'h'), awaySlots: slotsFor(A, 'w') }),
    GOALS.map(([, g1]) => g1),
    'homeIdx=1, all players matched'
);

// 3) THE OLD BUG: home players all skipped → the per-game re-detection used to
//    see no matched home players and flip every game. Orientation must hold.
checkConsistency(
    makeSession({ homeIdx: 0, homeSlots: slotsFor(A, 'h', { skipped: true }), awaySlots: slotsFor(B, 'w') }),
    GOALS.map(([g0]) => g0),
    'homeIdx=0, ALL home players skipped (regression case)'
);

// 4) Same with sides swapped.
checkConsistency(
    makeSession({ homeIdx: 1, homeSlots: slotsFor(B, 'h', { skipped: true }), awaySlots: slotsFor(A, 'w') }),
    GOALS.map(([, g1]) => g1),
    'homeIdx=1, ALL home players skipped (regression case)'
);

console.log(failures ? `\n❌ ${failures} assertion(s) FAILED` : '\n✅ orientation consistency: all checks passed');
process.exit(failures ? 1 : 0);
