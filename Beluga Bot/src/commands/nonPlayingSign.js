const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, NP_ROLES, DIVISIONS } = require('../constants/roles');

// Command-specific channel IDs
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

// Pending transactions storage
const pendingNPCaptainTransactions = new Map();

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
                        playing: row[12] // Column M
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

    async updateNonPlayingSign(rowIndex) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const updates = [];

            // Set FA to NO (Column I)
            updates.push({
                range: `SalSheet!I${rowIndex}`,
                values: [['NO']]
            });

            // Set Playing to NO (Column M)
            updates.push({
                range: `SalSheet!M${rowIndex}`,
                values: [['NO']]
            });

            // Batch update
            await this.sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    data: updates,
                    valueInputOption: 'RAW'
                }
            });

            Logger.success(`Updated non-playing sign for row ${rowIndex}`);
            return true;
        } catch (error) {
            Logger.error('Failed to update non-playing sign', error);
            return false;
        }
    }
}

const sheetsManager = new GoogleSheetsManager();

// Helper function to check if user is a GM
function isGM(member) {
    for (const [teamName, gmRoleId] of Object.entries(ROLES.GM_ROLES)) {
        if (member.roles.cache.has(gmRoleId)) {
            return { isGM: true, teamName: teamName };
        }
    }
    return { isGM: false };
}

// Helper function to validate eligibility for non-playing sign
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
    
    return {
        valid: errors.length === 0,
        errors
    };
}

// Helper function to find team logo file
function findTeamLogo(teamName) {
    try {
        const logosDir = path.join(__dirname, '../../IMAGES/logos');
        
        if (!fs.existsSync(logosDir)) {
            Logger.warning(`Logos directory not found: ${logosDir}`);
            return null;
        }
        
        const files = fs.readdirSync(logosDir);
        
        // Normalize team name for matching
        const normalizedTeamName = teamName.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Try exact match first (case-insensitive)
        for (const file of files) {
            const fileNameWithoutExt = path.parse(file).name.toLowerCase();
            if (fileNameWithoutExt === teamName.toLowerCase()) {
                return path.join(logosDir, file);
            }
        }
        
        // Try fuzzy match (remove spaces, special chars)
        for (const file of files) {
            const fileNameWithoutExt = path.parse(file).name.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (fileNameWithoutExt === normalizedTeamName) {
                return path.join(logosDir, file);
            }
        }
        
        // Try partial match
        for (const file of files) {
            const fileNameWithoutExt = path.parse(file).name.toLowerCase();
            if (fileNameWithoutExt.includes(normalizedTeamName) || normalizedTeamName.includes(fileNameWithoutExt.replace(/[^a-z0-9]/g, ''))) {
                return path.join(logosDir, file);
            }
        }
        
        Logger.warning(`Logo not found for team: ${teamName}`);
        return null;
    } catch (error) {
        Logger.error(`Error finding team logo for ${teamName}`, error);
        return null;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sign-as-np-captain')
        .setDescription('[GM Only] Sign a player as a non-playing captain')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to sign as non-playing captain')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('division')
                .setDescription('Division for captain role')
                .setRequired(true)
                .addChoices(
                    { name: 'AA', value: 'AA' },
                    { name: 'AAA', value: 'AAA' },
                    { name: 'MAJORS', value: 'MAJORS' }
                )),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
        } catch (deferError) {
            Logger.error('Failed to defer interaction reply', deferError);
            return;
        }

        try {
            const executor = interaction.member;
            const player = interaction.options.getUser('player');
            const playerMember = await interaction.guild.members.fetch(player.id);
            const division = interaction.options.getString('division');

            // Check if user is a GM
            const gmCheck = isGM(executor);
            if (!gmCheck.isGM) {
                await interaction.editReply({
                    content: '❌ Only GMs can use this command.',
                });
                return;
            }

            const teamName = gmCheck.teamName;

            // Check if team exists in the specified division
            if (!TEAM_ROLES[division] || !TEAM_ROLES[division][teamName]) {
                await interaction.editReply({
                    content: `❌ ${teamName} does not exist in the ${division} division. You cannot sign a non-playing captain for a division your team is not in.`,
                });
                return;
            }

            // Check if NP role exists for this team
            const npRoleId = NP_ROLES[teamName];
            if (!npRoleId) {
                await interaction.editReply({
                    content: `❌ No non-playing role found for ${teamName}.`,
                });
                return;
            }

            // Check if captain role exists for this division
            const captainRoleId = ROLES.CAPTAINS[division];
            if (!captainRoleId) {
                await interaction.editReply({
                    content: `❌ No captain role found for ${division} division.`,
                });
                return;
            }

            // Check if the team already has a captain for this division
            const teamRoleId = TEAM_ROLES[division][teamName];
            if (teamRoleId) {
                // Fetch all members with the captain role for this division
                const guild = interaction.guild;
                const captainRole = await guild.roles.fetch(captainRoleId);
                if (captainRole) {
                    // Check if any member with the captain role also has this team's role OR NP role
                    const membersWithCaptainRole = captainRole.members;
                    for (const [memberId, guildMember] of membersWithCaptainRole) {
                        if (guildMember.roles.cache.has(teamRoleId) || guildMember.roles.cache.has(npRoleId)) {
                            await interaction.editReply({
                                content: `❌ ${teamName} already has a ${division} captain: ${guildMember.user.username}. Each team can only have one captain per division.`,
                            });
                            return;
                        }
                    }
                }
            }

            // Check if player already has captain role
            if (playerMember.roles.cache.has(captainRoleId)) {
                await interaction.editReply({
                    content: `❌ ${player.username} is already a ${division} captain.`,
                });
                return;
            }

            // Get player data from sheet
            const userData = await sheetsManager.getUserData(player.id);
            
            // Validate eligibility
            const eligibilityCheck = validateEligibility(userData);
            if (!eligibilityCheck.valid) {
                const errorList = eligibilityCheck.errors.map(e => `• ${e}`).join('\n');
                await interaction.editReply({
                    content: `❌ **Cannot sign ${player.username} as non-playing captain:**\n\n${errorList}`,
                });
                return;
            }

            // Send transaction request to transaction channel
            const transactionChannel = await interaction.client.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);

            const transactionEmbed = new EmbedBuilder()
                .setTitle('⭐ Non-Playing Captain Sign Request')
                .setDescription(`${player}, **${teamName}** wants to sign you as a **non-playing ${division} captain**!\n\n⚠️ **Note:** You will receive:\n• ${teamName} NP role\n• ${division} Captain role\n\nYou will be marked as NOT playing.`)
                .addFields(
                    { name: 'Team', value: teamName, inline: true },
                    { name: 'Division', value: division, inline: true },
                    { name: 'Player', value: player.username, inline: true },
                    { name: 'Offered By', value: interaction.user.username, inline: true },
                    { name: 'Required Approvals', value: '✅ Salary Crew\n✅ Player', inline: false }
                )
                .setColor(0x9B59B6)
                .setTimestamp()
                .setFooter({ text: '✅ to accept or ❌ to decline.' });

            const transactionMessage = await transactionChannel.send({
                content: `${player}`,
                embeds: [transactionEmbed]
            });

            await transactionMessage.react('✅');
            await transactionMessage.react('❌');

            // Store transaction data
            const transactionId = transactionMessage.id;
            pendingNPCaptainTransactions.set(transactionId, {
                playerId: player.id,
                playerUsername: player.username,
                teamName,
                division,
                captainRoleId,
                npRoleId,
                offeredBy: interaction.user.id,
                offeredByUsername: interaction.user.username,
                playerAccepted: false,
                salaryCrewAccepted: false,
                rowIndex: userData.rowIndex,
                expiresAt: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
            });

            // Set timeout to expire transaction
            setTimeout(async () => {
                const transaction = pendingNPCaptainTransactions.get(transactionId);
                if (transaction && (!transaction.playerAccepted || !transaction.salaryCrewAccepted)) {
                    pendingNPCaptainTransactions.delete(transactionId);
                    
                    try {
                        await transactionMessage.edit({
                            content: '⏱️ This non-playing captain sign offer has expired.',
                            embeds: [transactionEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                        });
                    } catch (error) {
                        Logger.error('Failed to mark transaction as expired', error);
                    }
                }
            }, 12 * 60 * 60 * 1000);

            await interaction.editReply({
                content: '✅ Non-playing captain sign offer sent! Waiting for player and Salary Crew approval.',
            });

        } catch (error) {
            Logger.error('Failed to execute sign-as-np-captain command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the non-playing captain sign request. Please try again later.',
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

            const transaction = pendingNPCaptainTransactions.get(reaction.message.id);
            if (!transaction) return;

            // Check if transaction expired
            if (Date.now() > transaction.expiresAt) {
                pendingNPCaptainTransactions.delete(reaction.message.id);
                return;
            }

            const member = await reaction.message.guild.members.fetch(user.id);
            const isPlayer = user.id === transaction.playerId;
            const isSalaryCrew = member.roles.cache.has(ROLES.SALARY_CREW);

            // Handle rejection
            if (reaction.emoji.name === '❌') {
                if (isPlayer) {
                    pendingNPCaptainTransactions.delete(reaction.message.id);
                    
                    const embed = reaction.message.embeds[0];
                    await reaction.message.edit({
                        content: `❌ ${user.username} has rejected the offer.`,
                        embeds: [EmbedBuilder.from(embed).setColor(0xFF0000).setFooter({ text: 'Rejected by player' })]
                    });
                    return;
                } else if (isSalaryCrew) {
                    pendingNPCaptainTransactions.delete(reaction.message.id);
                    
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
                } else if (isSalaryCrew) {
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
                    pendingNPCaptainTransactions.delete(reaction.message.id);
                    
                    // Update embed to show partial approval
                    const originalEmbed = reaction.message.embeds[0];
                    const approvedEmbed = EmbedBuilder.from(originalEmbed)
                        .setColor(0x00FF00)
                        .setFooter({ text: 'Approved - All requirements met' });
                    
                    await reaction.message.edit({
                        content: '✅ **Approved by Salary Crew and Player**',
                        embeds: [approvedEmbed]
                    });
                    
                    await processNonPlayingCaptainSignCompletion(transaction, reaction.message, client);
                } else {
                    // Update embed to show partial approval
                    const originalEmbed = reaction.message.embeds[0];
                    const fields = originalEmbed.fields.map(field => {
                        if (field.name === 'Required Approvals') {
                            const value = `${transaction.salaryCrewAccepted ? '✅' : '⏳'} Salary Crew\n${transaction.playerAccepted ? '✅' : '⏳'} Player`;
                            return { ...field, value };
                        }
                        return field;
                    });

                    const updatedEmbed = EmbedBuilder.from(originalEmbed)
                        .setFields(fields);
                    
                    await reaction.message.edit({
                        embeds: [updatedEmbed]
                    });
                }
            }

        } catch (error) {
            Logger.error('Failed to handle non-playing captain sign reaction', error);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingNPCaptainTransactions.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending non-playing captain sign transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const transaction = pendingNPCaptainTransactions.get(transactionId);
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
                pendingNPCaptainTransactions.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} non-playing captain sign transactions`);
        return expiredCount;
    }
};

async function processNonPlayingCaptainSignCompletion(transaction, message, client) {
    try {
        const guild = message.guild;
        const player = await guild.members.fetch(transaction.playerId);
        
        // Remove all division FA roles
        for (const faRoleId of Object.values(ROLES.FREE_AGENTS)) {
            if (player.roles.cache.has(faRoleId)) {
                await player.roles.remove(faRoleId);
            }
        }
        
        // Add NP role
        await player.roles.add(transaction.npRoleId);
        Logger.info(`Added NP role to ${transaction.playerUsername}`);
        
        // Add Captain role
        await player.roles.add(transaction.captainRoleId);
        Logger.info(`Added ${transaction.division} Captain role to ${transaction.playerUsername}`);
        
        // Update sheet - set FA to NO and Playing to NO
        await sheetsManager.updateNonPlayingSign(transaction.rowIndex);
        
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
        
        // Send confirmation in transactions channel
        const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);
        
        const confirmationEmbed = new EmbedBuilder()
            .setTitle(`${transaction.teamName} signs ${transaction.playerUsername} as Non-Playing ${transaction.division} Captain`)
            .setDescription(`${player} has been signed as a **non-playing ${transaction.division} captain** of **${transaction.teamName}**.`)
            .addFields(
                { name: 'Roles Given', value: `• ${transaction.teamName} NP\n• ${transaction.division} Captain`, inline: true },
                { name: 'Offered By', value: transaction.offeredByUsername, inline: true },
                { name: 'Approved By (Salary Crew)', value: transaction.approvedBy, inline: true }
            )
            .setColor(0x9B59B6)
            .setTimestamp();
        
        // Add team logo
        const logoPath = findTeamLogo(transaction.teamName);
        if (logoPath && fs.existsSync(logoPath)) {
            const logoAttachment = new AttachmentBuilder(logoPath, { name: 'team_logo.png' });
            confirmationEmbed.setThumbnail('attachment://team_logo.png');
            await transactionChannel.send({ 
                content: `<@${transaction.playerId}>`,
                embeds: [confirmationEmbed], 
                files: [logoAttachment] 
            });
        } else {
            await transactionChannel.send({ 
                content: `<@${transaction.playerId}>`,
                embeds: [confirmationEmbed] 
            });
        }
        
        Logger.success(`Non-playing captain sign completed: ${transaction.playerUsername} to ${transaction.teamName} as ${transaction.division} Captain`);
        
    } catch (error) {
        Logger.error('Failed to process non-playing captain sign completion', error);
        throw error;
    }
}
