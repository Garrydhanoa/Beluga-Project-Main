const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration } = require('discord.js');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, NP_ROLES } = require('../constants/roles');
const { pool, isDatabaseAvailable, LeagueDB } = require('../utils/database');

// Channel ID for match threads
const MATCHES_CHANNEL_ID = '1444621891275985037';

// In-memory set of known week-thread channel IDs, used to cheaply decide whether
// a message belongs in a thread transcript without a DB hit per message.
let knownThreadIds = new Set();

// In-flight guard so processPendingWeekThreads never overlaps itself (the cause
// of duplicate threads when a slow run ran past the next 60s tick).
let processingPending = false;

async function refreshKnownThreadIds() {
    if (!isDatabaseAvailable()) return;
    try {
        const r = await pool.query(`SELECT thread_id FROM week_threads WHERE thread_id IS NOT NULL`);
        knownThreadIds = new Set(r.rows.map((row) => String(row.thread_id)));
    } catch { /* table may not exist yet */ }
}

/**
 * Capture a message into thread_messages (the website's live thread transcript)
 * if it belongs to a tracked week thread. Mirrors the ticket transcript capture.
 */
async function captureThreadMessage(message) {
    if (!isDatabaseAvailable()) return;
    const channelId = message.channel?.id;
    if (!channelId || !knownThreadIds.has(String(channelId))) return;
    try {
        const author = message.author;
        const member = message.member;
        const avatar = author?.displayAvatarURL ? author.displayAvatarURL({ extension: 'png', size: 64 }) : null;
        const color = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null;
        const attachments = Array.from(message.attachments?.values?.() || []).map((a) => ({
            url: a.url, name: a.name, contentType: a.contentType || null,
        }));
        const embeds = (message.embeds || []).map((e) => ({ title: e.title || null, description: e.description || null }));
        await pool.query(`
            INSERT INTO thread_messages
              (thread_id, message_id, author_id, author_username, author_display, author_avatar, author_color, is_bot, content, attachments, embeds, message_created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
            ON CONFLICT (thread_id, message_id) DO UPDATE SET content = EXCLUDED.content
        `, [
            String(channelId), message.id, author?.id || null, author?.username || null,
            member?.displayName || author?.globalName || author?.username || null,
            avatar, color, !!author?.bot, message.content || '',
            JSON.stringify(attachments), JSON.stringify(embeds), message.createdAt || new Date(),
        ]);
    } catch (err) {
        if (err && err.code === '42P01') return; // table not created yet
        Logger.error('captureThreadMessage failed', err.message || err);
    }
}

// Channel ID for week thread transcripts
const WEEK_THREAD_TRANSCRIPT_CHANNEL_ID = '1452890665728868525';

/**
 * Message pointing staff to the saved week-thread transcript on the website
 * (replaces the old dpaste link). The transcript lives in thread_messages and is
 * rendered in the admin panel's Week Threads tab.
 */
function weekThreadTranscriptPointer() {
    const base = process.env.WEBSITE_URL || process.env.PUBLIC_WEBSITE_URL;
    if (base) {
        const link = `${base.replace(/\/$/, '')}/admin/dashboard/weeks`;
        return `📄 **This thread's transcript is available on the website**, with full thread info — view it under [Admin → Week Threads](${link}).`;
    }
    return '📄 **This thread\'s transcript is available on the website**, with full thread info — under the **Admin → Week Threads** tab.';
}

/**
 * Backfill the thread's recent messages into thread_messages (so nothing is lost
 * if a message slipped past live capture), then write a thread_archives header
 * row. Keeps the transcript + context on the website after the Discord thread is
 * deleted — mirrors how tickets are archived.
 */
async function archiveWeekThread(record, weekNumber, closedByUsername, thread) {
    if (!isDatabaseAvailable()) return;
    try {
        // 1) Backfill any messages that slipped past live capture.
        if (thread && typeof thread.messages?.fetch === 'function') {
            const fetched = await thread.messages.fetch({ limit: 100 }).catch(() => null);
            if (fetched) {
                const ordered = Array.from(fetched.values()).reverse();
                for (const msg of ordered) await captureThreadMessage(msg);
            }
        }

        // 2) Build the consolidated FINAL transcript snapshot from the live rows.
        const snapshot = await buildTranscriptSnapshot('thread_messages', 'thread_id', record.thread_id);

        // 3) Write the archive header + the frozen transcript snapshot.
        await pool.query(`
            INSERT INTO thread_archives (thread_id, season_id, week_number, division, team1, team2, match_number, closed_by_username, message_count, transcript)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
            ON CONFLICT (thread_id) DO UPDATE SET
                closed_by_username = EXCLUDED.closed_by_username,
                closed_at = CURRENT_TIMESTAMP,
                message_count = EXCLUDED.message_count,
                transcript = EXCLUDED.transcript
        `, [
            record.thread_id, record.season_id || null, weekNumber, record.division || null,
            record.team1 || null, record.team2 || null, record.match_number || null,
            closedByUsername || null, snapshot.length, JSON.stringify(snapshot),
        ]);

        // 4) Delete the live per-message rows — the snapshot is the kept transcript.
        await pool.query('DELETE FROM thread_messages WHERE thread_id = $1', [record.thread_id]).catch(() => {});
    } catch (err) {
        Logger.error('archiveWeekThread failed', err.message || err);
    }
}

/**
 * Read the live per-message rows for a ticket/thread and return them as a frozen
 * array of message objects (the same shape the website transcript viewer renders).
 * Used to snapshot the final transcript on close before the live rows are deleted.
 * @param {'thread_messages'|'ticket_messages'} table
 * @param {'thread_id'|'channel_id'} idCol
 * @param {string} id
 */
async function buildTranscriptSnapshot(table, idCol, id) {
    try {
        const r = await pool.query(
            `SELECT message_id, author_id, author_username, author_display, author_avatar,
                    author_color, is_bot, content, attachments, embeds, message_created_at
             FROM ${table} WHERE ${idCol} = $1
             ORDER BY message_created_at ASC, id ASC`,
            [id]
        );
        return r.rows.map((m) => ({
            messageId: m.message_id,
            authorId: m.author_id,
            authorUsername: m.author_username,
            authorDisplay: m.author_display || m.author_username,
            authorAvatar: m.author_avatar,
            authorColor: m.author_color,
            isBot: !!m.is_bot,
            content: m.content || '',
            attachments: m.attachments || [],
            embeds: m.embeds || [],
            createdAt: m.message_created_at,
        }));
    } catch {
        return [];
    }
}

// NOTE: the old hardcoded WEEK_START_DATES + timer-based scheduleAt auto-creation
// were removed. Auto-open is now DB-driven: the current week is computed from the
// active season's start_date and materialized from schedule_matches (see
// autoOpenCurrentWeek), feeding the single processPendingWeekThreads creation path.

/**
 * Initialize database table for week threads
 */
async function initializeWeekThreadsTable() {
    if (!isDatabaseAvailable()) {
        Logger.warning('Database not available - week threads will not persist');
        return false;
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS week_threads (
                id SERIAL PRIMARY KEY,
                week_number INTEGER NOT NULL,
                division VARCHAR(50) NOT NULL,
                team1 VARCHAR(255) NOT NULL,
                team2 VARCHAR(255) NOT NULL,
                thread_id VARCHAR(255),
                match_number INTEGER,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(week_number, division, team1, team2, match_number)
            )
        `);

        // The website materializes rows with NULL thread_id (it has no Discord
        // access). Drop legacy NOT NULL constraints so those inserts succeed.
        await pool.query(`ALTER TABLE week_threads ALTER COLUMN thread_id DROP NOT NULL`).catch(() => {});
        await pool.query(`ALTER TABLE week_threads ALTER COLUMN match_number DROP NOT NULL`).catch(() => {});

        // Columns shared with the website admin panel.
        await pool.query(`ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS season_id INTEGER`).catch(() => {});
        await pool.query(`ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS is_closed BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
        await pool.query(`ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP`).catch(() => {});
        // close_synced: bot sets TRUE after it has archived/unarchived the Discord
        // thread to match is_closed, so reconciliation doesn't re-process every cycle.
        await pool.query(`ALTER TABLE week_threads ADD COLUMN IF NOT EXISTS close_synced BOOLEAN NOT NULL DEFAULT TRUE`).catch(() => {});

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_week_threads_week
            ON week_threads(week_number)
        `);

        // thread_archives — header metadata for deleted week threads, mirroring the
        // website schema. Lets the website keep the transcript + context forever.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS thread_archives (
                thread_id TEXT PRIMARY KEY,
                season_id INTEGER,
                week_number INTEGER,
                division TEXT,
                team1 TEXT,
                team2 TEXT,
                match_number INTEGER,
                closed_by_username TEXT,
                closed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                message_count INTEGER NOT NULL DEFAULT 0,
                transcript JSONB
            )
        `).catch(() => {});
        await pool.query(`ALTER TABLE thread_archives ADD COLUMN IF NOT EXISTS transcript JSONB`).catch(() => {});

        // week_thread_actions — website-owned queue. The website "Delete week N"
        // inserts a row; the bot runs the same flow as /week-thread delete.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS week_thread_actions (
                id SERIAL PRIMARY KEY,
                action TEXT NOT NULL,
                season_id INTEGER,
                week_number INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                requested_by_discord_id TEXT,
                requested_by_username TEXT,
                result TEXT,
                requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fulfilled_at TIMESTAMP
            )
        `).catch(() => {});
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_week_thread_actions_status ON week_thread_actions(status, requested_at)`).catch(() => {});

        Logger.success('Week threads table initialized');
        return true;
    } catch (error) {
        Logger.error('Failed to initialize week threads table', error);
        return false;
    }
}

/**
 * Check if threads exist for a specific week
 */
async function weekThreadsExist(weekNumber) {
    if (!isDatabaseAvailable()) return false;

    try {
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM week_threads WHERE week_number = $1',
            [weekNumber]
        );
        return parseInt(result.rows[0].count) > 0;
    } catch (error) {
        Logger.error(`Failed to check week ${weekNumber} threads`, error);
        return false;
    }
}

/**
 * Save thread info to database
 */
async function saveThreadInfo(weekNumber, division, team1, team2, threadId, matchNumber) {
    if (!isDatabaseAvailable()) return false;

    try {
        await pool.query(
            `INSERT INTO week_threads (week_number, division, team1, team2, thread_id, match_number)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (week_number, division, team1, team2, match_number) 
             DO UPDATE SET thread_id = $5`,
            [weekNumber, division, team1, team2, threadId, matchNumber]
        );
        return true;
    } catch (error) {
        Logger.error(`Failed to save thread info for ${team1} vs ${team2}`, error);
        return false;
    }
}

/**
 * Get all thread IDs for a specific week
 */
async function getWeekThreadIds(weekNumber) {
    if (!isDatabaseAvailable()) return [];

    try {
        const result = await pool.query(
            'SELECT thread_id, division, team1, team2, match_number, season_id FROM week_threads WHERE week_number = $1',
            [weekNumber]
        );
        return result.rows;
    } catch (error) {
        Logger.error(`Failed to get week ${weekNumber} thread IDs`, error);
        return [];
    }
}

/**
 * Delete thread records for a specific week
 */
async function deleteWeekThreadRecords(weekNumber) {
    if (!isDatabaseAvailable()) return false;

    try {
        await pool.query(
            'DELETE FROM week_threads WHERE week_number = $1',
            [weekNumber]
        );
        return true;
    } catch (error) {
        Logger.error(`Failed to delete week ${weekNumber} thread records`, error);
        return false;
    }
}

// NOTE: the dpaste uploader + HTML transcript generator were removed. Transcripts
// now live on the website (thread_messages while open → a consolidated snapshot in
// thread_archives.transcript on close); the bot no longer renders or uploads HTML.

/**
 * Create a private thread for a match
 */
async function createMatchThread(channel, weekNumber, matchNumber, team1, team2, division, guild) {
    try {
        // Resolve role IDs DB-FIRST (teams.discord_* columns for this season),
        // falling back to the hardcoded constants only when a team isn't in the DB.
        const dbDiv = division === 'MAJORS' ? 'Majors' : division;
        const dbRoles = {}; // teamName -> { team, gm, captain, np }
        if (isDatabaseAvailable()) {
            const r = await pool.query(
                `SELECT name, discord_role_id, discord_gm_role_id, discord_captain_role_id, discord_np_role_id
                 FROM teams WHERE division = $1 AND name = ANY($2::text[])`,
                [dbDiv, [team1, team2]]
            ).catch(() => ({ rows: [] }));
            for (const row of r.rows) {
                dbRoles[row.name] = {
                    team: row.discord_role_id || null,
                    gm: row.discord_gm_role_id || null,
                    captain: row.discord_captain_role_id || null,
                    np: row.discord_np_role_id || null,
                };
            }
        }
        const roleFor = (team, slot, constantVal) => (dbRoles[team] && dbRoles[team][slot]) || constantVal || null;

        const team1RoleId = roleFor(team1, 'team', TEAM_ROLES[division]?.[team1]);
        const team2RoleId = roleFor(team2, 'team', TEAM_ROLES[division]?.[team2]);

        if (!team1RoleId || !team2RoleId) {
            Logger.warning(`Could not find roles for ${team1} or ${team2} in ${division} (checked DB + constants)`);
            return null;
        }

        // Create the thread name with division at the front
        const threadName = `Week ${weekNumber}: ${division}: ${team1} vs ${team2}`;
        
        // Create private thread with invites disabled
        const thread = await channel.threads.create({
            name: threadName,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
            type: ChannelType.PrivateThread,
            invitable: false, // Disable "anyone can invite" 
            reason: `Week ${weekNumber} match thread for ${team1} vs ${team2} in ${division}`
        });

        // ========================================
        // STEP 1: Add GMs to thread
        // GMs should be in ALL their team's division threads
        // ========================================
        const team1GMRoleId = roleFor(team1, 'gm', ROLES.GM_ROLES[team1]);
        const team2GMRoleId = roleFor(team2, 'gm', ROLES.GM_ROLES[team2]);

        const gmsToAdd = new Set();
        
        if (team1GMRoleId) {
            const team1GMRole = await guild.roles.fetch(team1GMRoleId).catch(() => null);
            if (team1GMRole) {
                team1GMRole.members.forEach(member => gmsToAdd.add(member.id));
            }
        }
        
        if (team2GMRoleId) {
            const team2GMRole = await guild.roles.fetch(team2GMRoleId).catch(() => null);
            if (team2GMRole) {
                team2GMRole.members.forEach(member => gmsToAdd.add(member.id));
            }
        }
        
        // Add all GMs to thread
        for (const gmId of gmsToAdd) {
            try {
                await thread.members.add(gmId);
                Logger.debug(`Added GM ${gmId} to thread`);
            } catch (error) {
                // Silently ignore
            }
        }

        // ========================================
        // STEP 2: Add Captains to thread
        // Captains are added based on:
        // - They have the captain role for THIS division
        // - They have a team role (any division) OR NP role for team1 or team2
        // ========================================
        const captainRoleId = ROLES.CAPTAINS[division];
        
        if (captainRoleId) {
            const captainRole = await guild.roles.fetch(captainRoleId).catch(() => null);
            
            if (captainRole) {
                // Get NP role IDs for both teams (DB-first, constant fallback)
                const team1NPRoleId = roleFor(team1, 'np', NP_ROLES[team1]);
                const team2NPRoleId = roleFor(team2, 'np', NP_ROLES[team2]);
                
                // Get all team role IDs for team1 and team2 across ALL divisions
                const team1AllRoleIds = new Set();
                const team2AllRoleIds = new Set();
                
                // Add division team roles
                for (const div of ['MAJORS', 'AAA', 'AA']) {
                    if (TEAM_ROLES[div]?.[team1]) team1AllRoleIds.add(TEAM_ROLES[div][team1]);
                    if (TEAM_ROLES[div]?.[team2]) team2AllRoleIds.add(TEAM_ROLES[div][team2]);
                }
                
                // Add NP roles
                if (team1NPRoleId) team1AllRoleIds.add(team1NPRoleId);
                if (team2NPRoleId) team2AllRoleIds.add(team2NPRoleId);
                
                // Check each captain
                for (const [memberId, member] of captainRole.members) {
                    // Check if this captain has any role for team1 or team2
                    const isTeam1 = [...team1AllRoleIds].some(roleId => member.roles.cache.has(roleId));
                    const isTeam2 = [...team2AllRoleIds].some(roleId => member.roles.cache.has(roleId));
                    
                    if (isTeam1 || isTeam2) {
                        try {
                            await thread.members.add(memberId);
                            Logger.debug(`Added captain ${member.user.tag} to thread (${isTeam1 ? team1 : team2})`);
                        } catch (error) {
                            // Silently ignore
                        }
                    }
                }
            }
        }

        // NOTE: Captain roles intentionally stay the FIXED per-division constants
        // (ROLES.CAPTAINS) — only team, GM, and NP role IDs are pulled from the DB.

        // ========================================
        // STEP 3: Send opening message with team role pings
        // This will automatically add all players with those roles
        // ========================================
        const openingEmbed = new EmbedBuilder()
            .setTitle(`Week ${weekNumber} Match Thread`)
            .setDescription(`**${team1}** vs **${team2}**\n\n**Division:** ${division}\n**Week:** ${weekNumber}\n**Match:** ${matchNumber}`)
            .addFields(
                { 
                    name: 'Thread Rules', 
                    value: '• Use this thread for scheduling your match\n• Discuss match times, maps, and any issues\n• In case of a forfeit (FF), this thread will be examined\n• Be respectful to your opponents', 
                    inline: false 
                }
            )
            .setColor(0x3498DB)
            .setTimestamp()
            .setFooter({ text: `${division} Division` });

        await thread.send({
            content: `<@&${team1RoleId}> vs <@&${team2RoleId}>\n\n**This is your private match scheduling thread.** Anything related to scheduling should be discussed here. In case of an FF, this thread will be examined.`,
            embeds: [openingEmbed]
        });

        Logger.success(`Created thread: ${threadName}`);
        return thread;
        
    } catch (error) {
        Logger.error(`Failed to create thread for ${team1} vs ${team2}`, error);
        return null;
    }
}

/**
 * Materialize week_threads ROWS for a week from the DB schedule (schedule_matches)
 * for a given season. This is the SINGLE source of week threads: it inserts rows
 * with thread_id = NULL (deduped by matchup) which processPendingWeekThreads then
 * turns into Discord threads. No Discord work happens here.
 * @returns {Promise<number>} rows inserted
 */
async function materializeWeekFromDb(seasonId, weekNumber) {
    if (!isDatabaseAvailable() || !seasonId) return 0;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const matches = await client.query(`
            SELECT sm.division, ht.name AS home, at.name AS away, sm.match_order
            FROM schedule_matches sm
            LEFT JOIN teams ht ON ht.id = sm.home_team_id
            LEFT JOIN teams at ON at.id = sm.away_team_id
            WHERE sm.season_id = $1 AND sm.week = $2 AND sm.is_published = TRUE
            ORDER BY sm.division, sm.match_order, sm.id
        `, [seasonId, weekNumber]);

        let inserted = 0;
        const perDiv = {};
        for (const m of matches.rows) {
            if (!m.home || !m.away) continue;
            perDiv[m.division] = (perDiv[m.division] || 0) + 1;
            // Skip if a row for this matchup already exists (either orientation).
            const dup = await client.query(`
                SELECT 1 FROM week_threads
                WHERE season_id = $1 AND week_number = $2 AND division = $3
                  AND ((team1 = $4 AND team2 = $5) OR (team1 = $5 AND team2 = $4))
                LIMIT 1
            `, [seasonId, weekNumber, m.division, m.home, m.away]);
            if (dup.rows.length) continue;

            await client.query(`
                INSERT INTO week_threads (week_number, division, team1, team2, season_id, match_number)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [weekNumber, m.division, m.home, m.away, seasonId, perDiv[m.division]]);
            inserted += 1;
        }
        await client.query('COMMIT');
        return inserted;
    } catch (err) {
        await client.query('ROLLBACK');
        Logger.error(`materializeWeekFromDb failed (season ${seasonId} week ${weekNumber})`, err);
        return 0;
    } finally {
        client.release();
    }
}

let lastAutoOpenCheck = 0;
const AUTO_OPEN_INTERVAL_MS = 30 * 60 * 1000; // re-check at most every 30 min

/**
 * DB-driven auto-open: compute the current week from the active season's
 * start_date and materialize that week's rows from the DB schedule if they don't
 * exist yet. processPendingWeekThreads then creates the Discord threads. Replaces
 * the old hardcoded-date timer.
 */
async function autoOpenCurrentWeek(client) {
    if (!isDatabaseAvailable()) return;
    const now = Date.now();
    if (now - lastAutoOpenCheck < AUTO_OPEN_INTERVAL_MS) return;
    lastAutoOpenCheck = now;

    try {
        const season = await LeagueDB.getActiveSeason();
        if (!season || !season.start_date) return;

        // Week number from start_date (UTC, matches the website's computeWeekNumber).
        const start = new Date(season.start_date);
        const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        const ref = new Date();
        const refUTC = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
        const diffMs = refUTC - startUTC;
        if (diffMs < 0) return; // season hasn't started
        const currentWeek = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
        if (currentWeek < 1) return;

        // Only materialize if this week has no rows yet for this season.
        const existing = await pool.query(
            `SELECT 1 FROM week_threads WHERE season_id = $1 AND week_number = $2 LIMIT 1`,
            [season.id, currentWeek]
        );
        if (existing.rows.length) return;

        const inserted = await materializeWeekFromDb(season.id, currentWeek);
        if (inserted > 0) {
            Logger.success(`Auto-opened Week ${currentWeek} (season ${season.season_number}) — materialized ${inserted} matchup(s) from the DB schedule`);
        }
    } catch (err) {
        Logger.error('autoOpenCurrentWeek failed', err);
    }
}

/**
 * Delete all threads for a specific week (with transcript saving)
 */
async function deleteWeekThreads(guild, weekNumber, client, closedByUsername = 'Salary Crew') {
    // Check database availability first
    if (!isDatabaseAvailable()) {
        Logger.error('Database not available - cannot delete week threads');
        return { success: false, error: 'Database not available. Cannot determine which threads to delete.' };
    }

    const threadRecords = await getWeekThreadIds(weekNumber);
    
    if (threadRecords.length === 0) {
        return { success: false, error: `No threads found for Week ${weekNumber}.` };
    }

    // Get transcript channel
    const transcriptChannel = await client.channels.fetch(WEEK_THREAD_TRANSCRIPT_CHANNEL_ID).catch(() => null);

    let deletedCount = 0;
    let failedCount = 0;
    let transcriptCount = 0;

    for (const record of threadRecords) {
        try {
            const thread = await client.channels.fetch(record.thread_id).catch(() => null);
            if (thread) {
                // Save the transcript on the website (thread_messages mirror +
                // thread_archives header) BEFORE deleting the Discord thread.
                try {
                    await archiveWeekThread(record, weekNumber, closedByUsername, thread);
                    transcriptCount++;
                } catch (archiveError) {
                    Logger.error(`Failed to archive transcript for ${record.team1} vs ${record.team2}`, archiveError);
                }

                // Post a pointer to the website transcript (no more dpaste link).
                if (transcriptChannel) {
                    const transcriptEmbed = new EmbedBuilder()
                        .setTitle(`🧵 Week ${weekNumber} Thread Closed: ${record.division}`)
                        .setDescription(`**${record.team1}** vs **${record.team2}**\n\n${weekThreadTranscriptPointer()}`)
                        .addFields(
                            { name: 'Division', value: record.division, inline: true },
                            { name: 'Week', value: `${weekNumber}`, inline: true },
                            { name: 'Archived', value: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }), inline: true }
                        )
                        .setColor(0x3498DB)
                        .setTimestamp();
                    await transcriptChannel.send({ embeds: [transcriptEmbed] }).catch(() => {});
                }

                await thread.delete(`Week ${weekNumber} thread cleanup`);
                deletedCount++;
            } else {
                // Thread doesn't exist anymore, still archive the header so the
                // website keeps the transcript, then count as handled.
                await archiveWeekThread(record, weekNumber, closedByUsername, null).catch(() => {});
                deletedCount++;
            }
        } catch (error) {
            Logger.error(`Failed to delete thread ${record.thread_id}`, error);
            failedCount++;
        }
        
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Delete records from database
    await deleteWeekThreadRecords(weekNumber);

    Logger.success(`Deleted ${deletedCount} threads for Week ${weekNumber} (${failedCount} failed, ${transcriptCount} transcripts saved)`);
    return { success: true, deletedCount, failedCount, transcriptCount };
}

/**
 * Scan `week_threads` for rows with thread_id IS NULL (materialized by the
 * website but not yet posted to Discord) and create the Discord threads.
 *
 * The website's admin panel writes rows into `week_threads` when an admin
 * clicks "Materialize Week N". This function picks those up on a polling
 * interval and creates the corresponding Discord threads, then updates each
 * row with the resulting thread_id so subsequent runs skip them.
 */
async function processPendingWeekThreads(client) {
    if (!isDatabaseAvailable()) return { processed: 0, errors: [] };

    // CONCURRENCY GUARD: thread creation is slow (≈1s each), so a long run could
    // overlap the next 60s tick and BOTH create the same still-NULL rows — the
    // root cause of duplicate threads. This in-flight lock makes runs serialize.
    if (processingPending) return { processed: 0, errors: ['already running'] };
    processingPending = true;
    try {

    let rows;
    try {
        const r = await pool.query(`
            SELECT id, week_number, division, team1, team2, match_number, season_id
            FROM week_threads
            WHERE thread_id IS NULL AND is_closed = FALSE
            ORDER BY week_number, division, COALESCE(match_number, 0), id
        `);
        rows = r.rows;
    } catch (err) {
        Logger.error('processPendingWeekThreads: query failed', err);
        return { processed: 0, errors: [err.message] };
    }

    if (rows.length === 0) return { processed: 0, errors: [] };

    Logger.info(`processPendingWeekThreads: ${rows.length} pending thread(s) to create`);

    let channel;
    try {
        channel = await client.channels.fetch(MATCHES_CHANNEL_ID);
    } catch (err) {
        Logger.error('processPendingWeekThreads: matches channel fetch failed', err);
        return { processed: 0, errors: ['matches channel not found'] };
    }

    const guild = client.guilds.cache.first();
    if (!guild) return { processed: 0, errors: ['no guild'] };

    let processed = 0;
    const errors = [];

    for (const row of rows) {
        // Normalize division to bot's expected form.
        const div = row.division === 'Majors' ? 'MAJORS' : row.division;
        const matchNum = row.match_number || 1;

        try {
            const thread = await createMatchThread(channel, row.week_number, matchNum, row.team1, row.team2, div, guild);
            if (!thread) {
                errors.push(`row ${row.id} (${row.team1} vs ${row.team2}): createMatchThread returned null`);
                continue;
            }

            // Update the existing row by id (not the saveThreadInfo upsert, since
            // we want to keep the website-side row intact including season_id).
            await pool.query(
                `UPDATE week_threads SET thread_id = $1 WHERE id = $2`,
                [thread.id, row.id]
            );
            // Track the new thread id immediately so its messages are captured
            // into the live transcript without waiting for the next 60s refresh.
            knownThreadIds.add(String(thread.id));
            processed += 1;

            // Avoid rate limit between thread creations.
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
            Logger.error(`processPendingWeekThreads: failed for row ${row.id}`, err);
            errors.push(`row ${row.id}: ${err.message}`);
        }
    }

    if (processed > 0) Logger.success(`processPendingWeekThreads: created ${processed} thread(s)`);
    return { processed, errors };

    } finally {
        processingPending = false;
    }
}

/**
 * Reconcile the archived/locked state of Discord threads with the website's
 * `is_closed` flag. Rows where close_synced = FALSE need action:
 *   - is_closed = TRUE  → archive + lock the Discord thread
 *   - is_closed = FALSE → unarchive + unlock (re-open)
 * Then set close_synced = TRUE so we don't re-process every cycle.
 */
async function reconcileWeekThreadClosures(client) {
    if (!isDatabaseAvailable()) return { closed: 0, reopened: 0 };

    let rows;
    try {
        const r = await pool.query(`
            SELECT id, thread_id, is_closed
            FROM week_threads
            WHERE close_synced = FALSE AND thread_id IS NOT NULL
            ORDER BY id
        `);
        rows = r.rows;
    } catch (err) {
        // close_synced column may not exist yet on a very old table; ignore.
        return { closed: 0, reopened: 0 };
    }

    if (!rows.length) return { closed: 0, reopened: 0 };

    let closed = 0;
    let reopened = 0;

    for (const row of rows) {
        try {
            const thread = await client.channels.fetch(row.thread_id).catch(() => null);
            if (!thread) {
                // Thread is gone; mark synced so we stop trying.
                await pool.query(`UPDATE week_threads SET close_synced = TRUE WHERE id = $1`, [row.id]);
                continue;
            }
            if (row.is_closed) {
                // Archive (and lock) to "close" the thread.
                if (typeof thread.setLocked === 'function') await thread.setLocked(true).catch(() => {});
                if (typeof thread.setArchived === 'function') await thread.setArchived(true).catch(() => {});
                closed += 1;
            } else {
                // Re-open: unarchive first, then unlock.
                if (typeof thread.setArchived === 'function') await thread.setArchived(false).catch(() => {});
                if (typeof thread.setLocked === 'function') await thread.setLocked(false).catch(() => {});
                reopened += 1;
            }
            await pool.query(`UPDATE week_threads SET close_synced = TRUE WHERE id = $1`, [row.id]);
            await new Promise(resolve => setTimeout(resolve, 400));
        } catch (err) {
            Logger.error(`reconcileWeekThreadClosures: failed for row ${row.id}`, err);
        }
    }

    if (closed || reopened) Logger.success(`Week-thread closures reconciled: ${closed} closed, ${reopened} reopened`);
    return { closed, reopened };
}

/**
 * Process website-queued week-thread actions (week_thread_actions). Currently
 * supports action='delete', which runs the SAME flow as /week-thread delete:
 * saves each thread's transcript on the website + deletes the Discord thread(s).
 */
async function processWeekThreadActions(client) {
    if (!isDatabaseAvailable()) return;
    let rows;
    try {
        const r = await pool.query(`
            SELECT id, action, week_number, requested_by_username
            FROM week_thread_actions
            WHERE status = 'pending'
            ORDER BY requested_at
            LIMIT 10
        `);
        rows = r.rows;
    } catch {
        return; // table may not exist yet
    }
    if (!rows.length) return;

    const guild = client.guilds.cache.first();
    for (const row of rows) {
        try {
            if (row.action !== 'delete') {
                await pool.query(
                    `UPDATE week_thread_actions SET status = 'failed', result = $2, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [row.id, `unknown action ${row.action}`]
                );
                continue;
            }
            const result = await deleteWeekThreads(guild, row.week_number, client, row.requested_by_username || 'Website Admin');
            await pool.query(
                `UPDATE week_thread_actions SET status = $2, result = $3, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [
                    row.id,
                    result.success ? 'fulfilled' : 'failed',
                    result.success ? `deleted ${result.deletedCount}, ${result.transcriptCount} transcripts saved` : (result.error || 'failed'),
                ]
            );
        } catch (err) {
            Logger.error(`processWeekThreadActions failed for action ${row.id}`, err);
            await pool.query(
                `UPDATE week_thread_actions SET status = 'failed', result = $2, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [row.id, err.message || 'error']
            ).catch(() => {});
        }
    }
}

let pendingScanInterval = null;
let threadsBackfilled = false;

/**
 * Backfill recent messages for currently-open week threads into thread_messages,
 * so the website transcript isn't empty for threads created before this deploy.
 * Runs once per process.
 */
async function backfillOpenThreads(client) {
    if (!isDatabaseAvailable() || threadsBackfilled) return;
    threadsBackfilled = true;
    try {
        const r = await pool.query(`SELECT thread_id FROM week_threads WHERE thread_id IS NOT NULL AND is_closed = FALSE`);
        for (const row of r.rows) {
            const thread = await client.channels.fetch(row.thread_id).catch(() => null);
            if (!thread || typeof thread.messages?.fetch !== 'function') continue;
            const fetched = await thread.messages.fetch({ limit: 100 }).catch(() => null);
            if (!fetched) continue;
            const ordered = Array.from(fetched.values()).reverse();
            for (const msg of ordered) await captureThreadMessage(msg);
        }
        Logger.info(`Thread transcripts backfilled for ${r.rows.length} open thread(s)`);
    } catch (err) {
        Logger.error('backfillOpenThreads failed', err.message || err);
    }
}

/**
 * Kick off a periodic watcher (every 60s) that (a) creates Discord threads for
 * rows the website materialized, and (b) reconciles open/close state with the
 * website's is_closed flag. Runs once immediately on startup.
 */
function startPendingWeekThreadWatcher(client, intervalMs = 60 * 1000) {
    if (pendingScanInterval) clearInterval(pendingScanInterval);
    const tick = async () => {
        await refreshKnownThreadIds().catch(() => {});
        // DB-driven auto-open: materialize the current week (from season start_date)
        // if not already present, then create any pending threads.
        await autoOpenCurrentWeek(client).catch(() => {});
        await processPendingWeekThreads(client).catch(() => {});
        await reconcileWeekThreadClosures(client).catch(() => {});
        await processWeekThreadActions(client).catch(() => {});
    };
    // Initial run after a short delay so the bot is fully ready, then a one-time
    // transcript backfill once known thread IDs are loaded.
    setTimeout(async () => {
        await tick();
        await backfillOpenThreads(client).catch(() => {});
    }, 5000);
    pendingScanInterval = setInterval(tick, intervalMs);
    Logger.info(`Pending week-thread watcher started (every ${Math.round(intervalMs / 1000)}s)`);
}

// (scheduleAutoCreation removed — auto-open is now DB-driven via autoOpenCurrentWeek
//  inside the pending-thread watcher, computed from the season's start_date.)

module.exports = {
    data: new SlashCommandBuilder()
        .setName('week-thread')
        .setDescription('[Salary Crew Only] Create or delete match threads for a week')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'Make', value: 'make' },
                    { name: 'Delete', value: 'delete' }
                )
        )
        .addIntegerOption(option =>
            option
                .setName('week')
                .setDescription('Week number')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(30)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Check if user is Salary Crew
            if (!interaction.member.roles.cache.has(ROLES.SALARY_CREW)) {
                return await interaction.editReply({
                    content: '❌ Only Salary Crew members can use this command.',
                });
            }

            // Check database availability
            if (!isDatabaseAvailable()) {
                return await interaction.editReply({
                    content: '❌ Database is not available. Week thread management requires the database to track created threads accurately.',
                });
            }

            // Initialize table if needed
            await initializeWeekThreadsTable();

            const action = interaction.options.getString('action');
            const weekNumber = interaction.options.getInteger('week');

            if (action === 'make') {
                // Single creation path: materialize this week's rows from the DB
                // schedule for the ACTIVE season, then let processPendingWeekThreads
                // create the Discord threads (deduped, no parallel hardcoded path).
                const season = await LeagueDB.getActiveSeason();
                if (!season) {
                    return await interaction.editReply({ content: '❌ No active season. Set one up on the website first.' });
                }

                await interaction.editReply({
                    content: `⏳ Materializing Week ${weekNumber} from the DB schedule…`,
                });

                const inserted = await materializeWeekFromDb(season.id, weekNumber);
                if (inserted === 0) {
                    // Either nothing in the DB schedule for this week, or already materialized.
                    const existing = await pool.query(
                        `SELECT COUNT(*)::int AS n FROM week_threads WHERE season_id = $1 AND week_number = $2`,
                        [season.id, weekNumber]
                    ).catch(() => ({ rows: [{ n: 0 }] }));
                    if (existing.rows[0].n === 0) {
                        return await interaction.followUp({
                            content: `❌ No published schedule found for Week ${weekNumber} in the DB. Generate/publish the schedule on the website first.`,
                            ephemeral: true,
                        });
                    }
                }

                // Create the Discord threads for any pending rows now.
                const result = await processPendingWeekThreads(interaction.client);
                await interaction.followUp({
                    content: `✅ Week ${weekNumber}: materialized **${inserted}** new matchup(s); created **${result.processed}** Discord thread(s)${result.errors?.length ? ` (${result.errors.length} error(s))` : ''}.`,
                    ephemeral: true,
                });

            } else if (action === 'delete') {
                await interaction.editReply({
                    content: `⏳ Deleting Week ${weekNumber} match threads...`,
                });

                const result = await deleteWeekThreads(interaction.guild, weekNumber, interaction.client, interaction.user.username);

                if (result.success) {
                    await interaction.followUp({
                        content: `✅ Deleted **${result.deletedCount}** match thread(s) for Week ${weekNumber} and saved their transcripts on the website.${result.failedCount > 0 ? ` (${result.failedCount} failed to delete)` : ''}`,
                        ephemeral: true
                    });
                } else {
                    await interaction.followUp({
                        content: `❌ Failed to delete threads: ${result.error}`,
                        ephemeral: true
                    });
                }
            }

            Logger.info(`Week thread ${action} for Week ${weekNumber} by ${interaction.user.tag}`);

        } catch (error) {
            Logger.error('Failed to execute week-thread command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while managing week threads. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    // Export functions for use in bot.js
    initializeWeekThreadsTable,
    processPendingWeekThreads,
    processWeekThreadActions,
    startPendingWeekThreadWatcher,
    captureThreadMessage,
    refreshKnownThreadIds,
    materializeWeekFromDb,
    autoOpenCurrentWeek,
    deleteWeekThreads
};
