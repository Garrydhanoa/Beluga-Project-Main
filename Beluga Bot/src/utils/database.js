const { Pool } = require('pg');
const Logger = require('./logger');

// Check if DATABASE_URL is available
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
let isDatabaseAvailable = false;

// Create PostgreSQL connection pool only if DATABASE_URL exists
if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
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
                    new Date(ticketData.createdAt)
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

module.exports = {
    pool,
    initializeDatabase,
    TicketDB,
    BirthdayDB,
    ManualSalaryDB,
    SalaryLockNotificationDB,
    RosterDB,
    testConnection,
    isDatabaseAvailable: () => isDatabaseAvailable
};
