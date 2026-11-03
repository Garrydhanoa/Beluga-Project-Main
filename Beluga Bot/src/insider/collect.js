/**
 * Builds the weekly packet the Beluga Insider is written from.
 *
 * Every fact the writer may state lives here, in plain names and display division
 * labels, so the fact check has one thing to compare a draft against. Moderation
 * never enters: `suspend`/`reinstate` rows and moderation releases are dropped, and
 * `transactions.details` (which holds reasons and case ids) is never selected.
 *
 * `asOf` replays the past: only series confirmed by that moment count, so a replay
 * knows what the league knew then. Standings order is then approximate, because
 * getStandings has no week input; a live run uses the real tiebreakers.
 */

const { pool } = require('../utils/database');
const { getStandings, belugaFromTotals } = require('../stats/statsStore');
const { pickGameOfWeek, pickPlayerOfWeek } = require('../stats/gameOfWeek');
const { LEAGUE_TZ, currentLeagueWeek } = require('../utils/leagueWeek');
const { DIVISION_CODES, divisionLabel, divisionCode } = require('../utils/divisionLabels');
const { cleanName } = require('./names');
const { collectChat, readAnnouncements, recentIssues, guildEmoji } = require('./chat');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PLAYOFF_WEEK = 90;
const WEEK_LIST = 6;
const LEADER_LIST = 5;

// Team emoji are A_<team>. The rest of the server's emoji were picked by hand,
// because several aren't fit for an announcement channel.
const EMOJI_OK = new Set([
    '0belugaLogo', 'Beluga', 'belugaCar', 'fire', 'whale', 'clown', 'pointandlaugh', 'okbuddy', 'smile',
    'vibin', 'whygod', 'RAHHHH', 'alpha', 'goofy', 'modcheck', 'stare', 'bruh', 'hehe', 'ohgod',
    'cryingcat', 'cryingkitten', 'madblob', 'hearmeout',
]);

async function seasonById(seasonId) {
    const r = await pool.query(
        `SELECT id, season_number, name, status, start_date FROM seasons WHERE id = $1`, [seasonId]
    );
    return r.rows[0] || null;
}

async function activeSeason() {
    const r = await pool.query(
        `SELECT id, season_number, name, status, start_date FROM seasons
         WHERE status = 'active' ORDER BY id DESC LIMIT 1`
    );
    return r.rows[0] || null;
}

/**
 * What a run at `now` should cover. The week just played is the league week minus
 * one on a Tuesday, because the week rolls over Monday 9:00 AM Eastern. No series
 * confirmed in the window means the off-season edition.
 */
async function resolvePeriod(now = new Date(), previousEnd = null) {
    const season = await activeSeason();
    const to = now;
    const from = previousEnd ? new Date(previousEnd) : new Date(now.getTime() - WEEK_MS);
    if (!season) return { season: null, week: null, edition: 'offseason', phase: 'offseason', from, to };

    const recent = await pool.query(
        `SELECT week, COUNT(*)::int AS n FROM stats_series
         WHERE season_id = $1 AND status = 'confirmed' AND confirmed_at >= $2::timestamptz AND confirmed_at < $3::timestamptz
         GROUP BY week`,
        [season.id, from, to]
    );
    if (!recent.rows.length) return { season, week: null, edition: 'offseason', phase: 'offseason', from, to };

    const regular = recent.rows.map((r) => r.week).filter((w) => w != null && w < PLAYOFF_WEEK);
    const playoffs = recent.rows.some((r) => r.week >= PLAYOFF_WEEK);
    const leagueWeek = currentLeagueWeek(season.start_date, now);
    const week = leagueWeek && leagueWeek > 1 ? leagueWeek - 1 : (regular.length ? Math.max(...regular) : null);
    return { season, week, edition: 'season', phase: playoffs ? 'playoffs' : 'regular', from, to };
}

async function weekResults(seasonId, week, asOf) {
    const r = await pool.query(
        `SELECT s.division, s.week, s.is_playoff, s.home_score, s.away_score, s.is_forfeit, s.format,
            ht.name AS home, at.name AS away, wt.name AS winner,
            COALESCE(SUM(g.home_goals),0)::int AS home_goals, COALESCE(SUM(g.away_goals),0)::int AS away_goals,
            COALESCE(SUM(CASE WHEN g.overtime THEN 1 ELSE 0 END),0)::int AS overtimes,
            COUNT(g.id)::int AS games_recorded,
            string_agg(g.home_goals || '-' || g.away_goals || CASE WHEN g.overtime THEN ' OT' ELSE '' END, ', ' ORDER BY g.game_number) AS game_scores
         FROM stats_series s
         LEFT JOIN stats_games g ON g.series_id = s.id
         LEFT JOIN teams ht ON ht.id = s.home_team_id
         LEFT JOIN teams at ON at.id = s.away_team_id
         LEFT JOIN teams wt ON wt.id = s.winner_team_id
         WHERE s.season_id = $1 AND s.status = 'confirmed' AND s.week = $2
           AND ($3::timestamptz IS NULL OR s.confirmed_at <= $3)
         GROUP BY s.id, ht.name, at.name, wt.name
         ORDER BY s.confirmed_at`,
        [seasonId, week, asOf]
    );
    return r.rows;
}

/** Series from earlier weeks that were only confirmed inside this window. */
async function lateResults(seasonId, week, from, to) {
    const r = await pool.query(
        `SELECT s.division, s.week, s.home_score, s.away_score, s.is_forfeit, ht.name AS home, at.name AS away
         FROM stats_series s
         LEFT JOIN teams ht ON ht.id = s.home_team_id
         LEFT JOIN teams at ON at.id = s.away_team_id
         WHERE s.season_id = $1 AND s.status = 'confirmed' AND s.week < $2
           AND s.confirmed_at >= $3::timestamptz AND s.confirmed_at < $4::timestamptz
         ORDER BY s.confirmed_at`,
        [seasonId, week, from, to]
    );
    return r.rows;
}

async function seasonSeries(seasonId, week, asOf) {
    const r = await pool.query(
        `SELECT s.division, s.week, s.home_team_id, s.away_team_id, s.winner_team_id, s.home_score, s.away_score,
            s.is_forfeit, ht.name AS home, at.name AS away,
            COALESCE(SUM(g.home_goals),0)::int AS home_goals, COALESCE(SUM(g.away_goals),0)::int AS away_goals
         FROM stats_series s
         LEFT JOIN stats_games g ON g.series_id = s.id
         LEFT JOIN teams ht ON ht.id = s.home_team_id
         LEFT JOIN teams at ON at.id = s.away_team_id
         WHERE s.season_id = $1 AND s.status = 'confirmed' AND s.is_playoff = FALSE
           AND COALESCE(s.week, 0) <= $2
           AND ($3::timestamptz IS NULL OR s.confirmed_at <= $3)
         GROUP BY s.id, ht.name, at.name
         ORDER BY COALESCE(s.week, 0), s.confirmed_at`,
        [seasonId, week, asOf]
    );
    return r.rows;
}

/**
 * A series whose stored games don't add up to its score had a game forfeited or
 * ruled on, so its goal total is partial. A real example: Surge "won" 12-5 on goals
 * in a series they lost 2-3, because games 4 and 5 have no stats.
 */
function shapeResult(r) {
    const played = Number(r.home_score) + Number(r.away_score);
    const incomplete = !r.is_forfeit && r.games_recorded !== played;
    return {
        home: r.home,
        away: r.away,
        score: `${r.home_score}-${r.away_score}`,
        goals: r.is_forfeit || incomplete ? null : `${r.home_goals}-${r.away_goals}`,
        games: r.is_forfeit ? null : r.game_scores,
        winner: r.winner,
        overtimes: r.overtimes,
        forfeit: r.is_forfeit,
        incomplete: incomplete || undefined,
    };
}

function standingsFrom(series, division) {
    const teams = new Map();
    const team = (id, name) => {
        if (!teams.has(id)) teams.set(id, { team: name, wins: 0, losses: 0, forfeitLosses: 0, gameDiff: 0, goalDiff: 0, form: [] });
        return teams.get(id);
    };
    for (const s of series) {
        if (divisionCode(s.division) !== division) continue;
        const home = team(s.home_team_id, s.home);
        const away = team(s.away_team_id, s.away);
        const gameDiff = Number(s.home_score) - Number(s.away_score);
        const goalDiff = Number(s.home_goals) - Number(s.away_goals);
        home.gameDiff += gameDiff; away.gameDiff -= gameDiff;
        home.goalDiff += goalDiff; away.goalDiff -= goalDiff;
        if (s.winner_team_id === s.home_team_id) {
            home.wins += 1; away.losses += 1; home.form.push('W'); away.form.push('L');
            if (s.is_forfeit) away.forfeitLosses += 1;
        } else if (s.winner_team_id === s.away_team_id) {
            away.wins += 1; home.losses += 1; away.form.push('W'); home.form.push('L');
            if (s.is_forfeit) home.forfeitLosses += 1;
        }
    }
    return Array.from(teams.entries()).map(([teamId, t]) => {
        const last = t.form[t.form.length - 1];
        let streak = 0;
        for (let i = t.form.length - 1; i >= 0 && t.form[i] === last; i -= 1) streak += 1;
        return {
            teamId,
            team: t.team,
            record: `${t.wins}-${t.losses}`,
            wins: t.wins,
            losses: t.losses,
            forfeitLosses: t.forfeitLosses,
            gameDiff: t.gameDiff,
            goalDiff: t.goalDiff,
            streak: last ? `${last}${streak}` : null,
            lastFive: t.form.slice(-5).join(''),
        };
    }).sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.gameDiff - a.gameDiff || b.goalDiff - a.goalDiff);
}

async function divisionStandings(seasonId, division, series, asOf) {
    const rows = standingsFrom(series, division);
    if (!asOf) {
        const real = await getStandings(seasonId, division);
        const rank = new Map(real.map((t, i) => [t.teamId, i]));
        rows.sort((a, b) => (rank.get(a.teamId) ?? 99) - (rank.get(b.teamId) ?? 99));
    }
    return rows.map(({ teamId, wins, losses, ...row }, i) => ({ place: i + 1, ...row }));
}

async function playerWeeks(seasonId, week, asOf) {
    const r = await pool.query(
        `SELECT s.division, s.week, COALESCE(gp.discord_id, gp.ingame_name) AS key,
            MAX(gp.discord_id) AS discord_id, MAX(gp.ingame_name) AS ingame_name, MAX(t.name) AS team,
            COUNT(*)::int AS games, SUM(gp.goals)::int AS goals, SUM(gp.assists)::int AS assists,
            SUM(gp.saves)::int AS saves, SUM(gp.shots)::int AS shots, SUM(gp.score)::int AS score,
            SUM(gp.demos_inflicted)::int AS demos_inflicted, SUM(CASE WHEN gp.mvp THEN 1 ELSE 0 END)::int AS mvps
         FROM stats_game_players gp
         JOIN stats_series s ON s.id = gp.series_id
         LEFT JOIN teams t ON t.id = gp.team_id
         WHERE s.season_id = $1 AND s.status = 'confirmed' AND s.is_playoff = FALSE
           AND s.is_forfeit = FALSE AND COALESCE(s.week, 0) <= $2
           AND ($3::timestamptz IS NULL OR s.confirmed_at <= $3)
         GROUP BY s.division, s.week, COALESCE(gp.discord_id, gp.ingame_name)`,
        [seasonId, week, asOf]
    );
    return r.rows;
}

function sumPlayers(rows, nameOf) {
    const players = new Map();
    for (const row of rows) {
        if (!players.has(row.key)) {
            players.set(row.key, { player: nameOf(row), team: row.team, games: 0, goals: 0, assists: 0, saves: 0, shots: 0, score: 0, demos_inflicted: 0, mvps: 0 });
        }
        const p = players.get(row.key);
        p.team = row.team || p.team;
        for (const stat of ['games', 'goals', 'assists', 'saves', 'shots', 'score', 'demos_inflicted', 'mvps']) p[stat] += Number(row[stat] || 0);
    }
    return Array.from(players.values()).map((p) => ({ ...p, belugaScore: belugaFromTotals(p, p.games) }));
}

const statLine = ({ score, ...p }) => ({ ...p, scorePerGame: p.games ? Math.round(score / p.games) : 0 });

function divisionPlayers(rows, division, week, nameOf) {
    const here = rows.filter((r) => divisionCode(r.division) === division);
    const thisWeek = sumPlayers(here.filter((r) => r.week === week), nameOf);
    const season = sumPlayers(here, nameOf);
    const most = Math.max(0, ...season.map((p) => p.games));
    const qualified = season.filter((p) => p.games >= Math.max(3, Math.floor(most * 0.4)));
    const top = (list, stat, n) => [...list].sort((a, b) => b[stat] - a[stat]).slice(0, n).map(statLine);
    return {
        topOfWeek: top(thisWeek.filter((p) => p.games >= 2), 'belugaScore', WEEK_LIST),
        seasonLeaders: {
            belugaScore: top(qualified, 'belugaScore', LEADER_LIST),
            goals: top(season, 'goals', 3),
            assists: top(season, 'assists', 3),
            saves: top(season, 'saves', 3),
            mvps: top(season, 'mvps', 3),
        },
    };
}

async function powerRankings(seasonId, week, asOf, nameOf) {
    // A replay can't see the snapshot of a week that hadn't finished yet.
    const latest = asOf ? week - 1 : week;
    const r = await pool.query(
        `SELECT pr.division, pr.entity_type, pr.rank, pr.week, pr.trend, pr.note, pr.label, t.name AS team, pr.player_discord_id
         FROM power_rankings pr
         LEFT JOIN teams t ON t.id = pr.team_id
         WHERE pr.season_id = $1
           AND pr.week = (SELECT MAX(week) FROM power_rankings WHERE season_id = $1 AND week <= $2)
         ORDER BY pr.division, pr.entity_type, pr.rank`,
        [seasonId, latest]
    );
    return r.rows.map((row) => ({
        division: divisionCode(row.division),
        type: row.team ? 'team' : 'player',
        rank: row.rank,
        week: row.week,
        name: row.team || nameOf({ discord_id: row.player_discord_id, ingame_name: row.label }),
        trend: row.trend,
        note: row.note,
    }));
}

async function schedule(seasonId, week) {
    const r = await pool.query(
        `SELECT m.division, ht.name AS home, at.name AS away
         FROM schedule_matches m
         LEFT JOIN teams ht ON ht.id = m.home_team_id
         LEFT JOIN teams at ON at.id = m.away_team_id
         WHERE m.season_id = $1 AND m.week = $2 AND m.is_published = TRUE
         ORDER BY m.division, m.match_order`,
        [seasonId, week]
    );
    return r.rows;
}

/** Roster moves, with moderation left out and mass-drops folded into one count. */
async function transactionWire(from, to) {
    const r = await pool.query(
        `SELECT x.type, x.source, x.performed_at, x.team_name_snapshot AS team, x.paired_team_name_snapshot AS other_team,
            COALESCE(m.display_name, x.display_name, x.discord_username) AS player
         FROM transactions x
         LEFT JOIN discord_members m ON m.discord_id = x.discord_id
         WHERE x.performed_at >= $1::timestamptz AND x.performed_at < $2::timestamptz
           AND x.type NOT IN ('suspend', 'reinstate')
           AND COALESCE(x.source, '') <> 'bot:moderation'
         ORDER BY x.performed_at`,
        [from, to]
    );
    let massDrops = 0;
    const moves = [];
    for (const row of r.rows) {
        if (row.source === 'bot:/mass-drop') { massDrops += 1; continue; }
        if (row.type === 'trade_out') continue; // the trade_in row already names both teams
        moves.push({
            type: row.type === 'trade_in' ? 'trade' : row.type,
            player: cleanName(row.player),
            team: row.team,
            otherTeam: row.other_team || undefined,
            at: row.performed_at,
        });
    }
    return { massDrops, moves };
}

async function pastChampions() {
    const r = await pool.query(
        `SELECT s.season_number AS season, c.division, t.name AS team
         FROM season_champions c
         JOIN seasons s ON s.id = c.season_id
         LEFT JOIN teams t ON t.id = c.team_id
         ORDER BY s.season_number DESC, c.division`
    );
    return r.rows.map((row) => ({ season: row.season, division: divisionLabel(row.division), team: row.team }));
}

async function leagueFacts({ season, week, from, to, asOf }, nameOf) {
    if (!season || !week) return null;
    const series = await seasonSeries(season.id, week, asOf);
    const results = await weekResults(season.id, week, asOf);
    const players = await playerWeeks(season.id, week, asOf);
    const rankings = await powerRankings(season.id, week, asOf, nameOf);
    const upcoming = await schedule(season.id, week + 1);

    const divisions = [];
    for (const division of DIVISION_CODES) {
        // eslint-disable-next-line no-await-in-loop
        const standings = await divisionStandings(season.id, division, series, asOf);
        const records = new Map(standings.map((t) => [t.team, t.record]));
        // eslint-disable-next-line no-await-in-loop
        const game = await pickGameOfWeek(season.id, division, week, asOf);
        // eslint-disable-next-line no-await-in-loop
        const player = await pickPlayerOfWeek(season.id, division, week, asOf);
        const shaped = results.filter((r) => divisionCode(r.division) === division).map(shapeResult);
        divisions.push({
            division: divisionLabel(division),
            results: shaped,
            standings,
            gameOfWeek: game ? shaped.find((r) => r.home === game.home && r.away === game.away) || null : null,
            playerOfWeek: player ? {
                player: cleanName(player.name),
                team: player.team,
                games: player.games,
                goals: player.goals,
                assists: player.assists,
                saves: player.saves,
                mvps: player.mvps,
            } : null,
            ...divisionPlayers(players, division, week, nameOf),
            powerRankings: rankings.filter((p) => p.division === division).map(({ division: _d, ...p }) => p),
            nextWeek: upcoming.filter((m) => divisionCode(m.division) === division).map((m) => ({
                home: m.home,
                homeRecord: records.get(m.home) || null,
                away: m.away,
                awayRecord: records.get(m.away) || null,
            })),
        });
    }
    return {
        divisions,
        lateResults: asOf ? [] : (await lateResults(season.id, week, from, to)).map((r) => ({
            division: divisionLabel(r.division),
            week: r.week,
            home: r.home,
            away: r.away,
            score: `${r.home_score}-${r.away_score}`,
            forfeit: r.is_forfeit,
        })),
        scheduleLength: Math.max(...series.map((s) => Number(s.week) || 0), 0),
    };
}

/** "Sun 21:14 Jack > Barry: nice save [+3]". JSON keys on 2,000 messages cost more than the chat. */
function chatLine(message) {
    const when = new Date(message.at).toLocaleString('en-US', {
        timeZone: LEAGUE_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).replace(',', '');
    const to = message.replyTo ? ` > ${message.replyTo}` : '';
    const reactions = message.reactions ? ` [+${message.reactions}]` : '';
    return `${when} ${message.author}${to}: ${message.text}${reactions}`;
}

async function memberNames() {
    const r = await pool.query(`SELECT discord_id, display_name, username FROM discord_members`);
    const names = new Map(r.rows.map((m) => [m.discord_id, cleanName(m.display_name || m.username)]));
    return (row) => names.get(row.discord_id) || cleanName(row.ingame_name) || 'someone';
}

/**
 * The whole packet for one issue.
 * @param {{ season, week, edition, phase, from, to, asOf? }} period
 * @param {{ guildId, settings, publicOnly?, rewriteNote? }} opts
 */
async function buildPacket(period, { guildId, settings, publicOnly = false, rewriteNote = null }) {
    const { season, week, edition, phase, from, to, asOf = null } = period;
    const nameOf = await memberNames();
    const chat = await collectChat({ guildId, settings, from, to, publicOnly });
    const league = await leagueFacts({ season, week, from, to, asOf }, nameOf);
    const wire = await transactionWire(from, to);
    const salaryMoves = await readAnnouncements(settings.salaryChannelId, from, to, chat.lookup);
    const pastIssues = await recentIssues(settings.publishChannelId, to, chat.lookup);
    const emoji = await guildEmoji(guildId);

    const packet = {
        meta: {
            season: season?.season_number ?? null,
            seasonName: season?.name ?? null,
            seasonHasStartDate: !!season?.start_date,
            week,
            edition,
            phase,
            from: from.toISOString(),
            to: to.toISOString(),
            replayedAsOf: asOf ? new Date(asOf).toISOString() : null,
            standingsOrderApproximate: !!asOf,
            builtAt: new Date().toISOString(),
        },
        rewriteNote,
        league,
        transactions: wire,
        salaryMoves,
        champions: await pastChampions(),
        chat: {
            timesAreEastern: true,
            channels: chat.channels.map(({ messages, ...c }) => ({ ...c, lines: messages.map(chatLine) })),
            totals: chat.totals,
            gaps: chat.gaps,
        },
        pastIssues,
        emoji: {
            teams: emoji.filter((name) => name.startsWith('A_')).map((name) => `:${name}:`),
            general: emoji.filter((name) => EMOJI_OK.has(name)).map((name) => `:${name}:`),
        },
    };
    // Refused channels stay out of the packet: the writer has no need to know the
    // names of private channels, and a name alone can give something away.
    return { packet, refused: chat.refused };
}

module.exports = { resolvePeriod, buildPacket, seasonById, activeSeason, standingsFrom };
