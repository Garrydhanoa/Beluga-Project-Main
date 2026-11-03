/**
 * Lets the chat AI look up anything about the league by writing its own queries, so it can
 * answer questions nobody planned for and leave the maths to Postgres instead of doing it in
 * its head.
 *
 * Safety comes from the database, not from checking what the AI wrote. Members can talk the
 * model into nearly anything, so the query runs through its own login, `ai_reader`, which can
 * only read the views in the `ai` schema below and has no rights on any real table. Only what
 * is in a view can reach chat: tickets, DMs, applications, test answers, logins, logs and
 * moderation evidence have no view, so a query for them is refused by Postgres itself.
 *
 * It's a separate login rather than `SET ROLE` on the main connection because that connection
 * is a superuser, and a superuser session can set itself back with set_config() from inside a
 * SELECT. This needs AI_DB_PASSWORD on the bot service; without it the tools stay off and chat
 * carries on with what playerContext gives it.
 *
 * Views are rebuilt on every boot inside one transaction, so a view that no longer matches a
 * table rolls back and keeps the last good set. A view pins the columns it reads: dropping or
 * retyping one of those columns needs the view dropped first.
 */

const { Pool } = require('pg');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { pool: adminPool } = require('../utils/database');
const { divisionCode, divisionLabel } = require('../utils/divisionLabels');
const { getStandings } = require('../stats/statsStore');
const { countsSql } = require('../invites/inviteCounts');

const ROLE = 'ai_reader';
const SCHEMA = 'ai';
const MAX_ROWS = 40;
const MAX_RESULT_CHARS = 6000;
const QUERY_TIMEOUT_MS = 6 * 1000;
const MAX_RULES = 4;
const RULE_CHARS = 900;

/* The stored codes never change, and everything a person sees uses the S11 names. */
const division = (col) => `CASE lower(${col}) WHEN 'aa' THEN 'Academy' WHEN 'aaa' THEN 'Contenders' WHEN 'majors' THEN 'Premier' ELSE ${col} END`;
/* "BOD (13.5) Barry" is a staff tag, a salary and a name. */
const playerName = (m) => `COALESCE(NULLIF(trim(regexp_replace(${m}.display_name, '^[^()]*\\([^)]*\\)\\s*', '')), ''), ${m}.display_name, ${m}.username)`;
const salary = (m) => `substring(${m}.display_name from '\\(([0-9]+(?:\\.[0-9]+)?)\\)')::numeric`;
const mmr = (key) => `NULLIF(regexp_replace(t.best::jsonb->'${key}'->>'value', '[^0-9]', '', 'g'), '')::int`;
const perGame = (col, games) => `round(${col}::numeric / NULLIF(${games}, 0), 2)`;

const VIEWS = [
    {
        name: 'seasons',
        about: 'season, name, status (active or archived), start_date, weeks, esub_limit, academy_teams, contenders_teams, premier_teams, academy_cap, contenders_cap, premier_cap',
        sql: `SELECT s.season_number AS season, s.name, s.status, s.start_date::date AS start_date, c.weeks, c.esub_limit,
                (c.teams_per_division::jsonb->>'AA')::int AS academy_teams,
                (c.teams_per_division::jsonb->>'AAA')::int AS contenders_teams,
                (c.teams_per_division::jsonb->>'Majors')::int AS premier_teams,
                (c.onfield_caps::jsonb->>'AA')::numeric AS academy_cap,
                (c.onfield_caps::jsonb->>'AAA')::numeric AS contenders_cap,
                (c.onfield_caps::jsonb->>'Majors')::numeric AS premier_cap
              FROM seasons s LEFT JOIN season_config c ON c.season_id = s.id`,
    },
    {
        name: 'teams',
        about: 'season, division, team, franchise, slogan, is_active',
        sql: `SELECT s.season_number AS season, ${division('t.division')} AS division, t.name AS team, f.name AS franchise, t.slogan, t.is_active
              FROM teams t JOIN seasons s ON s.id = t.season_id LEFT JOIN team_franchises f ON f.id = t.franchise_id`,
    },
    {
        name: 'players',
        about: 'player, username, salary (null if none), in_server, joined_server, peak_3s, peak_2s, current_3s, current_2s (MMR)',
        sql: `SELECT ${playerName('m')} AS player, m.username, ${salary('m')} AS salary, m.is_in_guild AS in_server, m.joined_at::date AS joined_server,
                ${mmr('peak_3s')} AS peak_3s, ${mmr('peak_2s')} AS peak_2s, ${mmr('cur_3s')} AS current_3s, ${mmr('cur_2s')} AS current_2s
              FROM discord_members m
              LEFT JOIN (SELECT DISTINCT ON (discord_id) discord_id, best FROM trn_players ORDER BY discord_id, updated_at DESC NULLS LAST) t ON t.discord_id = m.discord_id
              WHERE NOT COALESCE(m.is_bot, FALSE)`,
    },
    {
        name: 'player_names',
        about: 'player, ingame_name (every in-game name they have used)',
        sql: `SELECT DISTINCT ${playerName('m')} AS player, n.name AS ingame_name FROM (
                SELECT discord_id, current_name AS name FROM stats_player_accounts
                UNION SELECT discord_id, name FROM stats_name_history
              ) n JOIN discord_members m ON m.discord_id = n.discord_id WHERE n.name IS NOT NULL`,
    },
    {
        name: 'rosters',
        about: 'season, division, team, player, role (gm, agm, captain or player). A GM sits on all three of their franchise rosters',
        sql: `SELECT s.season_number AS season, ${division('t.division')} AS division, t.name AS team,
                COALESCE(${playerName('m')}, rm.display_name, rm.discord_username) AS player, rm.role
              FROM team_roster_members rm JOIN teams t ON t.id = rm.team_id JOIN seasons s ON s.id = rm.season_id
              LEFT JOIN discord_members m ON m.discord_id = rm.discord_id
              WHERE rm.is_active`,
    },
    {
        name: 'player_stats',
        about: 'one row per player, season, division and phase: season, division, team, player, is_playoff, games, goals, assists, saves, shots, score, mvps, demos_given, demos_taken, beluga_score, goals_per_game, assists_per_game, saves_per_game, shots_per_game, score_per_game, shooting_pct',
        sql: `SELECT s.season_number AS season, ${division('p.division')} AS division, t.name AS team, ${playerName('m')} AS player, p.is_playoff,
                p.games, p.goals, p.assists, p.saves, p.shots, p.score, p.mvps, p.demos_inflicted AS demos_given, p.demos_taken, p.beluga_score,
                ${perGame('p.goals', 'p.games')} AS goals_per_game, ${perGame('p.assists', 'p.games')} AS assists_per_game,
                ${perGame('p.saves', 'p.games')} AS saves_per_game, ${perGame('p.shots', 'p.games')} AS shots_per_game,
                ${perGame('p.score', 'p.games')} AS score_per_game, round(100.0 * p.goals / NULLIF(p.shots, 0), 2) AS shooting_pct
              FROM stats_player_season p JOIN seasons s ON s.id = p.season_id
              LEFT JOIN teams t ON t.id = p.team_id LEFT JOIN discord_members m ON m.discord_id = p.discord_id`,
    },
    {
        name: 'lifetime_stats',
        about: 'career totals: player, is_playoff, games, seasons_played, goals, assists, saves, shots, score, mvps, demos_given, demos_taken, beluga_score',
        sql: `SELECT ${playerName('m')} AS player, l.is_playoff, l.games, l.seasons_played, l.goals, l.assists, l.saves, l.shots, l.score, l.mvps,
                l.demos_inflicted AS demos_given, l.demos_taken, l.beluga_score
              FROM stats_player_lifetime l LEFT JOIN discord_members m ON m.discord_id = l.discord_id`,
    },
    {
        name: 'team_stats',
        about: 'one row per team, season and phase: season, division, team, is_playoff, series_wins, series_losses, game_wins, game_losses, game_diff, goals_for, goals_against, goal_diff, games_played, shots, saves, assists, demos_given, demos_taken, beluga_score',
        sql: `SELECT s.season_number AS season, ${division('ts.division')} AS division, t.name AS team, ts.is_playoff, ts.series_wins, ts.series_losses,
                ts.game_wins, ts.game_losses, ts.game_wins - ts.game_losses AS game_diff, ts.goals_for, ts.goals_against,
                ts.goals_for - ts.goals_against AS goal_diff, ts.games_played, ts.shots, ts.saves, ts.assists,
                ts.demos_inflicted AS demos_given, ts.demos_taken, ts.beluga_score
              FROM stats_team_season ts JOIN seasons s ON s.id = ts.season_id LEFT JOIN teams t ON t.id = ts.team_id`,
    },
    {
        name: 'series',
        about: 'every confirmed series: series_id, season, division, week, is_playoff, home_team, away_team, home_score, away_score (games won), winner, is_forfeit, format, date',
        sql: `SELECT ss.id AS series_id, s.season_number AS season, ${division('ss.division')} AS division, ss.week, ss.is_playoff,
                h.name AS home_team, a.name AS away_team, ss.home_score, ss.away_score, w.name AS winner, ss.is_forfeit, ss.format, ss.confirmed_at::date AS date
              FROM stats_series ss JOIN seasons s ON s.id = ss.season_id
              LEFT JOIN teams h ON h.id = ss.home_team_id LEFT JOIN teams a ON a.id = ss.away_team_id LEFT JOIN teams w ON w.id = ss.winner_team_id
              WHERE ss.status = 'confirmed'`,
    },
    {
        name: 'games',
        about: 'every game: series_id, game_number, season, division, week, is_playoff, map, overtime, duration_seconds, home_team, away_team, home_goals, away_goals, winner, is_forfeit, played_at, replay_url',
        sql: `SELECT g.series_id, g.game_number, s.season_number AS season, ${division('ss.division')} AS division, ss.week, ss.is_playoff, g.map, g.overtime,
                g.duration_seconds, h.name AS home_team, a.name AS away_team, g.home_goals, g.away_goals, w.name AS winner, g.is_forfeit, g.played_at,
                g.ballchasing_replay_url AS replay_url
              FROM stats_games g JOIN stats_series ss ON ss.id = g.series_id AND ss.status = 'confirmed' JOIN seasons s ON s.id = ss.season_id
              LEFT JOIN teams h ON h.id = ss.home_team_id LEFT JOIN teams a ON a.id = ss.away_team_id LEFT JOIN teams w ON w.id = g.winner_team_id`,
    },
    {
        name: 'player_games',
        about: 'one row per player per game: series_id, game_number, season, division, week, is_playoff, team, opponent, player, is_sub, score, goals, assists, saves, shots, demos_given, demos_taken, mvp, won, played_at',
        sql: `SELECT gp.series_id, g.game_number, s.season_number AS season, ${division('gp.division')} AS division, ss.week, gp.is_playoff, t.name AS team, o.name AS opponent,
                COALESCE(${playerName('m')}, gp.ingame_name) AS player, gp.is_sub, gp.score, gp.goals, gp.assists, gp.saves, gp.shots,
                gp.demos_inflicted AS demos_given, gp.demos_taken, gp.mvp, g.winner_team_id = gp.team_id AS won, g.played_at
              FROM stats_game_players gp JOIN stats_games g ON g.id = gp.game_id JOIN stats_series ss ON ss.id = gp.series_id AND ss.status = 'confirmed'
              JOIN seasons s ON s.id = gp.season_id LEFT JOIN teams t ON t.id = gp.team_id
              LEFT JOIN teams o ON o.id = CASE WHEN gp.team_id = ss.home_team_id THEN ss.away_team_id ELSE ss.home_team_id END
              LEFT JOIN discord_members m ON m.discord_id = gp.discord_id`,
    },
    {
        name: 'playoffs',
        about: 'published bracket matchups: season, division, round, round_order, is_finals, best_of, home_seed, home_team, away_seed, away_team, home_score, away_score, winner, is_bye',
        sql: `SELECT s.season_number AS season, ${division('b.division')} AS division, r.name AS round, r.round_order, r.is_finals, COALESCE(m.best_of, r.best_of) AS best_of,
                m.home_seed, h.name AS home_team, m.away_seed, a.name AS away_team, m.home_score, m.away_score, w.name AS winner, m.is_bye
              FROM playoff_matchups m JOIN playoff_rounds r ON r.id = m.round_id JOIN playoff_brackets b ON b.id = r.bracket_id AND b.is_published
              JOIN seasons s ON s.id = b.season_id
              LEFT JOIN teams h ON h.id = m.home_team_id LEFT JOIN teams a ON a.id = m.away_team_id LEFT JOIN teams w ON w.id = m.winner_team_id`,
    },
    {
        name: 'champions',
        about: 'season, division, team, gm',
        sql: `SELECT s.season_number AS season, ${division('c.division')} AS division, t.name AS team, c.gm_display_name AS gm
              FROM season_champions c JOIN seasons s ON s.id = c.season_id LEFT JOIN teams t ON t.id = c.team_id`,
    },
    {
        name: 'power_rankings',
        about: 'weekly snapshots: season, division, week, type (team or player), rank, team, player, trend, note',
        sql: `SELECT s.season_number AS season, ${division('pr.division')} AS division, pr.week, pr.entity_type AS type, pr.rank, t.name AS team,
                COALESCE(${playerName('m')}, pr.label) AS player, pr.trend, pr.note
              FROM power_rankings pr JOIN seasons s ON s.id = pr.season_id
              LEFT JOIN teams t ON t.id = pr.team_id LEFT JOIN discord_members m ON m.discord_id = pr.player_discord_id`,
    },
    {
        name: 'schedule',
        about: 'published matches: season, division, week, home_team, away_team, status',
        sql: `SELECT s.season_number AS season, ${division('sm.division')} AS division, sm.week, h.name AS home_team, a.name AS away_team, sm.status
              FROM schedule_matches sm JOIN seasons s ON s.id = sm.season_id
              LEFT JOIN teams h ON h.id = sm.home_team_id LEFT JOIN teams a ON a.id = sm.away_team_id
              WHERE sm.is_published`,
    },
    {
        name: 'transactions',
        about: 'season, type (sign, drop, esub, rfa, captain_assign, captain_remove, ir_place, other), player, team, other_team, date',
        sql: `SELECT s.season_number AS season, x.type, COALESCE(${playerName('m')}, x.display_name, x.discord_username) AS player,
                x.team_name_snapshot AS team, x.paired_team_name_snapshot AS other_team, x.performed_at::date AS date
              FROM transactions x LEFT JOIN seasons s ON s.id = x.season_id LEFT JOIN discord_members m ON m.discord_id = x.discord_id`,
    },
    {
        name: 'team_esubs',
        about: 'season, team, used',
        sql: `SELECT s.season_number AS season, t.name AS team, e.used
              FROM team_esubs e JOIN seasons s ON s.id = e.season_id JOIN teams t ON t.id = e.team_id`,
    },
    {
        name: 'awards',
        about: 'award (such as "Season 7 AAA League All-Star"), player',
        sql: `SELECT r.name AS award, ${playerName('m')} AS player
              FROM award_role_holders h JOIN discord_roles r ON r.role_id = h.role_id JOIN discord_members m ON m.discord_id = h.discord_id`,
    },
    {
        name: 'member_roles',
        about: 'player, role (every Discord role, including staff roles such as Director and Admin)',
        sql: `SELECT ${playerName('m')} AS player, r.name AS role
              FROM discord_member_roles x JOIN discord_roles r ON r.role_id = x.role_id AND NOT r.is_managed AND r.name <> '@everyone'
              JOIN discord_members m ON m.discord_id = x.discord_id AND m.is_in_guild`,
    },
    {
        name: 'suspensions',
        about: 'current ones only: player, status (active, or queued to start after another), unit, total, served, remaining (null if indefinite), starts_on, ends_on, team, division',
        sql: `SELECT ${playerName('m')} AS player, x.status, x.unit, x.total, x.served, x.total - x.served AS remaining,
                x.starts_at::date AS starts_on, x.ends_at::date AS ends_on, x.team_name AS team, ${division('x.division')} AS division
              FROM mod_suspensions x LEFT JOIN discord_members m ON m.discord_id = x.discord_id
              WHERE x.status IN ('active', 'queued')`,
    },
    {
        name: 'strikes',
        about: 'player, strikes (out of 3, members with none are not listed)',
        sql: `SELECT ${playerName('m')} AS player, x.strikes
              FROM mod_member_state x JOIN discord_members m ON m.discord_id = x.discord_id WHERE x.strikes > 0`,
    },
    {
        name: 'invite_leaderboard',
        about: 'player, invites (lifetime)',
        sql: `SELECT ${playerName('m')} AS player, c.total AS invites
              FROM (${countsSql('lifetime')}) c JOIN discord_members m ON m.discord_id = c.id`,
    },
];

const TOOLS = [
    {
        name: 'league_query',
        description: `Run one read-only PostgreSQL SELECT on the league database and get the rows back. Use this for anything about the league: stats, records, calculations, playoffs, past seasons, champions, rosters, salaries, MMR, transactions, schedule, power rankings, awards, staff, suspensions and strikes. Do every calculation in the query (averages, percentiles, ratios, ranks), never by hand. Results stop at ${MAX_ROWS} rows, so aggregate or use ORDER BY and LIMIT.

Views:
${VIEWS.map((v) => `- ${v.name}: ${v.about}`).join('\n')}

Notes:
- Divisions are 'Academy', 'Contenders' and 'Premier'. People may say AA, AAA or Majors, which are the same divisions.
- Match names loosely: player ILIKE '%barry%'. Team names the same way. They are often nicknames or misspelled, so check the players or teams view when nothing matches.
- is_playoff false is the regular season. Use it, or playoff and regular rows get mixed.
- The current season has status 'active' in seasons. If it has no games yet, use the latest season that does and say which one you used.
- beluga_score is per game: (score*25 + goals*30 + assists*15 + saves*20 + shots*5 + demos_given*5) / 100 / games.
- A team's cap covers its three players on the field. Salary caps are in seasons.`,
        input_schema: {
            type: 'object',
            properties: { sql: { type: 'string', description: 'A single SELECT or WITH statement.' } },
            required: ['sql'],
            additionalProperties: false,
        },
    },
    {
        name: 'league_standings',
        description: 'Official standings for one division and season, including the head-to-head tiebreakers, which a query cannot reproduce. Use this for any question about standings or who is in what place.',
        input_schema: {
            type: 'object',
            properties: {
                season: { type: 'integer', description: 'Season number. Leave it out for the latest season with games.' },
                division: { type: 'string', description: 'Academy, Contenders or Premier' },
            },
            required: ['division'],
            additionalProperties: false,
        },
    },
    {
        name: 'search_rulebook',
        description: 'Search the league rulebook. Use it for any question about rules, penalties, eligibility, rosters, subs, forfeits, playoffs format or how something works in the league. You can pass a section number.',
        input_schema: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Keywords, or a section number like 6.1.3' } },
            required: ['query'],
            additionalProperties: false,
        },
    },
];
const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

let reader = null;
let ready = false;
let ruleBook = null;

function available() {
    return ready;
}

function handles(name) {
    return TOOL_NAMES.has(name);
}

/** aiChat already holds a rulebook reader, and one copy of it is enough. */
function useRuleBook(manager) {
    ruleBook = manager;
}

function readerUrl(password) {
    const url = new URL(process.env.DATABASE_URL);
    url.username = ROLE;
    url.password = encodeURIComponent(password);
    return url.toString();
}

async function buildViews(client, password) {
    const quoted = client.escapeLiteral(password);
    await client.query('BEGIN');
    try {
        await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
        await client.query(`CREATE SCHEMA ${SCHEMA}`);
        for (const view of VIEWS) await client.query(`CREATE VIEW ${SCHEMA}.${view.name} AS ${view.sql}`);

        await client.query(`DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE}; END IF;
        END $$`);
        await client.query(`ALTER ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 6 PASSWORD ${quoted}`);
        for (const [key, value] of Object.entries({
            search_path: SCHEMA,
            default_transaction_read_only: 'on',
            statement_timeout: '4s',
            lock_timeout: '1s',
            idle_in_transaction_session_timeout: '10s',
            temp_file_limit: '64MB',
        })) await client.query(`ALTER ROLE ${ROLE} SET ${key} = '${value}'`);

        const { rows: [{ db }] } = await client.query('SELECT current_database() AS db');
        await client.query(`REVOKE TEMPORARY ON DATABASE ${client.escapeIdentifier(db)} FROM PUBLIC`);
        await client.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${ROLE}`);
        await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${ROLE}`);
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
    }
}

/** Builds the views and opens the reader. Runs at startup and leaves chat alone if it fails. */
async function start() {
    const password = process.env.AI_DB_PASSWORD;
    if (!password || !adminPool) {
        Logger.warning('League lookups are off: AI_DB_PASSWORD or the database is missing.');
        return false;
    }
    const client = await adminPool.connect();
    try {
        await buildViews(client, password);
    } finally {
        client.release();
    }
    if (reader) await reader.end().catch(() => {});
    reader = new Pool({
        connectionString: readerUrl(password),
        ssl: { rejectUnauthorized: false },
        max: 2,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        query_timeout: QUERY_TIMEOUT_MS,
    });
    // An unlistened pg 'error' event is thrown as an uncaught exception.
    reader.on('error', (err) => Logger.warning(`League lookup connection dropped: ${err.message}`));
    reader.on('connect', (conn) => conn.on('error', (err) => Logger.warning(`League lookup client error: ${err.message}`)));
    await reader.query('SELECT 1 FROM seasons LIMIT 1');
    ready = true;
    Logger.success(`League lookups ready (${VIEWS.length} views)`);
    return true;
}

/** Member names and anything else quoted in a query stay out of the audit log. */
function logLookup(sql, details, outcome = 'success') {
    higgenLog.logInteraction({
        eventType: 'job',
        action: 'ai.data_lookup',
        actor: { name: 'Beluga League BOT', id: null },
        what: 'looked up league data',
        details: [['Query', sql.replace(/'[^']*'/g, "'…'").slice(0, 700)], ...details],
    }, { outcome });
}

/**
 * Wrapped as a subquery, so it can only ever be one read: a second statement or a writing WITH
 * is a syntax error. The newline keeps a trailing comment from swallowing the closing bracket.
 */
async function runQuery(rawSql) {
    const sql = String(rawSql || '').trim().replace(/;+\s*$/, '');
    if (!/^(select|with)\b/i.test(sql)) return { error: 'Only one SELECT statement is allowed.' };
    const started = Date.now();
    try {
        const res = await reader.query({
            text: `SELECT * FROM (\n${sql}\n) AS result LIMIT ${MAX_ROWS + 1}`,
            rowMode: 'array',
        });
        const truncated = res.rows.length > MAX_ROWS;
        const rows = res.rows.slice(0, MAX_ROWS);
        logLookup(sql, [['Rows', `${rows.length}${truncated ? ' (cut off)' : ''}`], ['Took', `${Date.now() - started} ms`]]);
        return { columns: res.fields.map((f) => f.name), rows, truncated };
    } catch (err) {
        logLookup(sql, [['Error', String(err.message).slice(0, 200)]], 'failed');
        if (err.code === '42501') return { error: 'That data is not available.' };
        // The message tells the model what to fix, like a column that doesn't exist.
        return { error: err.message };
    }
}

async function standingsTool({ season, division: name }) {
    const code = divisionCode(name);
    if (!code) return { error: 'Division must be Academy, Contenders or Premier.' };
    const { rows: [row] } = await reader.query(season
        ? { text: 'SELECT season FROM seasons WHERE season = $1', values: [season] }
        : 'SELECT max(season) AS season FROM series');
    if (!row?.season) return { error: 'No such season.' };
    const { rows: [{ id }] } = await adminPool.query('SELECT id FROM seasons WHERE season_number = $1', [row.season]);
    const table = await getStandings(id, code);
    return {
        season: row.season,
        division: divisionLabel(code),
        standings: table.map((t) => ({ place: t.place, team: t.teamName, wins: t.wins, losses: t.losses, game_diff: t.gameDiff, goal_diff: t.goalDiff })),
    };
}

async function rulesTool({ query }) {
    if (!ruleBook) return { error: 'The rulebook is not available.' };
    await ruleBook.ensureLoaded();
    const found = ruleBook.searchRules(String(query || '')) || [];
    if (!found.length) return { error: 'Nothing in the rulebook matched. Try other words.' };
    return {
        rules: found.slice(0, MAX_RULES).map((r) => ({ section: r.number, title: r.section, text: r.content.slice(0, RULE_CHARS) })),
    };
}

/** Runs one tool call and returns its tool_result block. Never throws. */
async function run(call) {
    let result;
    try {
        if (!ready) result = { error: 'League lookups are unavailable right now.' };
        else if (call.name === 'league_query') result = await runQuery(call.input?.sql);
        else if (call.name === 'league_standings') result = await standingsTool(call.input || {});
        else result = await rulesTool(call.input || {});
    } catch (err) {
        Logger.warning(`League lookup failed: ${err.message}`);
        result = { error: 'That lookup failed. Answer with what you have or say you could not find it.' };
    }
    const content = JSON.stringify(result);
    return {
        type: 'tool_result',
        tool_use_id: call.id,
        ...(result.error ? { is_error: true } : {}),
        content: content.length > MAX_RESULT_CHARS ? `${content.slice(0, MAX_RESULT_CHARS)}… (cut off, aggregate or LIMIT the query)` : content,
    };
}

module.exports = { start, available, handles, run, runQuery, useRuleBook, TOOLS, VIEWS, ROLE };
