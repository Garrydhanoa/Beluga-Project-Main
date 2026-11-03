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
  // Assistant GM role (S11): same bot powers as the GM role, one per franchise.
  await step('team_franchises.agm_role_id', `ALTER TABLE team_franchises ADD COLUMN IF NOT EXISTS agm_role_id TEXT`)

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

  // ---------- Invite campaign (MIRRORED in Beluga Bot/src/invites/inviteSchema.js) ----------
  // The bot tracks joins/registrations; this site's admin Invites tab records staff
  // decisions, tags, adjustments and settings. One invites row per invitee.
  await step('invite_campaigns', `CREATE TABLE IF NOT EXISTS invite_campaigns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    prize TEXT,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active',
    end_pinged_at TIMESTAMPTZ,
    final_top JSONB,
    created_by TEXT,
    ended_by TEXT
    )`)
  await step('uq_invite_campaigns_active', `CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_campaigns_active ON invite_campaigns ((status)) WHERE status = 'active'`)
  await step('invites', `CREATE TABLE IF NOT EXISTS invites (
    invitee_id TEXT PRIMARY KEY,
    joined_at TIMESTAMPTZ,
    left_at TIMESTAMPTZ,
    in_guild BOOLEAN NOT NULL DEFAULT TRUE,
    account_created_at TIMESTAMPTZ,
    pre_launch BOOLEAN NOT NULL DEFAULT FALSE,
    known_before BOOLEAN NOT NULL DEFAULT FALSE,
    join_count INTEGER NOT NULL DEFAULT 1,
    source_type TEXT NOT NULL DEFAULT 'unknown',
    invite_code TEXT,
    discord_inviter_id TEXT,
    diff_inviter_id TEXT,
    diff_code TEXT,
    diff_result TEXT,
    inviter_id TEXT,
    verified_via TEXT,
    verified_at TIMESTAMPTZ,
    flags TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'tracked',
    registered_at TIMESTAMPTZ,
    counted_at TIMESTAMPTZ,
    credited_campaign_id INTEGER,
    claimable_until TIMESTAMPTZ,
    notified_at TIMESTAMPTZ,
    claim_posted_at TIMESTAMPTZ,
    review_posted_at TIMESTAMPTZ,
    admin_locked BOOLEAN NOT NULL DEFAULT FALSE,
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_invites_inviter', `CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites (inviter_id, status)`)
  await step('idx_invites_status', `CREATE INDEX IF NOT EXISTS idx_invites_status ON invites (status)`)
  await step('invite_events', `CREATE TABLE IF NOT EXISTS invite_events (
    id BIGSERIAL PRIMARY KEY,
    invitee_id TEXT,
    inviter_id TEXT,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_invite_events_invitee', `CREATE INDEX IF NOT EXISTS idx_invite_events_invitee ON invite_events (invitee_id, created_at DESC)`)
  await step('idx_invite_events_inviter', `CREATE INDEX IF NOT EXISTS idx_invite_events_inviter ON invite_events (inviter_id, created_at DESC)`)
  await step('invite_claims', `CREATE TABLE IF NOT EXISTS invite_claims (
    id SERIAL PRIMARY KEY,
    invitee_id TEXT NOT NULL,
    claimer_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    note TEXT
    )`)
  await step('uq_invite_claims_one_pending', `CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_claims_one_pending ON invite_claims (claimer_id) WHERE status = 'pending'`)
  await step('idx_invite_claims_invitee', `CREATE INDEX IF NOT EXISTS idx_invite_claims_invitee ON invite_claims (invitee_id, status)`)
  await step('invite_adjustments', `CREATE TABLE IF NOT EXISTS invite_adjustments (
    id SERIAL PRIMARY KEY,
    inviter_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT 'both',
    campaign_id INTEGER,
    reason TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_invite_adjustments_inviter', `CREATE INDEX IF NOT EXISTS idx_invite_adjustments_inviter ON invite_adjustments (inviter_id)`)
  await step('invite_codes', `CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    inviter_id TEXT,
    inviter_is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    channel_id TEXT,
    uses INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER NOT NULL DEFAULT 0,
    temporary BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    is_vanity BOOLEAN NOT NULL DEFAULT FALSE,
    is_general BOOLEAN NOT NULL DEFAULT FALSE,
    label TEXT,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('invite_settings', `CREATE TABLE IF NOT EXISTS invite_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('invite_actions', `CREATE TABLE IF NOT EXISTS invite_actions (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    payload JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by_discord_id TEXT,
    requested_by_username TEXT,
    result TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at TIMESTAMPTZ
    )`)
  await step('idx_invite_actions_status', `CREATE INDEX IF NOT EXISTS idx_invite_actions_status ON invite_actions (status, id)`)
  await step('invite_campaigns.seed', `INSERT INTO invite_campaigns (name) SELECT 'Campaign 1' WHERE NOT EXISTS (SELECT 1 FROM invite_campaigns)`)

  // GM / AGM rulebook certification (S11). Link-only /gm-test + /agm-test, run
  // from the super-admin Tests tab in higgenlogs; the bot posts the staff notice,
  // tallies Salary Crew reactions and grants roles. MIRRORED in
  // Beluga Bot/src/certs/certSchema.js — keep the two in sync.
  await step('cert_questions', `CREATE TABLE IF NOT EXISTS cert_questions (
    id SERIAL PRIMARY KEY,
    prompt TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'mc',
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    correct_index INTEGER NOT NULL DEFAULT 0,
    rule_ref TEXT,
    for_gm BOOLEAN NOT NULL DEFAULT TRUE,
    for_agm BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('cert_attempts', `CREATE TABLE IF NOT EXISTS cert_attempts (
    id SERIAL PRIMARY KEY,
    season_id INTEGER,
    discord_id TEXT NOT NULL,
    username TEXT,
    test TEXT NOT NULL,
    franchise_id INTEGER,
    franchise_name TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score INTEGER,
    total INTEGER,
    pct NUMERIC(5,2),
    passed BOOLEAN,
    signature TEXT,
    acknowledged JSONB,
    ip TEXT,
    user_agent TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ
    )`)
  await step('idx_cert_attempts_person', `CREATE INDEX IF NOT EXISTS idx_cert_attempts_person ON cert_attempts (season_id, test, discord_id)`)
  await step('ux_cert_attempts_open', `CREATE UNIQUE INDEX IF NOT EXISTS ux_cert_attempts_open ON cert_attempts (season_id, test, discord_id) WHERE status = 'in_progress'`)
  await step('cert_requests', `CREATE TABLE IF NOT EXISTS cert_requests (
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER UNIQUE REFERENCES cert_attempts(id) ON DELETE CASCADE,
    season_id INTEGER,
    discord_id TEXT NOT NULL,
    username TEXT,
    test TEXT NOT NULL,
    franchise_id INTEGER,
    franchise_name TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    notice_channel_id TEXT,
    notice_message_id TEXT,
    notice_failed BOOLEAN NOT NULL DEFAULT FALSE,
    notice_synced BOOLEAN NOT NULL DEFAULT TRUE,
    crew_approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
    crew_denials JSONB NOT NULL DEFAULT '[]'::jsonb,
    decided_by TEXT,
    decided_by_name TEXT,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    roles_granted JSONB NOT NULL DEFAULT '[]'::jsonb,
    result TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_cert_requests_status', `CREATE INDEX IF NOT EXISTS idx_cert_requests_status ON cert_requests (status, id)`)
  await step('cert_grants', `CREATE TABLE IF NOT EXISTS cert_grants (
    id SERIAL PRIMARY KEY,
    season_id INTEGER,
    discord_id TEXT NOT NULL,
    test TEXT NOT NULL,
    extra INTEGER NOT NULL DEFAULT 1,
    reason TEXT,
    granted_by TEXT,
    granted_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('cert_retake_requests', `CREATE TABLE IF NOT EXISTS cert_retake_requests (
    id SERIAL PRIMARY KEY,
    season_id INTEGER,
    discord_id TEXT NOT NULL,
    username TEXT,
    test TEXT NOT NULL,
    attempt_id INTEGER,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    notice_channel_id TEXT,
    notice_message_id TEXT,
    notice_failed BOOLEAN NOT NULL DEFAULT FALSE,
    notice_synced BOOLEAN NOT NULL DEFAULT TRUE,
    resolved_by TEXT,
    resolved_by_name TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('cert_events', `CREATE TABLE IF NOT EXISTS cert_events (
    id BIGSERIAL PRIMARY KEY,
    season_id INTEGER,
    attempt_id INTEGER,
    discord_id TEXT,
    username TEXT,
    test TEXT,
    event TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '[]'::jsonb,
    ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_cert_events_recent', `CREATE INDEX IF NOT EXISTS idx_cert_events_recent ON cert_events (created_at DESC)`)
  await step('idx_cert_events_attempt', `CREATE INDEX IF NOT EXISTS idx_cert_events_attempt ON cert_events (attempt_id)`)

  // ---------- Beluga Insider (insider_*) ----------
  // MIRRORED from Beluga Bot/src/insider/insiderSchema.js. The bot builds packets and
  // posts issues; this site hands packets to the writer and takes its drafts.
  await step('insider_issues', `CREATE TABLE IF NOT EXISTS insider_issues (
    id SERIAL PRIMARY KEY,
    issue_date DATE NOT NULL UNIQUE,
    issue_number INTEGER,
    season_id INTEGER,
    week INTEGER,
    edition TEXT NOT NULL DEFAULT 'offseason',
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'collecting',
    packet JSONB,
    draft JSONB,
    final JSONB,
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    interview JSONB,
    rewrite_note TEXT,
    review_channel_id TEXT,
    review_message_id TEXT,
    review_thread_id TEXT,
    approved_by_id TEXT,
    approved_by_name TEXT,
    published_at TIMESTAMPTZ,
    published_message_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    header_png BYTEA,
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_insider_issues_status', `CREATE INDEX IF NOT EXISTS idx_insider_issues_status ON insider_issues (status, issue_date DESC)`)
  await step('idx_insider_issues_published', `CREATE INDEX IF NOT EXISTS idx_insider_issues_published ON insider_issues (published_at DESC)`)
  await step('insider_queries', `CREATE TABLE IF NOT EXISTS insider_queries (
    id BIGSERIAL PRIMARY KEY,
    issue_id INTEGER,
    sql TEXT NOT NULL,
    row_count INTEGER,
    result JSONB,
    took_ms INTEGER,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_insider_queries_issue', `CREATE INDEX IF NOT EXISTS idx_insider_queries_issue ON insider_queries (issue_id, created_at)`)
  await step('insider_edits', `CREATE TABLE IF NOT EXISTS insider_edits (
    id BIGSERIAL PRIMARY KEY,
    issue_id INTEGER NOT NULL,
    section TEXT,
    before TEXT,
    after TEXT,
    editor_id TEXT,
    editor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`)
  await step('idx_insider_edits_recent', `CREATE INDEX IF NOT EXISTS idx_insider_edits_recent ON insider_edits (created_at DESC)`)

  // ---------- Moderation (mod_*) ----------
  // MIRRORED from Beluga Bot/src/moderation/modSchema.js. The bot owns every Discord
  // side effect; the Mod Logs tab reads these and queues actions through mod_actions.
  await step('mod_cases', `CREATE TABLE IF NOT EXISTS mod_cases (
    id SERIAL PRIMARY KEY,
    discord_id TEXT NOT NULL,
    target_name TEXT,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    rule_code TEXT,
    rule_label TEXT,
    reason TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    source TEXT NOT NULL DEFAULT 'command',
    counts BOOLEAN NOT NULL DEFAULT TRUE,
    strike_number INTEGER,
    duration_seconds INTEGER,
    expires_at TIMESTAMPTZ,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    steps JSONB NOT NULL DEFAULT '{}'::jsonb,
    msg_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_id INTEGER,
    legacy_ref TEXT,
    voided_by_id TEXT,
    voided_by_name TEXT,
    void_reason TEXT,
    voided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_cases_person', `CREATE INDEX IF NOT EXISTS idx_mod_cases_person ON mod_cases (discord_id, created_at DESC)`)
  await step('idx_mod_cases_recent', `CREATE INDEX IF NOT EXISTS idx_mod_cases_recent ON mod_cases (created_at DESC)`)
  await step('idx_mod_cases_expiry', `CREATE INDEX IF NOT EXISTS idx_mod_cases_expiry ON mod_cases (status, expires_at)`)
  await step('ux_mod_cases_legacy', `CREATE UNIQUE INDEX IF NOT EXISTS ux_mod_cases_legacy ON mod_cases (legacy_ref) WHERE legacy_ref IS NOT NULL`)
  await step('ux_mod_cases_action', `CREATE UNIQUE INDEX IF NOT EXISTS ux_mod_cases_action ON mod_cases (action_id) WHERE action_id IS NOT NULL`)
  await step('mod_member_state', `CREATE TABLE IF NOT EXISTS mod_member_state (
    discord_id TEXT PRIMARY KEY,
    strikes INTEGER NOT NULL DEFAULT 0,
    warned_at TIMESTAMPTZ,
    last_chance BOOLEAN NOT NULL DEFAULT FALSE,
    legacy_strikes INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('mod_suspensions', `CREATE TABLE IF NOT EXISTS mod_suspensions (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    unit TEXT NOT NULL,
    total INTEGER,
    served INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    team_id INTEGER,
    team_name TEXT,
    division TEXT,
    season_id INTEGER,
    target_season_number INTEGER,
    sheet_synced BOOLEAN NOT NULL DEFAULT FALSE,
    release_state TEXT,
    review_season_id INTEGER,
    review_state TEXT,
    lifted_at TIMESTAMPTZ,
    lifted_by_id TEXT,
    lifted_by_name TEXT,
    lift_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_suspensions_active', `CREATE INDEX IF NOT EXISTS idx_mod_suspensions_active ON mod_suspensions (status, discord_id)`)
  await step('idx_mod_suspensions_person', `CREATE INDEX IF NOT EXISTS idx_mod_suspensions_person ON mod_suspensions (discord_id, created_at DESC)`)
  await step('mod_suspension_ledger', `CREATE TABLE IF NOT EXISTS mod_suspension_ledger (
    suspension_id INTEGER NOT NULL,
    series_id INTEGER NOT NULL,
    team_id INTEGER,
    counted BOOLEAN NOT NULL DEFAULT TRUE,
    reason TEXT,
    noted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (suspension_id, series_id)
  )`)
  await step('mod_thread_notices', `CREATE TABLE IF NOT EXISTS mod_thread_notices (
    suspension_id INTEGER NOT NULL,
    thread_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (suspension_id, thread_id, kind)
  )`)
  await step('mod_bans', `CREATE TABLE IF NOT EXISTS mod_bans (
    case_id INTEGER PRIMARY KEY,
    discord_id TEXT NOT NULL,
    ban_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    unban_at TIMESTAMPTZ,
    appeal_after TIMESTAMPTZ,
    dm_status TEXT,
    dm_error TEXT,
    invite_url TEXT,
    team_snapshot JSONB,
    unbanned_at TIMESTAMPTZ,
    unban_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_bans_person', `CREATE INDEX IF NOT EXISTS idx_mod_bans_person ON mod_bans (discord_id, created_at DESC)`)
  await step('idx_mod_bans_expiry', `CREATE INDEX IF NOT EXISTS idx_mod_bans_expiry ON mod_bans (status, unban_at)`)
  await step('mod_requests', `CREATE TABLE IF NOT EXISTS mod_requests (
    id SERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by_id TEXT,
    requested_by_name TEXT,
    channel_id TEXT,
    message_id TEXT,
    decided_by_id TEXT,
    decided_by_name TEXT,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_requests_status', `CREATE INDEX IF NOT EXISTS idx_mod_requests_status ON mod_requests (status, created_at DESC)`)
  await step('mod_appeals', `CREATE TABLE IF NOT EXISTS mod_appeals (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL UNIQUE,
    discord_id TEXT NOT NULL,
    discord_name TEXT,
    kind TEXT NOT NULL,
    answers JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'voting',
    vote_message_id TEXT,
    director_message_id TEXT,
    posted_at TIMESTAMPTZ,
    decided_by_id TEXT,
    decided_by_name TEXT,
    decision_note TEXT,
    decided_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    invite_shown_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_appeals_status', `CREATE INDEX IF NOT EXISTS idx_mod_appeals_status ON mod_appeals (status, created_at DESC)`)
  await step('idx_mod_appeals_person', `CREATE INDEX IF NOT EXISTS idx_mod_appeals_person ON mod_appeals (discord_id)`)
  await step('mod_appeal_votes', `CREATE TABLE IF NOT EXISTS mod_appeal_votes (
    appeal_id INTEGER NOT NULL,
    voter_id TEXT NOT NULL,
    voter_name TEXT,
    vote TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (appeal_id, voter_id)
  )`)
  await step('mod_evidence', `CREATE TABLE IF NOT EXISTS mod_evidence (
    id SERIAL PRIMARY KEY,
    case_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'file',
    filename TEXT,
    mime TEXT,
    size_bytes INTEGER,
    bytes BYTEA,
    text TEXT,
    source_message_id TEXT,
    added_by_id TEXT,
    added_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_evidence_case', `CREATE INDEX IF NOT EXISTS idx_mod_evidence_case ON mod_evidence (case_id)`)
  await step('mod_events', `CREATE TABLE IF NOT EXISTS mod_events (
    id BIGSERIAL PRIMARY KEY,
    discord_id TEXT,
    case_id INTEGER,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    actor_id TEXT,
    actor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_events_person', `CREATE INDEX IF NOT EXISTS idx_mod_events_person ON mod_events (discord_id, created_at DESC)`)
  await step('idx_mod_events_recent', `CREATE INDEX IF NOT EXISTS idx_mod_events_recent ON mod_events (created_at DESC)`)
  await step('mod_actions', `CREATE TABLE IF NOT EXISTS mod_actions (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    payload JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    requested_by_discord_id TEXT,
    requested_by_username TEXT,
    result TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at TIMESTAMPTZ
  )`)
  await step('idx_mod_actions_status', `CREATE INDEX IF NOT EXISTS idx_mod_actions_status ON mod_actions (status, id)`)
  await step('mod_settings', `CREATE TABLE IF NOT EXISTS mod_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('mod_words', `CREATE TABLE IF NOT EXISTS mod_words (
    id SERIAL PRIMARY KEY,
    word TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL DEFAULT 'slur',
    source TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    added_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('mod_allowlist', `CREATE TABLE IF NOT EXISTS mod_allowlist (
    id SERIAL PRIMARY KEY,
    phrase TEXT NOT NULL UNIQUE,
    added_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('mod_flags', `CREATE TABLE IF NOT EXISTS mod_flags (
    id SERIAL PRIMARY KEY,
    layer TEXT NOT NULL,
    message_id TEXT,
    channel_id TEXT,
    channel_name TEXT,
    author_id TEXT NOT NULL,
    author_name TEXT,
    content TEXT,
    matched TEXT,
    verdict JSONB,
    model TEXT,
    case_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    alert_message_id TEXT,
    reviewed_by_id TEXT,
    reviewed_by_name TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`)
  await step('idx_mod_flags_status', `CREATE INDEX IF NOT EXISTS idx_mod_flags_status ON mod_flags (status, created_at DESC)`)
  await step('idx_mod_flags_person', `CREATE INDEX IF NOT EXISTS idx_mod_flags_person ON mod_flags (author_id, created_at DESC)`)
  await step('ux_mod_flags_message', `CREATE UNIQUE INDEX IF NOT EXISTS ux_mod_flags_message ON mod_flags (layer, message_id) WHERE message_id IS NOT NULL`)
  await step('mod_ai_usage', `CREATE TABLE IF NOT EXISTS mod_ai_usage (
    day DATE NOT NULL,
    model TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, model)
  )`)
  await step('mod_claude_account', `CREATE TABLE IF NOT EXISTS mod_claude_account (
    id INTEGER PRIMARY KEY DEFAULT 1,
    balance_usd NUMERIC(12,6) NOT NULL DEFAULT 5,
    spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
    balance_set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    balance_set_by TEXT,
    state TEXT NOT NULL DEFAULT 'unknown',
    alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
    empty_since TIMESTAMPTZ,
    last_error TEXT
  )`)
  await step('mod_claude_account_row', `INSERT INTO mod_claude_account (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
  await step('mod_claude_account_day_key', `ALTER TABLE mod_claude_account ADD COLUMN IF NOT EXISTS day_key TEXT`)
  await step('mod_claude_account_day_spent', `ALTER TABLE mod_claude_account ADD COLUMN IF NOT EXISTS day_spent_usd NUMERIC(12,6) NOT NULL DEFAULT 0`)
  await step('mod_claude_account_day_alert', `ALTER TABLE mod_claude_account ADD COLUMN IF NOT EXISTS day_alert_sent BOOLEAN NOT NULL DEFAULT FALSE`)
  await step('mod_claude_usage', `CREATE TABLE IF NOT EXISTS mod_claude_usage (
    day DATE NOT NULL,
    purpose TEXT NOT NULL,
    model TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
    errors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, purpose, model)
  )`)
  await step('mod_identities', `CREATE TABLE IF NOT EXISTS mod_identities (
    id SERIAL PRIMARY KEY,
    discord_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    key TEXT NOT NULL,
    source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (discord_id, platform, key)
  )`)
  await step('idx_mod_identities_key', `CREATE INDEX IF NOT EXISTS idx_mod_identities_key ON mod_identities (platform, key)`)
  await step('mod_evasion_alerts', `CREATE TABLE IF NOT EXISTS mod_evasion_alerts (
    id SERIAL PRIMARY KEY,
    new_id TEXT NOT NULL,
    banned_id TEXT NOT NULL,
    key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    alert_message_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (new_id, banned_id, key)
  )`)
  await step('mod_staff_freezes', `CREATE TABLE IF NOT EXISTS mod_staff_freezes (
    id SERIAL PRIMARY KEY,
    staff_id TEXT NOT NULL,
    staff_name TEXT,
    reason TEXT,
    frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unfrozen_by_id TEXT,
    unfrozen_by_name TEXT,
    unfrozen_at TIMESTAMPTZ
  )`)
  await step('idx_mod_freezes_active', `CREATE INDEX IF NOT EXISTS idx_mod_freezes_active ON mod_staff_freezes (staff_id) WHERE unfrozen_at IS NULL`)
  await step('mod_ff_warnings', `CREATE TABLE IF NOT EXISTS mod_ff_warnings (
    season_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    forfeits INTEGER,
    case_id INTEGER,
    notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (season_id, team_id, level)
  )`)
  await step('invite_codes.is_moderation', `ALTER TABLE invite_codes ADD COLUMN IF NOT EXISTS is_moderation BOOLEAN NOT NULL DEFAULT FALSE`)

  const elapsedMs = Date.now() - started
  lastReport = { ran, failed, elapsedMs, finishedAt: new Date().toISOString() }
  console.log(`[schema] migration complete in ${elapsedMs}ms — ${ran.length} ok, ${failed.length} failed`)
  if (failed.length > 0) {
    console.error('[schema] failed steps:', failed)
  }
}
