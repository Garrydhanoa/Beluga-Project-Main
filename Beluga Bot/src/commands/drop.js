const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, NP_ROLES } = require('../constants/roles');
const { TransactionDB } = require('../utils/database');
const { attachTeamLogo } = require('../utils/teamRoles');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const RFA_CHANNEL_ID = '1263723227872755732';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

// Pending drop transactions
const pendingDrops = new Map();

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
                ['https://www.googleapis.com/auth/spreadsheets']
            );
            
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            return true;
        } catch (error) {
            Logger.error('Failed to initialize Google Sheets', error);
            return false;
        }
    }

    async getUsername(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'SalSheet!B:P';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });
            
            const rows = response.data.values || [];
            const userIdString = String(userId);
            
            // Find user by Discord ID in column P (index 14 in B:P range)
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 15 && String(row[14]) === userIdString) {
                    return row[0]; // Column B (index 0 in B:P range)
                }
            }
            
            return null;
        } catch (error) {
            Logger.error('Failed to get username from sheet', error);
            return null;
        }
    }

    async getUserRowIndex(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'SalSheet!P:P';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });
            
            const rows = response.data.values || [];
            const userIdString = String(userId);
            
            for (let i = 0; i < rows.length; i++) {
                if (String(rows[i][0]) === userIdString) {
                    return i + 1; // 1-indexed
                }
            }
            
            return null;
        } catch (error) {
            Logger.error('Failed to find user row index', error);
            throw error;
        }
    }

    async getIRStatus(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'SalSheet!K:P';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });
            
            const rows = response.data.values || [];
            const userIdString = String(userId);
            
            // Find user by Discord ID in column P (index 5 in K:P range)
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.length >= 6 && String(row[5]) === userIdString) {
                    return row[0]; // Column K (index 0 in K:P range)
                }
            }
            
            return null;
        } catch (error) {
            Logger.error('Failed to get IR status', error);
            return null;
        }
    }

    async updatePlayerDrop(rowIndex, isPlayerDecision) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const updates = [];

            if (isPlayerDecision) {
                // Player decision (RFA) - Keep FA as NO, set RFA status
                // Update RFA status (Column U)
                updates.push({
                    range: `SalSheet!U${rowIndex}`,
                    values: [['YES']]
                });

                // Update RFA expiry date (Column V) - 1 week from now in EST
                const now = new Date();
                const expiryDate = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)); // Add 7 days in milliseconds
                const formattedDateTime = expiryDate.toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                    month: 'numeric',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                }) + ' EST';
                
                updates.push({
                    range: `SalSheet!V${rowIndex}`,
                    values: [[formattedDateTime]]
                });
            } else {
                // Team decision - Set FA to YES (normal free agent)
                updates.push({
                    range: `SalSheet!I${rowIndex}`,
                    values: [['YES']]
                });
            }

            // Set Playing to YES (Column M) - regardless of player or team decision
            updates.push({
                range: `SalSheet!M${rowIndex}`,
                values: [['YES']]
            });

            // Clear IR status (Column K) - set to NO
            updates.push({
                range: `SalSheet!K${rowIndex}`,
                values: [['NO']]
            });

            // Clear IR expiry date (Column W)
            updates.push({
                range: `SalSheet!W${rowIndex}`,
                values: [['']]
            });

            // Batch update
            await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'RAW',
                    data: updates
                }
            });

            Logger.success(`Updated drop status for row ${rowIndex}`);
            return true;
        } catch (error) {
            Logger.error('Failed to update player drop', error);
            return false;
        }
    }
}

const sheetsManager = new GoogleSheetsManager();

// Team logo for embeds — DB only (team→franchise logo). Returns an
// AttachmentBuilder named team_logo.png or null. (Was IMAGES/logos/*.png.)
async function teamLogoAttachment(teamName) {
    return attachTeamLogo(null, teamName);
}

// Helper function to get player's team and division (checks team roles first, then NP roles with league role for division)
function getPlayerTeamAndDivision(member) {
    // Check regular team roles first
    for (const [division, teams] of Object.entries(TEAM_ROLES)) {
        for (const [teamName, roleId] of Object.entries(teams)) {
            if (member.roles.cache.has(roleId)) {
                return { teamName, division };
            }
        }
    }
    
    // Check NP roles - need to get division from their league role
    for (const [teamName, npRoleId] of Object.entries(NP_ROLES)) {
        if (member.roles.cache.has(npRoleId)) {
            // Get division from league role
            for (const [division, divisionRoleId] of Object.entries(ROLES.DIVISIONS)) {
                if (member.roles.cache.has(divisionRoleId)) {
                    return { teamName, division };
                }
            }
        }
    }
    
    return null;
}

// Helper function to get user's team name from their roles (scans all divisions including NP)
function getUserTeamNameAllDivisions(member) {
    // Scan all divisions to find which team the user belongs to
    for (const [division, teams] of Object.entries(TEAM_ROLES)) {
        for (const [teamName, roleId] of Object.entries(teams)) {
            if (member.roles.cache.has(roleId)) {
                return teamName;
            }
        }
    }
    
    // Check NP roles
    for (const [teamName, npRoleId] of Object.entries(NP_ROLES)) {
        if (member.roles.cache.has(npRoleId)) {
            return teamName;
        }
    }
    
    return null;
}

// Helper function to get user's team name from their roles in a specific division
function getUserTeamName(member, division) {
    const divisionUpper = division.toUpperCase();
    const teamRoles = TEAM_ROLES[divisionUpper];
    
    if (!teamRoles) return null;
    
    for (const [teamName, roleId] of Object.entries(teamRoles)) {
        if (member.roles.cache.has(roleId)) {
            return teamName;
        }
    }
    
    return null;
}

// Helper function to check if user can drop players
function canUserDrop(member, targetMember, division) {
    // Check if Salary Crew
    if (member.roles.cache.has(ROLES.SALARY_CREW)) {
        return { allowed: true, type: 'salary_crew' };
    }
    
    const playerInfo = getPlayerTeamAndDivision(targetMember);
    if (!playerInfo) {
        return { allowed: false };
    }
    
    // Check if GM (team-specific)
    for (const [teamName, gmRoleId] of Object.entries(ROLES.GM_ROLES)) {
        if (member.roles.cache.has(gmRoleId)) {
            // GM can only drop players from their own team
            if (playerInfo.teamName === teamName) {
                return { allowed: true, type: 'gm', teamName: teamName };
            }
        }
    }
    
    // Check if Captain - collect ALL captain roles they have and check if any match the player's division
    const captainDivisions = [];
    for (const [capDivision, captainRoleId] of Object.entries(ROLES.CAPTAINS)) {
        if (member.roles.cache.has(captainRoleId)) {
            captainDivisions.push(capDivision);
        }
    }
    
    if (captainDivisions.length > 0) {
        // Check if captain has the division role for the player's division
        if (captainDivisions.includes(division)) {
            // Captain must have a team role somewhere (scan all divisions)
            const captainTeamName = getUserTeamNameAllDivisions(member);
            if (captainTeamName) {
                // Captain can only drop players from their own team
                if (playerInfo.teamName === captainTeamName) {
                    return { 
                        allowed: true, 
                        type: 'captain', 
                        divisions: captainDivisions, // Array of all captain divisions
                        teamName: captainTeamName 
                    };
                }
            }
        }
    }
    
    return { allowed: false };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('drop')
        .setDescription('Drop a player from a team')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to drop')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('player_decision')
                .setDescription('Is this the player\'s decision to leave?')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: 64 });

            const player = interaction.options.getUser('player');
            const isPlayerDecision = interaction.options.getBoolean('player_decision');
            
            const playerMember = await interaction.guild.members.fetch(player.id);

            // Get player's current team and division from their team role
            const playerInfo = getPlayerTeamAndDivision(playerMember);
            if (!playerInfo) {
                await interaction.editReply({
                    content: `❌ ${player.username} is not on any team.`,
                });
                return;
            }
            
            const division = playerInfo.division;

            // Check permissions
            const permissionCheck = canUserDrop(interaction.member, playerMember, division);
            if (!permissionCheck.allowed) {
                // Provide specific error message based on user type
                let errorMessage = '❌ You do not have permission to drop this player.';
                
                // Check if user is a GM or Captain but for wrong team
                for (const [teamName, gmRoleId] of Object.entries(ROLES.GM_ROLES)) {
                    if (interaction.member.roles.cache.has(gmRoleId) && teamName !== playerInfo.teamName) {
                        errorMessage = `❌ You are the GM of ${teamName} and can only drop players from your own team. ${player.username} is on ${playerInfo.teamName}.`;
                        break;
                    }
                }
                
                // Check if user has captain roles
                const userCaptainDivisions = [];
                for (const [capDivision, captainRoleId] of Object.entries(ROLES.CAPTAINS)) {
                    if (interaction.member.roles.cache.has(captainRoleId)) {
                        userCaptainDivisions.push(capDivision);
                    }
                }
                
                if (userCaptainDivisions.length > 0) {
                    const captainTeamName = getUserTeamNameAllDivisions(interaction.member);
                    if (!userCaptainDivisions.includes(division)) {
                        const divisionsText = userCaptainDivisions.join(', ');
                        errorMessage = `❌ You are a Captain for ${divisionsText} and can only drop players from those divisions. ${player.username} is in ${division}.`;
                    } else if (!captainTeamName) {
                        errorMessage = `❌ You do not have a team role in any division.`;
                    } else if (captainTeamName !== playerInfo.teamName) {
                        errorMessage = `❌ You are the Captain of ${captainTeamName} and can only drop players from your own team. ${player.username} is on ${playerInfo.teamName}.`;
                    }
                }
                
                await interaction.editReply({
                    content: errorMessage,
                });
                return;
            }

            // Get player's row index in sheet
            const rowIndex = await sheetsManager.getUserRowIndex(player.id);
            if (!rowIndex) {
                await interaction.editReply({
                    content: `❌ Could not find ${player.username} in the salary sheet.`,
                });
                return;
            }

            const transactionChannel = await interaction.client.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);

            if (isPlayerDecision) {
                // Player decision - requires player and Salary Crew approval
                const dropEmbed = new EmbedBuilder()
                    .setTitle('🔔 Player Decision Drop Request')
                    .setDescription(`${player}, are you sure you want to leave **${playerInfo.teamName}**?\n\n⚠️ **Important:** If you accept, you will be placed on **Restricted Free Agent (RFA)** status for **1 week**.`)
                    .addFields(
                        { name: 'Team', value: playerInfo.teamName, inline: true },
                        { name: 'Division', value: division, inline: true },
                        { name: 'Player', value: player.username, inline: true },
                        { name: 'Requested By', value: interaction.user.username, inline: true }
                    )
                    .setColor(0xFFA500)
                    .setTimestamp()
                    .setFooter({ text: '✅ to confirm or ❌ to cancel. You and Salary Crew must confirm.' });

                const dropMessage = await transactionChannel.send({
                    content: `${player} - React ✅ to confirm you want to leave the team or ❌ to cancel. **Salary Crew** must also approve with ✅.`,
                    embeds: [dropEmbed]
                });

                await dropMessage.react('✅');
                await dropMessage.react('❌');

                pendingDrops.set(dropMessage.id, {
                    playerId: player.id,
                    playerUsername: player.username,
                    teamName: playerInfo.teamName,
                    division: division,
                    requestedBy: interaction.user.id,
                    requestedByUsername: interaction.user.username,
                    playerAccepted: false,
                    salaryCrewAccepted: false,
                    isPlayerDecision: true,
                    rowIndex: rowIndex,
                    expiresAt: Date.now() + (12 * 60 * 60 * 1000)
                });

                setTimeout(async () => {
                    const drop = pendingDrops.get(dropMessage.id);
                    if (drop && (!drop.playerAccepted || !drop.salaryCrewAccepted)) {
                        pendingDrops.delete(dropMessage.id);
                        try {
                            await dropMessage.edit({
                                content: '⏱️ This drop request has expired.',
                                embeds: [dropEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                            });
                        } catch (error) {
                            Logger.error('Failed to mark drop as expired', error);
                        }
                    }
                }, 12 * 60 * 60 * 1000);

                await interaction.editReply({
                    content: '✅ Drop request sent! Waiting for player and Salary Crew confirmation.',
                });

            } else {
                // Team decision - only requires Salary Crew approval
                const dropEmbed = new EmbedBuilder()
                    .setTitle('🔔 Team Drop Request')
                    .setDescription(`**${playerInfo.teamName}** wants to drop ${player.username} from the roster.`)
                    .addFields(
                        { name: 'Team', value: playerInfo.teamName, inline: true },
                        { name: 'Division', value: division, inline: true },
                        { name: 'Player', value: player.username, inline: true },
                        { name: 'Requested By', value: interaction.user.username, inline: true }
                    )
                    .setColor(0xFF6B6B)
                    .setTimestamp()
                    .setFooter({ text: 'Salary Crew: React ✅ to approve or ❌ to deny.' });

                const dropMessage = await transactionChannel.send({
                    content: `**Salary Crew**: Please review this drop request for ${player.username}.`,
                    embeds: [dropEmbed]
                });

                await dropMessage.react('✅');
                await dropMessage.react('❌');

                pendingDrops.set(dropMessage.id, {
                    playerId: player.id,
                    playerUsername: player.username,
                    teamName: playerInfo.teamName,
                    division: division,
                    requestedBy: interaction.user.id,
                    requestedByUsername: interaction.user.username,
                    salaryCrewAccepted: false,
                    isPlayerDecision: false,
                    rowIndex: rowIndex,
                    expiresAt: Date.now() + (12 * 60 * 60 * 1000)
                });

                setTimeout(async () => {
                    const drop = pendingDrops.get(dropMessage.id);
                    if (drop && !drop.salaryCrewAccepted) {
                        pendingDrops.delete(dropMessage.id);
                        try {
                            await dropMessage.edit({
                                content: '⏱️ This drop request has expired.',
                                embeds: [dropEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                            });
                        } catch (error) {
                            Logger.error('Failed to mark drop as expired', error);
                        }
                    }
                }, 12 * 60 * 60 * 1000);

                await interaction.editReply({
                    content: '✅ Drop request sent! Waiting for Salary Crew approval.',
                });
            }

        } catch (error) {
            Logger.error('Failed to execute drop command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the drop request. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    async handleReaction(reaction, user, client) {
        try {
            if (user.bot) return;

            const drop = pendingDrops.get(reaction.message.id);
            if (!drop) return;

            if (Date.now() > drop.expiresAt) {
                pendingDrops.delete(reaction.message.id);
                return;
            }

            const member = await reaction.message.guild.members.fetch(user.id);
            const isPlayer = user.id === drop.playerId;
            const isSalaryCrew = member.roles.cache.has(ROLES.SALARY_CREW);

            // Handle cancellation
            if (reaction.emoji.name === '❌') {
                if (drop.isPlayerDecision) {
                    // Player decision workflow - player or salary crew can cancel
                    if (isPlayer) {
                        pendingDrops.delete(reaction.message.id);
                        const embed = reaction.message.embeds[0];
                        await reaction.message.edit({
                            content: `❌ ${user.username} has cancelled the drop request.`,
                            embeds: [EmbedBuilder.from(embed).setColor(0xFF0000).setFooter({ text: 'Cancelled by player' })]
                        });
                        return;
                    } else if (isSalaryCrew) {
                        pendingDrops.delete(reaction.message.id);
                        const embed = reaction.message.embeds[0];
                        await reaction.message.edit({
                            content: `❌ Drop request denied by Salary Crew.`,
                            embeds: [EmbedBuilder.from(embed).setColor(0xFF0000).setFooter({ text: 'Denied by Salary Crew' })]
                        });
                        return;
                    }
                } else if (!drop.isPlayerDecision && isSalaryCrew) {
                    // Team decision workflow - only salary crew can deny
                    pendingDrops.delete(reaction.message.id);
                    const embed = reaction.message.embeds[0];
                    await reaction.message.edit({
                        content: `❌ Drop request denied by Salary Crew.`,
                        embeds: [EmbedBuilder.from(embed).setColor(0xFF0000).setFooter({ text: 'Denied by Salary Crew' })]
                    });
                    return;
                }
            }

            // Handle approval
            if (reaction.emoji.name === '✅') {
                if (drop.isPlayerDecision) {
                    // Player decision workflow - check if user is the player FIRST
                    if (isPlayer) {
                        drop.playerAccepted = true;
                    } else if (isSalaryCrew) {
                        drop.salaryCrewAccepted = true;
                        drop.approvedBy = user.username;
                    }

                    if (drop.playerAccepted && drop.salaryCrewAccepted) {
                        // Check if already processing to prevent race condition
                        if (drop.isProcessing) {
                            return;
                        }
                        
                        // Mark as processing and remove from pending immediately
                        drop.isProcessing = true;
                        pendingDrops.delete(reaction.message.id);
                        
                        await processDropCompletion(drop, reaction.message, client, true);
                    }
                } else {
                    // Team decision workflow
                    if (isSalaryCrew) {
                        // Check if already processing to prevent race condition
                        if (drop.isProcessing) {
                            return;
                        }
                        
                        // Mark as processing and remove from pending immediately
                        drop.isProcessing = true;
                        drop.salaryCrewAccepted = true;
                        drop.approvedBy = user.username;
                        pendingDrops.delete(reaction.message.id);
                        
                        await processDropCompletion(drop, reaction.message, client, false);
                    }
                }
            }

        } catch (error) {
            Logger.error('Failed to handle drop reaction', error);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingDrops.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending drop transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const drop = pendingDrops.get(transactionId);
                if (!drop) continue;
                
                // Try to fetch the message and update it
                try {
                    const channel = await client.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
                    const message = await channel.messages.fetch(transactionId);
                    
                    const embed = message.embeds[0];
                    const expiredEmbed = EmbedBuilder.from(embed)
                        .setColor(0x808080)
                        .setFooter({ text: '⚠️ Expired due to maintenance' });
                    
                    await message.edit({
                        content: '⚠️ This transaction has expired due to bot maintenance.',
                        embeds: [expiredEmbed]
                    });
                    
                    expiredCount++;
                } catch (messageError) {
                    Logger.warning(`Could not update message ${transactionId}: ${messageError.message}`);
                }
                
                // Remove from pending transactions
                pendingDrops.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire drop transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} drop transactions`);
        return expiredCount;
    }
};

async function processDropCompletion(drop, message, client, isPlayerDecision) {
    try {
        const guild = message.guild;
        const player = await guild.members.fetch(drop.playerId);
        
        // Get role IDs
        const teamRoleId = TEAM_ROLES[drop.division][drop.teamName];
        const npRoleId = NP_ROLES[drop.teamName];
        const freeAgentRoleId = ROLES.FREE_AGENTS[drop.division];
        
        // Remove team role OR NP role
        if (teamRoleId && player.roles.cache.has(teamRoleId)) {
            await player.roles.remove(teamRoleId);
        }
        if (npRoleId && player.roles.cache.has(npRoleId)) {
            await player.roles.remove(npRoleId);
        }
        
        // Remove all captain roles
        for (const captainRoleId of Object.values(ROLES.CAPTAINS)) {
            if (player.roles.cache.has(captainRoleId)) {
                await player.roles.remove(captainRoleId);
                Logger.info(`Removed captain role from ${drop.playerUsername}`);
            }
        }
        
        // Add free agent role
        if (freeAgentRoleId) {
            await player.roles.add(freeAgentRoleId);
        }
        
        // Update sheet
        await sheetsManager.updatePlayerDrop(drop.rowIndex, isPlayerDecision);
        
        // Update Discord nickname from column B
        const sheetUsername = await sheetsManager.getUsername(drop.playerId);
        if (sheetUsername && player.manageable) {
            try {
                await player.setNickname(sheetUsername);
                Logger.info(`Updated nickname to: ${sheetUsername}`);
            } catch (nickError) {
                Logger.warning(`Failed to update nickname: ${nickError.message}`);
            }
        }
        
        // Send confirmation in transactions channel
        const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);
        
        const confirmationEmbed = new EmbedBuilder()
            .setTitle(`${drop.teamName} drop ${drop.playerUsername}`)
            .setDescription(`${player} has been dropped from ${drop.division} league.${isPlayerDecision ? '\n\n⚠️ **Placed on RFA for 1 week**' : ''}`)
            .addFields(
                { name: 'Requested By', value: drop.requestedByUsername, inline: true },
                { name: 'Approved By (Salary Crew)', value: drop.approvedBy, inline: true },
                { name: 'Type', value: isPlayerDecision ? 'Player Decision' : 'Team Decision', inline: true }
            )
            .setColor(0xFF6B6B)
            .setTimestamp();
        
        // Add team logo (from DB)
        const logoAttachment = await teamLogoAttachment(drop.teamName);
        if (logoAttachment) {
            confirmationEmbed.setThumbnail('attachment://team_logo.png');
            await transactionChannel.send({ content: `<@${drop.playerId}>`, embeds: [confirmationEmbed], files: [logoAttachment] });
        } else {
            await transactionChannel.send({ content: `<@${drop.playerId}>`, embeds: [confirmationEmbed] });
        }
        
        // If player decision, send RFA notification
        if (isPlayerDecision) {
            const rfaChannel = await client.channels.fetch(RFA_CHANNEL_ID);
            const rfaExpiryDate = new Date();
            rfaExpiryDate.setDate(rfaExpiryDate.getDate() + 7);
            const rfaExpiryFormatted = rfaExpiryDate.toLocaleString('en-US', { 
                timeZone: 'America/New_York',
                dateStyle: 'full',
                timeStyle: 'short'
            });
            
            const rfaEmbed = new EmbedBuilder()
                .setTitle('🔒 Player Placed on RFA')
                .setDescription(`${player} has been placed on **Restricted Free Agent (RFA)** status.`)
                .addFields(
                    { name: 'Player', value: drop.playerUsername, inline: true },
                    { name: 'Former Team', value: drop.teamName, inline: true },
                    { name: 'Division', value: drop.division, inline: true },
                    
                    { name: 'RFA Expires On', value: rfaExpiryFormatted, inline: false },
                    { name: 'Reason', value: 'Player Decision - Self Drop', inline: false }
                )
                .setColor(0xFFA500)
                .setTimestamp();
            
            await rfaChannel.send({ embeds: [rfaEmbed] });
        }
        
        // Update original message
        const embed = message.embeds[0];
        await message.edit({
            content: '✅ Drop completed successfully!',
            embeds: [EmbedBuilder.from(embed).setColor(0x00FF00).setFooter({ text: 'Completed' })]
        });

        // Log transaction to shared DB.
        const teamId = await TransactionDB.findTeamIdByName(drop.division, drop.teamName);
        await TransactionDB.log({
            discordId: drop.playerId,
            discordUsername: drop.playerUsername,
            teamId,
            teamNameSnapshot: drop.teamName,
            type: isPlayerDecision ? 'rfa' : 'drop',
            details: {
                division: drop.division,
                isPlayerDecision: !!isPlayerDecision,
                requestedByUsername: drop.requestedByUsername,
            },
            performedByDiscordId: drop.requestedBy,
            performedByUsername: drop.requestedByUsername,
            source: 'bot:/drop',
        });

        Logger.success(`Drop completed: ${drop.playerUsername} from ${drop.teamName} (${drop.division}) - Player Decision: ${isPlayerDecision}`);
        
    } catch (error) {
        Logger.error('Failed to process drop completion', error);
        throw error;
    }
}
