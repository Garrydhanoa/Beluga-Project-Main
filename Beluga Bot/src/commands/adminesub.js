const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, TEAM_NAMES, getTeamChoices } = require('../constants/roles');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const ESUB_TRACKING_CHANNEL_ID = '1265781513660923945';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

// Team names in order (columns B-Q)
const TEAM_COLUMNS = TEAM_NAMES;

// Team choices for dropdown
const TEAM_CHOICES = getTeamChoices();

// Division rows (AA=2, AAA=3, MAJORS=4)
const DIVISION_ROWS = {
    'AA': 2,
    'AAA': 3,
    'MAJORS': 4
};

// Pending admin esub transactions (for SIGN action)
const pendingAdminEsubTransactions = new Map();

/**
 * Find team logo path
 */
function findTeamLogo(teamName) {
    const normalizedName = teamName.replace(/\s+/g, ' ').trim();
    const logoPath = path.join(__dirname, '../../IMAGES/logos', `${normalizedName}.png`);
    return logoPath;
}

/**
 * Get esub count from One Day Sub Tracker sheet
 */
async function getEsubCount(teamName, division) {
    try {
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
        
        const auth = new google.auth.JWT(
            client_email,
            null,
            private_key.replace(/\\n/g, '\n'),
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        const columnIndex = TEAM_COLUMNS.indexOf(teamName);
        if (columnIndex === -1) {
            throw new Error(`Team ${teamName} not found`);
        }
        
        const columnLetter = String.fromCharCode(66 + columnIndex);
        const rowIndex = DIVISION_ROWS[division];
        const range = `One Day Sub Tracker!${columnLetter}${rowIndex}`;
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });
        
        const value = response.data.values?.[0]?.[0];
        const count = parseInt(value) || 0;
        
        Logger.info(`Esub count for ${teamName} ${division}: ${count}/3`);
        return count;
        
    } catch (error) {
        Logger.error('Failed to get esub count', error);
        return 0;
    }
}

/**
 * Update esub count in sheet
 */
async function updateEsubCount(teamName, division, newCount) {
    try {
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
        
        const auth = new google.auth.JWT(
            client_email,
            null,
            private_key.replace(/\\n/g, '\n'),
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        const columnIndex = TEAM_COLUMNS.indexOf(teamName);
        if (columnIndex === -1) {
            throw new Error(`Team ${teamName} not found`);
        }
        
        const columnLetter = String.fromCharCode(66 + columnIndex);
        const rowIndex = DIVISION_ROWS[division];
        const range = `One Day Sub Tracker!${columnLetter}${rowIndex}`;
        
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'RAW',
            resource: {
                values: [[newCount]]
            }
        });
        
        Logger.success(`Updated esub count for ${teamName} ${division} to ${newCount}`);
        return true;
        
    } catch (error) {
        Logger.error('Failed to update esub count', error);
        throw error;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adminesub')
        .setDescription('Admin command to manage one-day subs (Salary Crew only)')
        .addStringOption(option =>
            option
                .setName('action')
                .setDescription('Action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'SIGN', value: 'SIGN' },
                    { name: 'CANCEL', value: 'CANCEL' }
                )
        )
        .addStringOption(option =>
            option
                .setName('team')
                .setDescription('Team name')
                .setRequired(true)
                .addChoices(...TEAM_CHOICES)
        )
        .addStringOption(option =>
            option
                .setName('division')
                .setDescription('Division')
                .setRequired(true)
                .addChoices(
                    { name: 'AA', value: 'AA' },
                    { name: 'AAA', value: 'AAA' },
                    { name: 'MAJORS', value: 'MAJORS' }
                )
        )
        .addUserOption(option =>
            option
                .setName('player')
                .setDescription('The player')
                .setRequired(true)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const member = await interaction.guild.members.fetch(interaction.user.id);
            
            // Check if user is Salary Crew
            if (!member.roles.cache.has(ROLES.SALARY_CREW)) {
                return await interaction.editReply({
                    content: '❌ This command is only available to Salary Crew members.',
                });
            }

            const action = interaction.options.getString('action');
            const teamName = interaction.options.getString('team');
            const division = interaction.options.getString('division');
            const player = interaction.options.getUser('player');
            const playerMember = await interaction.guild.members.fetch(player.id);

            // Check if the team exists in the specified division
            if (!TEAM_ROLES[division] || !TEAM_ROLES[division][teamName]) {
                return await interaction.editReply({
                    content: `❌ **${teamName}** does not exist in the ${division} division.`,
                });
            }

            if (action === 'SIGN') {
                // SIGN action - requires approval from another Salary Crew member
                
                // Check if player is a free agent
                const freeAgentRoleId = ROLES.FREE_AGENTS[division];
                if (!freeAgentRoleId || !playerMember.roles.cache.has(freeAgentRoleId)) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is not a ${division} free agent.`,
                    });
                }

                // Check esub count
                const currentEsubCount = await getEsubCount(teamName, division);
                if (currentEsubCount >= 3) {
                    return await interaction.editReply({
                        content: `❌ ${teamName} has already used all 3 one-day subs for ${division} this season (${currentEsubCount}/3).`,
                    });
                }

                // Get transaction channel
                const transactionChannel = await interaction.guild.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
                if (!transactionChannel) {
                    return await interaction.editReply({
                        content: '❌ Transaction channel not found.',
                    });
                }

                // Create admin esub request embed
                const esubEmbed = new EmbedBuilder()
                    .setTitle(`🛡️ Admin One-Day Sub Request`)
                    .setDescription(`Salary Crew member **${interaction.user.username}** wants to sign ${player.username} to **${teamName}** as a one-day substitute.`)
                    .addFields(
                        { name: 'Player', value: `<@${player.id}>`, inline: true },
                        { name: 'Team', value: teamName, inline: true },
                        { name: 'Division', value: division, inline: true },
                        { name: 'E-Subs Used', value: `${currentEsubCount}/3 (will be ${currentEsubCount + 1}/3)`, inline: true },
                        { name: 'Requested By', value: `${interaction.user.username} (Salary Crew)`, inline: false },
                        { name: 'Required Approvals', value: '⏳ One other Salary Crew member', inline: false }
                    )
                    .setColor(0x0099FF)
                    .setFooter({ text: 'React with ✅ to approve or ❌ to deny' })
                    .setTimestamp();

                // Add team logo
                const logoPath = findTeamLogo(teamName);
                let esubMessage;
                
                // Send request without logo attachment
                esubMessage = await transactionChannel.send({ 
                    content: `<@&${ROLES.SALARY_CREW}>`,
                    embeds: [esubEmbed]
                });

                // Add reactions
                await esubMessage.react('✅');
                await esubMessage.react('❌');

                // Store pending transaction
                pendingAdminEsubTransactions.set(esubMessage.id, {
                    teamName: teamName,
                    playerId: player.id,
                    playerUsername: player.username,
                    division: division,
                    currentEsubCount: currentEsubCount,
                    requestedBy: interaction.user.id,
                    requestedByUsername: interaction.user.username,
                    approved: false,
                    expiresAt: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
                });

                // Set timeout
                setTimeout(async () => {
                    const transaction = pendingAdminEsubTransactions.get(esubMessage.id);
                    if (transaction) {
                        pendingAdminEsubTransactions.delete(esubMessage.id);
                        try {
                            await esubMessage.edit({
                                content: '⏱️ This admin one-day sub request has expired.',
                                embeds: [esubEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                            });
                        } catch (error) {
                            Logger.error('Failed to mark admin esub request as expired', error);
                        }
                    }
                }, 12 * 60 * 60 * 1000);

                await interaction.editReply({
                    content: `✅ Admin one-day sub request sent! Waiting for another Salary Crew member to approve. ${teamName} has used ${currentEsubCount}/3 e-subs for ${division}.`,
                });

            } else if (action === 'CANCEL') {
                // CANCEL action - immediate execution, no approval needed
                
                // Get current esub count
                const currentEsubCount = await getEsubCount(teamName, division);
                
                if (currentEsubCount <= 0) {
                    return await interaction.editReply({
                        content: `❌ ${teamName} has no recorded one-day subs to cancel for ${division} (${currentEsubCount}/3).`,
                    });
                }

                // Decrement count
                const newCount = currentEsubCount - 1;
                await updateEsubCount(teamName, division, newCount);

                // E-subs don't receive team roles, so no role removal needed

                // Send cancellation to transaction channel
                const transactionChannel = await interaction.guild.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);
                if (transactionChannel) {
                    const cancelEmbed = new EmbedBuilder()
                        .setTitle(`🚫 One-Day Sub Cancelled`)
                        .setDescription(`<@${player.id}>'s one-day sub contract with **${teamName}** has been cancelled.`)
                        .addFields(
                            { name: 'Team', value: teamName, inline: true },
                            { name: 'Division', value: division, inline: true },
                            { name: 'E-Subs Used', value: `${newCount}/3`, inline: true },
                            { name: 'Cancelled By', value: `${interaction.user.username} (Salary Crew)`, inline: true }
                        )
                        .setColor(0xFF0000)
                        .setTimestamp();

                    const logoPath = findTeamLogo(teamName);
                    if (logoPath && fs.existsSync(logoPath)) {
                        const logoAttachment = new AttachmentBuilder(logoPath, { name: 'team_logo.png' });
                        cancelEmbed.setThumbnail('attachment://team_logo.png');
                        await transactionChannel.send({ 
                            content: `<@${player.id}>`,
                            embeds: [cancelEmbed], 
                            files: [logoAttachment] 
                        });
                    } else {
                        await transactionChannel.send({ content: `<@${player.id}>`, embeds: [cancelEmbed] });
                    }
                }

                // Send small embed to esub tracking channel
                const esubChannel = await interaction.guild.channels.fetch(ESUB_TRACKING_CHANNEL_ID);
                if (esubChannel) {
                    const trackingEmbed = new EmbedBuilder()
                        .setDescription(`**${teamName}** cancelled <@${player.id}>'s one-day sub for **${division}** (${newCount}/3 used)`)
                        .setColor(0xFF0000)
                        .setTimestamp();

                    const logoPath = findTeamLogo(teamName);
                    if (logoPath && fs.existsSync(logoPath)) {
                        const logoAttachment = new AttachmentBuilder(logoPath, { name: 'team_logo.png' });
                        trackingEmbed.setThumbnail('attachment://team_logo.png');
                        await esubChannel.send({ 
                            embeds: [trackingEmbed], 
                            files: [logoAttachment] 
                        });
                    } else {
                        await esubChannel.send({ embeds: [trackingEmbed] });
                    }
                }

                await interaction.editReply({
                    content: `✅ One-day sub cancelled! ${teamName} now has ${newCount}/3 e-subs used for ${division}. ${player.username} has been removed from the team.`,
                });

                Logger.success(`One-day sub cancelled: ${player.username} from ${teamName} ${division} by ${interaction.user.username}`);
            }

        } catch (error) {
            Logger.error('Failed to execute adminonesub command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the admin one-day sub command. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    /**
     * Process admin esub completion after approval
     */
    async processAdminEsubCompletion(transaction, message, client) {
        const guild = message.guild;
        
        try {
            const playerMember = await guild.members.fetch(transaction.playerId);
            if (!playerMember) {
                await message.channel.send({
                    content: `❌ Could not find player <@${transaction.playerId}> in the server.`
                });
                return;
            }

            // Add team role to player
            const teamRoleId = TEAM_ROLES[transaction.division][transaction.teamName];
            if (teamRoleId) {
                await playerMember.roles.add(teamRoleId);
            }

            // Update esub count
            const newCount = transaction.currentEsubCount + 1;
            await updateEsubCount(transaction.teamName, transaction.division, newCount);

            // Send confirmation to transaction channel
            const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);

            const confirmationEmbed = new EmbedBuilder()
                .setTitle(`✅ Admin One-Day Sub Signed`)
                .setDescription(`<@${transaction.playerId}> has been signed as a one-day substitute for **${transaction.teamName}** by Salary Crew.`)
                .addFields(
                    { name: 'Team', value: transaction.teamName, inline: true },
                    { name: 'Division', value: transaction.division, inline: true },
                    { name: 'E-Subs Used', value: `${newCount}/3`, inline: true },
                    { name: 'Processed By', value: transaction.requestedByUsername, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            const logoPath = findTeamLogo(transaction.teamName);
            if (logoPath && fs.existsSync(logoPath)) {
                const logoAttachment = new AttachmentBuilder(logoPath, { name: 'team_logo.png' });
                confirmationEmbed.setThumbnail('attachment://team_logo.png');
                await transactionChannel.send({ 
                    embeds: [confirmationEmbed], 
                    files: [logoAttachment] 
                });
            } else {
                await transactionChannel.send({ 
                    embeds: [confirmationEmbed] 
                });
            }

            // Send small embed to esub tracking channel
            const esubChannel = await client.channels.fetch(ESUB_TRACKING_CHANNEL_ID);
            if (esubChannel) {
                const trackingEmbed = new EmbedBuilder()
                    .setDescription(`**${transaction.teamName}** signed <@${transaction.playerId}> as a one-day sub for **${transaction.division}** via admin (${newCount}/3 used)`)
                    .setColor(0x0099FF)
                    .setTimestamp();

                if (logoPath && fs.existsSync(logoPath)) {
                    const logoAttachment = new AttachmentBuilder(logoPath, { name: 'team_logo.png' });
                    trackingEmbed.setThumbnail('attachment://team_logo.png');
                    await esubChannel.send({ 
                        embeds: [trackingEmbed], 
                        files: [logoAttachment] 
                    });
                } else {
                    await esubChannel.send({ embeds: [trackingEmbed] });
                }
            }

            Logger.success(`Admin one-day sub signed: ${transaction.playerUsername} to ${transaction.teamName} ${transaction.division}`);
            
        } catch (error) {
            Logger.error('Failed to process admin esub completion', error);
            await message.channel.send({
                content: `❌ An error occurred while processing the admin one-day sub for ${transaction.playerUsername}.`
            });
        }
    },

    /**
     * Handle reactions for admin esub approval
     */
    async handleReaction(reaction, user, client) {
        const transaction = pendingAdminEsubTransactions.get(reaction.message.id);
        if (!transaction) return;

        const member = await reaction.message.guild.members.fetch(user.id);
        const isSalaryCrew = member.roles.cache.has(ROLES.SALARY_CREW);

        // Only Salary Crew can approve/deny
        if (!isSalaryCrew) return;

        // Cannot approve own request
        if (user.id === transaction.requestedBy) return;

        if (reaction.emoji.name === '✅') {
            // Check if already processing to prevent race condition
            if (transaction.isProcessing) {
                return;
            }
            
            // Mark as processing and remove from pending immediately
            transaction.isProcessing = true;
            pendingAdminEsubTransactions.delete(reaction.message.id);
            
            // Approval
            const originalEmbed = reaction.message.embeds[0];
            const approvedEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0x00FF00)
                .setFooter({ text: `Approved by ${user.username}` });

            await reaction.message.edit({
                content: `✅ **Approved by ${user.username}**`,
                embeds: [approvedEmbed]
            });

            // Process the admin esub
            await this.processAdminEsubCompletion(transaction, reaction.message, client);

        } else if (reaction.emoji.name === '❌') {
            // Denial
            const originalEmbed = reaction.message.embeds[0];
            const deniedEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setFooter({ text: `Denied by ${user.username}` });

            await reaction.message.edit({
                content: `❌ **Denied by ${user.username}**`,
                embeds: [deniedEmbed]
            });

            // Remove from pending
            pendingAdminEsubTransactions.delete(reaction.message.id);

            Logger.info(`Admin one-day sub request denied by ${user.username}`);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingAdminEsubTransactions.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending admin esub transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const transaction = pendingAdminEsubTransactions.get(transactionId);
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
                pendingAdminEsubTransactions.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire admin esub transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} admin esub transactions`);
        return expiredCount;
    }
};
