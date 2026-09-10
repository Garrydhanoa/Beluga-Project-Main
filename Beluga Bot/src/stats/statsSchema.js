/**
 * Stats system database schema.
 *
 * Design principle: stats_game_players (one row per player per game) is the
 * immutable SOURCE OF TRUTH. Everything else — player season/lifetime totals,
 * team season totals, standings — is DERIVED from it by the recompute step, so
 * staff edits, deletes, and the "recalculate" button all just work.
 *
 * Player stats are LIFETIME (never reset); team stats are per-season. Regular
 * season and playoffs are kept separate via an is_playoff flag on aggregates.
 *
 * Created by the bot on boot (ensureStatsSchema). The website mirrors the same
 * DDL in lib/leagueSchema.js so its admin/read paths can rely on the tables.
 * All statements are IF NOT EXISTS / idempotent.
 */

async function ensureStatsSchema(pool, Logger = console) {
    const run = async (label, sql) => {
        try {
            await pool.query(sql);
        } catch (err) {
            (Logger.error || console.error)(`stats schema step failed: ${label}`, err);
            throw err;
        }
    };

    // --- identity: ballchasing account -> discord id -------------------------
    await run('stats_player_accounts', `
        CREATE TABLE IF NOT EXISTS stats_player_accounts (
            id SERIAL PRIMARY KEY,
            discord_id TEXT NOT NULL,
            platform TEXT NOT NULL,
            platform_id TEXT NOT NULL,
            current_name TEXT,
            first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            linked_by TEXT,
            UNIQUE (platform, platform_id)
        )
    `);
    await run('idx_accounts_discord', `CREATE INDEX IF NOT EXISTS idx_stats_accounts_discord ON stats_player_accounts(discord_id)`);

    // Append-only log of names/accounts seen for a player (shown on profile + admin).
    await run('stats_name_history', `
        CREATE TABLE IF NOT EXISTS stats_name_history (
            id SERIAL PRIMARY KEY,
            discord_id TEXT NOT NULL,
            name TEXT,
            platform TEXT,
            platform_id TEXT,
            source TEXT NOT NULL DEFAULT 'ballchasing',
            observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await run('idx_namehist_discord', `CREATE INDEX IF NOT EXISTS idx_stats_namehist_discord ON stats_name_history(discord_id)`);

    // --- the reported series -------------------------------------------------
    await run('stats_series', `
        CREATE TABLE IF NOT EXISTS stats_series (
            id SERIAL PRIMARY KEY,
            season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
            division TEXT NOT NULL,
            week INTEGER,
            is_playoff BOOLEAN NOT NULL DEFAULT FALSE,
            playoff_series_id INTEGER,
            schedule_match_id INTEGER,
            thread_id TEXT,
            home_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
            away_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
            home_score INTEGER NOT NULL DEFAULT 0,
            away_score INTEGER NOT NULL DEFAULT 0,
            winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
            format TEXT NOT NULL DEFAULT 'bo5',
            is_forfeit BOOLEAN NOT NULL DEFAULT FALSE,
            forfeit_kind TEXT,
            ballchasing_group_id TEXT,
            ballchasing_group_url TEXT,
            ballchasing_group_name TEXT,
            status TEXT NOT NULL DEFAULT 'confirmed',
            reported_by_discord_id TEXT,
            reported_via TEXT NOT NULL DEFAULT 'captain',
            manual_override BOOLEAN NOT NULL DEFAULT FALSE,
            confirmed_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await run('idx_series_lookup', `CREATE INDEX IF NOT EXISTS idx_stats_series_lookup ON stats_series(season_id, division, week)`);
    await run('idx_series_teams', `CREATE INDEX IF NOT EXISTS idx_stats_series_teams ON stats_series(home_team_id, away_team_id)`);
    // Block the same Ballchasing group being reported twice (staff can void the old one first).
    await run('uniq_series_group', `
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_stats_series_group
        ON stats_series(ballchasing_group_id)
        WHERE ballchasing_group_id IS NOT NULL AND status <> 'void'
    `);
    // Block two live reports for the same scheduled matchup.
    await run('uniq_series_schedule', `
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_stats_series_schedule
        ON stats_series(schedule_match_id)
        WHERE schedule_match_id IS NOT NULL AND status NOT IN ('void')
    `);

    // --- per-game (one row per replay) --------------------------------------
    await run('stats_games', `
        CREATE TABLE IF NOT EXISTS stats_games (
            id SERIAL PRIMARY KEY,
            series_id INTEGER NOT NULL REFERENCES stats_series(id) ON DELETE CASCADE,
            game_number INTEGER NOT NULL,
            ballchasing_replay_id TEXT,
            ballchasing_replay_url TEXT,
            map TEXT,
            duration_seconds INTEGER,
            overtime BOOLEAN NOT NULL DEFAULT FALSE,
            home_goals INTEGER NOT NULL DEFAULT 0,
            away_goals INTEGER NOT NULL DEFAULT 0,
            winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
            is_forfeit BOOLEAN NOT NULL DEFAULT FALSE,
            played_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (series_id, ballchasing_replay_id)
        )
    `);
    await run('idx_games_series', `CREATE INDEX IF NOT EXISTS idx_stats_games_series ON stats_games(series_id)`);

    // --- per-player per-game stat line (SOURCE OF TRUTH) --------------------
    await run('stats_game_players', `
        CREATE TABLE IF NOT EXISTS stats_game_players (
            id SERIAL PRIMARY KEY,
            game_id INTEGER NOT NULL REFERENCES stats_games(id) ON DELETE CASCADE,
            series_id INTEGER NOT NULL REFERENCES stats_series(id) ON DELETE CASCADE,
            season_id INTEGER,
            division TEXT,
            is_playoff BOOLEAN NOT NULL DEFAULT FALSE,
            team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
            discord_id TEXT,
            platform TEXT,
            platform_id TEXT,
            ingame_name TEXT,
            is_sub BOOLEAN NOT NULL DEFAULT FALSE,
            score INTEGER NOT NULL DEFAULT 0,
            goals INTEGER NOT NULL DEFAULT 0,
            assists INTEGER NOT NULL DEFAULT 0,
            saves INTEGER NOT NULL DEFAULT 0,
            shots INTEGER NOT NULL DEFAULT 0,
            shooting_pct NUMERIC,
            demos_inflicted INTEGER NOT NULL DEFAULT 0,
            demos_taken INTEGER NOT NULL DEFAULT 0,
            mvp BOOLEAN NOT NULL DEFAULT FALSE,
            played_seconds INTEGER,
            manually_edited BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await run('idx_gp_discord', `CREATE INDEX IF NOT EXISTS idx_stats_gp_discord ON stats_game_players(discord_id)`);
    await run('idx_gp_team', `CREATE INDEX IF NOT EXISTS idx_stats_gp_team ON stats_game_players(team_id)`);
    await run('idx_gp_series', `CREATE INDEX IF NOT EXISTS idx_stats_gp_series ON stats_game_players(series_id)`);
    await run('idx_gp_season_div', `CREATE INDEX IF NOT EXISTS idx_stats_gp_season_div ON stats_game_players(season_id, division)`);

    // --- derived aggregates (rebuilt by recompute) ---------------------------
    // Player per-season (regular vs playoff split via is_playoff).
    await run('stats_player_season', `
        CREATE TABLE IF NOT EXISTS stats_player_season (
            discord_id TEXT NOT NULL,
            season_id INTEGER NOT NULL,
            division TEXT NOT NULL,
            is_playoff BOOLEAN NOT NULL DEFAULT FALSE,
            team_id INTEGER,
            games INTEGER NOT NULL DEFAULT 0,
            score INTEGER NOT NULL DEFAULT 0,
            goals INTEGER NOT NULL DEFAULT 0,
            assists INTEGER NOT NULL DEFAULT 0,
            saves INTEGER NOT NULL DEFAULT 0,
            shots INTEGER NOT NULL DEFAULT 0,
            demos_inflicted INTEGER NOT NULL DEFAULT 0,
            demos_taken INTEGER NOT NULL DEFAULT 0,
            mvps INTEGER NOT NULL DEFAULT 0,
            beluga_score NUMERIC,
            manual_override BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_id, season_id, division, is_playoff)
        )
    `);

    // Player lifetime (regular vs playoff split). seasons_played powers
    // "average per season"; games powers "average per game".
    await run('stats_player_lifetime', `
        CREATE TABLE IF NOT EXISTS stats_player_lifetime (
            discord_id TEXT NOT NULL,
            is_playoff BOOLEAN NOT NULL DEFAULT FALSE,
            games INTEGER NOT NULL DEFAULT 0,
            seasons_played INTEGER NOT NULL DEFAULT 0,
            score INTEGER NOT NULL DEFAULT 0,
            goals INTEGER NOT NULL DEFAULT 0,
            assists INTEGER NOT NULL DEFAULT 0,
            saves INTEGER NOT NULL DEFAULT 0,
            shots INTEGER NOT NULL DEFAULT 0,
            demos_inflicted INTEGER NOT NULL DEFAULT 0,
            demos_taken INTEGER NOT NULL DEFAULT 0,
            mvps INTEGER NOT NULL DEFAULT 0,
            beluga_score NUMERIC,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (discord_id, is_playoff)
        )
    `);

    // Team per-season (regular vs playoff split). Standings read is_playoff=false.
    await run('stats_team_season', `
        CREATE TABLE IF NOT EXISTS stats_team_season (
            season_id INTEGER NOT NULL,
            division TEXT NOT NULL,
            team_id INTEGER NOT NULL,
            is_playoff BOOLEAN NOT NULL DEFAULT FALSE,
            series_wins INTEGER NOT NULL DEFAULT 0,
            series_losses INTEGER NOT NULL DEFAULT 0,
            game_wins INTEGER NOT NULL DEFAULT 0,
            game_losses INTEGER NOT NULL DEFAULT 0,
            goals_for INTEGER NOT NULL DEFAULT 0,
            goals_against INTEGER NOT NULL DEFAULT 0,
            games_played INTEGER NOT NULL DEFAULT 0,
            score INTEGER NOT NULL DEFAULT 0,
            goals INTEGER NOT NULL DEFAULT 0,
            assists INTEGER NOT NULL DEFAULT 0,
            saves INTEGER NOT NULL DEFAULT 0,
            shots INTEGER NOT NULL DEFAULT 0,
            demos_inflicted INTEGER NOT NULL DEFAULT 0,
            demos_taken INTEGER NOT NULL DEFAULT 0,
            beluga_score NUMERIC,
            manual_override BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (season_id, division, team_id, is_playoff)
        )
    `);

    // --- in-progress report sessions (survive bot restarts) ------------------
    await run('stats_report_sessions', `
        CREATE TABLE IF NOT EXISTS stats_report_sessions (
            id SERIAL PRIMARY KEY,
            thread_id TEXT,
            channel_id TEXT,
            division TEXT,
            season_id INTEGER,
            week INTEGER,
            is_playoff BOOLEAN NOT NULL DEFAULT FALSE,
            format TEXT NOT NULL DEFAULT 'bo5',
            home_team_id INTEGER,
            away_team_id INTEGER,
            schedule_match_id INTEGER,
            group_url TEXT,
            parsed JSONB,
            home_matches JSONB,
            away_matches JSONB,
            state TEXT NOT NULL DEFAULT 'await_group',
            started_by_discord_id TEXT,
            message_ids JSONB,
            series_id INTEGER,
            expires_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await run('idx_sessions_thread', `CREATE INDEX IF NOT EXISTS idx_stats_sessions_thread ON stats_report_sessions(thread_id)`);

    // --- report panels (the "Report Series" panel reposted in each thread) ---
    await run('stats_report_panels', `
        CREATE TABLE IF NOT EXISTS stats_report_panels (
            thread_id TEXT PRIMARY KEY,
            channel_id TEXT,
            message_id TEXT,
            division TEXT,
            season_id INTEGER,
            week INTEGER,
            home_team_id INTEGER,
            away_team_id INTEGER,
            status TEXT NOT NULL DEFAULT 'active',
            last_posted_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // --- audit log (who reported/edited/deleted/disputed, and when) ----------
    await run('stats_audit_log', `
        CREATE TABLE IF NOT EXISTS stats_audit_log (
            id SERIAL PRIMARY KEY,
            series_id INTEGER,
            action TEXT NOT NULL,
            actor_discord_id TEXT,
            actor_name TEXT,
            actor_source TEXT NOT NULL DEFAULT 'bot',
            detail JSONB,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    await run('idx_audit_series', `CREATE INDEX IF NOT EXISTS idx_stats_audit_series ON stats_audit_log(series_id)`);

    // --- Ballchasing import queue -------------------------------------------
    // Website-owned queue, drained by the bot (stats/seriesImportPoller.js). Staff
    // report a series by hand on the admin panel and attach a group link or one
    // replay link per game; the BOT holds the Ballchasing key, the rate limiter and
    // the parser, so it does the fetching and writes the real stats back.
    // Mirrored in beluga-league-main/lib/leagueSchema.js — keep in sync.
    await run('stats_import_jobs', `
        CREATE TABLE IF NOT EXISTS stats_import_jobs (
            id SERIAL PRIMARY KEY,
            series_id INTEGER NOT NULL REFERENCES stats_series(id) ON DELETE CASCADE,
            source TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            requested_by_discord_id TEXT,
            requested_by_username TEXT,
            result JSONB,
            error TEXT,
            requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            finished_at TIMESTAMP
        )
    `);
    await run('idx_stats_import_jobs', `CREATE INDEX IF NOT EXISTS idx_stats_import_jobs_status ON stats_import_jobs(status, requested_at)`);
    await run('idx_stats_import_jobs_series', `CREATE INDEX IF NOT EXISTS idx_stats_import_jobs_series ON stats_import_jobs(series_id, id DESC)`);

    // --- power_rankings.week -------------------------------------------------
    // power_rankings is CREATED by the website (lib/leagueSchema.js), but the bot
    // WRITES it, so the bot must be able to add this column itself in case it
    // deploys first. Guarded on to_regclass so a fresh DB where the website has
    // never booted doesn't fail the whole stats schema step.
    // A ranking is a snapshot of ONE WEEK: recalculating week 3 leaves weeks 2
    // and 4 alone, and trend compares week N against week N-1.
    await run('power_rankings_week', `
        DO $$
        BEGIN
            IF to_regclass('public.power_rankings') IS NOT NULL THEN
                ALTER TABLE power_rankings ADD COLUMN IF NOT EXISTS week INTEGER;
                CREATE INDEX IF NOT EXISTS idx_power_rankings_week
                    ON power_rankings(season_id, division, week, entity_type, rank);
            END IF;
        END $$;
    `);

    (Logger.success || console.log)('Stats system schema ensured');
    return true;
}

module.exports = { ensureStatsSchema };
