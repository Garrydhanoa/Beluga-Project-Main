const { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, ThreadAutoArchiveDuration } = require('discord.js');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, NP_ROLES } = require('../constants/roles');
const { getWeekMatches } = require('../constants/schedule');
const { pool, isDatabaseAvailable } = require('../utils/database');
const https = require('https');

// Channel ID for match threads
const MATCHES_CHANNEL_ID = '1444621891275985037';

// Channel ID for week thread transcripts
const WEEK_THREAD_TRANSCRIPT_CHANNEL_ID = '1452890665728868525';

// Week start dates (Monday at 9 AM ET)
// Week 1 starts March 23, 2026 (already created)
const WEEK_START_DATES = {
    1: new Date('2026-03-23T13:00:00.000Z'), // 9 AM ET = 13:00 UTC (during DST)
    2: new Date('2026-03-30T13:00:00.000Z'),
    3: new Date('2026-04-06T13:00:00.000Z'),
    4: new Date('2026-04-13T13:00:00.000Z'),
    5: new Date('2026-04-20T13:00:00.000Z'),
    6: new Date('2026-04-27T13:00:00.000Z'),
    7: new Date('2026-05-04T13:00:00.000Z'),
    8: new Date('2026-05-11T13:00:00.000Z')
};

// Store scheduled intervals for auto-creation
const scheduledWeekCreations = new Map();

// Maximum safe timeout (~24.8 days in ms)
const MAX_TIMEOUT = 2147483647;

/**
 * Schedule a function to run at a specific date, handling long delays
 */
function scheduleAt(targetDate, callback, weekNumber) {
    const now = Date.now();
    const delay = targetDate.getTime() - now;
    
    if (delay <= 0) {
        // Date has passed, don't schedule
        return null;
    }
    
    if (delay <= MAX_TIMEOUT) {
        // Can schedule directly
        return setTimeout(callback, delay);
    } else {
        // Need to use interval approach for long delays
        // Check every hour if it's time
        const checkInterval = setInterval(() => {
            const currentDelay = targetDate.getTime() - Date.now();
            
            if (currentDelay <= 0) {
                // Time to execute
                clearInterval(checkInterval);
                scheduledWeekCreations.delete(weekNumber);
                callback();
            } else if (currentDelay <= MAX_TIMEOUT) {
                // Close enough to schedule directly
                clearInterval(checkInterval);
                const finalTimeout = setTimeout(() => {
                    scheduledWeekCreations.delete(weekNumber);
                    callback();
                }, currentDelay);
                scheduledWeekCreations.set(weekNumber, { type: 'timeout', ref: finalTimeout });
            }
            // Otherwise, keep waiting
        }, 60 * 60 * 1000); // Check every hour
        
        return { type: 'interval', ref: checkInterval };
    }
}

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
                thread_id VARCHAR(255) NOT NULL,
                match_number INTEGER NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(week_number, division, team1, team2, match_number)
            )
        `);
        
        // Create index for faster lookups
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_week_threads_week 
            ON week_threads(week_number)
        `);
        
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
            'SELECT thread_id, division, team1, team2 FROM week_threads WHERE week_number = $1',
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

/**
 * Upload HTML to dpaste and return a viewable link
 * Uses dpaste.com API which is simple and reliable
 */
async function uploadHTMLToPaste(html, title) {
    return new Promise((resolve, reject) => {
        // Wrap HTML in a simple viewer that auto-renders
        const wrappedHtml = html;
        
        // URL encode the form data
        const formData = `content=${encodeURIComponent(wrappedHtml)}&syntax=html&expiry_days=365`;

        const options = {
            hostname: 'dpaste.com',
            port: 443,
            path: '/api/v2/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(formData)
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    // dpaste returns the URL directly as plain text
                    if (res.statusCode === 200 || res.statusCode === 201) {
                        const pasteUrl = data.trim();
                        // Add .txt to get raw content, then we'll create an HTML viewer
                        const rawUrl = `${pasteUrl}.txt`;
                        
                        // Create a simple HTML viewer URL that loads the content
                        // We'll use a data URL to create an instant viewer
                        resolve(rawUrl);
                    } else {
                        Logger.error(`dpaste returned status ${res.statusCode}: ${data}`);
                        reject(new Error(`Failed to upload to dpaste: HTTP ${res.statusCode}`));
                    }
                } catch (error) {
                    Logger.error('Error parsing dpaste response', error);
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            Logger.error('Network error uploading to dpaste', error);
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(formData);
        req.end();
    });
}

/**
 * Generate a formatted HTML transcript for a week thread
 */
async function generateWeekThreadTranscript(thread, weekNumber, division, team1, team2) {
    try {
        const messages = await thread.messages.fetch({ limit: 100 });
        const sortedMessages = Array.from(messages.values()).reverse();
        
        // Build HTML transcript
        let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Week ${weekNumber} - ${division}: ${team1} vs ${team2}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #e0e0e0; 
            padding: 20px;
            min-height: 100vh;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header { 
            background: linear-gradient(135deg, #0f3460 0%, #16213e 100%);
            border-radius: 12px; 
            padding: 30px; 
            margin-bottom: 25px;
            border: 1px solid #1f4068;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .header h1 { 
            color: #00d9ff; 
            font-size: 28px; 
            margin-bottom: 10px;
            text-shadow: 0 0 10px rgba(0,217,255,0.3);
        }
        .header .matchup { 
            font-size: 22px; 
            color: #ffffff; 
            margin-bottom: 15px;
            font-weight: 600;
        }
        .header .meta { 
            display: flex; 
            gap: 30px; 
            flex-wrap: wrap;
            color: #a0a0a0; 
            font-size: 14px; 
        }
        .header .meta span { 
            background: rgba(255,255,255,0.05); 
            padding: 6px 12px; 
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .messages { display: flex; flex-direction: column; gap: 12px; }
        .message { 
            background: rgba(255,255,255,0.03); 
            border-radius: 10px; 
            padding: 15px 18px;
            border-left: 3px solid #0f3460;
            transition: background 0.2s;
        }
        .message:hover { background: rgba(255,255,255,0.06); }
        .message-header { 
            display: flex; 
            align-items: center; 
            gap: 12px; 
            margin-bottom: 8px; 
        }
        .avatar { 
            width: 36px; 
            height: 36px; 
            border-radius: 50%; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 14px;
            color: white;
        }
        .username { 
            font-weight: 600; 
            color: #00d9ff; 
        }
        .timestamp { 
            color: #666; 
            font-size: 12px; 
            margin-left: auto;
        }
        .content { 
            color: #d0d0d0; 
            line-height: 1.6; 
            padding-left: 48px;
            word-wrap: break-word;
        }
        .embed { 
            background: rgba(0,217,255,0.05); 
            border-left: 3px solid #00d9ff; 
            padding: 12px 15px; 
            margin-top: 10px; 
            border-radius: 6px;
            margin-left: 48px;
        }
        .embed-title { color: #00d9ff; font-weight: 600; margin-bottom: 5px; }
        .attachment { 
            color: #7289da; 
            text-decoration: none; 
            display: inline-block;
            margin-top: 8px;
            padding: 4px 10px;
            background: rgba(114,137,218,0.1);
            border-radius: 4px;
            margin-left: 48px;
        }
        .attachment:hover { background: rgba(114,137,218,0.2); }
        .footer { 
            text-align: center; 
            margin-top: 30px; 
            padding: 20px; 
            color: #666;
            font-size: 12px;
            border-top: 1px solid rgba(255,255,255,0.1);
        }
        .no-messages { 
            text-align: center; 
            padding: 40px; 
            color: #666;
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Week ${weekNumber} Match Thread</h1>
            <div class="matchup">${team1} vs ${team2}</div>
            <div class="meta">
                <span><strong>Division:</strong> ${division}</span>
                <span><strong>Thread Created:</strong> ${thread.createdAt ? thread.createdAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' }) : 'Unknown'}</span>
                <span><strong>Archived:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })}</span>
            </div>
        </div>
        <div class="messages">`;

        if (sortedMessages.length === 0) {
            html += `<div class="no-messages">No messages in this thread</div>`;
        } else {
            for (const message of sortedMessages) {
                const timestamp = message.createdAt.toLocaleString('en-US', { 
                    timeZone: 'America/New_York',
                    dateStyle: 'short',
                    timeStyle: 'short'
                });
                
                const authorName = message.author.username;
                const initial = authorName.charAt(0).toUpperCase();
                
                // Escape HTML in content
                const escapedContent = (message.content || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\n/g, '<br>');
                
                html += `
            <div class="message">
                <div class="message-header">
                    <div class="avatar">${initial}</div>
                    <span class="username">${authorName}</span>
                    <span class="timestamp">${timestamp}</span>
                </div>
                <div class="content">${escapedContent || '<em>No text content</em>'}</div>`;
                
                // Add embeds
                for (const embed of message.embeds) {
                    html += `
                <div class="embed">
                    ${embed.title ? `<div class="embed-title">${embed.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : ''}
                    ${embed.description ? `<div>${embed.description.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>` : ''}
                </div>`;
                }
                
                // Add attachments
                for (const [, attachment] of message.attachments) {
                    html += `<a class="attachment" href="${attachment.url}" target="_blank">📎 ${attachment.name}</a>`;
                }
                
                html += `
            </div>`;
            }
        }

        html += `
        </div>
        <div class="footer">
            Beluga League Bot • Week ${weekNumber} ${division} Transcript • ${team1} vs ${team2}
        </div>
    </div>
</body>
</html>`;

        return html;
    } catch (error) {
        Logger.error(`Failed to generate transcript for ${team1} vs ${team2}`, error);
        return null;
    }
}

/**
 * Create a private thread for a match
 */
async function createMatchThread(channel, weekNumber, matchNumber, team1, team2, division, guild) {
    try {
        // Get team role IDs for this specific division
        const team1RoleId = TEAM_ROLES[division]?.[team1];
        const team2RoleId = TEAM_ROLES[division]?.[team2];
        
        if (!team1RoleId || !team2RoleId) {
            Logger.warning(`Could not find roles for ${team1} or ${team2} in ${division}`);
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
        const team1GMRoleId = ROLES.GM_ROLES[team1];
        const team2GMRoleId = ROLES.GM_ROLES[team2];
        
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
                // Get NP role IDs for both teams
                const team1NPRoleId = NP_ROLES[team1];
                const team2NPRoleId = NP_ROLES[team2];
                
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
 * Create all threads for a specific week
 */
async function createWeekThreads(guild, weekNumber, client) {
    // Check database availability first
    if (!isDatabaseAvailable()) {
        Logger.error('Database not available - cannot create week threads');
        return { success: false, error: 'Database not available. Week threads require database for tracking.' };
    }

    // Check if threads already exist
    const threadsExist = await weekThreadsExist(weekNumber);
    if (threadsExist) {
        Logger.warning(`Week ${weekNumber} threads already exist`);
        return { success: false, error: `Week ${weekNumber} threads already exist. Delete them first before creating new ones.` };
    }

    const channel = await client.channels.fetch(MATCHES_CHANNEL_ID).catch(() => null);
    if (!channel) {
        return { success: false, error: 'Matches channel not found.' };
    }

    const createdThreads = [];
    const divisions = ['MAJORS', 'AAA', 'AA'];
    
    for (const division of divisions) {
        const matches = getWeekMatches(weekNumber, division);
        
        // For AAA and AA, they share the same schedule
        // So we skip AA if we already processed AAA (they're the same matches)
        if (division === 'AA') {
            // AA uses same schedule as AAA, just different division
            // We need to create separate threads for AA
        }
        
        let matchNumber = 1;
        for (const match of matches) {
            const [team1, team2] = match;
            
            // Skip if team doesn't exist in this division
            if (!TEAM_ROLES[division]?.[team1] || !TEAM_ROLES[division]?.[team2]) {
                continue;
            }
            
            const thread = await createMatchThread(channel, weekNumber, matchNumber, team1, team2, division, guild);
            
            if (thread) {
                await saveThreadInfo(weekNumber, division, team1, team2, thread.id, matchNumber);
                createdThreads.push({
                    division,
                    team1,
                    team2,
                    threadId: thread.id,
                    matchNumber
                });
            }
            
            matchNumber++;
            
            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    Logger.success(`Created ${createdThreads.length} threads for Week ${weekNumber}`);
    return { success: true, count: createdThreads.length, threads: createdThreads };
}

/**
 * Delete all threads for a specific week (with transcript saving)
 */
async function deleteWeekThreads(guild, weekNumber, client) {
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
                // Generate and save transcript before deleting
                if (transcriptChannel) {
                    try {
                        const transcript = await generateWeekThreadTranscript(
                            thread, 
                            weekNumber, 
                            record.division, 
                            record.team1, 
                            record.team2
                        );
                        
                        if (transcript) {
                            try {
                                // Upload to dpaste for viewing
                                const title = `Week ${weekNumber}: ${record.division} - ${record.team1} vs ${record.team2}`;
                                const rawUrl = await uploadHTMLToPaste(transcript, title);
                                
                                // Create an HTML viewer URL using htmlpreview.github.io
                                const viewerUrl = `https://htmlpreview.github.io/?${encodeURIComponent(rawUrl)}`;
                                
                                const fileName = `Week${weekNumber}-${record.division}-${record.team1.replace(/\s+/g, '')}-vs-${record.team2.replace(/\s+/g, '')}.html`;
                                const transcriptBuffer = Buffer.from(transcript, 'utf8');
                                
                                const transcriptEmbed = new EmbedBuilder()
                                    .setTitle(`Week ${weekNumber}: ${record.division}`)
                                    .setDescription(
                                        `**${record.team1}** vs **${record.team2}**\n\n` +
                                        `**View Options:**\n` +
                                        `• [🌐 Interactive Viewer](${viewerUrl})\n` +
                                        `• [📄 Raw HTML](${rawUrl})\n` +
                                        `• 📥 Download the file attached below`
                                    )
                                    .addFields(
                                        { name: 'Division', value: record.division, inline: true },
                                        { name: 'Week', value: `${weekNumber}`, inline: true },
                                        { name: 'Archived', value: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }), inline: true }
                                    )
                                    .setColor(0x3498DB)
                                    .setTimestamp();
                                
                                await transcriptChannel.send({
                                    embeds: [transcriptEmbed],
                                    files: [{
                                        attachment: transcriptBuffer,
                                        name: fileName
                                    }]
                                });
                                transcriptCount++;
                            } catch (uploadError) {
                                Logger.error('Failed to upload transcript to dpaste', uploadError);
                                
                                // Fallback: just send the file
                                const fileName = `Week${weekNumber}-${record.division}-${record.team1.replace(/\s+/g, '')}-vs-${record.team2.replace(/\s+/g, '')}.html`;
                                const transcriptBuffer = Buffer.from(transcript, 'utf8');
                                
                                const transcriptEmbed = new EmbedBuilder()
                                    .setTitle(`Week ${weekNumber}: ${record.division}`)
                                    .setDescription(`**${record.team1}** vs **${record.team2}**\n\n⚠️ Online viewer unavailable. Download the HTML file below to view the transcript.`)
                                    .addFields(
                                        { name: 'Division', value: record.division, inline: true },
                                        { name: 'Week', value: `${weekNumber}`, inline: true },
                                        { name: 'Archived', value: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }), inline: true }
                                    )
                                    .setColor(0x3498DB)
                                    .setTimestamp();
                                
                                await transcriptChannel.send({
                                    embeds: [transcriptEmbed],
                                    files: [{
                                        attachment: transcriptBuffer,
                                        name: fileName
                                    }]
                                });
                                transcriptCount++;
                            }
                        }
                    } catch (transcriptError) {
                        Logger.error(`Failed to save transcript for ${record.team1} vs ${record.team2}`, transcriptError);
                    }
                }
                
                await thread.delete(`Week ${weekNumber} thread cleanup`);
                deletedCount++;
            } else {
                // Thread doesn't exist anymore, still count as handled
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
 * Schedule automatic thread creation for all weeks
 */
function scheduleAutoCreation(client) {
    const now = new Date();
    
    for (let week = 1; week <= 8; week++) {
        const startDate = WEEK_START_DATES[week];
        const timeUntilStart = startDate.getTime() - now.getTime();
        
        // Only schedule if the date is in the future
        if (timeUntilStart > 0) {
            // Clear any existing scheduled item for this week
            if (scheduledWeekCreations.has(week)) {
                const existing = scheduledWeekCreations.get(week);
                if (existing.type === 'interval') {
                    clearInterval(existing.ref);
                } else if (existing.type === 'timeout') {
                    clearTimeout(existing.ref);
                } else {
                    clearTimeout(existing);
                }
            }
            
            const callback = async () => {
                Logger.info(`Auto-creating Week ${week} threads...`);
                
                try {
                    // Check database availability before attempting
                    if (!isDatabaseAvailable()) {
                        Logger.error(`Cannot auto-create Week ${week} threads: Database not available`);
                        return;
                    }
                    
                    // Check if threads already exist for this week (prevent duplicates)
                    const alreadyExists = await weekThreadsExist(week);
                    if (alreadyExists) {
                        Logger.warning(`Week ${week} threads already exist - skipping auto-creation`);
                        return;
                    }
                    
                    const guild = client.guilds.cache.first();
                    if (guild) {
                        const result = await createWeekThreads(guild, week, client);
                        if (result.success) {
                            Logger.success(`Auto-created ${result.count} threads for Week ${week}`);
                        } else {
                            Logger.error(`Failed to auto-create Week ${week} threads: ${result.error}`);
                        }
                    }
                } catch (error) {
                    Logger.error(`Error auto-creating Week ${week} threads`, error);
                }
                
                // Remove from scheduled map
                scheduledWeekCreations.delete(week);
            };
            
            const scheduled = scheduleAt(startDate, callback, week);
            if (scheduled) {
                scheduledWeekCreations.set(week, scheduled);
                
                const startDateStr = startDate.toLocaleString('en-US', { 
                    timeZone: 'America/New_York',
                    dateStyle: 'full',
                    timeStyle: 'short'
                });
                Logger.info(`Scheduled Week ${week} thread creation for ${startDateStr} EST`);
            }
        } else {
            Logger.info(`Week ${week} start date has passed (${startDate.toISOString()}), skipping`);
        }
    }
}

/**
 * Cancel all scheduled auto-creations
 */
function cancelAllScheduled() {
    for (const [week, scheduled] of scheduledWeekCreations) {
        if (scheduled.type === 'interval') {
            clearInterval(scheduled.ref);
        } else if (scheduled.type === 'timeout') {
            clearTimeout(scheduled.ref);
        } else {
            clearTimeout(scheduled);
        }
        Logger.info(`Cancelled scheduled creation for Week ${week}`);
    }
    scheduledWeekCreations.clear();
}

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
                .setDescription('Week number (1-8)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(8)
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
                // Check if threads already exist
                const threadsExist = await weekThreadsExist(weekNumber);
                if (threadsExist) {
                    return await interaction.editReply({
                        content: `❌ Week ${weekNumber} threads already exist. Use the **Delete** action first if you want to recreate them.`,
                    });
                }

                await interaction.editReply({
                    content: `⏳ Creating Week ${weekNumber} match threads... This may take a few minutes.`,
                });

                const result = await createWeekThreads(interaction.guild, weekNumber, interaction.client);

                if (result.success) {
                    await interaction.followUp({
                        content: `✅ Successfully created **${result.count}** match threads for Week ${weekNumber}!\n\nThreads have been created in <#${MATCHES_CHANNEL_ID}>.`,
                        ephemeral: true
                    });
                } else {
                    await interaction.followUp({
                        content: `❌ Failed to create threads: ${result.error}`,
                        ephemeral: true
                    });
                }

            } else if (action === 'delete') {
                await interaction.editReply({
                    content: `⏳ Deleting Week ${weekNumber} match threads...`,
                });

                const result = await deleteWeekThreads(interaction.guild, weekNumber, interaction.client);

                if (result.success) {
                    await interaction.followUp({
                        content: `✅ Successfully deleted **${result.deletedCount}** match threads for Week ${weekNumber}.${result.failedCount > 0 ? ` (${result.failedCount} failed to delete)` : ''}`,
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
    scheduleAutoCreation,
    cancelAllScheduled,
    createWeekThreads,
    deleteWeekThreads
};
