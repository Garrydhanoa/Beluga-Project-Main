const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');
const { TransactionDB } = require('../utils/database');
const { attachTeamLogo, getActiveSeasonId, resolveMemberTeamInDivision } = require('../utils/teamRoles');
const { getEsubLimit, getEsubUsed, consumeEsub } = require('../utils/esubStore');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const ESUB_TRACKING_CHANNEL_ID = '1265781513660923945';

// Pending esub transactions
const pendingEsubTransactions = new Map();

/**
 * Team logo for embeds — DB only (team→franchise logo). Returns an
 * AttachmentBuilder named team_logo.png or null. (Was IMAGES/logos/*.png.)
 */
async function teamLogoAttachment(teamId, teamName) {
    return attachTeamLogo(teamId, teamName);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('esub')
        .setDescription('Sign a free agent as a one-day substitute (GM/Captain only)')
        .addUserOption(option =>
            option
                .setName('player')
                .setDescription('The free agent to sign as a one-day sub')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('division')
                .setDescription('Division to sign the player to')
                .setRequired(true)
                .addChoices(
                    { name: 'AA', value: 'AA' },
                    { name: 'AAA', value: 'AAA' },
                    { name: 'MAJORS', value: 'MAJORS' }
                )
        ),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const player = interaction.options.getUser('player');
            const division = interaction.options.getString('division');
            const initiatorMember = await interaction.guild.members.fetch(interaction.user.id);
            const playerMember = await interaction.guild.members.fetch(player.id);

            const seasonId = await getActiveSeasonId();
            if (!seasonId) {
                return await interaction.editReply({
                    content: '❌ No active season — one-day subs cannot be tracked right now.',
                });
            }

            // Resolve the initiator's team in this division from the DB (GM role,
            // team role, NP role or roster row) — the constants team list is stale.
            const link = await resolveMemberTeamInDivision(initiatorMember, division);
            if (!link) {
                return await interaction.editReply({
                    content: `❌ Could not determine your ${division} team.`,
                });
            }

            const initiatorTeam = link.team.name;
            const initiatorTeamId = link.team.id;

            // GMs sign for their franchise; captains sign for the division they
            // hold the captain role in. NP (non-playing) staff count as being on
            // the team, so an NP captain qualifies too.
            const userIsGM = link.isGM;
            if (!userIsGM && !link.hasCaptainRole) {
                return await interaction.editReply({
                    content: `❌ Only General Managers and ${division} Captains can sign one-day subs for ${division}.`,
                });
            }

            // Check if player is a free agent in the specified division
            const freeAgentRoleId = ROLES.FREE_AGENTS[division];
            if (!freeAgentRoleId || !playerMember.roles.cache.has(freeAgentRoleId)) {
                return await interaction.editReply({
                    content: `❌ ${player.username} is not a ${division} free agent.`,
                });
            }

            // Check esub count (DB — resets automatically each season)
            const esubLimit = await getEsubLimit(seasonId);
            const currentEsubCount = await getEsubUsed(seasonId, initiatorTeamId);
            if (currentEsubCount >= esubLimit) {
                return await interaction.editReply({
                    content: `❌ Your team has already used all ${esubLimit} one-day subs for ${division} this season (${currentEsubCount}/${esubLimit}).`,
                });
            }

            // Get transaction channel
            const transactionChannel = await interaction.guild.channels.fetch(TRANSACTION_REQUEST_CHANNEL_ID);
            if (!transactionChannel) {
                return await interaction.editReply({
                    content: '❌ Transaction channel not found.',
                });
            }

            // Create esub request embed
            const esubEmbed = new EmbedBuilder()
                .setTitle(`🔄 One-Day Sub Request`)
                .setDescription(`**${initiatorTeam}** wants to sign ${player.username} as a one-day substitute.`)
                .addFields(
                    { name: 'Player', value: `<@${player.id}>`, inline: true },
                    { name: 'Team', value: initiatorTeam, inline: true },
                    { name: 'Division', value: division, inline: true },
                    { name: 'E-Subs Used', value: `${currentEsubCount}/${esubLimit} (will be ${currentEsubCount + 1}/${esubLimit})`, inline: true },
                    { name: 'Requested By', value: `${interaction.user.username} (${userIsGM ? 'GM' : `${division} Captain`})`, inline: false },
                    { name: 'Required Approvals', value: '✅ Salary Crew\n✅ Player', inline: false }
                )
                .setColor(0xFF9900)
                .setFooter({ text: 'React with ✅ to approve or ❌ to deny' })
                .setTimestamp();

            // Request is posted without a logo attachment.
            let esubMessage;
            esubMessage = await transactionChannel.send({
                content: `<@&${ROLES.SALARY_CREW}> <@${player.id}>`,
                embeds: [esubEmbed]
            });

            // Add reactions
            await esubMessage.react('✅');
            await esubMessage.react('❌');

            // Store pending transaction
            pendingEsubTransactions.set(esubMessage.id, {
                seasonId,
                teamId: initiatorTeamId,
                teamName: initiatorTeam,
                playerId: player.id,
                playerUsername: player.username,
                division: division,
                esubLimit,
                currentEsubCount: currentEsubCount,
                requestedBy: interaction.user.id,
                requestedByUsername: interaction.user.username,
                isGM: userIsGM,
                approvals: {
                    salaryCrew: false,
                    player: false
                },
                expiresAt: Date.now() + (12 * 60 * 60 * 1000) // 12 hours
            });

            // Set timeout
            setTimeout(async () => {
                const transaction = pendingEsubTransactions.get(esubMessage.id);
                if (transaction) {
                    pendingEsubTransactions.delete(esubMessage.id);
                    try {
                        await esubMessage.edit({
                            content: '⏱️ This one-day sub request has expired.',
                            embeds: [esubEmbed.setColor(0xFF0000).setFooter({ text: 'Expired' })]
                        });
                    } catch (error) {
                        Logger.error('Failed to mark esub request as expired', error);
                    }
                }
            }, 12 * 60 * 60 * 1000);

            await interaction.editReply({
                content: `✅ One-day sub request sent! Your team has used ${currentEsubCount}/${esubLimit} e-subs for ${division}. Waiting for Salary Crew and player approval.`,
            });

        } catch (error) {
            Logger.error('Failed to execute onesub command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the one-day sub request. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    /**
     * Process esub completion after approvals
     */
    async processEsubCompletion(transaction, message, client) {
        const guild = message.guild;
        
        try {
            const playerMember = await guild.members.fetch(transaction.playerId);
            if (!playerMember) {
                await message.channel.send({
                    content: `❌ Could not find player <@${transaction.playerId}> in the server.`
                });
                return;
            }

            // E-subs are temporary - DO NOT add team role
            // Just update the count in tracking

            // Consume one e-sub. This is the atomic limit check: the count could
            // have moved between the request and the approval (12h window), so a
            // null here means the team hit the cap in the meantime.
            const esubLimit = transaction.esubLimit ?? await getEsubLimit(transaction.seasonId);
            const newCount = await consumeEsub(
                transaction.seasonId,
                transaction.teamId,
                esubLimit,
                transaction.requestedByUsername || null
            );
            if (newCount === null) {
                await message.channel.send({
                    content: `❌ **${transaction.teamName}** has already used all ${esubLimit} ${transaction.division} one-day subs this season — this request was not applied.`
                });
                return;
            }

            // Send confirmation to transaction channel
            const transactionChannel = await client.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);

            const confirmationEmbed = new EmbedBuilder()
                .setTitle(`✅ One-Day Sub Signed`)
                .setDescription(`<@${transaction.playerId}> has been signed as a one-day substitute for **${transaction.teamName}**.`)
                .addFields(
                    { name: 'Team', value: transaction.teamName, inline: true },
                    { name: 'Division', value: transaction.division, inline: true },
                    { name: 'E-Subs Used', value: `${newCount}/${esubLimit}`, inline: true },
                    { name: 'Requested By', value: transaction.requestedByUsername, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            const logoAttachment = await teamLogoAttachment(transaction.teamId, transaction.teamName);
            if (logoAttachment) {
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

            // Send small embed to esub tracking channel
            const esubChannel = await client.channels.fetch(ESUB_TRACKING_CHANNEL_ID);
            if (esubChannel) {
                const trackingEmbed = new EmbedBuilder()
                    .setDescription(`**${transaction.teamName}** signed <@${transaction.playerId}> as a one-day sub for **${transaction.division}** (${newCount}/${esubLimit} used)`)
                    .setColor(0xFF9900)
                    .setTimestamp();

                const trackLogo = await teamLogoAttachment(transaction.teamId, transaction.teamName);
                if (trackLogo) {
                    trackingEmbed.setThumbnail('attachment://team_logo.png');
                    await esubChannel.send({
                        embeds: [trackingEmbed],
                        files: [trackLogo]
                    });
                } else {
                    await esubChannel.send({ embeds: [trackingEmbed] });
                }
            }

            {
                const teamId = transaction.teamId
                    || await TransactionDB.findTeamIdByName(transaction.division, transaction.teamName);
                await TransactionDB.log({
                    discordId: transaction.playerId,
                    discordUsername: transaction.playerUsername,
                    teamId,
                    teamNameSnapshot: transaction.teamName,
                    type: 'esub',
                    details: {
                        division: transaction.division,
                        isGM: !!transaction.isGM,
                        requestedByUsername: transaction.requestedByUsername,
                    },
                    performedByDiscordId: transaction.requestedBy,
                    performedByUsername: transaction.requestedByUsername,
                    source: 'bot:/esub',
                });
            }

            Logger.success(`One-day sub signed: ${transaction.playerUsername} to ${transaction.teamName} ${transaction.division}`);
            
        } catch (error) {
            Logger.error('Failed to process esub completion', error);
            await message.channel.send({
                content: `❌ An error occurred while processing the one-day sub for ${transaction.playerUsername}.`
            });
        }
    },

    /**
     * Handle reactions for esub approval
     */
    async handleReaction(reaction, user, client) {
        const transaction = pendingEsubTransactions.get(reaction.message.id);
        if (!transaction) return;

        const member = await reaction.message.guild.members.fetch(user.id);
        const isPlayer = user.id === transaction.playerId;
        const isSalaryCrew = member.roles.cache.has(ROLES.SALARY_CREW);

        if (reaction.emoji.name === '✅') {
            // Approval - check if user is the player FIRST
            if (isPlayer) {
                transaction.approvals.player = true;
            } else if (isSalaryCrew) {
                transaction.approvals.salaryCrew = true;
            } else {
                return; // Not authorized
            }

            // Check if all approvals are met
            const allApproved = transaction.approvals.salaryCrew && transaction.approvals.player;

            if (allApproved) {
                // Check if already processing to prevent race condition
                if (transaction.isProcessing) {
                    return;
                }
                
                // Mark as processing and remove from pending immediately
                transaction.isProcessing = true;
                pendingEsubTransactions.delete(reaction.message.id);
                
                const originalEmbed = reaction.message.embeds[0];
                const approvedEmbed = EmbedBuilder.from(originalEmbed)
                    .setColor(0x00FF00)
                    .setFooter({ text: 'Approved - All requirements met' });

                await reaction.message.edit({
                    content: '✅ **One-Day Sub Approved**',
                    embeds: [approvedEmbed]
                });

                // Process the esub
                await this.processEsubCompletion(transaction, reaction.message, client);
            } else {
                // Update embed to show partial approvals
                const originalEmbed = reaction.message.embeds[0];
                const fields = originalEmbed.fields.map(field => {
                    if (field.name === 'Required Approvals') {
                        const value = `${transaction.approvals.salaryCrew ? '✅' : '⏳'} Salary Crew\n${transaction.approvals.player ? '✅' : '⏳'} Player`;
                        return { ...field, value };
                    }
                    return field;
                });

                const updatedEmbed = EmbedBuilder.from(originalEmbed).setFields(fields);
                await reaction.message.edit({ embeds: [updatedEmbed] });
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
            pendingEsubTransactions.delete(reaction.message.id);

            Logger.info(`One-day sub request denied by ${user.username}`);
        }
    },

    async expireAllTransactions(client) {
        let expiredCount = 0;
        const transactionIds = Array.from(pendingEsubTransactions.keys());
        
        Logger.info(`Expiring ${transactionIds.length} pending esub transactions...`);
        
        for (const transactionId of transactionIds) {
            try {
                const transaction = pendingEsubTransactions.get(transactionId);
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
                pendingEsubTransactions.delete(transactionId);
                
            } catch (error) {
                Logger.error(`Failed to expire esub transaction ${transactionId}`, error);
            }
        }
        
        Logger.info(`Expired ${expiredCount} esub transactions`);
        return expiredCount;
    }
};
