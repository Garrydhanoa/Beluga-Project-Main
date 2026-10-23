import { query } from './db'

let schemaReady = false
let schemaPromise = null
let lastReport = null

export function getLastSchemaReport() {
  return lastReport
}

export async function ensureLeagueSchema() {
  if (schemaReady) return
  if (schemaPromise) {
    try {
      return await schemaPromise
    } catch {
      // previous attempt failed; fall through to retry
    }
  }

  schemaPromise = runMigrations()
  try {
    await schemaPromise
    schemaReady = true
  } catch (err) {
    schemaPromise = null
    throw err
  }
}

async function runMigrations() {
  const ran = []
  const failed = []
  const started = Date.now()

  async function step(label, sql) {
    try {
      await query(sql)
      ran.push(label)
    } catch (err) {
      failed.push({ label, error: err.message })
      console.error(`[schema] ${label} FAILED:`, err.message)
    }
  }

  // ---------- Bot-shared core tables (idempotent CREATE IF NOT EXISTS) ----------

  await step('seasons', `
    CREATE TABLE IF NOT EXISTS seasons (
      id SERIAL PRIMARY KEY,
      season_number INTEGER NOT NULL UNIQUE,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('seasons.year', `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS year INTEGER`)
  await step('seasons.status_label', `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS status_label TEXT`)
  await step('seasons.description', `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS description TEXT`)
  await step('seasons.recruiting_open', `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS recruiting_open BOOLEAN NOT NULL DEFAULT FALSE`)
  await step('seasons.start_date', `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS start_date DATE`)
  // Safety hardening (behind the director-gated reset flow): at most ONE active
  // season at a time. Partial unique index — only one row may have status='active'.
  // Non-fatal if it can't be created (e.g. pre-existing duplicate active rows); the
  // reset/delete executors already enforce single-active in application code.
  await step('ux_one_active_season', `CREATE UNIQUE INDEX IF NOT EXISTS ux_one_active_season ON seasons (status) WHERE status = 'active'`)

  await step('teams', `
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      name TEXT NOT NULL,
      roster_limit INTEGER NOT NULL DEFAULT 4,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      logo_mime TEXT,
      logo_data BYTEA,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (season_id, division, name)
    )
  `)

  await step('team_roster_members', `
    CREATE TABLE IF NOT EXISTS team_roster_members (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      discord_id TEXT NOT NULL,
      discord_username TEXT,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'player',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (season_id, team_id, discord_id, role)
    )
  `)

  await step('roster_syncs', `
    CREATE TABLE IF NOT EXISTS roster_syncs (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await step('idx_teams_season_division', `CREATE INDEX IF NOT EXISTS idx_teams_season_division ON teams(season_id, division)`)
  await step('idx_roster_members_team', `CREATE INDEX IF NOT EXISTS idx_roster_members_team ON team_roster_members(season_id, team_id)`)

  await step('schedule_matches', `
    CREATE TABLE IF NOT EXISTS schedule_matches (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      week INTEGER NOT NULL,
      home_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      away_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (season_id, division, week, home_team_id, away_team_id, status)
    )
  `)
  await step('schedule_matches.is_published', `ALTER TABLE schedule_matches ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE`)
  await step('schedule_matches.match_order', `ALTER TABLE schedule_matches ADD COLUMN IF NOT EXISTS match_order INTEGER NOT NULL DEFAULT 0`)
  await step('schedule_matches.is_published backfill', `
    UPDATE schedule_matches
    SET is_published = CASE WHEN status = 'published' THEN TRUE ELSE FALSE END
    WHERE is_published IS DISTINCT FROM (status = 'published')
  `)
  await step('idx_schedule_matches_season', `CREATE INDEX IF NOT EXISTS idx_schedule_matches_season ON schedule_matches(season_id, division, week, status)`)

  await step('playoff_brackets', `
    CREATE TABLE IF NOT EXISTS playoff_brackets (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('playoff_brackets.is_published', `ALTER TABLE playoff_brackets ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT TRUE`)
  await step('playoff_brackets.display_order', `ALTER TABLE playoff_brackets ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0`)
  await step('playoff_brackets.is_published backfill', `
    UPDATE playoff_brackets
    SET is_published = CASE WHEN status = 'published' THEN TRUE ELSE FALSE END
    WHERE is_published IS DISTINCT FROM (status = 'published')
  `)

  await step('playoff_rounds', `
    CREATE TABLE IF NOT EXISTS playoff_rounds (
      id SERIAL PRIMARY KEY,
      bracket_id INTEGER NOT NULL REFERENCES playoff_brackets(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      round_order INTEGER NOT NULL,
      is_finals BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (bracket_id, round_order)
    )
  `)
  await step('playoff_rounds.round_number', `ALTER TABLE playoff_rounds ADD COLUMN IF NOT EXISTS round_number INTEGER`)
  await step('playoff_rounds.round_number backfill', `UPDATE playoff_rounds SET round_number = round_order WHERE round_number IS NULL`)
  await step('playoff_rounds.round_number default', `ALTER TABLE playoff_rounds ALTER COLUMN round_number SET DEFAULT 1`)
  // round_order is NOT NULL with no default, and an INSERT that forgot it used to
  // 500 every manual bracket save. We always write it now; the default is a belt
  // so a future omission degrades instead of blowing up the whole save.
  await step('playoff_rounds.round_order default', `ALTER TABLE playoff_rounds ALTER COLUMN round_order SET DEFAULT 1`)
  await step('playoff_rounds.best_of', `ALTER TABLE playoff_rounds ADD COLUMN IF NOT EXISTS best_of INTEGER NOT NULL DEFAULT 7`)

  await step('playoff_matchups', `
    CREATE TABLE IF NOT EXISTS playoff_matchups (
      id SERIAL PRIMARY KEY,
      round_id INTEGER NOT NULL REFERENCES playoff_rounds(id) ON DELETE CASCADE,
      home_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      away_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      best_of INTEGER NOT NULL DEFAULT 7,
      order_index INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('playoff_matchups.match_order', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS match_order INTEGER NOT NULL DEFAULT 1`)
  await step('playoff_matchups.match_order backfill', `UPDATE playoff_matchups SET match_order = order_index WHERE match_order IS NULL`)
  await step('idx_playoff_matchups_round', `CREATE INDEX IF NOT EXISTS idx_playoff_matchups_round ON playoff_matchups(round_id, order_index)`)

  // --- Bracket graph (2026-09) -------------------------------------------------
  // A matchup used to be two team ids and nothing else: no seed, no score, no
  // winner, and no pointer at the slot the winner belongs in. That is why nothing
  // could ever advance a bracket and round 2 had to be typed in by hand. These
  // columns turn playoff_matchups into a real graph, so advancement is generic
  // over any bracket size.
  await step('playoff_matchups.home_seed', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS home_seed INTEGER`)
  await step('playoff_matchups.away_seed', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS away_seed INTEGER`)
  await step('playoff_matchups.home_score', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS home_score INTEGER`)
  await step('playoff_matchups.away_score', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS away_score INTEGER`)
  await step('playoff_matchups.winner_team_id', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS winner_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL`)
  // 'series' | 'ffw' | 'double_ff' | 'bye'
  await step('playoff_matchups.result_kind', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS result_kind TEXT`)
  await step('playoff_matchups.series_id', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS series_id INTEGER`)
  // Where this matchup's winner goes next. Self-referential, so a bracket of any
  // shape (8, 10 with byes, 16) is just a different wiring of the same table.
  await step('playoff_matchups.next_matchup_id', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS next_matchup_id INTEGER REFERENCES playoff_matchups(id) ON DELETE SET NULL`)
  await step('playoff_matchups.next_slot', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS next_slot TEXT`)
  // Staff edited this matchup by hand -> recompute must never overwrite it.
  await step('playoff_matchups.manual_override', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE`)
  await step('playoff_matchups.is_bye', `ALTER TABLE playoff_matchups ADD COLUMN IF NOT EXISTS is_bye BOOLEAN NOT NULL DEFAULT FALSE`)
  await step('playoff_brackets.qualifier_count', `ALTER TABLE playoff_brackets ADD COLUMN IF NOT EXISTS qualifier_count INTEGER NOT NULL DEFAULT 8`)
  await step('idx_playoff_matchups_next', `CREATE INDEX IF NOT EXISTS idx_playoff_matchups_next ON playoff_matchups(next_matchup_id)`)

  await step('team_records', `
    CREATE TABLE IF NOT EXISTS team_records (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      game_wins INTEGER NOT NULL DEFAULT 0,
      game_losses INTEGER NOT NULL DEFAULT 0,
      goals_for INTEGER NOT NULL DEFAULT 0,
      goals_against INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (season_id, division, team_id)
    )
  `)

  await step('player_records', `
    CREATE TABLE IF NOT EXISTS player_records (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      player_name TEXT NOT NULL,
      platform TEXT,
      platform_id TEXT,
      games_played INTEGER NOT NULL DEFAULT 0,
      goals INTEGER NOT NULL DEFAULT 0,
      assists INTEGER NOT NULL DEFAULT 0,
      saves INTEGER NOT NULL DEFAULT 0,
      shots INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (season_id, division, team_id, player_name, platform, platform_id)
    )
  `)

  // ---------- Website-managed additions ----------

  await step('team_franchises', `
    CREATE TABLE IF NOT EXISTS team_franchises (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      default_division TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      logo_mime TEXT,
      logo_data BYTEA,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('teams.franchise_id', `
    ALTER TABLE teams
    ADD COLUMN IF NOT EXISTS franchise_id INTEGER REFERENCES team_franchises(id) ON DELETE SET NULL
  `)
  await step('idx_teams_franchise', `CREATE INDEX IF NOT EXISTS idx_teams_franchise ON teams(franchise_id)`)
  await step('teams.discord_role_id', `ALTER TABLE teams ADD COLUMN IF NOT EXISTS discord_role_id TEXT`)
  await step('teams.discord_gm_role_id', `ALTER TABLE teams ADD COLUMN IF NOT EXISTS discord_gm_role_id TEXT`)
  await step('teams.discord_captain_role_id', `ALTER TABLE teams ADD COLUMN IF NOT EXISTS discord_captain_role_id TEXT`)
  await step('teams.discord_np_role_id', `ALTER TABLE teams ADD COLUMN IF NOT EXISTS discord_np_role_id TEXT`)
  await step('franchise backfill (seed)', `
    INSERT INTO team_franchises (name, default_division, logo_mime, logo_data)
    SELECT DISTINCT ON (t.name) t.name, t.division, t.logo_mime, t.logo_data
    FROM teams t
    WHERE NOT EXISTS (
      SELECT 1 FROM team_franchises f WHERE f.name = t.name
    )
    ORDER BY t.name, t.created_at DESC
  `)
  await step('franchise backfill (link teams)', `
    UPDATE teams t
    SET franchise_id = f.id
    FROM team_franchises f
    WHERE t.franchise_id IS NULL AND f.name = t.name
  `)

  await step('season_config', `
    CREATE TABLE IF NOT EXISTS season_config (
      season_id INTEGER PRIMARY KEY REFERENCES seasons(id) ON DELETE CASCADE,
      teams_per_division JSONB NOT NULL DEFAULT '{}'::jsonb,
      weeks INTEGER,
      schedule_generated_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Per-season e-sub (one-day sub) allowance. Editable from the admin panel's
  // Transactions tab; the bot reads it and falls back to 3 if it is missing.
  await step('season_config.esub_limit', `
    ALTER TABLE season_config ADD COLUMN IF NOT EXISTS esub_limit INTEGER NOT NULL DEFAULT 3
  `)

  // ---------- E-sub usage ----------
  // How many one-day subs each team has used, keyed by SEASON + TEAM row. Teams
  // are per (season, division, name), so this is inherently per-division and
  // resets itself on a new season: new season → new team ids → no rows → 0 used.
  //
  // Replaces the "One Day Sub Tracker" tab of the salary spreadsheet, which
  // addressed cells by team index into a hardcoded name list. That sheet's
  // header row had drifted away from the live team names, so every read and
  // write landed in some other team's column. Mirrored in the bot's database.js.
  await step('team_esubs', `
    CREATE TABLE IF NOT EXISTS team_esubs (
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      used INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT,
      PRIMARY KEY (season_id, team_id)
    )
  `)

  await step('season_champions', `
    CREATE TABLE IF NOT EXISTS season_champions (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      division TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      franchise_id INTEGER REFERENCES team_franchises(id) ON DELETE SET NULL,
      gm_discord_id TEXT,
      gm_display_name TEXT,
      notes TEXT,
      set_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (season_id, division)
    )
  `)

  await step('team_records.manual_override', `ALTER TABLE team_records ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE`)
  await step('player_records.manual_override', `ALTER TABLE player_records ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE`)

  await step('transactions', `
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
      discord_id TEXT NOT NULL,
      discord_username TEXT,
      display_name TEXT,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team_name_snapshot TEXT,
      franchise_id INTEGER REFERENCES team_franchises(id) ON DELETE SET NULL,
      paired_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      paired_team_name_snapshot TEXT,
      type TEXT NOT NULL,
      details JSONB DEFAULT '{}'::jsonb,
      performed_by_discord_id TEXT,
      performed_by_username TEXT,
      source TEXT,
      performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('idx_tx_player', `CREATE INDEX IF NOT EXISTS idx_tx_player ON transactions(discord_id, performed_at DESC)`)
  await step('idx_tx_team', `CREATE INDEX IF NOT EXISTS idx_tx_team ON transactions(team_id, performed_at DESC)`)
  await step('idx_tx_franchise', `CREATE INDEX IF NOT EXISTS idx_tx_franchise ON transactions(franchise_id, performed_at DESC)`)
  await step('idx_tx_season', `CREATE INDEX IF NOT EXISTS idx_tx_season ON transactions(season_id, performed_at DESC)`)

  // Bot-shared week_threads table. The bot creates it lazily in its week-thread command;
  // we mirror the schema here so the website can read/write even before the bot has been hit.
  await step('week_threads', `
    CREATE TABLE IF NOT EXISTS week_threads (
      id SERIAL PRIMARY KEY,
      week_number INTEGER NOT NULL,
      division TEXT NOT NULL,
      team1 TEXT NOT NULL,
      team2 TEXT NOT NULL,
      thread_id TEXT,
      match_number INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('week_threads.season_id', `ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE`)
  await step('week_threads.is_closed', `ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT FALSE`)
  await step('week_threads.closed_at', `ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`)
  await step('week_threads.close_synced', `ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS close_synced BOOLEAN NOT NULL DEFAULT TRUE`)
  // Website materializes rows with NULL thread_id; drop legacy NOT NULL if the bot created it that way.
  await step('week_threads.thread_id nullable', `ALTER TABLE week_threads ALTER COLUMN thread_id DROP NOT NULL`)
  await step('week_threads.match_number nullable', `ALTER TABLE week_threads ALTER COLUMN match_number DROP NOT NULL`)
  await step('idx_week_threads_week', `CREATE INDEX IF NOT EXISTS idx_week_threads_week ON week_threads(week_number)`)
  await step('idx_week_threads_season', `CREATE INDEX IF NOT EXISTS idx_week_threads_season ON week_threads(season_id, week_number)`)

  // ticket_requests — website-owned queue for tickets the admin asks for from the
  // website. The bot picks them up and actually creates the Discord channel +
  // ticket row in the `tickets` table (which the bot owns). Off-limits `tickets`
  // table is NOT modified by the website schema.
  await step('ticket_requests', `
    CREATE TABLE IF NOT EXISTS ticket_requests (
      id SERIAL PRIMARY KEY,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT,
      requested_by_discord_id TEXT,
      requested_by_username TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      ticket_channel_id TEXT,
      requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfilled_at TIMESTAMP
    )
  `)
  await step('idx_ticket_requests_status', `CREATE INDEX IF NOT EXISTS idx_ticket_requests_status ON ticket_requests(status, requested_at DESC)`)

  // site_config — website-owned key/value store for homepage cosmetics
  // (notification bar, etc.). One row per key, value is JSONB.
  await step('site_config', `
    CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // ticket_messages — live transcript mirror written by the bot for every
  // message in a tracked ticket channel. Website reads to render a Discord-style
  // transcript; website never writes here.
  await step('ticket_messages', `
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id SERIAL PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      author_id TEXT,
      author_username TEXT,
      author_display TEXT,
      author_avatar TEXT,
      author_color TEXT,
      is_bot BOOLEAN NOT NULL DEFAULT FALSE,
      content TEXT,
      attachments JSONB DEFAULT '[]'::jsonb,
      embeds JSONB DEFAULT '[]'::jsonb,
      message_created_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (channel_id, message_id)
    )
  `)
  await step('idx_ticket_messages_channel', `CREATE INDEX IF NOT EXISTS idx_ticket_messages_channel ON ticket_messages(channel_id, message_created_at)`)

  // ticket_close_requests — website-owned queue. Website "Close" inserts a row;
  // the bot runs the same close flow as /close, then marks it fulfilled. The
  // off-limits `tickets` table is only mutated by the bot, never the website.
  await step('ticket_close_requests', `
    CREATE TABLE IF NOT EXISTS ticket_close_requests (
      id SERIAL PRIMARY KEY,
      channel_id TEXT NOT NULL,
      requested_by_discord_id TEXT,
      requested_by_username TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfilled_at TIMESTAMP
    )
  `)
  await step('idx_ticket_close_requests', `CREATE INDEX IF NOT EXISTS idx_ticket_close_requests ON ticket_close_requests(status, requested_at)`)

  // ticket_archives — header metadata for CLOSED tickets (bot deletes the live
  // `tickets` row on close), so the website can still list closed tickets and
  // render the saved transcript from ticket_messages.
  await step('ticket_archives', `
    CREATE TABLE IF NOT EXISTS ticket_archives (
      channel_id TEXT PRIMARY KEY,
      channel_name TEXT,
      reason TEXT,
      opened_by_username TEXT,
      opened_at TIMESTAMP,
      closed_by_username TEXT,
      closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER NOT NULL DEFAULT 0
    )
  `)
  await step('idx_ticket_archives_closed', `CREATE INDEX IF NOT EXISTS idx_ticket_archives_closed ON ticket_archives(closed_at DESC)`)
  // Consolidated final transcript snapshot (array of message objects) written on
  // close; the per-message ticket_messages rows are deleted to keep the DB lean.
  await step('ticket_archives.transcript', `ALTER TABLE ticket_archives ADD COLUMN IF NOT EXISTS transcript JSONB`)

  // thread_messages — live transcript mirror for week-thread channels (bot-written),
  // same shape as ticket_messages. Powers the live + closed thread transcript viewer.
  await step('thread_messages', `
    CREATE TABLE IF NOT EXISTS thread_messages (
      id SERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      message_id TEXT,
      author_id TEXT,
      author_username TEXT,
      author_display TEXT,
      author_avatar TEXT,
      author_color TEXT,
      is_bot BOOLEAN NOT NULL DEFAULT FALSE,
      content TEXT,
      attachments JSONB DEFAULT '[]'::jsonb,
      embeds JSONB DEFAULT '[]'::jsonb,
      message_created_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (thread_id, message_id)
    )
  `)
  await step('idx_thread_messages_thread', `CREATE INDEX IF NOT EXISTS idx_thread_messages_thread ON thread_messages(thread_id, message_created_at)`)

  // discord_members — bot-populated mirror of the Discord guild's members. This is
  // the SINGLE source of identity for the website: display names, avatars, and the
  // exact "members in the Discord" count. The bot upserts on every member pull.
  // The website only reads from here; the Discord ID is a join key, never shown.
  await step('discord_members', `
    CREATE TABLE IF NOT EXISTS discord_members (
      discord_id TEXT PRIMARY KEY,
      username TEXT,
      display_name TEXT,
      avatar_url TEXT,
      is_bot BOOLEAN NOT NULL DEFAULT FALSE,
      is_in_guild BOOLEAN NOT NULL DEFAULT TRUE,
      joined_at TIMESTAMP,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('idx_discord_members_in_guild', `CREATE INDEX IF NOT EXISTS idx_discord_members_in_guild ON discord_members(is_in_guild, is_bot)`)

  // discord_roles — bot-populated mirror of the guild's roles. Powers the ticket
  // creation "select a role" picker and any role-name resolution in transcripts.
  await step('discord_roles', `
    CREATE TABLE IF NOT EXISTS discord_roles (
      role_id TEXT PRIMARY KEY,
      name TEXT,
      color TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      is_managed BOOLEAN NOT NULL DEFAULT FALSE,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('idx_discord_roles_position', `CREATE INDEX IF NOT EXISTS idx_discord_roles_position ON discord_roles(position DESC)`)

  // thread_archives — header metadata for CLOSED/DELETED week threads, mirroring
  // ticket_archives. The bot writes one row per thread when it deletes the Discord
  // thread, so the website keeps the transcript (thread_messages) + context forever.
  await step('thread_archives', `
    CREATE TABLE IF NOT EXISTS thread_archives (
      thread_id TEXT PRIMARY KEY,
      season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
      week_number INTEGER,
      division TEXT,
      team1 TEXT,
      team2 TEXT,
      match_number INTEGER,
      closed_by_username TEXT,
      closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER NOT NULL DEFAULT 0
    )
  `)
  await step('idx_thread_archives_week', `CREATE INDEX IF NOT EXISTS idx_thread_archives_week ON thread_archives(season_id, week_number)`)
  // Consolidated final transcript snapshot written on close/delete; per-message
  // thread_messages rows are then deleted to keep the DB lean.
  await step('thread_archives.transcript', `ALTER TABLE thread_archives ADD COLUMN IF NOT EXISTS transcript JSONB`)
  // transcript_files — copies of IMAGE attachments from tickets + week threads (the
  // bot writes them at capture time; Discord's links expire). Mirrors the bot's
  // src/utils/transcriptStore.js — keep the two definitions in sync.
  await step('transcript_files', `
    CREATE TABLE IF NOT EXISTS transcript_files (
      id            BIGSERIAL PRIMARY KEY,
      scope         TEXT NOT NULL,
      parent_id     TEXT NOT NULL,
      message_id    TEXT,
      attachment_id TEXT UNIQUE,
      name          TEXT,
      content_type  TEXT,
      size          INTEGER,
      data          BYTEA NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await step('idx_transcript_files_parent', `CREATE INDEX IF NOT EXISTS idx_transcript_files_parent ON transcript_files(scope, parent_id)`)

  // week_thread_actions — website-owned queue. The website "Delete week N" inserts
  // a row; the bot polls it and runs the SAME flow as /week-thread delete: deletes
  // the Discord thread(s) AND saves the transcript (thread_messages + thread_archives).
  // No DB-only deletion — the bot is the single actor that mutates Discord + week_threads.
  await step('week_thread_actions', `
    CREATE TABLE IF NOT EXISTS week_thread_actions (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
      week_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by_discord_id TEXT,
      requested_by_username TEXT,
      result TEXT,
      requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfilled_at TIMESTAMP
    )
  `)
  await step('idx_week_thread_actions_status', `CREATE INDEX IF NOT EXISTS idx_week_thread_actions_status ON week_thread_actions(status, requested_at)`)
  // Target ONE thread instead of a whole week. Needed for the playoff tab's
  // "delete this matchup's thread" — deleting an entire playoff round to clear a
  // single mis-created thread was the only option before. `action` has no CHECK
  // constraint, so new verbs ('delete_matchup') need no migration of their own.
  await step('week_thread_actions.week_thread_id', `ALTER TABLE week_thread_actions ADD COLUMN IF NOT EXISTS week_thread_id INTEGER`)

  // Per-division on-field salary caps live on season_config as JSONB, e.g.
  // {"Majors": 200, "AAA": 165, "AA": 130}. Used by the roster page's 3-player
  // (3v3) on-field lineup combination calculator.
  await step('season_config.onfield_caps', `ALTER TABLE season_config ADD COLUMN IF NOT EXISTS onfield_caps JSONB NOT NULL DEFAULT '{}'::jsonb`)

  // power_rankings — website-owned, season-scoped, admin-editable rankings for BOTH
  // teams and players (entity_type discriminates). No seeded/fake data; rows only
  // exist when an admin creates them. rank ascending = better.
  await step('power_rankings', `
    CREATE TABLE IF NOT EXISTS power_rankings (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      division TEXT,
      rank INTEGER NOT NULL,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      franchise_id INTEGER REFERENCES team_franchises(id) ON DELETE SET NULL,
      player_discord_id TEXT,
      label TEXT,
      note TEXT,
      trend TEXT,
      updated_by_username TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('idx_power_rankings', `CREATE INDEX IF NOT EXISTS idx_power_rankings ON power_rankings(season_id, entity_type, division, rank)`)

  // A ranking is a snapshot of ONE WEEK. Recalculating week 3 must not touch week
  // 2 or 4, and trend arrows compare week N against week N-1. Pre-existing rows
  // carry week = NULL (legacy, unweeked); the first weeked save per season+division
  // purges them. Mirrored in Beluga Bot/src/stats/statsSchema.js — keep in sync.
  await step('power_rankings.week', `ALTER TABLE power_rankings ADD COLUMN IF NOT EXISTS week INTEGER`)
  await step('idx_power_rankings_week', `CREATE INDEX IF NOT EXISTS idx_power_rankings_week ON power_rankings(season_id, division, week, entity_type, rank)`)

  // season_action_requests — director-gated queue for "Start New Season" / "Delete
  // Season". The website (admin panel) inserts a row after the 5-step confirm; the
  // bot posts an approval embed to the director channel, collects 3 Director ✅
  // reactions (any ❌ withdraws; 24h expiry), then executes the archive+new-season
  // or delete DB writes itself. Mirrored in the bot's database.js.
  await step('season_action_requests', `
    CREATE TABLE IF NOT EXISTS season_action_requests (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      season_id INTEGER,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      initiated_by_discord_id TEXT,
      initiated_by_username TEXT,
      verify_string TEXT,
      status TEXT NOT NULL DEFAULT 'pending_post',
      approval_channel_id TEXT,
      approval_message_id TEXT,
      approver_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      declined_by TEXT,
      expires_at TIMESTAMP,
      result TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      posted_at TIMESTAMP,
      executed_at TIMESTAMP
    )
  `)
  await step('idx_season_action_requests_status', `CREATE INDEX IF NOT EXISTS idx_season_action_requests_status ON season_action_requests(status, created_at)`)

  // Franchise-level Discord wiring: a franchise has ONE GM and ONE NP role across
  // all its division teams (operator rule), plus an invite link for /franchise.
  await step('team_franchises.gm_role_id', `ALTER TABLE team_franchises ADD COLUMN IF NOT EXISTS gm_role_id TEXT`)
  await step('team_franchises.np_role_id', `ALTER TABLE team_franchises ADD COLUMN IF NOT EXISTS np_role_id TEXT`)
  await step('team_franchises.discord_invite_url', `ALTER TABLE team_franchises ADD COLUMN IF NOT EXISTS discord_invite_url TEXT`)
  await step('team_franchises.color', `ALTER TABLE team_franchises ADD COLUMN IF NOT EXISTS color TEXT`)

  // Shared bot+website key/value settings (e.g. stats_channel_id).
  await step('app_config', `
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Staff quotes shown across the public site (+ optional per-player quotes).
  await step('site_quotes', `
    CREATE TABLE IF NOT EXISTS site_quotes (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      author_discord_id TEXT NOT NULL,
      player_discord_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Configurable ticket system (bot reads these; reasons + queued panels).
  await step('ticket_reasons', `
    CREATE TABLE IF NOT EXISTS ticket_reasons (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      description TEXT,
      welcome_message TEXT,
      staff_role_ids TEXT[] NOT NULL DEFAULT '{}',
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      max_open_per_user INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('ticket_panels', `
    CREATE TABLE IF NOT EXISTS ticket_panels (
      id SERIAL PRIMARY KEY,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL DEFAULT 'Open a ticket',
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Applications/forms system (website builder + bot bridge).
  await step('app_forms', `
    CREATE TABLE IF NOT EXISTS app_forms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      channel_id TEXT,
      require_in_server BOOLEAN NOT NULL DEFAULT TRUE,
      allow_votes BOOLEAN NOT NULL DEFAULT TRUE,
      vote_role_ids TEXT[] NOT NULL DEFAULT '{}',
      decision_role_ids TEXT[] NOT NULL DEFAULT '{}',
      ping_role_ids TEXT[] NOT NULL DEFAULT '{}',
      dm_on_decision BOOLEAN NOT NULL DEFAULT TRUE,
      accept_message TEXT,
      deny_message TEXT,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      max_file_mb INTEGER NOT NULL DEFAULT 8,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('app_submissions', `
    CREATE TABLE IF NOT EXISTS app_submissions (
      id SERIAL PRIMARY KEY,
      form_id INTEGER NOT NULL REFERENCES app_forms(id) ON DELETE CASCADE,
      discord_id TEXT NOT NULL,
      username TEXT,
      display_name TEXT,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',
      votes JSONB NOT NULL DEFAULT '{"up":[],"down":[]}'::jsonb,
      message_id TEXT,
      post_failed BOOLEAN NOT NULL DEFAULT FALSE,
      decided_at TIMESTAMP,
      decided_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('app_files', `
    CREATE TABLE IF NOT EXISTS app_files (
      id SERIAL PRIMARY KEY,
      submission_id INTEGER NOT NULL REFERENCES app_submissions(id) ON DELETE CASCADE,
      name TEXT,
      mime TEXT,
      size INTEGER,
      data BYTEA,
      keep_forever BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('site_logins', `
    CREATE TABLE IF NOT EXISTS site_logins (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      username TEXT,
      context TEXT,
      logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // ── Full audit trail (the hidden /higgenlogs page) ────────────────────────
  // Every interaction and every failure, from BOTH apps, in one table. Written
  // by the bot (src/utils/higgenLog.js) and the website (lib/activityLog.js).
  //
  //   source ∈ bot | website          → the two top-level tabs
  //   stream ∈ interaction | error    → the two sub-tabs
  //
  // Readability contract: `summary` is a finished English sentence and `details`
  // is ordered {label: value} pairs. The UI never renders raw JSON at the reader.
  await step('higgen_logs', `
    CREATE TABLE IF NOT EXISTS higgen_logs (
      id            BIGSERIAL PRIMARY KEY,
      occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source        TEXT NOT NULL,
      stream        TEXT NOT NULL,
      event_type    TEXT,
      actor_name    TEXT,
      actor_tag     TEXT,
      actor_id      TEXT,
      action        TEXT,
      target        TEXT,
      location      TEXT,
      outcome       TEXT,
      duration_ms   INTEGER,
      division      TEXT,
      summary       TEXT NOT NULL,
      details       JSONB,
      error_message TEXT,
      error_stack   TEXT,
      ip            TEXT,
      user_agent    TEXT
    )
  `)
  await step('idx_higgen_logs_feed', `CREATE INDEX IF NOT EXISTS idx_higgen_logs_feed ON higgen_logs(source, stream, occurred_at DESC)`)
  await step('idx_higgen_logs_time', `CREATE INDEX IF NOT EXISTS idx_higgen_logs_time ON higgen_logs(occurred_at DESC)`)
  await step('idx_higgen_logs_actor', `CREATE INDEX IF NOT EXISTS idx_higgen_logs_actor ON higgen_logs(actor_id, occurred_at DESC)`)
  await step('idx_higgen_logs_action', `CREATE INDEX IF NOT EXISTS idx_higgen_logs_action ON higgen_logs(action)`)

  // ── login security (lib/security.js) ─────────────────────────────────────
  // ip_bans: an auto-ban (3 strikes) or a manual ban by a super admin. A ban stays
  // until lifted (expires_at is only set if a timed ban is ever wanted).
  await step('ip_bans', `
    CREATE TABLE IF NOT EXISTS ip_bans (
      id                BIGSERIAL PRIMARY KEY,
      ip                TEXT NOT NULL,
      reason            TEXT,
      auto              BOOLEAN NOT NULL DEFAULT FALSE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by        TEXT,
      expires_at        TIMESTAMPTZ,
      lifted_at         TIMESTAMPTZ,
      lifted_by         TEXT,
      lift_reason       TEXT,
      last_discord_id   TEXT,
      last_discord_name TEXT,
      strike_count      INTEGER NOT NULL DEFAULT 0
    )
  `)
  await step('idx_ip_bans_active', `CREATE INDEX IF NOT EXISTS idx_ip_bans_active ON ip_bans(ip) WHERE lifted_at IS NULL`)
  // security_strikes: one row per failed login. voided_at = cancelled by the outage guard.
  await step('security_strikes', `
    CREATE TABLE IF NOT EXISTS security_strikes (
      id           BIGSERIAL PRIMARY KEY,
      at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip           TEXT NOT NULL,
      kind         TEXT NOT NULL,
      path         TEXT,
      discord_id   TEXT,
      discord_name TEXT,
      device_id    TEXT,
      error_sig    TEXT,
      detail       TEXT,
      voided_at    TIMESTAMPTZ
    )
  `)
  await step('idx_security_strikes_ip', `CREATE INDEX IF NOT EXISTS idx_security_strikes_ip ON security_strikes(ip, at DESC)`)
  // security_devices: a first-party device cookie + a light browser fingerprint, and
  // every Discord account that has signed in from that device.
  await step('security_devices', `
    CREATE TABLE IF NOT EXISTS security_devices (
      device_id   TEXT PRIMARY KEY,
      fp_hash     TEXT,
      fingerprint JSONB,
      first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_ip     TEXT,
      discord_ids TEXT[] NOT NULL DEFAULT '{}'
    )
  `)
  // web_sessions: the registry behind "who is online", "log this person out" and
  // "log everyone out" (NextAuth JWTs are stateless on their own).
  await step('web_sessions', `
    CREATE TABLE IF NOT EXISTS web_sessions (
      sid            TEXT PRIMARY KEY,
      discord_id     TEXT NOT NULL,
      username       TEXT,
      display_name   TEXT,
      avatar_url     TEXT,
      email          TEXT,
      login_intent   TEXT,
      gate_passed    BOOLEAN NOT NULL DEFAULT FALSE,
      is_director    BOOLEAN NOT NULL DEFAULT FALSE,
      is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
      access_granted BOOLEAN NOT NULL DEFAULT FALSE,
      ip             TEXT,
      country        TEXT,
      city           TEXT,
      region         TEXT,
      isp            TEXT,
      user_agent     TEXT,
      browser        TEXT,
      os             TEXT,
      device_type    TEXT,
      device_id      TEXT,
      fp_hash        TEXT,
      guilds         JSONB,
      identity       JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_path      TEXT,
      revoked_at     TIMESTAMPTZ,
      revoked_by     TEXT,
      revoke_reason  TEXT
    )
  `)
  await step('idx_web_sessions_seen', `CREATE INDEX IF NOT EXISTS idx_web_sessions_seen ON web_sessions(last_seen_at DESC)`)
  await step('idx_web_sessions_user', `CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(discord_id)`)

  // The old two-surface log (`site_logs`, read by the now-deleted Logs tab and the
  // first higgenlogs build) is retired. Its rows were thin and unreadable — the
  // operator asked to start fresh on the schema above. Dropped LAST so the new
  // table is guaranteed to exist first. Note `site_logins` is a different table
  // and is deliberately untouched.
  await step('drop site_logs', `DROP TABLE IF EXISTS site_logs`)

  // Snapshot of who holds the admin-configured award roles (bot-refreshed).
  await step('award_role_holders', `
    CREATE TABLE IF NOT EXISTS award_role_holders (
      role_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (role_id, discord_id)
    )
  `)

  // Durable "last-known award roles per member" — survives a member leaving the
  // server so the bot can re-grant those roles on rejoin. Pruned only when staff
  // removes a role from an in-guild member (guildMemberUpdate); mirrors the bot's
  // ensureAwardMemoryTable() in Beluga Bot/src/utils/awardSync.js.
  await step('award_role_memory', `
    CREATE TABLE IF NOT EXISTS award_role_memory (
      role_id TEXT NOT NULL,
      discord_id TEXT NOT NULL,
      remembered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (role_id, discord_id)
    )
  `)

  // Homepage montage videos (YouTube links, admin-managed; max 2 shown).
  await step('site_montage', `
    CREATE TABLE IF NOT EXISTS site_montage (
      id SERIAL PRIMARY KEY,
      youtube_url TEXT NOT NULL,
      title TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // ---- New Ballchasing-based stats system (written by the bot; mirrored here so
  // website reads/admin never race the bot's boot). stats_game_players is the
  // source of truth; *_season/_lifetime are derived aggregates.
  await step('teams.slogan', `ALTER TABLE teams ADD COLUMN IF NOT EXISTS slogan TEXT`)
  await step('stats_player_accounts', `
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
  `)
  await step('stats_name_history', `
    CREATE TABLE IF NOT EXISTS stats_name_history (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      name TEXT,
      platform TEXT,
      platform_id TEXT,
      source TEXT NOT NULL DEFAULT 'ballchasing',
      observed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('stats_series', `
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
  `)
  await step('stats_games', `
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
  `)
  await step('stats_game_players', `
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
  `)
  await step('stats_player_season', `
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
  `)
  await step('stats_player_lifetime', `
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
  `)
  await step('stats_team_season', `
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
  `)
  await step('stats_audit_log', `
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
  `)

  // ---------- Ballchasing import queue ----------
  // Website-owned queue, drained by the bot (Beluga Bot/src/stats/seriesImportPoller.js).
  // Staff report a series by hand on the admin panel and attach a group link or one
  // replay link per game; the BOT holds the Ballchasing key, the rate limiter and the
  // parser, so it does the fetching and writes the real stats back.
  // Mirrored in Beluga Bot/src/stats/statsSchema.js — keep in sync.
  await step('stats_import_jobs', `
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
  `)
  await step('idx_stats_import_jobs', `CREATE INDEX IF NOT EXISTS idx_stats_import_jobs_status ON stats_import_jobs(status, requested_at)`)
  await step('idx_stats_import_jobs_series', `CREATE INDEX IF NOT EXISTS idx_stats_import_jobs_series ON stats_import_jobs(series_id, id DESC)`)

  // ---------- DM Center ----------
  // The website composes + queues a blast here; the BOT drains it (it owns the
  // Discord token). See Beluga Bot/src/dm/dmSender.js.
  await step('dm_jobs', `
    CREATE TABLE IF NOT EXISTS dm_jobs (
      id SERIAL PRIMARY KEY,
      created_by TEXT,
      created_by_name TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      targets JSONB NOT NULL DEFAULT '{}'::jsonb,
      include_default BOOLEAN NOT NULL DEFAULT TRUE,
      default_text TEXT,
      body TEXT NOT NULL,
      test_only BOOLEAN NOT NULL DEFAULT FALSE,
      total INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
      error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMP,
      finished_at TIMESTAMP
    )
  `)
  await step('idx_dm_jobs_status', `CREATE INDEX IF NOT EXISTS idx_dm_jobs_status ON dm_jobs(status, id)`)

  await step('dm_job_targets', `
    CREATE TABLE IF NOT EXISTS dm_job_targets (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES dm_jobs(id) ON DELETE CASCADE,
      discord_id TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      rendered TEXT,
      sent_at TIMESTAMP,
      UNIQUE (job_id, discord_id)
    )
  `)
  await step('idx_dm_job_targets_job', `CREATE INDEX IF NOT EXISTS idx_dm_job_targets_job ON dm_job_targets(job_id, status)`)

  // Bot-owned mirrors the DM Center reads (created here too so the website can
  // query them before the bot's first sync of a fresh DB).
  await step('discord_channels', `
    CREATE TABLE IF NOT EXISTS discord_channels (
      channel_id TEXT PRIMARY KEY,
      name TEXT,
      type INTEGER,
      parent_id TEXT,
      parent_name TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('discord_member_roles', `
    CREATE TABLE IF NOT EXISTS discord_member_roles (
      discord_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (discord_id, role_id)
    )
  `)
  await step('idx_discord_member_roles_role', `CREATE INDEX IF NOT EXISTS idx_discord_member_roles_role ON discord_member_roles(role_id)`)

  // ---------- DM inbox (two-way conversations with the bot) ----------
  // One row per person who has DMed the bot or been DMed by it.
  await step('dm_conversations', `
    CREATE TABLE IF NOT EXISTS dm_conversations (
      discord_id TEXT PRIMARY KEY,
      display_name TEXT,
      avatar_url TEXT,
      last_message_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_preview TEXT,
      last_direction TEXT,
      unread_count INTEGER NOT NULL DEFAULT 0,
      ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  await step('idx_dm_conversations_recent', `CREATE INDEX IF NOT EXISTS idx_dm_conversations_recent ON dm_conversations(last_message_at DESC)`)
  // Superseded by ai_personas below — the persona applies everywhere, not just
  // in DMs. Kept (never dropped) so an older bot build mid-deploy still reads.
  await step('dm_conversations.ai_mode', `
    ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS ai_mode TEXT NOT NULL DEFAULT 'professional'
  `)

  // ---------- AI persona, per PERSON ----------
  // Which voice the bot uses with someone: 'professional' (default, the same
  // voice it uses in the server) or 'unhinged' (roast mode). This is a property
  // of the PERSON, not of a DM thread — set someone to unhinged and they get
  // roasted in the server channels too.
  //
  // Separate from dm_conversations.ai_enabled on purpose: that one means "should
  // the bot auto-answer this person's DMs", which really is DM-only. Keeping the
  // persona here means staff can mark anyone unhinged without the side effect of
  // creating an empty, message-less conversation just to hold the flag.
  await step('ai_personas', `
    CREATE TABLE IF NOT EXISTS ai_personas (
      discord_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'professional',
      set_by TEXT,
      set_by_name TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  // Carry over anything already set while the persona lived on the conversation.
  await step('ai_personas.backfill', `
    INSERT INTO ai_personas (discord_id, mode)
    SELECT discord_id, ai_mode FROM dm_conversations
     WHERE ai_mode IS NOT NULL AND ai_mode <> 'professional'
    ON CONFLICT (discord_id) DO NOTHING
  `)

  // Every message either way. `status` only matters for outgoing rows: the
  // website inserts them as 'queued' and the bot flips them to 'sent'/'failed'.
  await step('dm_messages', `
    CREATE TABLE IF NOT EXISTS dm_messages (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      content TEXT,
      attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
      author_name TEXT,
      author_discord_id TEXT,
      source TEXT NOT NULL DEFAULT 'dm',
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT,
      discord_message_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP
    )
  `)
  await step('idx_dm_messages_convo', `CREATE INDEX IF NOT EXISTS idx_dm_messages_convo ON dm_messages(discord_id, id DESC)`)
  await step('idx_dm_messages_queued', `CREATE INDEX IF NOT EXISTS idx_dm_messages_queued ON dm_messages(status, id) WHERE direction = 'out'`)

  const elapsedMs = Date.now() - started
  lastReport = { ran, failed, elapsedMs, finishedAt: new Date().toISOString() }
  console.log(`[schema] migration complete in ${elapsedMs}ms — ${ran.length} ok, ${failed.length} failed`)
  if (failed.length > 0) {
    console.error('[schema] failed steps:', failed)
  }
}
