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

  const elapsedMs = Date.now() - started
  lastReport = { ran, failed, elapsedMs, finishedAt: new Date().toISOString() }
  console.log(`[schema] migration complete in ${elapsedMs}ms — ${ran.length} ok, ${failed.length} failed`)
  if (failed.length > 0) {
    console.error('[schema] failed steps:', failed)
  }
}
