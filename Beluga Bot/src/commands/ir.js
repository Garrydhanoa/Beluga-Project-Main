const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { LeagueDB, TransactionDB, isDatabaseAvailable } = require('../utils/database');
const { ROLES, TEAM_ROLES, NP_ROLES } = require('../constants/roles');
const { attachTeamLogo } = require('../utils/teamRoles');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
const DEFAULT_ROSTER_LIMIT = 4;

// Pending IR transactions storage
const pendingIRTransactions = new Map();

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
                    return i + 1;
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

    async updateIRStatus(rowIndex, putOnIR) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const updates = [];

            if (putOnIR) {
                // Set IR to YES (Column K)
                updates.push({
                    range: `SalSheet!K${rowIndex}`,
                    values: [['YES']]
                });

                // Set IR expiry date to 2 weeks from today (Column W)
                const expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + 14);
                const formattedDate = expiryDate.toLocaleDateString('en-US');
                
                updates.push({
                    range: `SalSheet!W${rowIndex}`,
                    values: [[formattedDate]]
                });
            } else {
                // Remove from IR - Set IR to NO (Column K)
                updates.push({
                    range: `SalSheet!K${rowIndex}`,
                    values: [['NO']]
                });

                // Clear IR expiry date (Column W)
                updates.push({
                    range: `SalSheet!W${rowIndex}`,
                    values: [['']]
                });
            }

            // Batch update
            await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    valueInputOption: 'RAW',
                    data: updates
                }
            });

            Logger.success(`Updated IR status for row ${rowIndex}`);
            return true;
        } catch (error) {
            Logger.error('Failed to update IR status', error);
            return false;
        }
    }
}

const sheetsManager = new GoogleSheetsManager();

// Helper function to get player's team and division from their roles
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
    // Scan all divisions for team roles
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

// Helper function to check if user can manage IR
function canUserManageIR(member, targetMember) {
    // Check if Salary Crew
    if (member.roles.cache.has(ROLES.SALARY_CREW)) {
        return { allowed: true, type: 'salary_crew' };
    }
    
    const playerInfo = getPlayerTeamAndDivision(targetMember);
    if (!playerInfo) {
        return { allowed: false };
    }
    
    // Check if GM (team-specific, any division)
    for (const [teamName, gmRoleId] of Object.entries(ROLES.GM_ROLES)) {
        if (member.roles.cache.has(gmRoleId)) {
            // GM can manage IR for their team in any division
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
        // Captain must have a team role somewhere
        const captainTeamName = getUserTeamNameAllDivisions(member);
        if (captainTeamName) {
            // Check if captain has the division role for the player's division
            if (captainDivisions.includes(playerInfo.division)) {
                // Captain can only manage IR for their own team
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

// Helper function to count roster size for a team in a specific division
async function getRosterSize(guild, teamName, division) {
    try {
        const teamRoleId = TEAM_ROLES[division][teamName];
        if (!teamRoleId) return 0;
        
        const role = await guild.roles.fetch(teamRoleId);
        if (!role) return 0;
        
        return role.members.size;
    } catch (error) {
        Logger.error(`Failed to get roster size for ${teamName} in ${division}`, error);
        return 0;
    }
}

async function getRosterLimit(division, teamName) {
    if (!isDatabaseAvailable()) return DEFAULT_ROSTER_LIMIT;
    const limit = await LeagueDB.getTeamRosterLimit(division, teamName);
    return Number.isInteger(limit) ? limit : DEFAULT_ROSTER_LIMIT;
}

// Team logo for embeds — DB only (team→franchise logo). Returns an
// AttachmentBuilder named team_logo.png or null. (Was IMAGES/logos/*.png.)
async function teamLogoAttachment(teamName) {
    return attachTeamLogo(null, teamName);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ir')
        .setDescription('Manage player In Reserve (IR) status')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Put player on IR or remove from IR')
                .setRequired(true)
                .addChoices(
                    { name: 'Put on IR', value: 'put' },
                    { name: 'Remove from IR', value: 'remove' }
                ))
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to manage')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: 64 });

            const action = interaction.options.getString('action');
            const player = interaction.options.getUser('player');
            const playerMember = await interaction.guild.members.fetch(player.id);

            // Get player's current team and division
            const playerInfo = getPlayerTeamAndDivision(playerMember);
            if (!playerInfo) {
                await interaction.editReply({
                    content: `❌ ${player.username} is not on any team.`,
                });
                return;
            }

            // Check permissions
            const permissionCheck = canUserManageIR(interaction.member, playerMember);
            if (!permissionCheck.allowed) {
                let errorMessage = '❌ You do not have permission to manage IR for this player.';
                
                // Provide specific error messages
                for (const [teamName, gmRoleId] of Object.entries(ROLES.GM_ROLES)) {
                    if (interaction.member.roles.cache.has(gmRoleId) && teamName !== playerInfo.teamName) {
                        errorMessage = `❌ You are the GM of ${teamName} and can only manage IR for players on your own team. ${player.username} is on ${playerInfo.teamName}.`;
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
                    if (!userCaptainDivisions.includes(playerInfo.division)) {
                        const divisionsText = userCaptainDivisions.join(', ');
                        errorMessage = `❌ You are a Captain for ${divisionsText} and can only manage IR in those divisions. ${player.username} is in ${playerInfo.division}.`;
                    } else if (!captainTeamName) {
                        errorMessage = `❌ You do not have a team role in any division.`;
                    } else if (captainTeamName !== playerInfo.teamName) {
                        errorMessage = `❌ You are the Captain of ${captainTeamName} and can only manage IR for players on your own team. ${player.username} is on ${playerInfo.teamName}.`;
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

            if (action === 'put') {
                // Put player on IR - Request Salary Crew approval
                
                // Check if player is already on IR
                const currentIRStatus = await sheetsManager.getIRStatus(player.id);
                if (currentIRStatus === 'YES') {
                    await interaction.editReply({
                        content: `❌ ${player.username} is already on IR. They cannot be placed on IR again until removed.`,
                    });
                    return;
                }
                
                // Check NP role exists
                const npRoleId = NP_ROLES[playerInfo.teamName];
                if (!npRoleId) {
                    await interaction.editReply({
                        content: `❌ Could not find Non-Playing role for ${playerInfo.teamName}.`,
                    });
                    return;
                }
                
                // Calculate expiry date
                const expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + 14);
                const formattedExpiryDate = expiryDate.toLocaleDateString('en-US');
                
                // Send IR request to transaction channel for Salary Crew approval
                const transactionChannel = await interaction.client.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
                
                const irRequestEmbed = new EmbedBuilder()
                    .setTitle('🔔 IR Placement Request')
                    .setDescription(`Request to place ${player} on **In Reserve (IR)** status.`)
                    .addFields(
                        { name: 'Player', value: player.username, inline: true },
                        { name: 'Team', value: playerInfo.teamName, inline: true },
                        { name: 'Division', value: playerInfo.division, inline: true },
                        { name: 'Requested By', value: interaction.user.username, inline: true },
                        { name: 'IR Expiry Date', value: formattedExpiryDate, inline: false }
                    )
                    .setColor(0xFFA500)
                    .setTimestamp()
                    .setFooter({ text: 'Salary Crew: React ✅ to approve or ❌ to deny.' });
                
                const irRequestMessage = await transactionChannel.send({
                    content: `**Salary Crew**: Please review this IR placement request for ${player}.`,
                    embeds: [irRequestEmbed]
                });
                
                await irRequestMessage.react('✅');
                await irRequestMessage.react('❌');
                
                // Store IR request data
                pendingIRTransactions.set(irRequestMessage.id, {
                    action: 'put',
                    playerId: player.id,
                    playerUsername: player.username,
                    teamName: playerInfo.teamName,
                    division: playerInfo.division,
                    requestedBy: interaction.user.id,
                    requestedByUsername: interaction.user.username,
                    rowIndex: rowIndex,
                    salaryCrewApproved: false,
                    expiresAt: Date.now() + (12 * 60 * 60 * 1000)
                });
                
                // Set timeout
                setTimeout(async () => {
                    const irRequest = pendingIRTransactions.get(irRequestMessage.id);
                    if (irRequest && !irRequest.salaryCrewApproved) {
                        pendingIRTransactions.delete(irRequestMessage.id);
                        try {
                            await irRequestMessage.edit({
                                content: '⏱️ This IR request has expired.',
                                embeds: [irRequestEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                            });
                        } catch (error) {
                            Logger.error('Failed to mark IR request as expired', error);
                        }
                    }
                }, 12 * 60 * 60 * 1000);
                
                await interaction.editReply({
                    content: '✅ IR placement request sent! Waiting for Salary Crew approval.',
                });
                
            } else if (action === 'remove') {
                // Remove player from IR - Request Salary Crew approval
                
                // Check roster size first
                const currentRosterSize = await getRosterSize(interaction.guild, playerInfo.teamName, playerInfo.division);
                const rosterLimit = await getRosterLimit(playerInfo.division, playerInfo.teamName);
                
                if (currentRosterSize >= rosterLimit) {
                    await interaction.editReply({
                        content: `❌ **Cannot remove from IR:** ${playerInfo.teamName} roster in ${playerInfo.division} is at full capacity (${currentRosterSize}/${rosterLimit} players). The roster must have space before removing a player from IR.`,
                    });
                    return;
                }
                
                // Check team role exists
                const teamRoleId = TEAM_ROLES[playerInfo.division][playerInfo.teamName];
                if (!teamRoleId) {
                    await interaction.editReply({
                        content: `❌ Could not find team role for ${playerInfo.teamName} in ${playerInfo.division}.`,
                    });
                    return;
                }
                
                // Send IR removal request to transaction channel for Salary Crew approval
                const transactionChannel = await interaction.client.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
                
                const irRemovalRequestEmbed = new EmbedBuilder()
                    .setTitle('🔔 IR Removal Request')
                    .setDescription(`Request to remove ${player} from **In Reserve (IR)** status and return to active roster.`)
                    .addFields(
                        { name: 'Player', value: player.username, inline: true },
                        { name: 'Team', value: playerInfo.teamName, inline: true },
                        { name: 'Division', value: playerInfo.division, inline: true },
                        { name: 'Requested By', value: interaction.user.username, inline: true },
                        { name: 'Current Roster Size', value: `${currentRosterSize}/${rosterLimit}`, inline: false }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp()
                    .setFooter({ text: 'Salary Crew: React ✅ to approve or ❌ to deny.' });
                
                const irRemovalRequestMessage = await transactionChannel.send({
                    content: `**Salary Crew**: Please review this IR removal request for ${player}.`,
                    embeds: [irRemovalRequestEmbed]
                });
                
                await irRemovalRequestMessage.react('✅');
                await irRemovalRequestMessage.react('❌');
                
                // Store IR removal request data
                pendingIRTransactions.set(irRemovalRequestMessage.id, {
                    action: 'remove',
                    playerId: player.id,
                    playerUsername: player.username,
                    teamName: playerInfo.teamName,
                    division: playerInfo.division,
                    requestedBy: interaction.user.id,
                    requestedByUsername: interaction.user.username,
                    rowIndex: rowIndex,
                    salaryCrewApproved: false,
                    expiresAt: Date.now() + (12 * 60 * 60 * 1000)
                });
                
                // Set timeout
                setTimeout(async () => {
                    const irRequest = pendingIRTransactions.get(irRemovalRequestMessage.id);
                    if (irRequest && !irRequest.salaryCrewApproved) {
                        pendingIRTransactions.delete(irRemovalRequestMessage.id);
                        try {
                            await irRemovalRequestMessage.edit({
                                content: '⏱️ This IR removal request has expired.',
                                embeds: [irRemovalRequestEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                            });
                        } catch (error) {
                            Logger.error('Failed to mark IR removal request as expired', error);
                        }
                    }
                }, 12 * 60 * 60 * 1000);
                
                await interaction.editReply({
                    content: '✅ IR removal request sent! Waiting for Salary Crew approval.',
                });
            }

        } catch (error) {
            Logger.error('Failed to execute IR command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the IR request. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },
    
    /**
     * Process IR completion after Salary Crew approval
     */
    async processIRCompletion(irTransaction, message, client) {
        const sheetsManager = new GoogleSheetsManager();
        const guild = message.guild;
        
        try {
            const playerMember = await guild.members.fetch(irTransaction.playerId);
            if (!playerMember) {
                await message.channel.send({
                    content: `❌ Could not find player <@${irTransaction.playerId}> in the server.`
                });
                return;
            }
            
            if (irTransaction.action === 'put') {
                // PUT ON IR: Remove team role, add NP role, update sheet
                
                const teamRoleId = TEAM_ROLES[irTransaction.division][irTransaction.teamName];
                const npRoleId = NP_ROLES[irTransaction.teamName];
                
                // Remove team role and add NP role
                if (teamRoleId && playerMember.roles.cache.has(teamRoleId)) {
                    await playerMember.roles.remove(teamRoleId);
                }
                if (npRoleId) {
                    await playerMember.roles.add(npRoleId);
                }
                
                // Update sheet - set IR to YES and add expiry date (2 weeks)
                await sheetsManager.updateIRStatus(irTransaction.rowIndex, true);
                
                // Calculate expiry date
                const expiryDate = new Date();
                expiryDate.setDate(expiryDate.getDate() + 14);
                const formattedExpiryDate = expiryDate.toLocaleDateString('en-US');
                
                // Send confirmation to transaction channel
                const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);
                
                const confirmationEmbed = new EmbedBuilder()
                    .setTitle(`${irTransaction.teamName} - ${irTransaction.playerUsername} placed on IR`)
                    .setDescription(`<@${irTransaction.playerId}> has been placed on **In Reserve (IR)** status.`)
                    .addFields(
                        { name: 'Team', value: irTransaction.teamName, inline: true },
                        { name: 'Division', value: irTransaction.division, inline: true },
                        { name: 'Placed By', value: irTransaction.requestedByUsername, inline: true },
                        { name: 'IR Expiry Date', value: formattedExpiryDate, inline: false }
                    )
                    .setColor(0xFFA500)
                    .setTimestamp();
                
                // Add team logo (from DB)
                const logoAttachment = await teamLogoAttachment(irTransaction.teamName);
                if (logoAttachment) {
                    confirmationEmbed.setThumbnail('attachment://team_logo.png');
                    await transactionChannel.send({
                        content: `<@${irTransaction.playerId}>`,
                        embeds: [confirmationEmbed],
                        files: [logoAttachment]
                    });
                } else {
                    await transactionChannel.send({
                        content: `<@${irTransaction.playerId}>`,
                        embeds: [confirmationEmbed]
                    });
                }
                
                // Log to shared transactions table.
                {
                    const teamId = await TransactionDB.findTeamIdByName(irTransaction.division, irTransaction.teamName);
                    await TransactionDB.log({
                        discordId: irTransaction.playerId,
                        discordUsername: irTransaction.playerUsername,
                        teamId,
                        teamNameSnapshot: irTransaction.teamName,
                        type: 'ir_place',
                        details: { division: irTransaction.division, requestedByUsername: irTransaction.requestedByUsername },
                        performedByDiscordId: irTransaction.requestedBy,
                        performedByUsername: irTransaction.requestedByUsername,
                        source: 'bot:/ir put',
                    });
                }

                Logger.success(`${irTransaction.playerUsername} placed on IR by ${irTransaction.requestedByUsername}`);
                
            } else if (irTransaction.action === 'remove') {
                // REMOVE FROM IR: Add team role, remove NP role, update sheet
                
                const teamRoleId = TEAM_ROLES[irTransaction.division][irTransaction.teamName];
                const npRoleId = NP_ROLES[irTransaction.teamName];
                
                // Add team role and remove NP role
                if (teamRoleId) {
                    await playerMember.roles.add(teamRoleId);
                }
                if (npRoleId && playerMember.roles.cache.has(npRoleId)) {
                    await playerMember.roles.remove(npRoleId);
                }
                
                // Update sheet - set IR to NO and clear expiry date
                await sheetsManager.updateIRStatus(irTransaction.rowIndex, false);
                
                // Send confirmation to transaction channel
                const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);
                
                const confirmationEmbed = new EmbedBuilder()
                    .setTitle(`${irTransaction.teamName} - ${irTransaction.playerUsername} removed from IR`)
                    .setDescription(`<@${irTransaction.playerId}> has been removed from **In Reserve (IR)** status and is now active.`)
                    .addFields(
                        { name: 'Team', value: irTransaction.teamName, inline: true },
                        { name: 'Division', value: irTransaction.division, inline: true },
                        { name: 'Removed By', value: irTransaction.requestedByUsername, inline: true }
                    )
                    .setColor(0x00FF00)
                    .setTimestamp();
                
                // Add team logo (from DB)
                const logoAttachment = await teamLogoAttachment(irTransaction.teamName);
                if (logoAttachment) {
                    confirmationEmbed.setThumbnail('attachment://team_logo.png');
                    await transactionChannel.send({
                        content: `<@${irTransaction.playerId}>`,
                        embeds: [confirmationEmbed],
                        files: [logoAttachment]
                    });
                } else {
                    await transactionChannel.send({
                        content: `<@${irTransaction.playerId}>`,
                        embeds: [confirmationEmbed]
                    });
                }
                
                // Log to shared transactions table.
                {
                    const teamId = await TransactionDB.findTeamIdByName(irTransaction.division, irTransaction.teamName);
                    await TransactionDB.log({
                        discordId: irTransaction.playerId,
                        discordUsername: irTransaction.playerUsername,
                        teamId,
                        teamNameSnapshot: irTransaction.teamName,
                        type: 'ir_return',
                        details: { division: irTransaction.division, requestedByUsername: irTransaction.requestedByUsername },
                        performedByDiscordId: irTransaction.requestedBy,
                        performedByUsername: irTransaction.requestedByUsername,
                        source: 'bot:/ir remove',
                    });
                }

                Logger.success(`${irTransaction.playerUsername} removed from IR by ${irTransaction.requestedByUsername}`);
            }
            
        } catch (error) {
            Logger.error('Failed to process IR completion', error);
            await message.channel.send({
                content: `❌ An error occurred while processing the IR ${irTransaction.action} for ${irTransaction.playerUsername}.`
            });
        }
    },
    
    /**
     * Handle reactions for IR approval
     */
    async handleReaction(reaction, user, client) {
        // Check if this reaction is for a pending IR transaction
        const irTransaction = pendingIRTransactions.get(reaction.message.id);
        if (!irTransaction) return;
        
        // Check if user has Salary Crew role
        const member = await reaction.message.guild.members.fetch(user.id);
        if (!member.roles.cache.has(ROLES.SALARY_CREW)) {
            return;
        }
        
        // Check for approval or denial
        if (reaction.emoji.name === '✅') {
            // Check if already processing to prevent race condition
            if (irTransaction.isProcessing) {
                return;
            }
            
            // Mark as processing and remove from pending immediately
            irTransaction.isProcessing = true;
            pendingIRTransactions.delete(reaction.message.id);
            
            // Approved
            irTransaction.salaryCrewApproved = true;
            
            const originalEmbed = reaction.message.embeds[0];
            const approvedEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0x00FF00)
                .setFooter({ text: `Approved by ${user.username}` });
            
            await reaction.message.edit({
                content: `✅ **Approved by ${user.username}**`,
                embeds: [approvedEmbed]
            });
            
            // Process the IR transaction
            await this.processIRCompletion(irTransaction, reaction.message, client);
            
        } else if (reaction.emoji.name === '❌') {
            // Denied
            const originalEmbed = reaction.message.embeds[0];
            const deniedEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setFooter({ text: `Denied by ${user.username}` });
            
            await reaction.message.edit({
                content: `❌ **Denied by ${user.username}**`,
                embeds: [deniedEmbed]
            });
            
            // Remove from pending
            pendingIRTransactions.delete(reaction.message.id);
            
            Logger.info(`IR ${irTransaction.action} request for ${irTransaction.playerUsername} denied by ${user.username}`);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingIRTransactions.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending IR transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const transaction = pendingIRTransactions.get(transactionId);
                if (!transaction) continue;
                
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
                pendingIRTransactions.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire IR transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} IR transactions`);
        return expiredCount;
    }
};
