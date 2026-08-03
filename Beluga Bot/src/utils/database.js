const { Pool } = require('pg');
const Logger = require('./logger');

// Check if DATABASE_URL is available
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
let isDatabaseAvailable = false;

// TLS config for the Postgres link. If DATABASE_CA_CERT (PEM contents) is provided we
// verify the server cert strictly (defeats MITM). Without it we fall back to relaxed
// verification because the prod connection is over Railway's PRIVATE network
// (postgres.railway.internal), whose self-signed cert can't be strictly verified
// without Railway's CA. Set DATABASE_CA_CERT to enable strict TLS.
function buildSslConfig() {
    const ca = process.env.DATABASE_CA_CERT;
    if (ca && ca.includes('BEGIN CERTIFICATE')) {
        return { ca, rejectUnauthorized: true };
    }
    return { rejectUnauthorized: false };
}

// Create PostgreSQL connection pool only if DATABASE_URL exists
if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: buildSslConfig()
    });
    isDatabaseAvailable = true;
    Logger.info('Database connection configured with DATABASE_URL');
} else {
    Logger.warning('DATABASE_URL not found - database features will be disabled');
    Logger.warning('To enable database: Add PostgreSQL to your Railway project');
}

// Initialize database tables
async function initializeDatabase() {
    if (!isDatabaseAvailable) {
        Logger.warning('Skipping database initialization - DATABASE_URL not configured');
        Logger.warning('Ticket system will not persist across restarts');
        return false;
    }

    try {
        // Test connection first
        await pool.query('SELECT NOW()');
        
        // Create tickets table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                channel_id VARCHAR(255) PRIMARY KEY,
                channel_name VARCHAR(255) NOT NULL,
                reason VARCHAR(100) NOT NULL,
                created_by VARCHAR(255) NOT NULL,
                created_by_username VARCHAR(255) NOT NULL,
                user_ids TEXT[] NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create birthdays table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS birthdays (
                user_id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                display_name VARCHAR(255) NOT NULL,
                month INTEGER NOT NULL,
                day INTEGER NOT NULL,
                year INTEGER,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create manual_salaries table if it doesn't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS manual_salaries (
                discord_id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                salary NUMERIC(10, 2) NOT NULL,
                set_by VARCHAR(255) NOT NULL,
                set_by_username VARCHAR(255) NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create salary_lock_notifications table for tracking sent notifications
        await pool.query(`
            CREATE TABLE IF NOT EXISTS salary_lock_notifications (
                discord_id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                locked_salary NUMERIC(10, 2) NOT NULL,
                expected_salary NUMERIC(10, 2) NOT NULL,
                notified_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Create roster_messages table for tracking roster embed message IDs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS roster_messages (
                team_name VARCHAR(255) NOT NULL,
                division VARCHAR(50) NOT NULL,
                channel_id VARCHAR(255) NOT NULL,
                message_id VARCHAR(255) NOT NULL,
                roster_hash TEXT,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (team_name, division)
            )
        `);

        // Migration: Add roster_hash column if it doesn't exist
        await pool.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'roster_messages' 
                    AND column_name = 'roster_hash'
                ) THEN
                    ALTER TABLE roster_messages ADD COLUMN roster_hash TEXT;
                END IF;
            END $$;
        `);

        // League tables used by the website admin panel
        await pool.query(`
            CREATE TABLE IF NOT EXISTS seasons (
                id SERIAL PRIMARY KEY,
                season_number INTEGER NOT NULL UNIQUE,
                name TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
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
        `);

        await pool.query(`
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
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS roster_syncs (
                id SERIAL PRIMARY KEY,
                season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
                division TEXT NOT NULL,
                synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_teams_season_division
            ON teams(season_id, division)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_roster_members_team
            ON team_roster_members(season_id, team_id)
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS schedule_matches (
                id SERIAL PRIMARY KEY,
                season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
                division TEXT NOT NULL,
                week INTEGER NOT NULL,
                home_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                away_team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'published',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS playoff_brackets (
                id SERIAL PRIMARY KEY,
                season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
                division TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'published',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
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
        `);

        await pool.query(`
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
        `);

        await pool.query(`
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
        `);

        await pool.query(`
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
        `);

        // team_esubs — one-day-sub (e-sub) usage, keyed by SEASON + TEAM row.
        // Teams are per (season, division, name), so this is inherently
        // per-division and resets itself every season: a new season means new
        // team ids, which means no rows, which means 0 used. Replaces the
        // "One Day Sub Tracker" Google sheet, whose header row had drifted out
        // of sync with the live team names so every read/write hit the wrong
        // column. Mirrored in the website's leagueSchema.js.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS team_esubs (
                season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
                team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                used INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_by TEXT,
                PRIMARY KEY (season_id, team_id)
            )
        `);

        // season_action_requests — website-owned queue for the director-gated
        // "Start New Season" / "Delete Season" flow. The website inserts a row
        // (status='pending_post'); the bot posts an approval embed to the director
        // channel, collects 3 Director ✅ reactions (any ❌ withdraws, 24h expiry),
        // then EXECUTES the archive+new-season / delete DB writes itself. Mirrored
        // in the website's leagueSchema.js.
        await pool.query(`
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
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_season_action_requests_status
            ON season_action_requests(status, created_at)
        `);

        // Full audit trail shared with the website (the hidden /higgenlogs page):
        // every interaction and every failure from both apps. Created here as well
        // as in the website's leagueSchema.js so whichever service deploys first can
        // start writing. Kept in sync with that file.
        await pool.query(`
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
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_higgen_logs_feed ON higgen_logs(source, stream, occurred_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_higgen_logs_time ON higgen_logs(occurred_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_higgen_logs_actor ON higgen_logs(actor_id, occurred_at DESC)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_higgen_logs_action ON higgen_logs(action)`);

        // New Ballchasing-based stats system schema (series, per-game rows,
        // player/team aggregates, identity map, report sessions, audit log).
        const { ensureStatsSchema } = require('../stats/statsSchema');
        await ensureStatsSchema(pool, Logger);

        Logger.success('Database tables initialized successfully');
        return true;
    } catch (error) {
        Logger.error('Failed to initialize database', error);
        Logger.warning('Continuing without database - tickets will not persist');
        isDatabaseAvailable = false;
        return false;
    }
}

// Ticket operations
const TicketDB = {
    // Get all active tickets
    async getAll() {
        if (!isDatabaseAvailable) return [];
        
        try {
            const result = await pool.query('SELECT * FROM tickets');
            return result.rows.map(row => ({
                channelId: row.channel_id,
                channelName: row.channel_name,
                reason: row.reason,
                createdBy: row.created_by,
                createdByUsername: row.created_by_username,
                userIds: row.user_ids,
                createdAt: row.created_at.toISOString()
            }));
        } catch (error) {
            Logger.error('Failed to get all tickets', error);
            return [];
        }
    },

    // Get ticket by channel ID
    async get(channelId) {
        if (!isDatabaseAvailable) return null;
        
        try {
            const result = await pool.query(
                'SELECT * FROM tickets WHERE channel_id = $1',
                [channelId]
            );
            
            if (result.rows.length === 0) return null;
            
            const row = result.rows[0];
            return {
                channelId: row.channel_id,
                channelName: row.channel_name,
                reason: row.reason,
                createdBy: row.created_by,
                createdByUsername: row.created_by_username,
                userIds: row.user_ids,
                createdAt: row.created_at.toISOString()
            };
        } catch (error) {
            Logger.error(`Failed to get ticket ${channelId}`, error);
            return null;
        }
    },

    // Create new ticket
    async create(ticketData) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - ticket will not persist');
            return;
        }
        
        try {
            // Coerce createdAt defensively: a missing/invalid value would become
            // `new Date(undefined)` = Invalid Date, which Postgres rejects with a
            // 22007 timestamp error and orphans the channel. Fall back to now().
            let createdAt = ticketData.createdAt ? new Date(ticketData.createdAt) : new Date();
            if (Number.isNaN(createdAt.getTime())) createdAt = new Date();
            await pool.query(
                `INSERT INTO tickets (channel_id, channel_name, reason, created_by, created_by_username, user_ids, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    ticketData.channelId,
                    ticketData.channelName,
                    ticketData.reason,
                    ticketData.createdBy,
                    ticketData.createdByUsername,
                    ticketData.userIds,
                    createdAt
                ]
            );
            Logger.info(`Created ticket in database: ${ticketData.channelName}`);
        } catch (error) {
            Logger.error('Failed to create ticket', error);
            throw error;
        }
    },

    // Update ticket (e.g., add/remove users)
    async update(channelId, ticketData) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - ticket changes will not persist');
            return;
        }
        
        try {
            await pool.query(
                `UPDATE tickets 
                 SET channel_name = $2, reason = $3, created_by = $4, 
                     created_by_username = $5, user_ids = $6
                 WHERE channel_id = $1`,
                [
                    channelId,
                    ticketData.channelName,
                    ticketData.reason,
                    ticketData.createdBy,
                    ticketData.createdByUsername,
                    ticketData.userIds
                ]
            );
            Logger.info(`Updated ticket in database: ${channelId}`);
        } catch (error) {
            Logger.error(`Failed to update ticket ${channelId}`, error);
            throw error;
        }
    },

    // Delete ticket
    async delete(channelId) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - ticket deletion will not persist');
            return;
        }
        
        try {
            await pool.query('DELETE FROM tickets WHERE channel_id = $1', [channelId]);
            Logger.info(`Deleted ticket from database: ${channelId}`);
        } catch (error) {
            Logger.error(`Failed to delete ticket ${channelId}`, error);
            throw error;
        }
    }
};

// Birthday operations
const BirthdayDB = {
    // Get all birthdays for a specific month and day
    async getByDate(month, day) {
        if (!isDatabaseAvailable) return [];
        
        try {
            const result = await pool.query(
                'SELECT * FROM birthdays WHERE month = $1 AND day = $2',
                [month, day]
            );
            return result.rows;
        } catch (error) {
            Logger.error('Failed to get birthdays by date', error);
            return [];
        }
    },

    // Get birthday for a specific user
    async get(userId) {
        if (!isDatabaseAvailable) return null;
        
        try {
            const result = await pool.query(
                'SELECT * FROM birthdays WHERE user_id = $1',
                [userId]
            );
            
            if (result.rows.length === 0) return null;
            return result.rows[0];
        } catch (error) {
            Logger.error(`Failed to get birthday for user ${userId}`, error);
            return null;
        }
    },

    // Save or update birthday
    async save(userId, username, displayName, month, day, year = null) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - birthday will not persist');
            return false;
        }
        
        try {
            // Check if birthday exists
            const existing = await this.get(userId);
            
            if (existing) {
                // Update existing
                await pool.query(
                    `UPDATE birthdays 
                     SET username = $2, display_name = $3, month = $4, day = $5, 
                         year = $6, updated_at = CURRENT_TIMESTAMP
                     WHERE user_id = $1`,
                    [userId, username, displayName, month, day, year]
                );
                Logger.info(`Updated birthday for ${username} (${userId})`);
            } else {
                // Insert new
                await pool.query(
                    `INSERT INTO birthdays (user_id, username, display_name, month, day, year)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [userId, username, displayName, month, day, year]
                );
                Logger.info(`Added birthday for ${username} (${userId})`);
            }
            return true;
        } catch (error) {
            Logger.error(`Failed to save birthday for ${username}`, error);
            return false;
        }
    },

    // Delete birthday
    async delete(userId) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - birthday deletion will not persist');
            return;
        }
        
        try {
            await pool.query('DELETE FROM birthdays WHERE user_id = $1', [userId]);
            Logger.info(`Deleted birthday from database: ${userId}`);
        } catch (error) {
            Logger.error(`Failed to delete birthday ${userId}`, error);
            throw error;
        }
    }
};

// Manual Salary operations
const ManualSalaryDB = {
    // Get all manual salary overrides
    async getAll() {
        if (!isDatabaseAvailable) return [];
        
        try {
            const result = await pool.query('SELECT * FROM manual_salaries');
            return result.rows;
        } catch (error) {
            Logger.error('Failed to get all manual salaries', error);
            return [];
        }
    },

    // Get manual salary for a specific user
    async get(discordId) {
        if (!isDatabaseAvailable) return null;
        
        try {
            const result = await pool.query(
                'SELECT * FROM manual_salaries WHERE discord_id = $1',
                [discordId]
            );
            
            if (result.rows.length === 0) return null;
            return result.rows[0];
        } catch (error) {
            Logger.error(`Failed to get manual salary for user ${discordId}`, error);
            return null;
        }
    },

    // Check if user has manual salary override
    async has(discordId) {
        if (!isDatabaseAvailable) return false;
        
        try {
            const result = await pool.query(
                'SELECT 1 FROM manual_salaries WHERE discord_id = $1',
                [discordId]
            );
            return result.rows.length > 0;
        } catch (error) {
            Logger.error(`Failed to check manual salary for user ${discordId}`, error);
            return false;
        }
    },

    // Set manual salary override
    async set(discordId, username, salary, setBy, setByUsername) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - manual salary will not persist');
            return false;
        }
        
        try {
            // Check if override exists
            const existing = await this.get(discordId);
            
            if (existing) {
                // Update existing
                await pool.query(
                    `UPDATE manual_salaries 
                     SET username = $2, salary = $3, set_by = $4, 
                         set_by_username = $5, updated_at = CURRENT_TIMESTAMP
                     WHERE discord_id = $1`,
                    [discordId, username, salary, setBy, setByUsername]
                );
                Logger.info(`Updated manual salary for ${username} (${discordId}) to ${salary}`);
            } else {
                // Insert new
                await pool.query(
                    `INSERT INTO manual_salaries (discord_id, username, salary, set_by, set_by_username)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [discordId, username, salary, setBy, setByUsername]
                );
                Logger.info(`Set manual salary for ${username} (${discordId}) to ${salary}`);
            }
            return true;
        } catch (error) {
            Logger.error(`Failed to set manual salary for ${username}`, error);
            return false;
        }
    },

    // Remove manual salary override
    async delete(discordId) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - manual salary deletion will not persist');
            return false;
        }
        
        try {
            const result = await pool.query(
                'DELETE FROM manual_salaries WHERE discord_id = $1 RETURNING *',
                [discordId]
            );
            
            if (result.rows.length > 0) {
                Logger.info(`Deleted manual salary override for user ${discordId}`);
                return true;
            }
            return false;
        } catch (error) {
            Logger.error(`Failed to delete manual salary ${discordId}`, error);
            return false;
        }
    }
};

// Salary Lock Notification operations
const SalaryLockNotificationDB = {
    // Get notification for a specific user
    async get(discordId) {
        if (!isDatabaseAvailable) return null;
        
        try {
            const result = await pool.query(
                'SELECT * FROM salary_lock_notifications WHERE discord_id = $1',
                [discordId]
            );
            
            if (result.rows.length === 0) return null;
            return result.rows[0];
        } catch (error) {
            Logger.error(`Failed to get salary lock notification for user ${discordId}`, error);
            return null;
        }
    },

    // Check if notification was already sent for this user with this expected salary
    async shouldNotify(discordId, expectedSalary) {
        if (!isDatabaseAvailable) return true; // Default to sending if DB unavailable
        
        try {
            const existing = await this.get(discordId);
            
            // No previous notification, should notify
            if (!existing) return true;
            
            // Different expected salary than before, should notify (new change)
            if (parseFloat(existing.expected_salary) !== parseFloat(expectedSalary)) {
                return true;
            }
            
            // Same expected salary as before, don't notify again
            return false;
        } catch (error) {
            Logger.error(`Failed to check notification status for user ${discordId}`, error);
            return true; // Default to sending on error
        }
    },

    // Record that a notification was sent
    async record(discordId, username, lockedSalary, expectedSalary) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - notification record will not persist');
            return false;
        }
        
        try {
            // Check if record exists
            const existing = await this.get(discordId);
            
            if (existing) {
                // Update existing record
                await pool.query(
                    `UPDATE salary_lock_notifications 
                     SET username = $2, locked_salary = $3, expected_salary = $4, 
                         notified_at = CURRENT_TIMESTAMP
                     WHERE discord_id = $1`,
                    [discordId, username, lockedSalary, expectedSalary]
                );
                Logger.info(`Updated salary lock notification record for ${username}`);
            } else {
                // Insert new record
                await pool.query(
                    `INSERT INTO salary_lock_notifications (discord_id, username, locked_salary, expected_salary)
                     VALUES ($1, $2, $3, $4)`,
                    [discordId, username, lockedSalary, expectedSalary]
                );
                Logger.info(`Created salary lock notification record for ${username}`);
            }
            return true;
        } catch (error) {
            Logger.error(`Failed to record salary lock notification for ${username}`, error);
            return false;
        }
    },

    // Delete notification record (e.g., when user is unlocked)
    async delete(discordId) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - notification deletion will not persist');
            return false;
        }
        
        try {
            const result = await pool.query(
                'DELETE FROM salary_lock_notifications WHERE discord_id = $1 RETURNING *',
                [discordId]
            );
            
            if (result.rows.length > 0) {
                Logger.info(`Deleted salary lock notification record for user ${discordId}`);
                return true;
            }
            return false;
        } catch (error) {
            Logger.error(`Failed to delete salary lock notification ${discordId}`, error);
            return false;
        }
    }
};

// Roster message operations
const RosterDB = {
    // Get roster message ID for a team and division
    async get(teamName, division) {
        if (!isDatabaseAvailable) return null;
        
        try {
            const result = await pool.query(
                'SELECT * FROM roster_messages WHERE team_name = $1 AND division = $2',
                [teamName, division]
            );
            
            if (result.rows.length === 0) return null;
            
            const row = result.rows[0];
            return {
                teamName: row.team_name,
                division: row.division,
                channelId: row.channel_id,
                messageId: row.message_id,
                rosterHash: row.roster_hash,
                updatedAt: row.updated_at
            };
        } catch (error) {
            Logger.error(`Failed to get roster message for ${teamName} ${division}`, error);
            return null;
        }
    },

    // Save or update roster message ID
    async save(teamName, division, channelId, messageId, rosterHash = null) {
        if (!isDatabaseAvailable) {
            Logger.warning('Database not available - roster message will not persist');
            return false;
        }
        
        try {
            await pool.query(
                `INSERT INTO roster_messages (team_name, division, channel_id, message_id, roster_hash, updated_at)
                 VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                 ON CONFLICT (team_name, division)
                 DO UPDATE SET channel_id = $3, message_id = $4, roster_hash = $5, updated_at = CURRENT_TIMESTAMP`,
                [teamName, division, channelId, messageId, rosterHash]
            );
            Logger.info(`Saved roster message for ${teamName} ${division}: ${messageId}`);
            return true;
        } catch (error) {
            Logger.error(`Failed to save roster message for ${teamName} ${division}`, error);
            return false;
        }
    },

    // Get all roster messages
    async getAll() {
        if (!isDatabaseAvailable) return [];
        
        try {
            const result = await pool.query('SELECT * FROM roster_messages ORDER BY team_name, division');
            return result.rows.map(row => ({
                teamName: row.team_name,
                division: row.division,
                channelId: row.channel_id,
                messageId: row.message_id,
                updatedAt: row.updated_at
            }));
        } catch (error) {
            Logger.error('Failed to get all roster messages', error);
            return [];
        }
    },

    // Delete roster message record
    async delete(teamName, division) {
        if (!isDatabaseAvailable) return false;
        
        try {
            await pool.query(
                'DELETE FROM roster_messages WHERE team_name = $1 AND division = $2',
                [teamName, division]
            );
            Logger.info(`Deleted roster message for ${teamName} ${division}`);
            return true;
        } catch (error) {
            Logger.error(`Failed to delete roster message for ${teamName} ${division}`, error);
            return false;
        }
    }
};

// League operations (shared with website admin)
const LeagueDB = {
    async getActiveSeason() {
        if (!isDatabaseAvailable) return null;

        try {
            const active = await pool.query(
                "SELECT * FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1"
            );
            if (active.rows.length > 0) return active.rows[0];

            const fallback = await pool.query('SELECT * FROM seasons ORDER BY season_number DESC LIMIT 1');
            return fallback.rows[0] || null;
        } catch (error) {
            Logger.error('Failed to get active season', error);
            return null;
        }
    },

    async getTeams(seasonId) {
        if (!isDatabaseAvailable) return [];

        try {
            const result = await pool.query(
                'SELECT id, name, division FROM teams WHERE season_id = $1 AND is_active = TRUE',
                [seasonId]
            );
            return result.rows;
        } catch (error) {
            Logger.error('Failed to get teams', error);
            return [];
        }
    },

    async getScheduleMatches({ seasonId = null, division = null, week = null } = {}) {
        if (!isDatabaseAvailable) return [];

        try {
            let resolvedSeasonId = seasonId;
            if (!resolvedSeasonId) {
                const season = await this.getActiveSeason();
                if (!season) return [];
                resolvedSeasonId = season.id;
            }

            const params = [resolvedSeasonId];
            let where = 'sm.season_id = $1 AND sm.is_published = TRUE';
            if (division) {
                params.push(division === 'MAJORS' ? 'Majors' : division);
                where += ` AND sm.division = $${params.length}`;
            }
            if (week != null) {
                params.push(week);
                where += ` AND sm.week = $${params.length}`;
            }

            const result = await pool.query(
                `SELECT sm.id, sm.week, sm.division, sm.match_order,
                    sm.home_team_id, sm.away_team_id,
                    ht.name AS home_team, at.name AS away_team
                 FROM schedule_matches sm
                 LEFT JOIN teams ht ON ht.id = sm.home_team_id
                 LEFT JOIN teams at ON at.id = sm.away_team_id
                 WHERE ${where}
                 ORDER BY sm.week, sm.division, sm.match_order, sm.id`,
                params
            );
            return result.rows;
        } catch (error) {
            Logger.error('Failed to get schedule matches', error);
            return [];
        }
    },

    async getTeamRosterLimit(division, teamName) {
        if (!isDatabaseAvailable) return null;

        const divisionLabel = division === 'MAJORS' ? 'Majors' : division;

        try {
            const season = await this.getActiveSeason();
            if (!season) return null;

            const result = await pool.query(
                'SELECT roster_limit FROM teams WHERE season_id = $1 AND division = $2 AND name = $3 AND is_active = TRUE',
                [season.id, divisionLabel, teamName]
            );
            if (!result.rows.length) return null;

            const value = Number(result.rows[0].roster_limit);
            return Number.isFinite(value) ? value : null;
        } catch (error) {
            Logger.error('Failed to get team roster limit', error);
            return null;
        }
    },

    async syncTeamRoster(seasonId, teamId, members) {
        if (!isDatabaseAvailable) return false;

        try {
            await pool.query(
                `UPDATE team_roster_members
                 SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
                 WHERE season_id = $1 AND team_id = $2`,
                [seasonId, teamId]
            );

            for (const member of members) {
                await pool.query(
                    `INSERT INTO team_roster_members (
                        season_id, team_id, discord_id, discord_username, display_name, role, is_active, updated_at
                     ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, CURRENT_TIMESTAMP)
                     ON CONFLICT (season_id, team_id, discord_id, role)
                     DO UPDATE SET discord_username = $4, display_name = $5, is_active = TRUE, updated_at = CURRENT_TIMESTAMP`,
                    [
                        seasonId,
                        teamId,
                        member.discordId,
                        member.discordUsername || null,
                        member.displayName || null,
                        member.role || 'player'
                    ]
                );
            }

            return true;
        } catch (error) {
            Logger.error('Failed to sync roster members', error);
            return false;
        }
    },

    async recordRosterSync(seasonId, division) {
        if (!isDatabaseAvailable) return false;

        try {
            await pool.query(
                'INSERT INTO roster_syncs (season_id, division) VALUES ($1, $2)',
                [seasonId, division]
            );
            return true;
        } catch (error) {
            Logger.error('Failed to record roster sync', error);
            return false;
        }
    }
};

// Test database connection
async function testConnection() {
    if (!isDatabaseAvailable) {
        Logger.warning('Database not configured');
        return false;
    }
    
    try {
        const result = await pool.query('SELECT NOW()');
        Logger.success('Database connection successful');
        return true;
    } catch (error) {
        Logger.error('Database connection failed', error);
        return false;
    }
}

/**
 * TransactionDB â€” bot-side helper to write to the shared `transactions` table
 * that the website's admin panel reads from. Always non-throwing so bot
 * commands never break on logging failures.
 *
 * Transaction types match those exported from the website's
 * `lib/transactionStore.js` TRANSACTION_TYPES constant.
 */
const TransactionDB = {
    async log({
        seasonId = null,
        discordId,
        discordUsername = null,
        displayName = null,
        teamId = null,
        teamNameSnapshot = null,
        franchiseId = null,
        pairedTeamId = null,
        pairedTeamNameSnapshot = null,
        type,
        details = {},
        performedByDiscordId = null,
        performedByUsername = null,
        source = 'bot',
    }) {
        if (!isDatabaseAvailable) return null;
        if (!discordId || !type) {
            Logger.warn(`TransactionDB.log skipped: missing discordId or type (got ${discordId}/${type})`);
            return null;
        }

        try {
            // Always stamp a readable name so the website's Transactions list never
            // shows a bare Discord ID ("Other"). Fall back to the discord_members
            // directory when the caller didn't pass one.
            let resolvedDisplayName = displayName;
            let resolvedUsername = discordUsername;
            if (!resolvedDisplayName || !resolvedUsername) {
                const m = await pool.query(
                    'SELECT display_name, username FROM discord_members WHERE discord_id = $1',
                    [String(discordId)]
                ).catch(() => ({ rows: [] }));
                if (m.rows.length) {
                    if (!resolvedDisplayName) resolvedDisplayName = m.rows[0].display_name || m.rows[0].username || null;
                    if (!resolvedUsername) resolvedUsername = m.rows[0].username || null;
                }
            }

            // Resolve team_name_snapshot if not provided.
            let resolvedTeamSnapshot = teamNameSnapshot;
            if (teamId && !resolvedTeamSnapshot) {
                const r = await pool.query('SELECT name FROM teams WHERE id = $1', [teamId]);
                if (r.rows.length) resolvedTeamSnapshot = r.rows[0].name;
            }
            let resolvedPairedSnapshot = pairedTeamNameSnapshot;
            if (pairedTeamId && !resolvedPairedSnapshot) {
                const r = await pool.query('SELECT name FROM teams WHERE id = $1', [pairedTeamId]);
                if (r.rows.length) resolvedPairedSnapshot = r.rows[0].name;
            }
            let resolvedFranchiseId = franchiseId;
            if (teamId && !resolvedFranchiseId) {
                const r = await pool.query('SELECT franchise_id FROM teams WHERE id = $1', [teamId]);
                if (r.rows.length) resolvedFranchiseId = r.rows[0].franchise_id;
            }

            // Auto-resolve seasonId if not given.
            let resolvedSeasonId = seasonId;
            if (!resolvedSeasonId) {
                const season = await LeagueDB.getActiveSeason();
                if (season) resolvedSeasonId = season.id;
            }

            const result = await pool.query(`
                INSERT INTO transactions (
                    season_id, discord_id, discord_username, display_name,
                    team_id, team_name_snapshot, franchise_id,
                    paired_team_id, paired_team_name_snapshot,
                    type, details, performed_by_discord_id, performed_by_username, source
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
                RETURNING id`,
                [
                    resolvedSeasonId,
                    String(discordId),
                    resolvedUsername,
                    resolvedDisplayName,
                    teamId,
                    resolvedTeamSnapshot,
                    resolvedFranchiseId,
                    pairedTeamId,
                    resolvedPairedSnapshot,
                    type,
                    JSON.stringify(details || {}),
                    performedByDiscordId,
                    performedByUsername,
                    source,
                ]
            );
            return result.rows[0].id;
        } catch (error) {
            Logger.error(`TransactionDB.log failed (type=${type}, discordId=${discordId})`, error);
            return null;
        }
    },

    /**
     * Helper: look up the team_id for (active season, team name) so callers
     * that only know names can still log transactions.
     */
    async findTeamIdByName(division, teamName) {
        if (!isDatabaseAvailable) return null;
        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) return null;
            const divisionLabel = division === 'MAJORS' ? 'Majors' : division;
            const r = await pool.query(
                `SELECT id FROM teams WHERE season_id = $1 AND division = $2 AND name = $3 AND is_active = TRUE LIMIT 1`,
                [season.id, divisionLabel, teamName]
            );
            return r.rows[0]?.id || null;
        } catch {
            return null;
        }
    },

    /**
     * Look up a Discord role ID for a team's role slot.
     * @param {string} division 'MAJORS' | 'AAA' | 'AA' (or DB form 'Majors'/'AAA'/'AA')
     * @param {string} teamName
     * @param {string} slot 'team' | 'gm' | 'captain' | 'np'
     * @returns {Promise<string|null>}
     */
    async findTeamRoleId(division, teamName, slot = 'team') {
        if (!isDatabaseAvailable) return null;
        try {
            const season = await LeagueDB.getActiveSeason();
            if (!season) return null;
            const divisionLabel = division === 'MAJORS' ? 'Majors' : division;
            const cols = {
                team: 'discord_role_id',
                gm: 'discord_gm_role_id',
                captain: 'discord_captain_role_id',
                np: 'discord_np_role_id',
            };
            const col = cols[slot] || 'discord_role_id';
            const r = await pool.query(
                `SELECT ${col} AS role_id FROM teams
                 WHERE season_id = $1 AND division = $2 AND name = $3 AND is_active = TRUE
                 LIMIT 1`,
                [season.id, divisionLabel, teamName]
            );
            return r.rows[0]?.role_id || null;
        } catch {
            return null;
        }
    },
};

module.exports = {
    pool,
    initializeDatabase,
    TicketDB,
    BirthdayDB,
    ManualSalaryDB,
    SalaryLockNotificationDB,
    RosterDB,
    LeagueDB,
    TransactionDB,
    testConnection,
    isDatabaseAvailable: () => isDatabaseAvailable
};
