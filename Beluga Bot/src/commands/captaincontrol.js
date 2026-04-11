const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ROLES, TEAM_ROLES, NP_ROLES } = require('../constants/roles');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';

// Pending captain control transactions storage
const pendingCaptainTransactions = new Map();

/**
 * Find team logo path
 */
function findTeamLogo(teamName) {
    const normalizedName = teamName.replace(/\s+/g, ' ').trim();
    const logoPath = path.join(__dirname, '../../IMAGES/logos', `${normalizedName}.png`);
    return logoPath;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('captain')
        .setDescription('Promote or demote team captains (GM only)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('promote')
                .setDescription('Promote a player to captain')
                .addUserOption(option =>
                    option
                        .setName('player')
                        .setDescription('The player to promote')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('division')
                        .setDescription('Division for captain role')
                        .setRequired(true)
                        .addChoices(
                            { name: 'AA', value: 'AA' },
                            { name: 'AAA', value: 'AAA' },
                            { name: 'MAJORS', value: 'MAJORS' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('demote')
                .setDescription('Demote a captain to regular player')
                .addUserOption(option =>
                    option
                        .setName('player')
                        .setDescription('The captain to demote')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('division')
                        .setDescription('Division of captain role to remove')
                        .setRequired(true)
                        .addChoices(
                            { name: 'AA', value: 'AA' },
                            { name: 'AAA', value: 'AAA' },
                            { name: 'MAJORS', value: 'MAJORS' }
                        )
                )
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const subcommand = interaction.options.getSubcommand();
            const player = interaction.options.getUser('player');
            const division = interaction.options.getString('division');
            const member = await interaction.guild.members.fetch(player.id);
            const gmMember = await interaction.guild.members.fetch(interaction.user.id);

            // Check if user is a GM
            const isGM = Object.values(ROLES.GM_ROLES).some(roleId => 
                gmMember.roles.cache.has(roleId)
            );

            if (!isGM) {
                return await interaction.editReply({
                    content: '❌ Only General Managers can use this command.',
                });
            }

            // Get GM's team
            let gmTeam = null;
            for (const [teamName, roleId] of Object.entries(ROLES.GM_ROLES)) {
                if (gmMember.roles.cache.has(roleId)) {
                    gmTeam = teamName;
                    break;
                }
            }

            if (!gmTeam) {
                return await interaction.editReply({
                    content: '❌ Could not determine your team.',
                });
            }

            // Check if player is on GM's team (ANY division or NP)
            const npRoleId = NP_ROLES[gmTeam];
            let isOnTeam = false;
            let playerDivision = null;
            
            // Check all divisions for this team
            for (const [div, teams] of Object.entries(TEAM_ROLES)) {
                const teamRoleId = teams[gmTeam];
                if (teamRoleId && member.roles.cache.has(teamRoleId)) {
                    isOnTeam = true;
                    playerDivision = div;
                    break;
                }
            }
            
            const isOnNP = npRoleId && member.roles.cache.has(npRoleId);

            if (!isOnTeam && !isOnNP) {
                return await interaction.editReply({
                    content: `❌ ${player.username} is not on your team in any division or NP.`,
                });
            }

            // Get transaction channel
            const transactionChannel = await interaction.guild.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
            if (!transactionChannel) {
                return await interaction.editReply({
                    content: '❌ Transaction channel not found.',
                });
            }

            if (subcommand === 'promote') {
                // Check if already a captain
                const captainRoleId = ROLES.CAPTAINS[division];
                if (member.roles.cache.has(captainRoleId)) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is already a ${division} captain.`,
                    });
                }

                // Check if the team already has a captain for this division
                const teamRoleId = TEAM_ROLES[division][gmTeam];
                if (teamRoleId) {
                    // Fetch all members with the captain role for this division
                    const guild = interaction.guild;
                    const captainRole = await guild.roles.fetch(captainRoleId);
                    if (captainRole) {
                        // Check if any member with the captain role also has this team's role
                        const membersWithCaptainRole = captainRole.members;
                        for (const [memberId, guildMember] of membersWithCaptainRole) {
                            if (guildMember.roles.cache.has(teamRoleId)) {
                                return await interaction.editReply({
                                    content: `❌ ${gmTeam} already has a ${division} captain: ${guildMember.user.username}. Each team can only have one captain per division.`,
                                });
                            }
                        }
                    }
                }

                // Create promotion request embed
                const promotionEmbed = new EmbedBuilder()
                    .setTitle(`⭐ Captain Promotion Request`)
                    .setDescription(`${gmMember.user.username} wants to promote ${player.username} to captain.`)
                    .addFields(
                        { name: 'Player', value: `<@${player.id}>`, inline: true },
                        { name: 'Team', value: gmTeam, inline: true },
                        { name: 'Current Status', value: isOnNP ? 'NP (Non-Playing)' : `${playerDivision} Roster`, inline: true },
                        { name: 'Captain Role', value: `${division} Captain`, inline: true },
                        { name: 'Requested By', value: gmMember.user.username, inline: true },
                        { name: 'Required Approvals', value: '✅ Salary Crew\n✅ Player', inline: false }
                    )
                    .setColor(0xFFD700)
                    .setFooter({ text: 'React with ✅ to approve or ❌ to deny' })
                    .setTimestamp();

                // Send request message without logo attachment (logo will be in confirmation only)
                const promotionMessage = await transactionChannel.send({ 
                    content: `<@${player.id}>`,
                    embeds: [promotionEmbed]
                });

                // Add reactions
                await promotionMessage.react('✅');
                await promotionMessage.react('❌');

                // Store pending transaction
                pendingCaptainTransactions.set(promotionMessage.id, {
                    action: 'promote',
                    playerId: player.id,
                    playerUsername: player.username,
                    teamName: gmTeam,
                    playerDivision: playerDivision || 'NP', // Division player is currently on
                    captainDivision: division, // Division for captain role
                    captainRoleId: captainRoleId,
                    requestedBy: interaction.user.id,
                    requestedByUsername: interaction.user.username,
                    salaryCrewApproved: false,
                    playerApproved: false,
                    expiresAt: Date.now() + (12 * 60 * 60 * 1000)
                });

                // Set timeout
                setTimeout(async () => {
                    const transaction = pendingCaptainTransactions.get(promotionMessage.id);
                    if (transaction && (!transaction.salaryCrewApproved || !transaction.playerApproved)) {
                        pendingCaptainTransactions.delete(promotionMessage.id);
                        try {
                            await promotionMessage.edit({
                                content: '⏱️ This captain promotion request has expired.',
                                embeds: [promotionEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                            });
                        } catch (error) {
                            Logger.error('Failed to mark captain promotion request as expired', error);
                        }
                    }
                }, 12 * 60 * 60 * 1000);

                await interaction.editReply({
                    content: '✅ Captain promotion request sent! Waiting for Salary Crew and player approval.',
                });

            } else if (subcommand === 'demote') {
                // Check if player has captain role
                const captainRoleId = ROLES.CAPTAINS[division];
                if (!member.roles.cache.has(captainRoleId)) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is not a ${division} captain.`,
                    });
                }

                // Create demotion request embed
                const demotionEmbed = new EmbedBuilder()
                    .setTitle(`📉 Captain Demotion Request`)
                    .setDescription(`${gmMember.user.username} wants to demote ${player.username} from captain.`)
                    .addFields(
                        { name: 'Player', value: `<@${player.id}>`, inline: true },
                        { name: 'Team', value: gmTeam, inline: true },
                        { name: 'Current Status', value: isOnNP ? 'NP (Non-Playing)' : `${playerDivision} Roster`, inline: true },
                        { name: 'Removing Role', value: `${division} Captain`, inline: true },
                        { name: 'Requested By', value: gmMember.user.username, inline: true },
                        { name: 'Required Approval', value: '✅ Salary Crew only', inline: false }
                    )
                    .setColor(0xFF6347)
                    .setFooter({ text: 'React with ✅ to approve or ❌ to deny' })
                    .setTimestamp();

                // Send request message without logo attachment (logo will be in confirmation only)
                const demotionMessage = await transactionChannel.send({ 
                    content: '',
                    embeds: [demotionEmbed]
                });

                // Add reactions
                await demotionMessage.react('✅');
                await demotionMessage.react('❌');

                // Store pending transaction
                pendingCaptainTransactions.set(demotionMessage.id, {
                    action: 'demote',
                    playerId: player.id,
                    playerUsername: player.username,
                    teamName: gmTeam,
                    playerDivision: playerDivision || 'NP', // Division player is currently on
                    captainDivision: division, // Division of captain role to remove
                    captainRoleId: captainRoleId,
                    requestedBy: interaction.user.id,
                    requestedByUsername: interaction.user.username,
                    salaryCrewApproved: false,
                    playerApproved: true, // Not needed for demotion
                    expiresAt: Date.now() + (12 * 60 * 60 * 1000)
                });

                // Set timeout
                setTimeout(async () => {
                    const transaction = pendingCaptainTransactions.get(demotionMessage.id);
                    if (transaction && !transaction.salaryCrewApproved) {
                        pendingCaptainTransactions.delete(demotionMessage.id);
                        try {
                            await demotionMessage.edit({
                                content: '⏱️ This captain demotion request has expired.',
                                embeds: [demotionEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                            });
                        } catch (error) {
                            Logger.error('Failed to mark captain demotion request as expired', error);
                        }
                    }
                }, 12 * 60 * 60 * 1000);

                await interaction.editReply({
                    content: '✅ Captain demotion request sent! Waiting for Salary Crew approval.',
                });
            }

        } catch (error) {
            Logger.error('Failed to execute captaincontrol command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the captain control request. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    /**
     * Process captain control completion after approvals
     */
    async processCaptainControlCompletion(transaction, message, client) {
        const guild = message.guild;
        
        try {
            const playerMember = await guild.members.fetch(transaction.playerId);
            if (!playerMember) {
                await message.channel.send({
                    content: `❌ Could not find player <@${transaction.playerId}> in the server.`
                });
                return;
            }

            const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);
            
            if (transaction.action === 'promote') {
                // Add captain role
                await playerMember.roles.add(transaction.captainRoleId);
                
                const confirmationEmbed = new EmbedBuilder()
                    .setTitle(`⭐ ${transaction.teamName} - ${transaction.playerUsername} Promoted to Captain`)
                    .setDescription(`<@${transaction.playerId}> has been promoted to **${transaction.captainDivision} Captain**.`)
                    .addFields(
                        { name: 'Team', value: transaction.teamName, inline: true },
                        { name: 'Player Division', value: transaction.playerDivision, inline: true },
                        { name: 'Captain Role', value: `${transaction.captainDivision} Captain`, inline: true },
                        { name: 'Promoted By', value: transaction.requestedByUsername, inline: true }
                    )
                    .setColor(0xFFD700)
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
                
                Logger.success(`${transaction.playerUsername} (${transaction.playerDivision}) promoted to ${transaction.captainDivision} captain by ${transaction.requestedByUsername}`);
                
            } else if (transaction.action === 'demote') {
                // Remove captain role
                await playerMember.roles.remove(transaction.captainRoleId);
                
                const confirmationEmbed = new EmbedBuilder()
                    .setTitle(`📉 ${transaction.teamName} - ${transaction.playerUsername} Demoted from Captain`)
                    .setDescription(`<@${transaction.playerId}> has been demoted from **${transaction.captainDivision} Captain**.`)
                    .addFields(
                        { name: 'Team', value: transaction.teamName, inline: true },
                        { name: 'Player Division', value: transaction.playerDivision, inline: true },
                        { name: 'Removed Role', value: `${transaction.captainDivision} Captain`, inline: true },
                        { name: 'Demoted By', value: transaction.requestedByUsername, inline: true }
                    )
                    .setColor(0xFF6347)
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
                
                Logger.success(`${transaction.playerUsername} (${transaction.playerDivision}) demoted from ${transaction.captainDivision} captain by ${transaction.requestedByUsername}`);
            }
            
        } catch (error) {
            Logger.error('Failed to process captain control completion', error);
            await message.channel.send({
                content: `❌ An error occurred while processing the captain ${transaction.action} for ${transaction.playerUsername}.`
            });
        }
    },

    /**
     * Handle reactions for captain control approval
     */
    async handleReaction(reaction, user, client) {
        // Check if this reaction is for a pending captain transaction
        const transaction = pendingCaptainTransactions.get(reaction.message.id);
        if (!transaction) return;

        const member = await reaction.message.guild.members.fetch(user.id);
        const isPlayer = user.id === transaction.playerId;
        const isSalaryCrew = member.roles.cache.has(ROLES.SALARY_CREW);

        // For promotion: need both Salary Crew and player approval
        // For demotion: need only Salary Crew approval
        
        if (reaction.emoji.name === '✅') {
            // Approval - check if player FIRST, then Salary Crew
            if (isPlayer && transaction.action === 'promote') {
                transaction.playerApproved = true;
            } else if (isSalaryCrew) {
                transaction.salaryCrewApproved = true;
            } else {
                return; // Not authorized to approve
            }

            // Check if all required approvals are met
            const allApproved = transaction.salaryCrewApproved && transaction.playerApproved;

            if (allApproved) {
                // Check if already processing to prevent race condition
                if (transaction.isProcessing) {
                    return;
                }
                
                // Mark as processing and remove from pending immediately
                transaction.isProcessing = true;
                pendingCaptainTransactions.delete(reaction.message.id);
                
                const originalEmbed = reaction.message.embeds[0];
                const approvedEmbed = EmbedBuilder.from(originalEmbed)
                    .setColor(0x00FF00)
                    .setFooter({ text: `Approved - All requirements met` });
                
                await reaction.message.edit({
                    content: `✅ **Approved by Salary Crew${transaction.action === 'promote' ? ' and Player' : ''}**`,
                    embeds: [approvedEmbed]
                });
                
                // Process the captain control transaction
                await this.processCaptainControlCompletion(transaction, reaction.message, client);
            } else {
                // Update embed to show partial approval
                const originalEmbed = reaction.message.embeds[0];
                const fields = originalEmbed.fields.map(field => {
                    if (field.name === 'Required Approvals' || field.name === 'Required Approval') {
                        let value = '';
                        if (transaction.action === 'promote') {
                            value = `${transaction.salaryCrewApproved ? '✅' : '⏳'} Salary Crew\n${transaction.playerApproved ? '✅' : '⏳'} Player`;
                        } else {
                            value = `${transaction.salaryCrewApproved ? '✅' : '⏳'} Salary Crew only`;
                        }
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
            
        } else if (reaction.emoji.name === '❌') {
            // Denial - only Salary Crew can deny
            if (!isSalaryCrew) return;

            const originalEmbed = reaction.message.embeds[0];
            const deniedEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setFooter({ text: `Denied by ${user.username}` });
            
            await reaction.message.edit({
                content: `❌ **Denied by ${user.username}**`,
                embeds: [deniedEmbed]
            });
            
            // Remove from pending
            pendingCaptainTransactions.delete(reaction.message.id);
            
            Logger.info(`Captain ${transaction.action} request for ${transaction.playerUsername} denied by ${user.username}`);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingCaptainTransactions.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending captain control transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const transaction = pendingCaptainTransactions.get(transactionId);
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
                pendingCaptainTransactions.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire captain transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} captain control transactions`);
        return expiredCount;
    }
};
