const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { LeagueDB, TransactionDB, isDatabaseAvailable } = require('../utils/database');
const { ROLES, TEAM_ROLES, TEAM_NAMES, getTeamChoices } = require('../constants/roles');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const DEFAULT_ROSTER_LIMIT = 4;

// Pending trade transactions storage
const pendingTrades = new Map();

/**
 * Get player's division by checking their team roles
 */
function getPlayerDivision(member, teamName) {
    for (const [division, teams] of Object.entries(TEAM_ROLES)) {
        const roleId = teams[teamName];
        if (roleId && member.roles.cache.has(roleId)) {
            return division;
        }
    }
    return null;
}

/**
 * Count players in a division for a team
 */
async function countTeamRoster(guild, teamName, division) {
    const roleId = TEAM_ROLES[division]?.[teamName];
    if (!roleId) return 0;
    
    const role = await guild.roles.fetch(roleId);
    return role?.members.size || 0;
}

async function getRosterLimit(division, teamName) {
    if (!isDatabaseAvailable()) return DEFAULT_ROSTER_LIMIT;
    const limit = await LeagueDB.getTeamRosterLimit(division, teamName);
    return Number.isInteger(limit) ? limit : DEFAULT_ROSTER_LIMIT;
}

/**
 * Check if user is GM
 */
function isGM(member) {
    return Object.values(ROLES.GM_ROLES).some(roleId => member.roles.cache.has(roleId));
}

/**
 * Check if user is captain of a specific division
 */
function isCaptain(member, division) {
    const captainRoleId = ROLES.CAPTAINS[division];
    return captainRoleId && member.roles.cache.has(captainRoleId);
}

/**
 * Get user's team
 */
function getUserTeam(member) {
    for (const [teamName, roleId] of Object.entries(ROLES.GM_ROLES)) {
        if (member.roles.cache.has(roleId)) {
            return teamName;
        }
    }
    
    // Check team roles if not GM
    for (const [division, teams] of Object.entries(TEAM_ROLES)) {
        for (const [teamName, roleId] of Object.entries(teams)) {
            if (member.roles.cache.has(roleId)) {
                return teamName;
            }
        }
    }
    
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Propose a trade with another team (GM/Captain only)')
        .addStringOption(option =>
            option
                .setName('receiving_team')
                .setDescription('The team you want to trade with')
                .setRequired(true)
                .addChoices(...getTeamChoices())
        )
        .addUserOption(option =>
            option
                .setName('offering_player1')
                .setDescription('Player you are offering (from your team)')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('requesting_player1')
                .setDescription('Player you are requesting (from their team)')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('offering_player2')
                .setDescription('Player you are offering (from your team)')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('requesting_player2')
                .setDescription('Player you are requesting (from their team)')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('offering_player3')
                .setDescription('Player you are offering (from your team)')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('requesting_player3')
                .setDescription('Player you are requesting (from their team)')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('offering_player4')
                .setDescription('Player you are offering (from your team)')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('requesting_player4')
                .setDescription('Player you are requesting (from their team)')
                .setRequired(false)
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const receivingTeam = interaction.options.getString('receiving_team');
            const initiatorMember = await interaction.guild.members.fetch(interaction.user.id);
            
            // Get initiator's team
            const initiatorTeam = getUserTeam(initiatorMember);
            if (!initiatorTeam) {
                return await interaction.editReply({
                    content: '❌ Could not determine your team.',
                });
            }

            // Check if user is GM or Captain
            const userIsGM = isGM(initiatorMember);
            let userIsCaptain = false;
            let captainDivision = null;
            
            for (const division of ['MAJORS', 'AAA', 'AA']) {
                if (isCaptain(initiatorMember, division)) {
                    userIsCaptain = true;
                    captainDivision = division;
                    break;
                }
            }

            if (!userIsGM && !userIsCaptain) {
                return await interaction.editReply({
                    content: '❌ Only General Managers and Captains can propose trades.',
                });
            }

            // Cannot trade with own team
            if (receivingTeam === initiatorTeam) {
                return await interaction.editReply({
                    content: '❌ You cannot trade with your own team.',
                });
            }

            // Collect offered and requested players
            const offeredPlayers = [];
            const requestedPlayers = [];
            
            for (let i = 1; i <= 4; i++) {
                const offeredUser = interaction.options.getUser(`offering_player${i}`);
                const requestedUser = interaction.options.getUser(`requesting_player${i}`);
                
                if (offeredUser) offeredPlayers.push(offeredUser);
                if (requestedUser) requestedPlayers.push(requestedUser);
            }

            if (offeredPlayers.length === 0 || requestedPlayers.length === 0) {
                return await interaction.editReply({
                    content: '❌ You must offer at least one player and request at least one player.',
                });
            }

            // Validate all players
            const offeredMembers = [];
            const offeredPlayerData = [];
            
            for (const player of offeredPlayers) {
                const member = await interaction.guild.members.fetch(player.id);
                
                // Check if player is on initiator's team
                const playerTeam = getUserTeam(member);
                if (playerTeam !== initiatorTeam) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is not on your team.`,
                    });
                }
                
                // Check if player is GM
                if (isGM(member)) {
                    return await interaction.editReply({
                        content: `❌ General Managers cannot be traded.`,
                    });
                }
                
                // Captain cannot trade themselves
                if (userIsCaptain && player.id === interaction.user.id) {
                    return await interaction.editReply({
                        content: `❌ Captains cannot trade themselves.`,
                    });
                }
                
                const division = getPlayerDivision(member, initiatorTeam);
                if (!division) {
                    return await interaction.editReply({
                        content: `❌ Could not determine division for ${player.username}.`,
                    });
                }
                
                offeredMembers.push(member);
                offeredPlayerData.push({
                    id: player.id,
                    username: player.username,
                    division: division
                });
            }

            const requestedMembers = [];
            const requestedPlayerData = [];
            
            for (const player of requestedPlayers) {
                const member = await interaction.guild.members.fetch(player.id);
                
                // Check if player is on receiving team
                const playerTeam = getUserTeam(member);
                if (playerTeam !== receivingTeam) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is not on ${receivingTeam}.`,
                    });
                }
                
                // Check if player is GM
                if (isGM(member)) {
                    return await interaction.editReply({
                        content: `❌ General Managers cannot be traded.`,
                    });
                }
                
                const division = getPlayerDivision(member, receivingTeam);
                if (!division) {
                    return await interaction.editReply({
                        content: `❌ Could not determine division for ${player.username}.`,
                    });
                }
                
                requestedMembers.push(member);
                requestedPlayerData.push({
                    id: player.id,
                    username: player.username,
                    division: division
                });
            }

            // Check roster limits after trade for both teams
            const divisionChanges = { [initiatorTeam]: {}, [receivingTeam]: {} };
            
            // Calculate changes for initiator team
            for (const player of offeredPlayerData) {
                divisionChanges[initiatorTeam][player.division] = (divisionChanges[initiatorTeam][player.division] || 0) - 1;
            }
            for (const player of requestedPlayerData) {
                divisionChanges[initiatorTeam][player.division] = (divisionChanges[initiatorTeam][player.division] || 0) + 1;
            }
            
            // Calculate changes for receiving team
            for (const player of requestedPlayerData) {
                divisionChanges[receivingTeam][player.division] = (divisionChanges[receivingTeam][player.division] || 0) - 1;
            }
            for (const player of offeredPlayerData) {
                divisionChanges[receivingTeam][player.division] = (divisionChanges[receivingTeam][player.division] || 0) + 1;
            }

            // Validate roster limits
            for (const team of [initiatorTeam, receivingTeam]) {
                for (const [division, change] of Object.entries(divisionChanges[team])) {
                    const currentCount = await countTeamRoster(interaction.guild, team, division);
                    const newCount = currentCount + change;
                    const limit = await getRosterLimit(division, team);
                    
                    if (newCount > limit) {
                        return await interaction.editReply({
                            content: `❌ This trade would exceed the roster limit for ${team}'s ${division} division (${newCount}/${limit}).`,
                        });
                    }
                }
            }

            // Get both GMs
            let initiatorGM = null;
            let receivingGM = null;
            
            const initiatorGMRoleId = ROLES.GM_ROLES[initiatorTeam];
            const receivingGMRoleId = ROLES.GM_ROLES[receivingTeam];
            
            if (initiatorGMRoleId) {
                const initiatorGMRole = await interaction.guild.roles.fetch(initiatorGMRoleId);
                if (initiatorGMRole && initiatorGMRole.members.size > 0) {
                    initiatorGM = initiatorGMRole.members.first();
                }
            }
            
            if (receivingGMRoleId) {
                const receivingGMRole = await interaction.guild.roles.fetch(receivingGMRoleId);
                if (receivingGMRole && receivingGMRole.members.size > 0) {
                    receivingGM = receivingGMRole.members.first();
                }
            }

            // Create trade proposal embed
            const offeredPlayersText = offeredPlayerData.map(p => `<@${p.id}> (${p.division})`).join('\n');
            const requestedPlayersText = requestedPlayerData.map(p => `<@${p.id}> (${p.division})`).join('\n');

            const tradeEmbed = new EmbedBuilder()
                .setTitle(`🔄 Trade Proposal`)
                .setDescription(`**${initiatorTeam}** → **${receivingTeam}**`)
                .addFields(
                    { name: `${initiatorTeam} Offers`, value: offeredPlayersText, inline: true },
                    { name: `${receivingTeam} Offers`, value: requestedPlayersText, inline: true },
                    { name: 'Proposed By', value: `${interaction.user.username} (${userIsGM ? 'GM' : `${captainDivision} Captain`})`, inline: false },
                    { name: 'Required Approvals', value: `✅ ${initiatorTeam} GM\n✅ ${receivingTeam} GM\n✅ Salary Crew`, inline: false }
                )
                .setColor(0x3498db)
                .setFooter({ text: 'React with ✅ to approve or ❌ to deny' })
                .setTimestamp();

            // Get transaction channel
            const transactionChannel = await interaction.guild.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
            if (!transactionChannel) {
                return await interaction.editReply({
                    content: '❌ Transaction channel not found.',
                });
            }

            // Build mention string - only ping Salary Crew and both GMs
            const allMentions = [`<@&${ROLES.SALARY_CREW}>`];
            
            if (initiatorGM) allMentions.push(`<@${initiatorGM.id}>`);
            if (receivingGM) allMentions.push(`<@${receivingGM.id}>`);

            const tradeMessage = await transactionChannel.send({
                content: allMentions.join(' '),
                embeds: [tradeEmbed]
            });

            // Add reactions
            await tradeMessage.react('✅');
            await tradeMessage.react('❌');

            // Store pending trade
            pendingTrades.set(tradeMessage.id, {
                initiatorTeam,
                receivingTeam,
                offeredPlayers: offeredPlayerData,
                requestedPlayers: requestedPlayerData,
                initiatorGMId: initiatorGM?.id,
                receivingGMId: receivingGM?.id,
                proposedBy: interaction.user.id,
                proposedByUsername: interaction.user.username,
                approvals: {
                    initiatorGM: false,
                    receivingGM: false,
                    salaryCrew: false
                },
                expiresAt: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
            });

            // Set timeout
            setTimeout(async () => {
                const trade = pendingTrades.get(tradeMessage.id);
                if (trade) {
                    pendingTrades.delete(tradeMessage.id);
                    try {
                        await tradeMessage.edit({
                            content: '⏱️ This trade proposal has expired.',
                            embeds: [tradeEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                        });
                    } catch (error) {
                        Logger.error('Failed to mark trade as expired', error);
                    }
                }
            }, 12 * 60 * 60 * 1000);

            await interaction.editReply({
                content: '✅ Trade proposal sent! Waiting for approvals from both GMs and Salary Crew.',
            });

        } catch (error) {
            Logger.error('Failed to execute trade command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the trade request. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    /**
     * Process trade completion after all approvals
     */
    async processTradeCompletion(trade, message, client) {
        const guild = message.guild;
        
        try {
            // Remove all captain roles from traded players
            const allTradedPlayerIds = [
                ...trade.offeredPlayers.map(p => p.id),
                ...trade.requestedPlayers.map(p => p.id)
            ];

            for (const playerId of allTradedPlayerIds) {
                const member = await guild.members.fetch(playerId).catch(() => null);
                if (member) {
                    // Remove all captain roles
                    for (const captainRoleId of Object.values(ROLES.CAPTAINS)) {
                        if (member.roles.cache.has(captainRoleId)) {
                            await member.roles.remove(captainRoleId);
                        }
                    }
                }
            }

            // Execute the trade - remove old team roles and add new ones
            for (const player of trade.offeredPlayers) {
                const member = await guild.members.fetch(player.id).catch(() => null);
                if (member) {
                    const oldRoleId = TEAM_ROLES[player.division][trade.initiatorTeam];
                    const newRoleId = TEAM_ROLES[player.division][trade.receivingTeam];
                    
                    if (oldRoleId) await member.roles.remove(oldRoleId);
                    if (newRoleId) await member.roles.add(newRoleId);
                }
            }

            for (const player of trade.requestedPlayers) {
                const member = await guild.members.fetch(player.id).catch(() => null);
                if (member) {
                    const oldRoleId = TEAM_ROLES[player.division][trade.receivingTeam];
                    const newRoleId = TEAM_ROLES[player.division][trade.initiatorTeam];
                    
                    if (oldRoleId) await member.roles.remove(oldRoleId);
                    if (newRoleId) await member.roles.add(newRoleId);
                }
            }

            // Send confirmation
            const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);

            const offeredPlayersText = trade.offeredPlayers.map(p => `<@${p.id}> (${p.division})`).join('\n');
            const requestedPlayersText = trade.requestedPlayers.map(p => `<@${p.id}> (${p.division})`).join('\n');
            
            // Build player pings for content (all traded players)
            const allPlayerPings = [...trade.offeredPlayers, ...trade.requestedPlayers].map(p => `<@${p.id}>`).join(' ');

            const confirmationEmbed = new EmbedBuilder()
                .setTitle(`Trade Completed`)
                .setDescription(`**${trade.initiatorTeam}** ↔️ **${trade.receivingTeam}**`)
                .addFields(
                    { name: `${trade.initiatorTeam} Sent`, value: offeredPlayersText, inline: true },
                    { name: `${trade.receivingTeam} Sent`, value: requestedPlayersText, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            await transactionChannel.send({
                content: allPlayerPings,
                embeds: [confirmationEmbed]
            });

            // Log trade to shared transactions table.
            // Each player gets ONE row: trade_out from origin team + trade_in to destination team.
            // Players going FROM initiator → receiving:
            try {
                const initiatorTeamId = await TransactionDB.findTeamIdByName(trade.offeredPlayers[0]?.division, trade.initiatorTeam);
                const receivingTeamId = await TransactionDB.findTeamIdByName(trade.requestedPlayers[0]?.division, trade.receivingTeam);

                for (const p of (trade.offeredPlayers || [])) {
                    // Player going FROM initiator TO receiving
                    await TransactionDB.log({
                        discordId: p.id,
                        teamId: receivingTeamId,
                        teamNameSnapshot: trade.receivingTeam,
                        pairedTeamId: initiatorTeamId,
                        pairedTeamNameSnapshot: trade.initiatorTeam,
                        type: 'trade_in',
                        details: { division: p.division, from: trade.initiatorTeam, to: trade.receivingTeam },
                        source: 'bot:/trade',
                    });
                    await TransactionDB.log({
                        discordId: p.id,
                        teamId: initiatorTeamId,
                        teamNameSnapshot: trade.initiatorTeam,
                        pairedTeamId: receivingTeamId,
                        pairedTeamNameSnapshot: trade.receivingTeam,
                        type: 'trade_out',
                        details: { division: p.division, from: trade.initiatorTeam, to: trade.receivingTeam },
                        source: 'bot:/trade',
                    });
                }
                for (const p of (trade.requestedPlayers || [])) {
                    // Player going FROM receiving TO initiator
                    await TransactionDB.log({
                        discordId: p.id,
                        teamId: initiatorTeamId,
                        teamNameSnapshot: trade.initiatorTeam,
                        pairedTeamId: receivingTeamId,
                        pairedTeamNameSnapshot: trade.receivingTeam,
                        type: 'trade_in',
                        details: { division: p.division, from: trade.receivingTeam, to: trade.initiatorTeam },
                        source: 'bot:/trade',
                    });
                    await TransactionDB.log({
                        discordId: p.id,
                        teamId: receivingTeamId,
                        teamNameSnapshot: trade.receivingTeam,
                        pairedTeamId: initiatorTeamId,
                        pairedTeamNameSnapshot: trade.initiatorTeam,
                        type: 'trade_out',
                        details: { division: p.division, from: trade.receivingTeam, to: trade.initiatorTeam },
                        source: 'bot:/trade',
                    });
                }
            } catch (txErr) {
                Logger.warning('Trade tx logging failed (non-fatal): ' + txErr.message);
            }

            Logger.success(`Trade completed between ${trade.initiatorTeam} and ${trade.receivingTeam}`);
            
        } catch (error) {
            Logger.error('Failed to process trade completion', error);
            await message.channel.send({
                content: `❌ An error occurred while processing the trade.`
            });
        }
    },

    /**
     * Handle reactions for trade approval
     */
    async handleReaction(reaction, user, client) {
        const trade = pendingTrades.get(reaction.message.id);
        if (!trade) return;

        const member = await reaction.message.guild.members.fetch(user.id);
        const isInitiatorGM = user.id === trade.initiatorGMId;
        const isReceivingGM = user.id === trade.receivingGMId;
        const isSalaryCrew = member.roles.cache.has(ROLES.SALARY_CREW);

        if (reaction.emoji.name === '✅') {
            // Approval - check GMs FIRST, then Salary Crew
            if (isInitiatorGM) {
                trade.approvals.initiatorGM = true;
            } else if (isReceivingGM) {
                trade.approvals.receivingGM = true;
            } else if (isSalaryCrew) {
                trade.approvals.salaryCrew = true;
            } else {
                return; // Not authorized
            }

            // Check if all approvals are met (both GMs + Salary Crew)
            const allApproved = trade.approvals.initiatorGM && 
                               trade.approvals.receivingGM && 
                               trade.approvals.salaryCrew;

            if (allApproved) {
                // Check if already processing to prevent race condition
                if (trade.isProcessing) {
                    return;
                }
                
                // Mark as processing and remove from pending immediately
                trade.isProcessing = true;
                pendingTrades.delete(reaction.message.id);
                
                const originalEmbed = reaction.message.embeds[0];
                const approvedEmbed = EmbedBuilder.from(originalEmbed)
                    .setColor(0x00FF00)
                    .setFooter({ text: 'Approved - All requirements met' });

                await reaction.message.edit({
                    content: '✅ **Trade Approved**',
                    embeds: [approvedEmbed]
                });

                // Process the trade
                await this.processTradeCompletion(trade, reaction.message, client);
            } else {
                // Update embed to show partial approvals
                const originalEmbed = reaction.message.embeds[0];
                
                const fields = originalEmbed.fields.map(field => {
                    if (field.name === 'Required Approvals') {
                        const value = `${trade.approvals.initiatorGM ? '✅' : '⏳'} ${trade.initiatorTeam} GM\n` +
                                     `${trade.approvals.receivingGM ? '✅' : '⏳'} ${trade.receivingTeam} GM\n` +
                                     `${trade.approvals.salaryCrew ? '✅' : '⏳'} Salary Crew`;
                        return { ...field, value };
                    }
                    return field;
                });

                const updatedEmbed = EmbedBuilder.from(originalEmbed).setFields(fields);
                await reaction.message.edit({ embeds: [updatedEmbed] });
            }

        } else if (reaction.emoji.name === '❌') {
            // Denial - only GMs or Salary Crew can deny
            if (!isInitiatorGM && !isReceivingGM && !isSalaryCrew) return;

            const originalEmbed = reaction.message.embeds[0];
            const deniedEmbed = EmbedBuilder.from(originalEmbed)
                .setColor(0xFF0000)
                .setFooter({ text: `Denied by ${user.username}` });

            await reaction.message.edit({
                content: `❌ **Trade Denied by ${user.username}**`,
                embeds: [deniedEmbed]
            });

            // Remove from pending
            pendingTrades.delete(reaction.message.id);

            Logger.info(`Trade between ${trade.initiatorTeam} and ${trade.receivingTeam} denied by ${user.username}`);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingTrades.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending trade transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const trade = pendingTrades.get(transactionId);
                if (!trade) continue;
                
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
                pendingTrades.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire trade transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} trade transactions`);
        return expiredCount;
    }
};
