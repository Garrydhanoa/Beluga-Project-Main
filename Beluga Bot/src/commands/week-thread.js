const {
    SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const Logger = require('../utils/logger');
const {
    getUnreportedMatches, countWeekThreads, formatUnreportedList, pingUnreportedThreads,
} = require('../stats/weekReportCheck');
// Only the fixed roles remain from constants (division captains, salary crew).
// Team/GM/NP roles are pulled from the database (teams + franchises).
const { ROLES } = require('../constants/roles');
const { pool, isDatabaseAvailable, LeagueDB } = require('../utils/database');
const transcriptStore = require('../utils/transcriptStore');
// Week rollover is 9:00 AM Monday US Eastern, not UTC midnight.
const { currentLeagueWeek, weekOpensAt, formatEastern } = require('../utils/leagueWeek');
// Playoff rounds live at week 90 + round. Those integers stay (threadContext and
// the ranking/game-of-week filters key off `week >= 90`), but every string a
// human reads goes through weekLabel so nobody is shown "Week 91" again.
const {
    weekLabel, isPlayoffWeek, roundFromWeek, roundNameFor, shortRoundName,
} = require('../stats/playoffBracket');

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

// Threads that are NOT week threads, remembered briefly so ordinary thread chatter
// elsewhere in the server doesn't cost a DB lookup per message.
const notWeekThread = new Map(); // threadId -> checkedAt

/**
 * Is this channel a tracked week thread? The in-memory set is the fast path; on a
 * miss, threads fall back to the database (the set used to be the ONLY check, and a
 * stale set meant whole threads were never captured).
 */
async function isTrackedWeekThread(channel) {
    const id = String(channel?.id || '');
    if (!id) return false;
    if (knownThreadIds.has(id)) return true;
    if (typeof channel.isThread !== 'function' || !channel.isThread()) return false;
    const missAt = notWeekThread.get(id);
    if (missAt && Date.now() - missAt < 10 * 60 * 1000) return false;
    try {
        const r = await pool.query(`SELECT 1 FROM week_threads WHERE thread_id = $1 LIMIT 1`, [id]);
        if (r.rows.length) { knownThreadIds.add(id); notWeekThread.delete(id); return true; }
        notWeekThread.set(id, Date.now());
        if (notWeekThread.size > 5000) notWeekThread.delete(notWeekThread.keys().next().value);
    } catch { /* DB blip — try again next message */ }
    return false;
}

/**
 * Capture a message into thread_messages (the website's live thread transcript)
 * if it belongs to a tracked week thread. Mirrors the ticket transcript capture.
 * `force` skips the membership check (used by the archive backfill, which already
 * knows the thread is a week thread). Image attachments are copied so they survive
 * the thread being deleted.
 */
async function captureThreadMessage(message, { force = false } = {}) {
    if (!isDatabaseAvailable()) return;
    const channelId = message.channel?.id;
    if (!channelId) return;
    if (!force && !(await isTrackedWeekThread(message.channel))) return;
    try {
        const author = message.author;
        const member = message.member;
        const avatar = author?.displayAvatarURL ? author.displayAvatarURL({ extension: 'png', size: 64 }) : null;
        const color = member?.displayHexColor && member.displayHexColor !== '#000000' ? member.displayHexColor : null;
        const attachments = await transcriptStore.captureAttachments('thread', channelId, message);
        const embeds = (message.embeds || []).map((e) => ({ title: e.title || null, description: e.description || null }));
        await pool.query(`
            INSERT INTO thread_messages
              (thread_id, message_id, author_id, author_username, author_display, author_avatar, author_color, is_bot, content, attachments, embeds, message_created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
            ON CONFLICT (thread_id, message_id) DO UPDATE SET content = EXCLUDED.content, attachments = EXCLUDED.attachments
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
 * Save a week thread's transcript to thread_archives BEFORE its Discord thread is
 * deleted: page through the thread's WHOLE history (not just the last 100), merge
 * with anything already archived (a re-archive can never shrink it), verify the
 * stored row, then drop the live rows.
 *
 * Returns { ok, count, reason }. Callers MUST keep the Discord thread when ok is
 * false — deleting it would lose the only copy (what happened to Season 10).
 */
async function archiveWeekThread(record, weekNumber, closedByUsername, thread) {
    if (!isDatabaseAvailable()) return { ok: false, reason: 'database unavailable' };
    try {
        let discordCount = null;
        if (thread && typeof thread.messages?.fetch === 'function') {
            const r = await transcriptStore.backfillChannel(thread, (msg) => captureThreadMessage(msg, { force: true }));
            if (r.error) return { ok: false, reason: `could not read the Discord thread (${r.error})` };
            discordCount = r.fetched;
        }

        const result = await transcriptStore.writeArchive({
            archiveTable: 'thread_archives', keyCol: 'thread_id', key: record.thread_id,
            liveTable: 'thread_messages', liveCol: 'thread_id', discordCount,
            insertSql: `
                INSERT INTO thread_archives (thread_id, season_id, week_number, division, team1, team2, match_number, closed_by_username, message_count, transcript)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
                ON CONFLICT (thread_id) DO UPDATE SET
                    closed_by_username = EXCLUDED.closed_by_username,
                    closed_at = CURRENT_TIMESTAMP,
                    message_count = EXCLUDED.message_count,
                    transcript = EXCLUDED.transcript`,
            insertParams: (merged) => [
                record.thread_id, record.season_id || null, weekNumber, record.division || null,
                record.team1 || null, record.team2 || null, record.match_number || null,
                closedByUsername || null, merged.length, JSON.stringify(merged),
            ],
        });
        if (!result.ok) Logger.error(`Transcript NOT saved for ${record.team1} vs ${record.team2} (${record.thread_id}): ${result.reason}`);
        return result;
    } catch (err) {
        Logger.error(`archiveWeekThread failed for ${record.team1} vs ${record.team2}`, err);
        return { ok: false, reason: err.message || String(err) };
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
        // Target ONE thread instead of a whole week — the playoff tab's "delete
        // this matchup's thread". `action` has no CHECK constraint, so new verbs
        // ('delete_matchup') need no migration of their own.
        await pool.query(`ALTER TABLE week_thread_actions ADD COLUMN IF NOT EXISTS week_thread_id INTEGER`).catch(() => {});

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
            'SELECT id, thread_id, division, team1, team2, match_number, season_id FROM week_threads WHERE week_number = $1',
            [weekNumber]
        );
        return result.rows;
    } catch (error) {
        Logger.error(`Failed to get week ${weekNumber} thread IDs`, error);
        return [];
    }
}

/** Delete specific week_threads rows (the ones a delete actually handled). */
async function deleteWeekThreadRowsById(ids) {
    if (!isDatabaseAvailable() || !ids.length) return false;
    try {
        await pool.query('DELETE FROM week_threads WHERE id = ANY($1::int[])', [ids]);
        return true;
    } catch (error) {
        Logger.error(`Failed to delete ${ids.length} week thread record(s)`, error);
        return false;
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
        // Week threads pull team/GM/NP roles from the DATABASE ONLY (operator
        // rule): team role from teams.discord_role_id, GM/NP from the team's
        // FRANCHISE (with the legacy team columns as a transition fallback).
        // No constants here — a missing team role rejects the whole week
        // upstream (see validateWeekRoles).
        const dbDiv = division === 'MAJORS' ? 'Majors' : division;
        const dbRoles = {}; // teamName -> { team, gm, np }
        if (isDatabaseAvailable()) {
            const r = await pool.query(
                `SELECT t.name, t.discord_role_id,
                    COALESCE(f.gm_role_id, t.discord_gm_role_id) AS gm_role_id,
                    COALESCE(f.np_role_id, t.discord_np_role_id) AS np_role_id
                 FROM teams t
                 LEFT JOIN team_franchises f ON f.id = t.franchise_id
                 WHERE t.division = $1 AND t.is_active = TRUE AND t.name = ANY($2::text[])`,
                [dbDiv, [team1, team2]]
            ).catch(() => ({ rows: [] }));
            for (const row of r.rows) {
                dbRoles[row.name] = {
                    team: row.discord_role_id || null,
                    gm: row.gm_role_id || null,
                    np: row.np_role_id || null,
                };
            }
        }
        const roleFor = (team, slot) => (dbRoles[team] && dbRoles[team][slot]) || null;

        const team1RoleId = roleFor(team1, 'team');
        const team2RoleId = roleFor(team2, 'team');

        if (!team1RoleId || !team2RoleId) {
            const missing = [!team1RoleId ? team1 : null, !team2RoleId ? team2 : null].filter(Boolean).join(', ');
            Logger.warning(`Team role ID missing in the database for: ${missing} (${dbDiv}) — thread not created`);
            return null;
        }

        // Create the thread name with division at the front. week_number >= 90
        // is the playoffs convention (90 + bracket round) → distinct naming.
        // The round names come from the shared bracket helper so a thread, an
        // embed and a slash reply can never disagree about what week 92 is.
        const threadName = isPlayoffWeek(weekNumber)
            ? `Playoffs ${shortRoundName(roundNameFor(roundFromWeek(weekNumber), 3))}: ${division}: ${team1} vs ${team2}`
            : `Week ${weekNumber}: ${division}: ${team1} vs ${team2}`;
        
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
        const team1GMRoleId = roleFor(team1, 'gm');
        const team2GMRoleId = roleFor(team2, 'gm');
        if (!team1GMRoleId || !team2GMRoleId) {
            Logger.warning(`GM role missing on franchise for ${!team1GMRoleId ? team1 : ''} ${!team2GMRoleId ? team2 : ''} — GMs won't be auto-added to ${threadName}`);
        }

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
                // NP role per franchise (DB).
                const team1NPRoleId = roleFor(team1, 'np');
                const team2NPRoleId = roleFor(team2, 'np');

                // All of each team's division role IDs from the DATABASE (a
                // captain of the franchise in any division gets thread access).
                const team1AllRoleIds = new Set();
                const team2AllRoleIds = new Set();
                if (isDatabaseAvailable()) {
                    const allDivs = await pool.query(
                        `SELECT name, discord_role_id FROM teams
                         WHERE is_active = TRUE AND discord_role_id IS NOT NULL AND name = ANY($1::text[])`,
                        [[team1, team2]]
                    ).catch(() => ({ rows: [] }));
                    for (const row of allDivs.rows) {
                        if (row.name === team1) team1AllRoleIds.add(row.discord_role_id);
                        if (row.name === team2) team2AllRoleIds.add(row.discord_role_id);
                    }
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
            .setTitle(isPlayoffWeek(weekNumber) ? `${weekLabel(weekNumber)} Match Thread` : `Week ${weekNumber} Match Thread`)
            .setDescription(
                `**${team1}** vs **${team2}**\n\n**Division:** ${division}\n` +
                `**${isPlayoffWeek(weekNumber) ? 'Round' : 'Week'}:** ${isPlayoffWeek(weekNumber) ? roundNameFor(roundFromWeek(weekNumber), 3) : weekNumber}\n` +
                `**Match:** ${matchNumber}`
            )
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
// Re-check every 5 min. The open time is 9:00 AM Monday Eastern, and a 30-minute
// throttle meant the threads could land as late as 9:29; the check is one cached
// season lookup plus one indexed SELECT, so tightening it costs effectively nothing.
const AUTO_OPEN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * DB-driven auto-open: compute the current week from the active season's
 * start_date and materialize that week's rows from the DB schedule if they don't
 * exist yet. processPendingWeekThreads then creates the Discord threads.
 *
 * TIMING: the week rolls over at 9:00 AM US EASTERN on Monday (see
 * utils/leagueWeek.js). This used to be plain UTC date math, and Railway runs in
 * UTC — so the week advanced at 00:00 UTC Monday, i.e. 8:00 PM SUNDAY Eastern in
 * summer, and threads opened a day early by the league's own clock.
 *
 * Only the "which week is it" gate changed here; the creation path underneath
 * (materializeWeekFromDb -> processPendingWeekThreads) is untouched.
 */
async function autoOpenCurrentWeek(client) {
    if (!isDatabaseAvailable()) return;
    const now = Date.now();
    if (now - lastAutoOpenCheck < AUTO_OPEN_INTERVAL_MS) return;
    lastAutoOpenCheck = now;

    try {
        const season = await LeagueDB.getActiveSeason();
        if (!season || !season.start_date) return;

        const currentWeek = currentLeagueWeek(season.start_date);
        if (!currentWeek || currentWeek < 1) return; // before 9am ET on opening Monday

        // Only materialize if this week has no rows yet for this season.
        const existing = await pool.query(
            `SELECT 1 FROM week_threads WHERE season_id = $1 AND week_number = $2 LIMIT 1`,
            [season.id, currentWeek]
        );
        if (existing.rows.length) return;

        const inserted = await materializeWeekFromDb(season.id, currentWeek);
        if (inserted > 0) {
            const opened = weekOpensAt(season.start_date, currentWeek);
            Logger.success(
                `Auto-opened Week ${currentWeek} (season ${season.season_number}) — materialized ${inserted} matchup(s) from the DB schedule`
                + ` [window opened ${formatEastern(opened)}]`
            );
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
        return { success: false, error: `No threads found for ${weekLabel(weekNumber)}.` };
    }

    // Get transcript channel
    const transcriptChannel = await client.channels.fetch(WEEK_THREAD_TRANSCRIPT_CHANNEL_ID).catch(() => null);

    let deletedCount = 0;
    let failedCount = 0;
    let transcriptCount = 0;
    const keptForTranscript = [];
    const processedIds = [];

    for (const record of threadRecords) {
        try {
            const thread = record.thread_id ? await client.channels.fetch(record.thread_id).catch(() => null) : null;
            if (thread) {
                // Save the transcript on the website BEFORE deleting the Discord
                // thread — and if it can't be saved, KEEP the thread (and its row,
                // so a retry can try again) rather than lose the only copy.
                const archived = await archiveWeekThread(record, weekNumber, closedByUsername, thread);
                if (!archived.ok) {
                    failedCount++;
                    keptForTranscript.push(`${record.team1} vs ${record.team2}`);
                    continue;
                }
                transcriptCount++;

                // Post a pointer to the website transcript (no more dpaste link).
                if (transcriptChannel) {
                    const transcriptEmbed = new EmbedBuilder()
                        .setTitle(`🧵 ${weekLabel(weekNumber)} Thread Closed: ${record.division}`)
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
                processedIds.push(record.id);
            } else {
                // Thread doesn't exist anymore — save whatever was captured live.
                if (record.thread_id) {
                    const archived = await archiveWeekThread(record, weekNumber, closedByUsername, null);
                    if (archived.ok && archived.count > 0) transcriptCount++;
                }
                deletedCount++;
                processedIds.push(record.id);
            }
        } catch (error) {
            Logger.error(`Failed to delete thread ${record.thread_id}`, error);
            failedCount++;
        }

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Remove only the rows that were actually handled. A thread kept because its
    // transcript couldn't be saved keeps its row, so it stays tracked + captured
    // and the next delete attempt retries it.
    await deleteWeekThreadRowsById(processedIds);
    await refreshKnownThreadIds().catch(() => {});

    if (keptForTranscript.length) {
        Logger.error(`Week ${weekNumber}: kept ${keptForTranscript.length} thread(s) because their transcript could not be saved: ${keptForTranscript.join(', ')}`);
    }
    Logger.success(`Deleted ${deletedCount} threads for Week ${weekNumber} (${failedCount} failed, ${transcriptCount} transcripts saved)`);
    return { success: true, deletedCount, failedCount, transcriptCount, keptForTranscript };
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

    // WEEK-LEVEL VALIDATION (operator rule): if ANY team in a pending week has
    // no team role ID in the database, reject creating that ENTIRE week and say
    // exactly which team is missing. The rows stay pending, so the week creates
    // itself automatically once the role ID is filled in on the website.
    const teamNames = [...new Set(rows.flatMap((r) => [r.team1, r.team2]))];
    const roleRows = await pool.query(
        `SELECT name, division, discord_role_id FROM teams
         WHERE is_active = TRUE AND name = ANY($1::text[])`,
        [teamNames]
    ).catch(() => ({ rows: [] }));
    const roleByTeamDiv = new Map(roleRows.rows.map((t) => [`${t.name}|${t.division}`, t.discord_role_id]));

    const rejectedWeeks = new Set(); // `${season_id}|${week_number}`
    const missingByWeek = new Map();
    for (const row of rows) {
        const dbDiv = row.division === 'MAJORS' ? 'Majors' : row.division;
        for (const team of [row.team1, row.team2]) {
            if (!roleByTeamDiv.get(`${team}|${dbDiv}`)) {
                const weekKey = `${row.season_id}|${row.week_number}`;
                rejectedWeeks.add(weekKey);
                if (!missingByWeek.has(weekKey)) missingByWeek.set(weekKey, new Set());
                missingByWeek.get(weekKey).add(`${team} (${dbDiv})`);
            }
        }
    }
    for (const [weekKey, missing] of missingByWeek) {
        const [, weekNum] = weekKey.split('|');
        const msg = `Week ${weekNum} NOT created — team role ID missing in the database for: ${[...missing].join(', ')}. Set it in the website admin (Teams) and the week will create itself on the next check.`;
        Logger.warning(msg);
        try {
            const { logEdge } = require('../stats/report/logChannel');
            await logEdge(client, { summary: msg, pingInThread: false });
        } catch { /* log channel optional */ }
    }
    const creatable = rows.filter((r) => !rejectedWeeks.has(`${r.season_id}|${r.week_number}`));
    if (creatable.length === 0) return { processed: 0, errors: [...missingByWeek.keys()].map((k) => `week ${k.split('|')[1]} missing team roles`) };

    Logger.info(`processPendingWeekThreads: ${creatable.length} pending thread(s) to create`);

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

    for (const row of creatable) {
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
 * Delete ONE week_threads row's Discord thread, saving its transcript first.
 *
 * Same contract as deleteWeekThreads (archive → delete → drop the row), just
 * scoped to a single matchup. Used by the playoff tab, where deleting a whole
 * round to clear one bad thread is far too blunt.
 *
 * Deliberately NOT gated on the series being reported: this is the targeted
 * "that thread is wrong, remove it" tool, and the person clicking it is staff
 * acting on one specific matchup. The week-level delete keeps its gate.
 */
async function deleteSingleWeekThread(guild, weekThreadId, client, closedByUsername = 'Website Admin') {
    if (!isDatabaseAvailable()) {
        return { success: false, message: 'database unavailable' };
    }
    if (!weekThreadId) {
        return { success: false, message: 'no thread id given' };
    }

    try {
        const r = await pool.query(
            `SELECT id, thread_id, season_id, week_number, division, team1, team2, match_number
               FROM week_threads WHERE id = $1`,
            [weekThreadId]
        );
        if (!r.rows.length) {
            return { success: false, message: 'that thread record no longer exists' };
        }
        const record = r.rows[0];
        const label = `${record.division} ${record.team1} vs ${record.team2}`;

        if (record.thread_id) {
            const thread = await client.channels.fetch(String(record.thread_id)).catch(() => null);
            // Archive whether or not the Discord thread still exists — the
            // transcript rows are the thing worth keeping. If a live thread's
            // transcript can't be saved, keep the thread.
            const archived = await archiveWeekThread(record, record.week_number, closedByUsername, thread);
            if (thread && !archived.ok) {
                return { success: false, message: `kept the thread — its transcript could not be saved (${archived.reason})` };
            }

            if (thread) {
                const transcriptChannel = await client.channels
                    .fetch(WEEK_THREAD_TRANSCRIPT_CHANNEL_ID).catch(() => null);
                if (transcriptChannel?.isTextBased?.()) {
                    const embed = new EmbedBuilder()
                        .setColor(0x3498DB)
                        .setTitle(`🧵 ${weekLabel(record.week_number)} Thread Closed: ${record.division}`)
                        .setDescription(`**${record.team1}** vs **${record.team2}**\n\n${weekThreadTranscriptPointer()}`)
                        .setFooter({ text: `Closed by ${closedByUsername}` })
                        .setTimestamp();
                    await transcriptChannel.send({ embeds: [embed] }).catch(() => {});
                }
                await thread.delete(`${weekLabel(record.week_number)} thread removed by ${closedByUsername}`).catch(() => {});
            }
        }

        await pool.query('DELETE FROM week_threads WHERE id = $1', [record.id]);
        await refreshKnownThreadIds();

        Logger.success(`Deleted single week thread #${record.id} (${label}) for ${closedByUsername}`);
        return { success: true, message: `deleted ${label} and saved its transcript` };
    } catch (err) {
        Logger.error('deleteSingleWeekThread failed', err);
        return { success: false, message: err.message || 'delete failed' };
    }
}

/**
 * Process website-queued week-thread actions (week_thread_actions). Supports
 * 'delete' / 'force_delete' (whole week), 'ping_unreported', and
 * 'delete_matchup' (one thread). All run the SAME flow as /week-thread delete:
 * save the transcript on the website, then delete the Discord thread(s).
 */
async function processWeekThreadActions(client) {
    if (!isDatabaseAvailable()) return;
    let rows;
    try {
        const r = await pool.query(`
            SELECT id, action, week_number, week_thread_id, requested_by_username
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
            // Website blocked a delete because of unreported series and asked us
            // to nudge salary crew in exactly those threads.
            if (row.action === 'ping_unreported') {
                const season = await LeagueDB.getActiveSeason();
                const unreported = await getUnreportedMatches(row.week_number, season?.id ?? null);
                const { pinged, failed } = await pingUnreportedThreads(
                    client, unreported, row.week_number, row.requested_by_username || 'Website Admin'
                );
                await pool.query(
                    `UPDATE week_thread_actions SET status = 'fulfilled', result = $2, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [row.id, `pinged ${pinged} of ${unreported.length} unreported thread(s)${failed ? `, ${failed} failed` : ''}`]
                );
                continue;
            }

            // Delete ONE matchup's thread (the playoff tab's per-matchup control).
            // Before this the smallest unit was a whole week, so clearing a single
            // mis-created playoff thread meant deleting the entire round.
            // Transcript-then-delete, exactly like a week delete.
            if (row.action === 'delete_matchup') {
                const result = await deleteSingleWeekThread(
                    guild, row.week_thread_id, client,
                    row.requested_by_username || 'Website Admin'
                );
                await pool.query(
                    `UPDATE week_thread_actions SET status = $2, result = $3, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [row.id, result.success ? 'fulfilled' : 'failed', result.message]
                );
                continue;
            }

            if (row.action !== 'delete' && row.action !== 'force_delete') {
                await pool.query(
                    `UPDATE week_thread_actions SET status = 'failed', result = $2, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [row.id, `unknown action ${row.action}`]
                );
                continue;
            }

            // Same gate as the slash command: a plain 'delete' from the website
            // is refused while any series is unreported, and salary crew get
            // pinged in exactly those threads. 'force_delete' is the website's
            // confirmed second step and skips the gate.
            if (row.action === 'delete') {
                const season = await LeagueDB.getActiveSeason();
                const unreported = await getUnreportedMatches(row.week_number, season?.id ?? null);
                if (unreported.length) {
                    const { pinged } = await pingUnreportedThreads(
                        client, unreported, row.week_number, row.requested_by_username || 'Website Admin'
                    );
                    await pool.query(
                        `UPDATE week_thread_actions SET status = 'failed', result = $2, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                        [row.id, `blocked: ${unreported.length} series unreported (pinged salary crew in ${pinged} thread(s))`]
                    );
                    Logger.warning(
                        `Website delete of week ${row.week_number} blocked — ${unreported.length} series unreported`
                    );
                    continue;
                }
            }

            const result = await deleteWeekThreads(
                guild, row.week_number, client,
                `${row.requested_by_username || 'Website Admin'}${row.action === 'force_delete' ? ' (forced)' : ''}`
            );
            await pool.query(
                `UPDATE week_thread_actions SET status = $2, result = $3, fulfilled_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [
                    row.id,
                    result.success ? 'fulfilled' : 'failed',
                    result.success
                        ? `deleted ${result.deletedCount}, ${result.transcriptCount} transcripts saved`
                          + (result.keptForTranscript?.length ? `; KEPT ${result.keptForTranscript.length} thread(s) whose transcript could not be saved (${result.keptForTranscript.join(', ')}) — retry the delete` : '')
                        : (result.error || 'failed'),
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
    await catchUpWeekThreads(client, 'startup');
}

/**
 * Pull in every message the live capture missed — e.g. while the bot was down.
 * For each tracked thread it reads back from the newest message already captured
 * (or the whole history if nothing is captured yet). Runs at startup and every
 * 10 minutes, so downtime can no longer leave holes in a transcript.
 */
let catchUpRunning = false;
async function catchUpWeekThreads(client, why = 'periodic') {
    if (!isDatabaseAvailable() || catchUpRunning) return;
    catchUpRunning = true;
    let threads = 0;
    let added = 0;
    try {
        const r = await pool.query(`SELECT thread_id FROM week_threads WHERE thread_id IS NOT NULL`);
        for (const row of r.rows) {
            const thread = await client.channels.fetch(row.thread_id).catch(() => null);
            if (!thread || typeof thread.messages?.fetch !== 'function') continue;
            // Startup re-reads the WHOLE history (a message captured live just after
            // a restart must not hide older ones missed during the downtime); the
            // periodic pass only reads what's newer than the last captured message.
            const since = why === 'startup'
                ? null
                : await transcriptStore.newestCapturedId('thread_messages', 'thread_id', row.thread_id).catch(() => undefined);
            if (since === undefined) continue; // DB blip — try next round
            const res = await transcriptStore.backfillChannel(
                thread, (msg) => captureThreadMessage(msg, { force: true }), { stopAtId: since }
            );
            threads++;
            added += res.fetched || 0;
        }
        if (why === 'startup' || added) Logger.info(`Thread transcripts caught up (${why}): ${added} message(s) across ${threads} thread(s)`);
    } catch (err) {
        Logger.error('Thread transcript catch-up failed', err);
    } finally {
        catchUpRunning = false;
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
    // Transcript safety net: re-read anything live capture missed, every 10 min.
    setInterval(() => { catchUpWeekThreads(client).catch(() => {}); }, 10 * 60 * 1000);
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
                // Playoff rounds are weeks 91-93 (90 + round). The old max of 30 put
                // them out of reach, so a playoff week could not be made OR deleted
                // from Discord at all.
                .setDescription('Week number (playoffs: 91 = QF, 92 = Semis, 93 = Finals)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(99)
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
                    content: `⏳ Materializing ${weekLabel(weekNumber)} from the DB schedule…`,
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
                            content: `❌ No published schedule found for ${weekLabel(weekNumber)} in the DB. Generate/publish the schedule on the website first.`,
                            ephemeral: true,
                        });
                    }
                }

                // Create the Discord threads for any pending rows now.
                const result = await processPendingWeekThreads(interaction.client);
                await interaction.followUp({
                    content: `✅ ${weekLabel(weekNumber)}: materialized **${inserted}** new matchup(s); created **${result.processed}** Discord thread(s)${result.errors?.length ? ` (${result.errors.length} error(s))` : ''}.`,
                    ephemeral: true,
                });

            } else if (action === 'delete') {
                // Deleting a week's threads IS how the league closes the week, and
                // a deleted thread is the only place its series could still be
                // reported. Block on anything unreported, say exactly what, and
                // ping salary crew in those threads.
                const season = await LeagueDB.getActiveSeason();
                const unreported = await getUnreportedMatches(weekNumber, season?.id ?? null);

                if (unreported.length) {
                    const total = await countWeekThreads(weekNumber, season?.id ?? null);
                    await interaction.editReply({
                        content: `⏳ ${weekLabel(weekNumber)} has unreported series — notifying salary crew…`,
                    });

                    const { pinged } = await pingUnreportedThreads(
                        interaction.client, unreported, weekNumber, interaction.user.username
                    );

                    const embed = new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setTitle(`⚠️ ${weekLabel(weekNumber)} not deleted — ${unreported.length} series unreported`)
                        .setDescription(
                            `**${total - unreported.length} of ${total}** series are reported.\n\n` +
                            `${formatUnreportedList(unreported)}\n\n` +
                            `Pinged salary crew in **${pinged}** of those thread(s).`
                        )
                        .setFooter({ text: 'Deleting now would destroy the only place these series can be reported.' });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`wt:forcedel:${weekNumber}`)
                            .setLabel(`Delete ${weekLabel(weekNumber)} anyway`)
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId('wt:cancel')
                            .setLabel('Cancel')
                            .setStyle(ButtonStyle.Secondary),
                    );

                    return await interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
                }

                await interaction.editReply({
                    content: `⏳ Deleting ${weekLabel(weekNumber)} match threads...`,
                });

                const result = await deleteWeekThreads(interaction.guild, weekNumber, interaction.client, interaction.user.username);

                if (result.success) {
                    await interaction.followUp({
                        content: `✅ Deleted **${result.deletedCount}** match thread(s) for ${weekLabel(weekNumber)} and saved their transcripts on the website.${result.failedCount > 0 ? ` (${result.failedCount} failed to delete)` : ''}`
                            + (result.keptForTranscript?.length ? `
Kept ${result.keptForTranscript.length} thread(s) because their transcript could not be saved: ${result.keptForTranscript.join(', ')}. Run the delete again to retry.` : ''),
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

    /**
     * Step 2 of the guarded delete. The command blocks and lists the unreported
     * series; this runs only when salary crew then clicks the red confirm.
     * customId: `wt:forcedel:<week>` / `wt:cancel` — routed from bot.js.
     */
    async handleButton(interaction) {
        const parts = String(interaction.customId).split(':');
        if (parts[0] !== 'wt') return false;

        if (!interaction.member?.roles?.cache?.has(ROLES.SALARY_CREW)) {
            await interaction.reply({ content: '❌ Only Salary Crew can do that.', flags: 64 }).catch(() => {});
            return true;
        }

        if (parts[1] === 'cancel') {
            await interaction.update({
                content: '✅ Cancelled — nothing was deleted.',
                embeds: [], components: [],
            }).catch(() => {});
            return true;
        }

        if (parts[1] === 'forcedel') {
            const weekNumber = Number(parts[2]);
            await interaction.update({
                content: `⏳ Force-deleting ${weekLabel(weekNumber)} match threads…`,
                embeds: [], components: [],
            }).catch(() => {});

            const result = await deleteWeekThreads(
                interaction.guild, weekNumber, interaction.client, `${interaction.user.username} (forced)`
            );

            Logger.warning(
                `Week ${weekNumber} force-deleted by ${interaction.user.tag} despite unreported series`
            );
            await interaction.followUp({
                content: result.success
                    ? `⚠️ Force-deleted **${result.deletedCount}** thread(s) for ${weekLabel(weekNumber)} with series still unreported. Transcripts were saved.`
                    : `❌ Failed to delete threads: ${result.error}`,
                ephemeral: true,
            }).catch(() => {});
            return true;
        }

        return false;
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
