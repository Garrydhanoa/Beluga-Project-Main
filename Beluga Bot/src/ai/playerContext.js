/**
 * What the AI knows about a person.
 *
 * Used by BOTH the server chatbot (`utils/aiChat.js`) and the DM responder
 * (`dm/dmAi.js`), so "what team am I on" and "how am I doing" answer the same
 * way wherever you ask.
 *
 * Shape of the context handed to the model:
 *   - a compact CARD for whoever is talking (always)
 *   - a card for up to 2 other players they named (only if they named someone)
 *   - DEEP sections — recent games, teammates, next opponent, awards, MMR… —
 *     only when the message actually touches that topic, mirroring the lazy
 *     rulebook lookup so a "hi" doesn't drag 60 lines of stats along with it
 *   - LEAGUE standings, only for league-wide questions
 *   - ROAST ANGLES, unhinged persona only
 *
 * EVERYTHING HERE IS PUBLIC — the same fields the website already shows at
 * /players/<name>. Deliberately excluded: the SalSheet's "INFO About the Person
 * (SUS) Flagged", "Suspended?" and "IR?" columns, and anything from `tickets`.
 * The bot talks directly to members, so a staff-only flag in here would get
 * repeated straight back to the person it's about.
 */

const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const { pickPrimaryRoster, primaryDivision } = require('../utils/primaryDivision');
const { getSalSheetRow } = require('../utils/salSheetLookup');
const { getStandings } = require('../stats/statsStore');

const CACHE_MS = 60 * 1000;
const LEAGUE_CACHE_MS = 5 * 60 * 1000;
const MAX_NAMED_PLAYERS = 2;

const cardCache = new Map();
let leagueCache = { text: null, at: 0 };

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

const n = (v) => Number(v || 0);
const per = (total, games) => (games ? (n(total) / n(games)).toFixed(2) : '0.00');

async function q(sql, params = []) {
    try {
        const r = await pool.query(sql, params);
        return r.rows;
    } catch (err) {
        // A wrong column name throws, and silently swallowing it would make the
        // AI quietly stat-blind. Log loudly, return nothing.
        Logger.warning(`playerContext query failed: ${err.message}`);
        return [];
    }
}

async function activeSeason() {
    const rows = await q(`SELECT id, season_number FROM seasons WHERE status = 'active' LIMIT 1`);
    return rows[0] || null;
}

/* ------------------------------------------------------------------ card --- */

/**
 * The always-injected profile. Kept deliberately short — this rides along on
 * every single message.
 */
async function buildPlayerCard(discordId, { label = null } = {}) {
    const id = String(discordId || '');
    if (!id || !db()) return null;

    const hit = cardCache.get(id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.text;

    const season = await activeSeason();
    const seasonId = season?.id || null;

    const [member] = await q(
        `SELECT display_name, username FROM discord_members WHERE discord_id = $1`, [id]);

    const rosterRows = seasonId ? await q(
        `SELECT t.id AS "teamId", t.name AS "teamName", t.division, rm.role,
                f.name AS franchise
           FROM team_roster_members rm
           JOIN teams t ON t.id = rm.team_id
           LEFT JOIN team_franchises f ON f.id = t.franchise_id
          WHERE rm.discord_id = $1 AND rm.season_id = $2
            AND rm.is_active = TRUE AND t.is_active = TRUE`, [id, seasonId]) : [];

    const seasonStats = seasonId ? await q(
        `SELECT division, team_id, games, score, goals, assists, saves, shots,
                mvps, demos_inflicted, demos_taken, beluga_score
           FROM stats_player_season
          WHERE discord_id = $1 AND season_id = $2 AND is_playoff = FALSE`, [id, seasonId]) : [];

    const sheet = await getSalSheetRow(id).catch(() => null);

    // Same resolver the website uses — a GM is rostered on all three of their
    // franchise's teams, so this must not just take the first row.
    const statsDivision = seasonStats[0]?.division || null;
    const roster = pickPrimaryRoster(rosterRows, { sheetLeague: sheet?.league || null, statsDivision });
    const division = primaryDivision({ sheetLeague: sheet?.league || null, statsDivision, rosterRows });

    const name = label || member?.display_name || member?.username || `User ${id.slice(-4)}`;
    const lines = [`Name: ${name}`];

    if (roster) {
        const role = roster.role && roster.role !== 'player' ? ` (${String(roster.role).toUpperCase()})` : '';
        lines.push(`Team: ${roster.teamName}${role}${roster.franchise && roster.franchise !== roster.teamName ? ` — ${roster.franchise} franchise` : ''}`);
    } else {
        lines.push('Team: FREE AGENT (not on a roster this season)');
    }

    // Say WHY it's unknown — "unknown" alone reads as a data error, and the two
    // reasons mean very different things to whoever is asking.
    if (division) {
        lines.push(`Division: ${division}`);
    } else if (rosterRows.length > 1) {
        lines.push('Division: not established — staff/GM who has not played a game');
    } else {
        lines.push('Division: not placed in one');
    }
    if (sheet?.salary != null) lines.push(`Salary: ${sheet.salary}`);
    if (sheet && sheet.eligible === false) lines.push('Eligibility: NOT eligible to play right now');

    // A GM sits on all three rosters; say so rather than looking like a mistake.
    if (rosterRows.length > 1) {
        lines.push(`Note: is a GM — sits on all ${rosterRows.length} of the franchise's rosters (${rosterRows.map((r) => r.division).join(', ')}).`);
    }

    const st = seasonStats[0];
    if (st && n(st.games)) {
        lines.push(
            `This season (S${season?.season_number ?? '?'}): ${n(st.games)} games · ` +
            `${n(st.goals)}G ${n(st.assists)}A ${n(st.saves)}Sv ${n(st.shots)}Sh · ${n(st.mvps)} MVPs · ` +
            `${n(st.demos_inflicted)} demos given / ${n(st.demos_taken)} taken`);
        lines.push(
            `Per game: ${per(st.goals, st.games)} goals, ${per(st.assists, st.games)} assists, ` +
            `${per(st.saves, st.games)} saves, ${per(st.score, st.games)} score · ` +
            `Beluga Score ${Number(st.beluga_score ?? 0).toFixed(2)}`);
    } else {
        lines.push(`This season (S${season?.season_number ?? '?'}): has not played any games yet.`);
    }

    const [life] = await q(
        `SELECT games, goals, assists, saves, mvps, beluga_score
           FROM stats_player_lifetime WHERE discord_id = $1`, [id]);
    if (life && n(life.games)) {
        lines.push(`Lifetime: ${n(life.games)} games · ${n(life.goals)}G ${n(life.assists)}A ${n(life.saves)}Sv · ${n(life.mvps)} MVPs`);
    }

    // Their team's standing.
    if (roster && seasonId) {
        const table = await getStandings(seasonId, roster.division).catch(() => []);
        const me = table.find((t) => t.teamId === roster.teamId);
        if (me) {
            lines.push(
                `Team standing: ${roster.teamName} is ${me.place}/${table.length} in ${roster.division} — ` +
                `${me.wins}W-${me.losses}L, game diff ${me.gameDiff >= 0 ? '+' : ''}${me.gameDiff}, ` +
                `goal diff ${me.goalDiff >= 0 ? '+' : ''}${me.goalDiff}`);
        }
    }

    const text = lines.join('\n');
    cardCache.set(id, { text, at: Date.now() });
    return text;
}

/* ------------------------------------------------------------- deep bits --- */

/** Which optional sections this message actually warrants. */
function topicsFor(message) {
    const m = String(message || '').toLowerCase();
    const has = (...words) => words.some((w) => m.includes(w));
    return {
        games: has('game', 'match', 'last', 'recent', 'played', 'lose', 'lost', 'win', 'won', 'streak', 'replay'),
        rank: has('rank', 'best', 'top', 'leader', 'better', 'worse', 'compare', 'mvp'),
        team: has('team', 'teammate', 'roster', 'lineup', 'franchise', 'captain', 'gm'),
        schedule: has('schedule', 'next', 'opponent', 'upcoming', 'play', 'week', 'fixture'),
        power: has('power', 'ranking', 'rating', 'standing'),
        history: has('award', 'championship', 'champion', 'trophy', 'history', 'trade', 'traded', 'signed', 'released', 'transaction'),
        mmr: has('mmr', 'rank', 'tracker', 'peak', 'ssl', 'gc', 'champ', 'elo'),
        league: has('league', 'standing', 'who is', "who's", 'everyone', 'division', 'first place', 'last place'),
    };
}

async function buildDeepContext(discordId, topics) {
    const id = String(discordId || '');
    if (!id || !db()) return '';

    const season = await activeSeason();
    const seasonId = season?.id || null;
    const out = [];

    if (topics.games && seasonId) {
        // NOTE: `week` and `home_team_id` live on stats_series, NOT stats_games —
        // stats_games only has the goals, the winner and the replay link.
        const games = await q(
            `SELECT s.week, s.home_team_id, g.home_goals, g.away_goals, g.winner_team_id,
                    gp.team_id, gp.score, gp.goals, gp.assists, gp.saves, gp.mvp
               FROM stats_game_players gp
               JOIN stats_games g ON g.id = gp.game_id
               JOIN stats_series s ON s.id = g.series_id
              WHERE gp.discord_id = $1 AND gp.is_playoff = FALSE
              ORDER BY g.id DESC LIMIT 5`, [id]);
        if (games.length) {
            out.push('Recent games (newest first):');
            for (const g of games) {
                const home = g.team_id === g.home_team_id;
                const ours = home ? n(g.home_goals) : n(g.away_goals);
                const theirs = home ? n(g.away_goals) : n(g.home_goals);
                const result = g.winner_team_id == null ? 'TIED'
                    : g.winner_team_id === g.team_id ? 'WON' : 'LOST';
                out.push(`  W${g.week ?? '?'} ${result} ${ours}-${theirs} · ` +
                    `${n(g.goals)}G ${n(g.assists)}A ${n(g.saves)}Sv, score ${n(g.score)}${g.mvp ? ' (MVP)' : ''}`);
            }
        }
    }

    if (topics.rank && seasonId) {
        const rows = await q(
            `SELECT discord_id, beluga_score,
                    RANK() OVER (PARTITION BY division ORDER BY beluga_score DESC) AS rk,
                    COUNT(*) OVER (PARTITION BY division) AS total, division
               FROM stats_player_season
              WHERE season_id = $1 AND is_playoff = FALSE AND games > 0`, [seasonId]);
        const me = rows.find((r) => String(r.discord_id) === id);
        if (me) out.push(`Leaderboard: ranked ${me.rk} of ${me.total} in ${me.division} by Beluga Score this season.`);
    }

    if (topics.team && seasonId) {
        const mates = await q(
            `SELECT DISTINCT COALESCE(m.display_name, m.username) AS name, rm.role
               FROM team_roster_members rm
               LEFT JOIN discord_members m ON m.discord_id = rm.discord_id
              WHERE rm.season_id = $1 AND rm.is_active = TRUE AND rm.discord_id <> $2
                AND rm.team_id IN (
                    SELECT team_id FROM team_roster_members
                     WHERE discord_id = $2 AND season_id = $1 AND is_active = TRUE)
              LIMIT 12`, [seasonId, id]);
        if (mates.length) {
            out.push(`Teammates: ${mates.map((x) => `${x.name}${x.role && x.role !== 'player' ? ` (${x.role})` : ''}`).join(', ')}`);
        }
    }

    if (topics.schedule && seasonId) {
        const next = await q(
            `SELECT sm.week, ht.name AS home, at.name AS away
               FROM schedule_matches sm
               LEFT JOIN teams ht ON ht.id = sm.home_team_id
               LEFT JOIN teams at ON at.id = sm.away_team_id
              WHERE sm.season_id = $1 AND sm.is_published = TRUE
                AND (sm.home_team_id IN (SELECT team_id FROM team_roster_members WHERE discord_id = $2 AND season_id = $1 AND is_active = TRUE)
                  OR sm.away_team_id IN (SELECT team_id FROM team_roster_members WHERE discord_id = $2 AND season_id = $1 AND is_active = TRUE))
              ORDER BY sm.week DESC LIMIT 3`, [seasonId, id]);
        if (next.length) {
            out.push(`Scheduled matches: ${next.map((x) => `W${x.week} ${x.home} vs ${x.away}`).join(' · ')}`);
        }
    }

    if (topics.power && seasonId) {
        // Rankings are per-week snapshots — read only the newest week, or a GM
        // rostered across divisions would surface one row per stored week.
        const pr = await q(
            `SELECT pr.rank, pr.division, pr.week, pr.note, pr.trend, t.name AS team
               FROM power_rankings pr
               LEFT JOIN teams t ON t.id = pr.team_id
              WHERE pr.season_id = $1 AND pr.team_id IN (
                    SELECT team_id FROM team_roster_members
                     WHERE discord_id = $2 AND season_id = $1 AND is_active = TRUE)
                AND pr.week IS NOT DISTINCT FROM (
                    SELECT MAX(week) FROM power_rankings WHERE season_id = $1)
              LIMIT 3`, [seasonId, id]);
        for (const p of pr) {
            out.push(`Power ranking${p.week != null ? ` (week ${p.week})` : ''}: ${p.team} is #${p.rank} in ${p.division}${p.trend ? ` (${p.trend})` : ''}${p.note ? ` — ${p.note}` : ''}`);
        }
    }

    if (topics.history) {
        const champs = await q(
            `SELECT DISTINCT s.season_number, sc.division, t.name AS team
               FROM season_champions sc
               JOIN teams t ON t.id = sc.team_id
               JOIN team_roster_members rm ON rm.team_id = sc.team_id AND rm.season_id = sc.season_id
               LEFT JOIN seasons s ON s.id = sc.season_id
              WHERE rm.discord_id = $1`, [id]);
        if (champs.length) {
            out.push(`Championships: ${champs.map((c) => `S${c.season_number} ${c.division} (${c.team})`).join(', ')}`);
        } else {
            out.push('Championships: none — has never won a title.');
        }

        const tx = await q(
            `SELECT type, team_name_snapshot AS team, performed_at
               FROM transactions WHERE discord_id = $1
              ORDER BY performed_at DESC LIMIT 5`, [id]);
        if (tx.length) {
            out.push(`Recent transactions: ${tx.map((t) => `${t.type}${t.team ? ` (${t.team})` : ''}`).join(', ')}`);
        }
    }

    if (topics.mmr) {
        const sheet = await getSalSheetRow(id).catch(() => null);
        if (sheet?.sal2sPeak || sheet?.sal3sPeak) {
            out.push(`Rocket League MMR — 2s peak: ${sheet.sal2sPeak || '?'}, 3s peak: ${sheet.sal3sPeak || '?'}`);
        }
        const names = await q(
            `SELECT DISTINCT current_name FROM stats_player_accounts WHERE discord_id = $1 LIMIT 5`, [id]);
        if (names.length) out.push(`In-game name(s): ${names.map((x) => x.current_name).join(', ')}`);
    }

    return out.join('\n');
}

/* ------------------------------------------------------------- league ----- */

async function buildLeagueContext() {
    if (!db()) return '';
    if (leagueCache.text && Date.now() - leagueCache.at < LEAGUE_CACHE_MS) return leagueCache.text;

    const season = await activeSeason();
    if (!season) return '';

    const out = [`League standings (S${season.season_number}):`];
    for (const division of ['Majors', 'AAA', 'AA']) {
        const table = await getStandings(season.id, division).catch(() => []);
        if (!table.length) continue;
        const top = table.slice(0, 3).map((t) => `${t.place}. ${t.teamName} ${t.wins}-${t.losses}`);
        const bottom = table[table.length - 1];
        out.push(`  ${division}: ${top.join(', ')} … last: ${bottom.teamName} ${bottom.wins}-${bottom.losses} (${table.length} teams)`);
    }

    const text = out.length > 1 ? out.join('\n') : '';
    leagueCache = { text, at: Date.now() };
    return text;
}

/* -------------------------------------------------------- roast angles ---- */

/**
 * Unhinged only. Nothing here is private — it's the same public stats, just
 * pre-chewed into the unflattering framing so the model reaches for a real
 * number instead of a generic insult.
 */
async function buildRoastAngles(discordId) {
    const id = String(discordId || '');
    if (!id || !db()) return '';

    const season = await activeSeason();
    const seasonId = season?.id || null;
    if (!seasonId) return '';

    const [st] = await q(
        `SELECT games, score, goals, shots, saves, mvps, demos_inflicted, demos_taken,
                beluga_score, division
           FROM stats_player_season
          WHERE discord_id = $1 AND season_id = $2 AND is_playoff = FALSE`, [id, seasonId]);

    const sheet = await getSalSheetRow(id).catch(() => null);
    const out = [];

    if (!st || !n(st.games)) {
        out.push('Has not played a single game this season — nothing to show for the salary.');
        if (sheet?.salary != null) out.push(`Still carrying a ${sheet.salary} salary while producing nothing.`);
        return out.length ? `ROAST MATERIAL (all public, use the real numbers):\n${out.map((x) => `  - ${x}`).join('\n')}` : '';
    }

    if (n(st.shots)) {
        const pct = (n(st.goals) / n(st.shots)) * 100;
        out.push(`Shooting ${pct.toFixed(0)}% (${n(st.goals)} goals on ${n(st.shots)} shots).`);
    }
    if (n(st.demos_taken) > n(st.demos_inflicted)) {
        out.push(`Gets demoed more than they demo: ${n(st.demos_taken)} taken vs ${n(st.demos_inflicted)} given.`);
    }
    if (!n(st.mvps)) out.push(`Zero MVPs in ${n(st.games)} games.`);

    // Worst individual game. (week comes from stats_series, not stats_games.)
    const [worst] = await q(
        `SELECT s.week, gp.score, gp.goals, gp.saves
           FROM stats_game_players gp
           JOIN stats_games g ON g.id = gp.game_id
           JOIN stats_series s ON s.id = g.series_id
          WHERE gp.discord_id = $1 AND gp.is_playoff = FALSE
          ORDER BY gp.score ASC LIMIT 1`, [id]);
    if (worst) out.push(`Worst game: week ${worst.week ?? '?'}, ${n(worst.score)} score with ${n(worst.goals)} goals and ${n(worst.saves)} saves.`);

    // Where they sit from the BOTTOM of their division.
    const ranked = await q(
        `SELECT discord_id, RANK() OVER (ORDER BY beluga_score ASC) AS from_bottom,
                COUNT(*) OVER () AS total
           FROM stats_player_season
          WHERE season_id = $1 AND division = $2 AND is_playoff = FALSE AND games > 0`,
        [seasonId, st.division]);
    const me = ranked.find((r) => String(r.discord_id) === id);
    if (me) out.push(`Ranks ${me.from_bottom} from the BOTTOM of ${me.total} players in ${st.division}.`);

    // Paid like X, playing like Y — the meanest honest line available.
    if (sheet?.salary != null) {
        const [avg] = await q(
            `SELECT AVG(beluga_score) AS a FROM stats_player_season
              WHERE season_id = $1 AND division = $2 AND is_playoff = FALSE AND games > 0`,
            [seasonId, st.division]);
        if (avg?.a) {
            const ratio = n(st.beluga_score) / n(avg.a);
            const verdict = ratio < 0.85 ? 'well BELOW' : ratio > 1.15 ? 'above' : 'about';
            out.push(`Beluga Score ${Number(st.beluga_score).toFixed(2)} vs ${st.division} average ${Number(avg.a).toFixed(2)} — ${verdict} average, on a ${sheet.salary} salary.`);
        }
    }

    // Current streak — winner_team_id is authoritative, no home/away math needed.
    const recent = await q(
        `SELECT g.winner_team_id, gp.team_id
           FROM stats_game_players gp JOIN stats_games g ON g.id = gp.game_id
          WHERE gp.discord_id = $1 AND gp.is_playoff = FALSE
          ORDER BY g.id DESC LIMIT 10`, [id]);
    let streak = 0;
    let streakKind = null;
    for (const g of recent) {
        if (g.winner_team_id == null) break; // a tie ends the streak
        const kind = g.winner_team_id === g.team_id ? 'win' : 'loss';
        if (streakKind === null) streakKind = kind;
        if (kind !== streakKind) break;
        streak++;
    }
    if (streak > 1 && streakKind === 'loss') out.push(`On a ${streak}-game losing streak.`);

    return out.length ? `ROAST MATERIAL (all public, use the real numbers):\n${out.map((x) => `  - ${x}`).join('\n')}` : '';
}

/* --------------------------------------------------------- orchestrator --- */

/** Resolve names mentioned in a message to league players. */
async function resolveNamedPlayers(message, excludeId) {
    const text = String(message || '');
    const found = new Map();

    // Explicit <@id> mentions are unambiguous, so take those first.
    for (const m of text.matchAll(/<@!?(\d{16,20})>/g)) {
        if (m[1] !== String(excludeId)) found.set(m[1], null);
        if (found.size >= MAX_NAMED_PLAYERS) break;
    }

    if (found.size < MAX_NAMED_PLAYERS) {
        // Only bother matching words that could plausibly be a name.
        const words = [...new Set(text.replace(/<[^>]+>/g, ' ').match(/[A-Za-z0-9_.]{3,}/g) || [])].slice(0, 25);
        if (words.length) {
            const rows = await q(
                `SELECT discord_id, COALESCE(display_name, username) AS name FROM discord_members
                  WHERE is_in_guild = TRUE AND (LOWER(username) = ANY($1) OR LOWER(display_name) = ANY($1))
                  LIMIT $2`,
                [words.map((w) => w.toLowerCase()), MAX_NAMED_PLAYERS]);
            for (const r of rows) {
                if (String(r.discord_id) === String(excludeId)) continue;
                if (found.size >= MAX_NAMED_PLAYERS) break;
                found.set(String(r.discord_id), r.name);
            }
        }
    }
    return [...found.entries()].map(([id, name]) => ({ id, name }));
}

/**
 * The whole context block for one request. Returns '' when there is nothing
 * useful to say, so a plain "hello" stays cheap.
 */
async function buildContextBlock({ discordId, displayName, message, mode } = {}) {
    if (!db()) return '';
    try {
        const topics = topicsFor(message);
        const parts = [];

        const card = await buildPlayerCard(discordId, { label: displayName });
        if (card) parts.push(`THE PERSON YOU ARE TALKING TO:\n${card}`);

        const deep = await buildDeepContext(discordId, topics);
        if (deep) parts.push(deep);

        for (const other of await resolveNamedPlayers(message, discordId)) {
            const c = await buildPlayerCard(other.id, { label: other.name });
            if (c) parts.push(`ANOTHER PLAYER THEY MENTIONED:\n${c}`);
        }

        if (topics.league || topics.rank) {
            const league = await buildLeagueContext();
            if (league) parts.push(league);
        }

        if (mode === 'unhinged') {
            const roast = await buildRoastAngles(discordId);
            if (roast) parts.push(roast);
        }

        if (!parts.length) return '';
        return [
            '[LEAGUE DATA — current and accurate. Use it when it is relevant to what they asked.',
            'Never dump it verbatim, never list it out, and do not mention that you were given data.',
            'If something is not here, say you do not know rather than guessing.]',
            '',
            parts.join('\n\n'),
        ].join('\n');
    } catch (err) {
        // Context is an enhancement — never let it stop the bot from replying.
        Logger.warning(`playerContext failed for ${discordId}: ${err.message}`);
        return '';
    }
}

function invalidate(discordId) {
    if (discordId) cardCache.delete(String(discordId));
    else cardCache.clear();
    leagueCache = { text: null, at: 0 };
}

module.exports = {
    buildContextBlock,
    buildPlayerCard,
    buildDeepContext,
    buildLeagueContext,
    buildRoastAngles,
    resolveNamedPlayers,
    topicsFor,
    invalidate,
};
