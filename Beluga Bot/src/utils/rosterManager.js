const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Logger = require('./logger');
const { RosterDB, isDatabaseAvailable } = require('./database');
const { ROLES, TEAM_ROLES, TEAM_NAMES, TEAM_COLORS, CHANNELS } = require('../constants/roles');
const fs = require('fs');
const path = require('path');

// Channel IDs for each division (roster-specific)
const ROSTER_CHANNELS = {
    MAJORS: '1209370015560769637',
    AAA: '1240859362008895561',
    AA: '1201768054363803668'
};

/**
 * Find team logo path
 */
function findTeamLogo(teamName) {
    const normalizedName = teamName.replace(/\s+/g, ' ').trim();
    const logoPath = path.join(__dirname, '../../IMAGES/logos', `${normalizedName}.png`);
    return logoPath;
}

/**
 * Generate a hash for roster data to detect changes
 */
function generateRosterHash(rosterData) {
    const { teamName, division, gm, captain, players } = rosterData;
    
    const gmId = gm ? gm.id : 'none';
    const captainId = captain ? captain.id : 'none';
    const playerIds = players
        .map(p => p.id)
        .sort()
        .join(',');
    
    return `${teamName}|${division}|${gmId}|${captainId}|${playerIds}`;
}

/**
 * Get team roster data for a specific division
 */
async function getTeamRoster(guild, teamName, division) {
    try {
        const teamRoleId = TEAM_ROLES[division][teamName];
        if (!teamRoleId) return null;

        const teamRole = await guild.roles.fetch(teamRoleId);
        if (!teamRole) return null;

        const members = teamRole.members;
        const captainRoleId = ROLES.CAPTAINS[division];
        const gmRoleId = ROLES.GM_ROLES[teamName];

        // Find captain
        let captain = null;
        if (captainRoleId) {
            const captainRole = await guild.roles.fetch(captainRoleId);
            if (captainRole) {
                for (const [memberId, member] of members) {
                    if (member.roles.cache.has(captainRoleId)) {
                        captain = member;
                        break;
                    }
                }
            }
        }

        // Find GM
        let gm = null;
        if (gmRoleId) {
            const gmRole = await guild.roles.fetch(gmRoleId);
            if (gmRole && gmRole.members.size > 0) {
                gm = gmRole.members.first();
            }
        }

        // Get all players (excluding captain from regular list)
        const players = [];
        for (const [memberId, member] of members) {
            // Include all players in the list
            players.push(member);
        }

        return {
            teamName,
            division,
            gm,
            captain,
            players,
            totalPlayers: members.size
        };
    } catch (error) {
        Logger.error(`Failed to get roster for ${teamName} ${division}`, error);
        return null;
    }
}

/**
 * Create roster embed for a team
 */
function createRosterEmbed(rosterData) {
    const { teamName, division, gm, captain, players, totalPlayers } = rosterData;

    const embed = new EmbedBuilder()
        .setTitle(`${teamName} - ${division}`)
        .setColor(TEAM_COLORS[teamName] || 0x3498DB)
        .setThumbnail('attachment://team_logo.png')
        .setTimestamp();

    // Add GM field
    const gmText = gm ? (gm.nickname || gm.user.username) : '*No GM assigned*';
    embed.addFields({ name: '👑 General Manager', value: gmText, inline: false });

    // Add Captain field
    const captainText = captain ? (captain.nickname || captain.user.username) : '*No captain assigned*';
    embed.addFields({ name: '⭐ Captain', value: captainText, inline: false });

    // Add Players field
    if (players.length > 0) {
        const playersList = players
            .sort((a, b) => {
                const nameA = (a.nickname || a.user.username).toLowerCase();
                const nameB = (b.nickname || b.user.username).toLowerCase();
                return nameA.localeCompare(nameB);
            })
            .map(p => p.nickname || p.user.username)
            .join('\n');
        
        embed.addFields({ name: `👥 Players (${totalPlayers})`, value: playersList, inline: false });
    } else {
        embed.addFields({ name: `👥 Players (${totalPlayers})`, value: '*No players*', inline: false });
    }

    return embed;
}

/**
 * Update roster for a specific division
 */
async function updateDivisionRoster(client, division) {
    try {
        // Check if database is available
        if (!isDatabaseAvailable()) {
            Logger.warning(`Database not available, skipping ${division} roster update`);
            
            // Send skip message to Majors channel only
            if (division === 'MAJORS') {
                try {
                    const majorsChannel = await client.channels.fetch(CHANNELS.MAJORS);
                    if (majorsChannel) {
                        await majorsChannel.send('-# Database Not Available (SKIPPING ROSTER EDITS)');
                    }
                } catch (error) {
                    Logger.error('Failed to send database skip message', error);
                }
            }
            return false;
        }

        const channelId = ROSTER_CHANNELS[division];
        const channel = await client.channels.fetch(channelId);
        
        if (!channel) {
            Logger.error(`Roster channel not found for ${division}: ${channelId}`);
            return false;
        }

        Logger.info(`Updating ${division} roster...`);

        for (const teamName of TEAM_NAMES) {
            // Check if team exists in this division
            if (!TEAM_ROLES[division][teamName]) {
                continue; // Skip teams that don't have this division
            }

            const rosterData = await getTeamRoster(channel.guild, teamName, division);
            if (!rosterData) continue;

            // Generate hash of current roster
            const currentHash = generateRosterHash(rosterData);

            // Check if roster has changed
            const savedMessage = await RosterDB.get(teamName, division);
            
            // If we have a saved message, verify it still exists
            let messageExists = false;
            if (savedMessage && savedMessage.messageId) {
                try {
                    await channel.messages.fetch(savedMessage.messageId);
                    messageExists = true;
                } catch (error) {
                    // Message was deleted
                    messageExists = false;
                    Logger.warning(`Roster message for ${teamName} ${division} was deleted, will recreate`);
                }
            }
            
            // Skip update only if message exists AND hash hasn't changed
            if (messageExists && savedMessage.rosterHash === currentHash) {
                Logger.info(`No changes for ${teamName} ${division}, skipping update`);
                continue;
            }

            const embed = createRosterEmbed(rosterData);

            // Get team logo
            const logoPath = findTeamLogo(teamName);
            const logoAttachment = fs.existsSync(logoPath) 
                ? new AttachmentBuilder(logoPath, { name: 'team_logo.png' })
                : null;

            try {
                if (savedMessage && savedMessage.messageId) {
                    // Try to fetch and edit existing message
                    try {
                        const message = await channel.messages.fetch(savedMessage.messageId);
                        if (logoAttachment) {
                            await message.edit({ embeds: [embed], files: [logoAttachment] });
                        } else {
                            await message.edit({ embeds: [embed] });
                        }
                        await RosterDB.save(teamName, division, channelId, message.id, currentHash);
                        Logger.info(`Updated roster message for ${teamName} ${division}`);
                    } catch (fetchError) {
                        // Message was deleted, create new one
                        Logger.warning(`Roster message deleted for ${teamName} ${division}, creating new one`);
                        const messageOptions = { embeds: [embed] };
                        if (logoAttachment) {
                            messageOptions.files = [logoAttachment];
                        }
                        const newMessage = await channel.send(messageOptions);
                        await RosterDB.save(teamName, division, channelId, newMessage.id, currentHash);
                        Logger.success(`Created new roster message for ${teamName} ${division}`);
                    }
                } else {
                    // Create new message
                    const messageOptions = { embeds: [embed] };
                    if (logoAttachment) {
                        messageOptions.files = [logoAttachment];
                    }
                    const newMessage = await channel.send(messageOptions);
                    await RosterDB.save(teamName, division, channelId, newMessage.id, currentHash);
                    Logger.success(`Created new roster message for ${teamName} ${division}`);
                }
            } catch (error) {
                // Outer catch for any other unexpected errors
                Logger.error(`Failed to create/update roster for ${teamName} ${division}`, error);
            }
        }

        Logger.success(`${division} roster updated successfully`);
        return true;
    } catch (error) {
        Logger.error(`Failed to update ${division} roster`, error);
        return false;
    }
}

/**
 * Update all division rosters
 */
async function updateAllRosters(client) {
    try {
        Logger.info('Starting full roster update...');
        
        await updateDivisionRoster(client, 'MAJORS');
        await updateDivisionRoster(client, 'AAA');
        await updateDivisionRoster(client, 'AA');
        
        Logger.success('All rosters updated successfully');
        return true;
    } catch (error) {
        Logger.error('Failed to update all rosters', error);
        return false;
    }
}

module.exports = {
    updateAllRosters,
    updateDivisionRoster,
    getTeamRoster,
    createRosterEmbed,
    findTeamLogo,
    ROSTER_CHANNELS
};
