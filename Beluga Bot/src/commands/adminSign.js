const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { LeagueDB, TransactionDB, isDatabaseAvailable } = require('../utils/database');
const { ROLES, TEAM_ROLES, NP_ROLES, TEAM_NAMES, getTeamChoices, getDivisionChoices } = require('../constants/roles');
const { attachTeamLogo, teamAutocomplete } = require('../utils/teamRoles');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const ROSTER_ALERT_CHANNEL_ID = '1299015210702737429';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
const DEFAULT_ROSTER_LIMIT = 4;

// Pending transactions storage
const pendingTransactions = new Map();

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

    async getUserData(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'SalSheet!A:Z';
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
                        rowIndex: i + 1,
                        discordId: row[15],
                        username: row[1], // Column B
                        freeAgent: row[8], // Column I
                        eligible: row[9], // Column J
                        inReserve: row[10], // Column K
                        suspended: row[11], // Column L
                        playing: row[12], // Column M
                        division: row[17] // Column R
                    };
                }
            }
            
            return null;
        } catch (error) {
            Logger.error('Failed to get user data from sheet', error);
            throw error;
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

    async updateFreeAgentStatus(rowIndex, value) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            // Column I is index 9 (I = 9th column)
            const range = `SalSheet!I${rowIndex}`;
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range,
                valueInputOption: 'RAW',
                resource: {
                    values: [[value]]
                },
            });

            Logger.success(`Updated FA status for row ${rowIndex} to ${value}`);
            return true;
        } catch (error) {
            Logger.error('Failed to update FA status', error);
            return false;
        }
    }
}

const sheetsManager = new GoogleSheetsManager();

// Helper function to validate eligibility
function validateEligibility(userData) {
    const errors = [];
    
    if (!userData) {
        return { valid: false, errors: ['User not found in the salary sheet.'] };
    }
    
    if (userData.freeAgent !== 'YES') {
        errors.push('Player is not a Free Agent');
    }
    
    if (userData.eligible !== 'YES') {
        errors.push('Player is not Eligible');
    }
    
    if (userData.inReserve === 'YES') {
        errors.push('Player is in Reserve (IR)');
    }
    
    if (userData.suspended === 'YES') {
        errors.push('Player is Suspended');
    }
    
    if (userData.playing !== 'YES') {
        errors.push('Player is not marked as Playing');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

// Team logo for embeds — DB only (teams.logo_data → franchise logo). Returns an
// AttachmentBuilder named team_logo.png, or null when no logo exists. (Replaces
// the old IMAGES/logos/*.png file lookup; static team PNGs were deleted.)
async function teamLogoAttachment(teamName) {
    return attachTeamLogo(null, teamName);
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

// Helper function to send roster alert to Salary Crew
async function sendRosterAlert(client, teamName, division, rosterSize, limit) {
    try {
        const alertChannel = await client.channels.fetch(ROSTER_ALERT_CHANNEL_ID);
        if (!alertChannel) {
            Logger.error(`Roster alert channel ${ROSTER_ALERT_CHANNEL_ID} not found`);
            return;
        }
        
        const salaryCrewMention = `<@&${ROLES.SALARY_CREW}>`;
        await alertChannel.send({
            content: `⚠️ ${salaryCrewMention} **ROSTER ALERT**`,
            embeds: [new EmbedBuilder()
                .setTitle('🚨 Roster Over Capacity')
                .setDescription(`**${teamName}** in **${division}** division has **${rosterSize} players** (maximum is ${limit})!`)
                .setColor(0xFF0000)
                .setTimestamp()
                .setFooter({ text: 'Please review and resolve this roster issue' })
            ]
        });
        
        Logger.warning(`Roster alert sent: ${teamName} ${division} has ${rosterSize} players`);
    } catch (error) {
        Logger.error('Failed to send roster alert', error);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminsign')
        .setDescription('[Salary Crew Only] Sign a player to any team')
        .addStringOption(option =>
            option.setName('division')
                .setDescription('Division to sign the player to')
                .setRequired(true)
                .addChoices(...getDivisionChoices()))
        .addStringOption(option =>
            option.setName('team')
                .setDescription('The team to sign the player to')
                .setRequired(true)
                .setAutocomplete(true))
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to sign')
                .setRequired(true)),

    // Live team list from the current season (DB), filtered by the chosen division.
    async autocomplete(interaction) {
        await teamAutocomplete(interaction, { valueField: 'name', divisionOptionName: 'division' });
    },

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: 64 });

            // Check if user is Salary Crew
            if (!interaction.member.roles.cache.has(ROLES.SALARY_CREW)) {
                await interaction.editReply({
                    content: '❌ This command is only available to Salary Crew members.',
                });
                return;
            }

            const division = interaction.options.getString('division');
            const teamName = interaction.options.getString('team');
            const player = interaction.options.getUser('player');

            // Validate team exists in division
            if (!TEAM_ROLES[division] || !TEAM_ROLES[division][teamName]) {
                await interaction.editReply({
                    content: `❌ Team "${teamName}" not found in ${division} division.`,
                });
                return;
            }

            // Get player data from sheet
            const userData = await sheetsManager.getUserData(player.id);
            const eligibilityCheck = validateEligibility(userData);
            
            if (!eligibilityCheck.valid) {
                await interaction.editReply({
                    content: `❌ Cannot sign ${player.username}:\n\n${eligibilityCheck.errors.map(e => `• ${e}`).join('\n')}`,
                });
                return;
            }

            // Check if player's division in sheet matches selected division
            if (userData.division && userData.division.toUpperCase() !== division) {
                await interaction.editReply({
                    content: `❌ Player is registered in ${userData.division} division but you're trying to sign them to ${division}.`,
                });
                return;
            }

            // Check roster size before sending transaction
            const currentRosterSize = await getRosterSize(interaction.guild, teamName, division);
            const rosterLimit = await getRosterLimit(division, teamName);
            
            if (currentRosterSize > rosterLimit) {
                // Roster is already over capacity - alert Salary Crew and block
                await sendRosterAlert(interaction.client, teamName, division, currentRosterSize, rosterLimit);
                await interaction.editReply({
                    content: `❌ **Cannot sign player:** ${teamName} roster in ${division} is already over capacity (${currentRosterSize}/${rosterLimit} players). Salary Crew has been notified of this roster issue.`,
                });
                return;
            } else if (currentRosterSize >= rosterLimit) {
                // Roster is at capacity - signing would exceed limit
                await interaction.editReply({
                    content: `❌ **Cannot sign player:** ${teamName} roster in ${division} is at full capacity (${currentRosterSize}/${rosterLimit} players). Signing this player would exceed the maximum roster size.`,
                });
                return;
            }
            // If roster size < 5, proceed normally (including bringing it to exactly 5)

            // Create transaction request
            const transactionChannel = await interaction.client.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
            
            const transactionEmbed = new EmbedBuilder()
                .setTitle('🔔 Transaction Offer')
                .setDescription(`Congratulations ${player}! You have received an offer to join **${teamName}**!`)
                .addFields(
                    { name: 'Team', value: teamName, inline: true },
                    { name: 'Division', value: division, inline: true },
                    { name: 'Player', value: player.username, inline: true },
                    { name: 'Offered By (Admin)', value: interaction.user.username, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: '✅ to confirm or ❌ to reject the offer. You have 12 hours to respond.' });

            const transactionMessage = await transactionChannel.send({
                content: `${player} - React ✅ to confirm or ❌ to reject the offer. **Another Salary Crew member** must also approve with ✅.`,
                embeds: [transactionEmbed]
            });

            // Add reactions
            await transactionMessage.react('✅');
            await transactionMessage.react('❌');

            // Store transaction data
            const transactionId = transactionMessage.id;
            pendingTransactions.set(transactionId, {
                playerId: player.id,
                playerUsername: player.username,
                teamName,
                division,
                offeredBy: interaction.user.id,
                offeredByUsername: interaction.user.username,
                playerAccepted: false,
                salaryCrewAccepted: false,
                isAdminSign: true,
                rowIndex: userData.rowIndex,
                expiresAt: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
            });

            // Set timeout to expire transaction
            setTimeout(async () => {
                const transaction = pendingTransactions.get(transactionId);
                if (transaction && (!transaction.playerAccepted || !transaction.salaryCrewAccepted)) {
                    pendingTransactions.delete(transactionId);
                    
                    try {
                        await transactionMessage.edit({
                            content: '⏱️ This transaction offer has expired.',
                            embeds: [transactionEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                        });
                    } catch (error) {
                        Logger.error('Failed to mark transaction as expired', error);
                    }
                }
            }, 12 * 60 * 60 * 1000);

            await interaction.editReply({
                content: '✅ Transaction offer sent! Waiting for player and Salary Crew approval.',
            });

        } catch (error) {
            Logger.error('Failed to execute adminsign command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the sign request. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    async handleReaction(reaction, user, client) {
        try {
            // Ignore bot reactions
            if (user.bot) return;

            const transaction = pendingTransactions.get(reaction.message.id);
            if (!transaction || !transaction.isAdminSign) return;

            // Check if transaction expired
            if (Date.now() > transaction.expiresAt) {
                pendingTransactions.delete(reaction.message.id);
                return;
            }

            const member = await reaction.message.guild.members.fetch(user.id);
            const isPlayer = user.id === transaction.playerId;
            const isSalaryCrew = member.roles.cache.has(ROLES.SALARY_CREW);
            const isOriginalAdmin = user.id === transaction.offeredBy;

            // Handle rejection
            if (reaction.emoji.name === '❌') {
                if (isPlayer) {
                    pendingTransactions.delete(reaction.message.id);
                    
                    const embed = reaction.message.embeds[0];
                    await reaction.message.edit({
                        content: `❌ ${user.username} has rejected the offer.`,
                        embeds: [EmbedBuilder.from(embed).setColor(0xFF0000).setFooter({ text: 'Rejected by player' })]
                    });
                    return;
                } else if (isSalaryCrew && !isOriginalAdmin) {
                    pendingTransactions.delete(reaction.message.id);
                    
                    const embed = reaction.message.embeds[0];
                    await reaction.message.edit({
                        content: `❌ ${user.username} has denied the offer.`,
                        embeds: [EmbedBuilder.from(embed).setColor(0xFF0000).setFooter({ text: 'Denied by Salary Crew' })]
                    });
                    return;
                }
            }

            // Handle acceptance
            if (reaction.emoji.name === '✅') {
                // Check if user is the player FIRST
                if (isPlayer) {
                    transaction.playerAccepted = true;
                } else if (isSalaryCrew && !isOriginalAdmin) {
                    // Different salary crew member must approve (not the one who created it)
                    transaction.salaryCrewAccepted = true;
                    transaction.approvedBy = user.username;
                }

                // Check if both have accepted
                if (transaction.playerAccepted && transaction.salaryCrewAccepted) {
                    // Check if already processing to prevent race condition
                    if (transaction.isProcessing) {
                        return;
                    }
                    
                    // Mark as processing and remove from pending immediately
                    transaction.isProcessing = true;
                    pendingTransactions.delete(reaction.message.id);
                    
                    // Process the signing
                    await processSigningCompletion(transaction, reaction.message, client);
                }
            }

        } catch (error) {
            Logger.error('Failed to handle reaction', error);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingTransactions.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending admin sign transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const transaction = pendingTransactions.get(transactionId);
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
                pendingTransactions.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} admin sign transactions`);
        return expiredCount;
    }
};

async function processSigningCompletion(transaction, message, client) {
    try {
        const guild = message.guild;
        const player = await guild.members.fetch(transaction.playerId);
        
        // DOUBLE-CHECK: Verify player is still a free agent before processing
        const currentUserData = await sheetsManager.getUserData(transaction.playerId);
        if (!currentUserData || currentUserData.freeAgent !== 'YES') {
            const embed = message.embeds[0];
            await message.edit({
                content: '❌ Transaction cancelled: Player is no longer a free agent (another transaction may have been processed).',
                embeds: [EmbedBuilder.from(embed).setColor(0xFF0000).setFooter({ text: 'Cancelled - Not a FA' })]
            });
            Logger.warning(`Transaction cancelled: ${transaction.playerUsername} is no longer a free agent`);
            return;
        }
        
        // Get role IDs
        const teamRoleId = TEAM_ROLES[transaction.division][transaction.teamName];
        const freeAgentRoleId = ROLES.FREE_AGENTS[transaction.division];
        
        // Add team role and remove free agent role
        if (teamRoleId) {
            await player.roles.add(teamRoleId);
        }
        if (freeAgentRoleId) {
            await player.roles.remove(freeAgentRoleId);
        }
        
        // Update sheet - set FA to NO
        await sheetsManager.updateFreeAgentStatus(transaction.rowIndex, 'NO');
        
        // Update Discord nickname from column B
        const sheetUsername = await sheetsManager.getUsername(transaction.playerId);
        if (sheetUsername && player.manageable) {
            try {
                await player.setNickname(sheetUsername);
                Logger.info(`Updated nickname to: ${sheetUsername}`);
            } catch (nickError) {
                Logger.warning(`Failed to update nickname: ${nickError.message}`);
            }
        }
        
        // Send confirmation embed
        const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);
        
        const confirmationEmbed = new EmbedBuilder()
            .setTitle(`${transaction.teamName} sign ${transaction.playerUsername}`)
            .setDescription(`${player} signed to ${transaction.division} league.`)
            .addFields(
                { name: 'Offer Submitted By', value: transaction.offeredByUsername, inline: true },
                { name: 'Approved By (Salary Crew)', value: transaction.approvedBy, inline: true }
            )
            .setColor(0x00FF00)
            .setTimestamp();
        
        // Try to add team logo (from DB)
        const logoAttachment = await teamLogoAttachment(transaction.teamName);
        if (logoAttachment) {
            confirmationEmbed.setThumbnail('attachment://team_logo.png');
            await transactionChannel.send({ content: `<@${transaction.playerId}>`, embeds: [confirmationEmbed], files: [logoAttachment] });
        } else {
            await transactionChannel.send({ content: `<@${transaction.playerId}>`, embeds: [confirmationEmbed] });
        }
        
        // Update original message
        const embed = message.embeds[0];
        await message.edit({
            content: '✅ Transaction completed successfully!',
            embeds: [EmbedBuilder.from(embed).setColor(0x00FF00).setFooter({ text: 'Completed' })]
        });
        
        {
            const teamId = await TransactionDB.findTeamIdByName(transaction.division, transaction.teamName);
            await TransactionDB.log({
                discordId: transaction.playerId,
                discordUsername: transaction.playerUsername,
                teamId,
                teamNameSnapshot: transaction.teamName,
                type: 'sign',
                details: {
                    division: transaction.division,
                    adminSign: true,
                    offeredByUsername: transaction.offeredByUsername,
                    approvedBy: transaction.approvedBy,
                },
                performedByDiscordId: transaction.offeredBy,
                performedByUsername: transaction.offeredByUsername,
                source: 'bot:/admin-sign',
            });
        }

        Logger.success(`Admin transaction completed: ${transaction.playerUsername} signed to ${transaction.teamName} (${transaction.division})`);
        
    } catch (error) {
        Logger.error('Failed to process signing completion', error);
        throw error;
    }
}
