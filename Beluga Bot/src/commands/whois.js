const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');

const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

// Cooldown management (5 seconds per user)
const cooldowns = new Map();
const COOLDOWN_DURATION = 5000; // 5 seconds in milliseconds

class GoogleSheetsManager {
    constructor() {
        this.auth = null;
        this.sheets = null;
    }

    async initialize() {
        try {
            if (this.auth) return true;
            
            let credentials;
            if (config.sheets.credentialsJson) {
                credentials = config.sheets.credentialsJson;
            } else {
                const credentialsPath = path.join(__dirname, '../../', config.sheets.credentials);
                if (!fs.existsSync(credentialsPath)) {
                    throw new Error('Google Sheets credentials not found');
                }
                credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            }

            const { client_email, private_key } = credentials;
            
            this.auth = new google.auth.JWT(
                client_email,
                null,
                private_key.replace(/\\n/g, '\n'),
                ['https://www.googleapis.com/auth/spreadsheets.readonly']
            );
            
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            return true;
        } catch (error) {
            Logger.error('Failed to initialize Google Sheets', error);
            return false;
        }
    }

    async getPlayerDirectory(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'Player Directory!A:O';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });
            
            const rows = response.data.values || [];
            const userIdString = String(userId);
            
            // Find user by Discord ID in column B (index 1)
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 2 && String(row[1]) === userIdString) {
                    return {
                        found: true,
                        username: row[0] || 'N/A',           // Column A
                        userId: row[1] || 'N/A',             // Column B
                        displayName: row[2] || 'N/A',        // Column C
                        salary: row[3] || 'N/A',             // Column D
                        league: row[4] || 'N/A',             // Column E
                        team: row[5] || 'N/A',               // Column F
                        freeAgent: row[6] || '',             // Column G
                        ineligible: row[7] || '',            // Column H
                        suspended: row[8] || '',             // Column I
                        mainTracker: row[9] || '',           // Column J
                        altTrackers: row[10] || '',          // Column K
                        isGM: row[11] || '',                 // Column L
                        aaCaptain: row[12] || '',            // Column M
                        aaaCaptain: row[13] || '',           // Column N
                        majorsCaptain: row[14] || ''         // Column O
                    };
                }
            }
            
            return { found: false };
        } catch (error) {
            Logger.error('Failed to get player directory data', error);
            throw error;
        }
    }

    async getSalSheetData(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'SalSheet!A:W';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });
            
            const rows = response.data.values || [];
            const userIdString = String(userId);
            
            // Find user by Discord ID in column P (index 15)
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 16 && String(row[15]) === userIdString) {
                    return {
                        found: true,
                        displayName: row[1] || 'N/A',        // Column B (nickname)
                        salary: row[14] || 'N/A',            // Column O
                        freeAgent: row[8] || '',             // Column I
                        eligible: row[9] || '',              // Column J
                        inReserve: row[10] || '',            // Column K
                        suspended: row[11] || '',            // Column L
                        division: row[17] || '',             // Column R
                        rfa: row[20] || '',                  // Column U (RFA status)
                        rfaExpiry: row[21] || '',            // Column V (RFA expiry date)
                        irExpiry: row[22] || ''              // Column W (IR expiry date)
                    };
                }
            }
            
            return { found: false };
        } catch (error) {
            Logger.error('Failed to get sal sheet data', error);
            throw error;
        }
    }

    async getMemberPullData(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'Member Pull!A:C';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });
            
            const rows = response.data.values || [];
            const userIdString = String(userId);
            
            // Find user by User ID in column B (index 1)
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 2 && String(row[1]) === userIdString) {
                    return {
                        found: true,
                        username: row[0] || 'N/A'  // Column A (actual Discord username)
                    };
                }
            }
            
            return { found: false };
        } catch (error) {
            Logger.error('Failed to get member pull data', error);
            return { found: false };
        }
    }
}

const sheetsManager = new GoogleSheetsManager();

// Helper function to shorten tracker URLs
function shortenTrackerUrl(url) {
    if (!url || url.trim() === '') return null;
    
    try {
        // Extract the profile path from the URL
        const match = url.match(/rocket-league\/profile\/([^\/]+)\/([^\/\s]+)/i);
        if (match) {
            const platform = match[1];
            const username = match[2];
            // Create a markdown link with just the username
            return `[${username}](${url})`;
        }
        // If pattern doesn't match, just return the URL as a link
        return `[View Tracker](${url})`;
    } catch (error) {
        return url;
    }
}

// Helper function to parse multiple tracker URLs
function parseTrackerUrls(trackerString) {
    if (!trackerString || trackerString.trim() === '') return [];
    
    // Split by common delimiters (newline, comma, semicolon)
    const urls = trackerString.split(/[\n,;]+/).map(url => url.trim()).filter(url => url.length > 0);
    return urls;
}

// Helper function to format status badges
function getStatusBadges(playerData, salSheetData) {
    const badges = [];
    
    // Use SalSheet data for status (priority source)
    if (salSheetData) {
        if (salSheetData.freeAgent && salSheetData.freeAgent.toUpperCase() === 'YES') {
            badges.push('🟢 **Free Agent**');
        }
        if (salSheetData.rfa && salSheetData.rfa.toUpperCase() === 'YES') {
            badges.push('🔒 **Restricted Free Agent (RFA)**');
        }
        if (salSheetData.inReserve && salSheetData.inReserve.toUpperCase() === 'YES') {
            badges.push('🏥 **In Reserve (IR)**');
        }
        if (salSheetData.eligible && salSheetData.eligible.toUpperCase() !== 'YES') {
            badges.push('🔴 **Ineligible**');
        }
        if (salSheetData.suspended && salSheetData.suspended.toUpperCase() === 'YES') {
            badges.push('🔴 **Suspended**');
        }
    } else {
        // Fallback to Player Directory data
        if (playerData.freeAgent && playerData.freeAgent.toUpperCase() === 'FA') {
            badges.push('🟢 **Free Agent**');
        }
        if (playerData.ineligible && playerData.ineligible.trim() !== '') {
            badges.push('🔴 **Ineligible**');
        }
        if (playerData.suspended && playerData.suspended.trim() !== '') {
            badges.push('🔴 **Suspended**');
        }
    }
    
    return badges.length > 0 ? badges.join(' • ') : null;
}

// Helper function to get captain roles
function getCaptainRoles(playerData) {
    const captainRoles = [];
    
    if (playerData.aaCaptain && playerData.aaCaptain.trim() !== '') {
        captainRoles.push('AA Captain');
    }
    if (playerData.aaaCaptain && playerData.aaaCaptain.trim() !== '') {
        captainRoles.push('AAA Captain');
    }
    if (playerData.majorsCaptain && playerData.majorsCaptain.trim() !== '') {
        captainRoles.push('Majors Captain');
    }
    
    return captainRoles;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('who-is')
        .setDescription('View detailed information about a player')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to lookup')
                .setRequired(true)),

    async execute(interaction) {
        try {
            // Check cooldown
            const userId = interaction.user.id;
            const now = Date.now();
            
            if (cooldowns.has(userId)) {
                const expirationTime = cooldowns.get(userId) + COOLDOWN_DURATION;
                
                if (now < expirationTime) {
                    const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
                    await interaction.reply({
                        content: `⏱️ Please wait ${timeLeft} more seconds before using this command again.`,
                        ephemeral: true
                    });
                    return;
                }
            }
            
            // Set cooldown
            cooldowns.set(userId, now);
            setTimeout(() => cooldowns.delete(userId), COOLDOWN_DURATION);

            await interaction.deferReply();

            const targetUser = interaction.options.getUser('user');
            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

            Logger.info(`User ${interaction.user.tag} requested info for ${targetUser.tag}`);

            // PRIORITY 1: Check SalSheet first (determines if registered)
            const salSheetData = await sheetsManager.getSalSheetData(targetUser.id);
            
            if (!salSheetData.found) {
                // User not found in SalSheet = NOT REGISTERED
                const notFoundEmbed = new EmbedBuilder()
                    .setTitle('❌ Player Not Found')
                    .setDescription(`**${targetUser.username}** is not registered in the Beluga League system.`)
                    .setColor(0xFF0000)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                    .setTimestamp()
                    .setFooter({ text: 'This user needs to register using /register' });

                await interaction.editReply({ embeds: [notFoundEmbed] });
                return;
            }

            // Get username from Member Pull (Column A)
            const memberPullData = await sheetsManager.getMemberPullData(targetUser.id);
            const username = memberPullData.found ? memberPullData.username : targetUser.username;
            const displayName = salSheetData.displayName;

            // User is registered (found in SalSheet), now try to get additional data from Player Directory
            let playerData = await sheetsManager.getPlayerDirectory(targetUser.id);
            
            if (!playerData.found) {
                // User exists in SalSheet but not in Player Directory (not fully processed)
                const clickableProfile = targetMember ? `${targetMember}` : `<@${targetUser.id}>`;
                
                const partialEmbed = new EmbedBuilder()
                    .setTitle('ℹ️ Player Information')
                    .setDescription(`**${clickableProfile}** is registered in the system but not yet fully processed in the Player Directory.`)
                    .setColor(0xFFA500)
                    .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                    .setTimestamp()
                    .setFooter({ text: 'Player data from SalSheet' });

                // Basic fields
                partialEmbed.addFields([
                    { name: '👤 Username', value: `\`${username}\``, inline: true },
                    { name: '📛 Display Name', value: clickableProfile, inline: true },
                    { name: '🆔 User ID', value: String(targetUser.id), inline: true }
                ]);

                // Show salary if available
                if (salSheetData.salary && salSheetData.salary !== 'N/A' && salSheetData.salary.trim() !== '') {
                    partialEmbed.addFields([
                        { name: '- Salary', value: `$${salSheetData.salary}`, inline: true }
                    ]);
                }

                // Show division if available
                if (salSheetData.division && salSheetData.division.trim() !== '') {
                    partialEmbed.addFields([
                        { name: '🏆 League', value: salSheetData.division.toUpperCase(), inline: true }
                    ]);
                }

                // Status badges for partial registration
                const partialStatusBadges = getStatusBadges(null, salSheetData);
                if (partialStatusBadges) {
                    partialEmbed.addFields([
                        { name: '📊 Status', value: partialStatusBadges, inline: false }
                    ]);
                }

                // IR Expiry Date
                if (salSheetData.inReserve && salSheetData.inReserve.toUpperCase() === 'YES' && salSheetData.irExpiry) {
                    const irExpiryDate = new Date(salSheetData.irExpiry);
                    const formattedIRDate = irExpiryDate.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric' 
                    });
                    partialEmbed.addFields([
                        { name: '🏥 IR Release Date', value: `**${formattedIRDate}**`, inline: true }
                    ]);
                }

                // RFA Expiry Date
                if (salSheetData.rfa && salSheetData.rfa.toUpperCase() === 'YES' && salSheetData.rfaExpiry) {
                    // Display the stored date+time directly (already in EST format)
                    partialEmbed.addFields([
                        { name: '🔒 RFA Release Date', value: `**${salSheetData.rfaExpiry}**`, inline: true }
                    ]);
                }

                partialEmbed.addFields([
                    { name: '📊 Processing Status', value: 'Pending Full Registration', inline: false }
                ]);

                await interaction.editReply({ embeds: [partialEmbed] });
                return;
            }

            // ---- Professional profile: identity -> team/salary -> status ->
            // roles -> career stats -> trackers -> membership. Embed colored
            // with the player's team color from the database.
            const clickableProfile = targetMember ? `${targetMember}` : `<@${targetUser.id}>`;
            const teamInfo = playerData.team !== 'N/A' ? playerData.team : null;
            const leagueInfo = playerData.league !== 'N/A' ? playerData.league.toUpperCase() : null;

            let embedColor = 0x2B6CB0;
            let statsLine = null;
            try {
                const { findTeam, getTeamColorInt } = require('../utils/teamRoles');
                if (teamInfo) {
                    const dbTeam = await findTeam(teamInfo, leagueInfo === 'MAJORS' ? 'Majors' : leagueInfo);
                    if (dbTeam) embedColor = await getTeamColorInt(dbTeam.id);
                }
                const { pool, isDatabaseAvailable } = require('../utils/database');
                if (typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable) {
                    const s = await pool.query(
                        `SELECT SUM(games)::int AS games, SUM(goals)::int AS goals, SUM(assists)::int AS assists,
                                SUM(saves)::int AS saves, SUM(mvps)::int AS mvps
                         FROM stats_player_lifetime WHERE discord_id = $1`,
                        [String(targetUser.id)]
                    );
                    const st = s.rows[0];
                    if (st && Number(st.games) > 0) {
                        statsLine = `${st.games} games · ${st.goals} goals · ${st.assists} assists · ${st.saves} saves · ${st.mvps} MVPs`;
                    }
                }
            } catch { /* profile renders without stats */ }

            const embed = new EmbedBuilder()
                .setAuthor({ name: 'Beluga League — Player Profile', iconURL: interaction.client.user.displayAvatarURL() })
                .setTitle(displayName)
                .setColor(embedColor)
                .setThumbnail(targetUser.displayAvatarURL({ dynamic: true, size: 256 }))
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

            embed.addFields(
                { name: 'Player', value: `${clickableProfile}\n\`${username}\` · \`${playerData.userId}\``, inline: true },
                { name: 'Team', value: teamInfo ? `**${teamInfo}**${leagueInfo ? `\n${leagueInfo}` : ''}` : '*Free agent*', inline: true },
                { name: 'Salary', value: playerData.salary !== 'N/A' ? `$${String(playerData.salary).replace(/^\$/, '')}` : '—', inline: true },
            );

            const statusBadges = getStatusBadges(playerData, salSheetData);
            const statusBits = [];
            if (statusBadges) statusBits.push(statusBadges);
            if (salSheetData.inReserve && salSheetData.inReserve.toUpperCase() === 'YES' && salSheetData.irExpiry) {
                const d = new Date(salSheetData.irExpiry);
                statusBits.push(`IR until **${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}**`);
            }
            if (salSheetData.rfa && salSheetData.rfa.toUpperCase() === 'YES' && salSheetData.rfaExpiry) {
                statusBits.push(`RFA until **${salSheetData.rfaExpiry}**`);
            }
            if (statusBits.length) embed.addFields({ name: 'Status', value: statusBits.join('\n'), inline: false });

            const captainRoles = getCaptainRoles(playerData);
            const rolesList = [];
            if (playerData.isGM && playerData.isGM.trim() !== '') rolesList.push('**General Manager**');
            if (captainRoles.length > 0) rolesList.push(`**${captainRoles.join(', ')}**`);
            if (rolesList.length) embed.addFields({ name: 'League Roles', value: rolesList.join(' · '), inline: false });

            if (statsLine) embed.addFields({ name: 'Career Stats', value: statsLine, inline: false });

            const trackerLines = [];
            if (playerData.mainTracker && playerData.mainTracker.trim() !== '') {
                const main = shortenTrackerUrl(playerData.mainTracker);
                if (main) trackerLines.push(`Main: ${main}`);
            }
            if (playerData.altTrackers && playerData.altTrackers.trim() !== '') {
                const altUrls = parseTrackerUrls(playerData.altTrackers);
                altUrls.slice(0, 4).forEach((u, i) => {
                    const link = shortenTrackerUrl(u);
                    if (link) trackerLines.push(`Alt ${i + 1}: ${link}`);
                });
                if (altUrls.length > 4) trackerLines.push(`*…and ${altUrls.length - 4} more*`);
            }
            if (trackerLines.length) embed.addFields({ name: 'Trackers', value: trackerLines.join('\n'), inline: false });

            const joined = targetMember?.joinedAt ? `<t:${Math.floor(targetMember.joinedAt.getTime() / 1000)}:R>` : null;
            const created = `<t:${Math.floor(targetUser.createdAt.getTime() / 1000)}:R>`;
            embed.addFields({
                name: 'Discord',
                value: `${joined ? `Joined server ${joined} · ` : ''}Account created ${created}`,
                inline: false,
            });

            const site = process.env.RAILWAY_PUBLIC_DOMAIN;
            if (site) {
                embed.addFields({ name: 'Full profile', value: `https://${site}/players/${encodeURIComponent(String(targetUser.id))}`, inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
            Logger.success(`Player info sent for ${targetUser.tag}`);

        } catch (error) {
            Logger.error('Failed to execute who-is command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while fetching player information. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },
};
