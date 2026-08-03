const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');
const { TransactionDB } = require('../utils/database');
const { attachTeamLogo, teamAutocomplete, findTeam, getActiveSeasonId } = require('../utils/teamRoles');
const { getEsubLimit, getEsubUsed, consumeEsub, refundEsub } = require('../utils/esubStore');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const ESUB_TRACKING_CHANNEL_ID = '1265781513660923945';

// Pending admin esub transactions (for SIGN action)
const pendingAdminEsubTransactions = new Map();

/**
 * Team logo for embeds — DB only (team→franchise logo). Returns an
 * AttachmentBuilder named team_logo.png or null. (Was IMAGES/logos/*.png.)
 */
async function teamLogoAttachment(teamId, teamName) {
    return attachTeamLogo(teamId, teamName);
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
                .setAutocomplete(true)
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

    // Live team list from the current season (DB), filtered by the chosen division.
    async autocomplete(interaction) {
        await teamAutocomplete(interaction, { valueField: 'name', divisionOptionName: 'division' });
    },

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

            const seasonId = await getActiveSeasonId();
            if (!seasonId) {
                return await interaction.editReply({
                    content: '❌ No active season — one-day subs cannot be tracked right now.',
                });
            }

            // Resolve the team from the DB for this division (the constants team
            // list is stale — franchises have been renamed since).
            const team = await findTeam(teamName, division);
            if (!team) {
                return await interaction.editReply({
                    content: `❌ **${teamName}** does not exist in the ${division} division.`,
                });
            }
            const esubLimit = await getEsubLimit(seasonId);

            if (action === 'SIGN') {
                // SIGN action - requires approval from another Salary Crew member
                
                // Check if player is a free agent
                const freeAgentRoleId = ROLES.FREE_AGENTS[division];
                if (!freeAgentRoleId || !playerMember.roles.cache.has(freeAgentRoleId)) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is not a ${division} free agent.`,
                    });
                }

                // Check esub count (DB — resets automatically each season)
                const currentEsubCount = await getEsubUsed(seasonId, team.id);
                if (currentEsubCount >= esubLimit) {
                    return await interaction.editReply({
                        content: `❌ ${teamName} has already used all ${esubLimit} one-day subs for ${division} this season (${currentEsubCount}/${esubLimit}).`,
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
                        { name: 'E-Subs Used', value: `${currentEsubCount}/${esubLimit} (will be ${currentEsubCount + 1}/${esubLimit})`, inline: true },
                        { name: 'Requested By', value: `${interaction.user.username} (Salary Crew)`, inline: false },
                        { name: 'Required Approvals', value: '⏳ One other Salary Crew member', inline: false }
                    )
                    .setColor(0x0099FF)
                    .setFooter({ text: 'React with ✅ to approve or ❌ to deny' })
                    .setTimestamp();

                // Request is posted without a logo attachment.
                let esubMessage;
                esubMessage = await transactionChannel.send({
                    content: `<@&${ROLES.SALARY_CREW}>`,
                    embeds: [esubEmbed]
                });

                // Add reactions
                await esubMessage.react('✅');
                await esubMessage.react('❌');

                // Store pending transaction
                pendingAdminEsubTransactions.set(esubMessage.id, {
                    seasonId,
                    teamId: team.id,
                    teamName: team.name,
                    playerId: player.id,
                    playerUsername: player.username,
                    division: division,
                    esubLimit,
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
                    content: `✅ Admin one-day sub request sent! Waiting for another Salary Crew member to approve. ${teamName} has used ${currentEsubCount}/${esubLimit} e-subs for ${division}.`,
                });

            } else if (action === 'CANCEL') {
                // CANCEL action - immediate execution, no approval needed
                
                // Get current esub count
                const currentEsubCount = await getEsubUsed(seasonId, team.id);

                if (currentEsubCount <= 0) {
                    return await interaction.editReply({
                        content: `❌ ${teamName} has no recorded one-day subs to cancel for ${division} (${currentEsubCount}/${esubLimit}).`,
                    });
                }

                // Give the e-sub back (never goes below 0)
                const newCount = await refundEsub(seasonId, team.id, interaction.user.username);

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
                            { name: 'E-Subs Used', value: `${newCount}/${esubLimit}`, inline: true },
                            { name: 'Cancelled By', value: `${interaction.user.username} (Salary Crew)`, inline: true }
                        )
                        .setColor(0xFF0000)
                        .setTimestamp();

                    const logoAttachment = await teamLogoAttachment(team.id, team.name);
                    if (logoAttachment) {
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
                        .setDescription(`**${teamName}** cancelled <@${player.id}>'s one-day sub for **${division}** (${newCount}/${esubLimit} used)`)
                        .setColor(0xFF0000)
                        .setTimestamp();

                    const logoAttachment = await teamLogoAttachment(team.id, team.name);
                    if (logoAttachment) {
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
                    content: `✅ One-day sub cancelled! ${teamName} now has ${newCount}/${esubLimit} e-subs used for ${division}.`,
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

            // E-subs are temporary — no team role is granted (this used to add
            // one from the stale constants map, which both contradicted /esub
            // and left the player wearing a team role after the sub was over).

            // Consume one e-sub. The count can move during the 12h approval
            // window, so this is also the atomic limit check.
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
                .setTitle(`✅ Admin One-Day Sub Signed`)
                .setDescription(`<@${transaction.playerId}> has been signed as a one-day substitute for **${transaction.teamName}** by Salary Crew.`)
                .addFields(
                    { name: 'Team', value: transaction.teamName, inline: true },
                    { name: 'Division', value: transaction.division, inline: true },
                    { name: 'E-Subs Used', value: `${newCount}/${esubLimit}`, inline: true },
                    { name: 'Processed By', value: transaction.requestedByUsername, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            const logoAttachment = await teamLogoAttachment(transaction.teamId, transaction.teamName);
            if (logoAttachment) {
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
                    .setDescription(`**${transaction.teamName}** signed <@${transaction.playerId}> as a one-day sub for **${transaction.division}** via admin (${newCount}/${esubLimit} used)`)
                    .setColor(0x0099FF)
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
                        adminEsub: true,
                        division: transaction.division,
                        requestedByUsername: transaction.requestedByUsername,
                    },
                    performedByDiscordId: transaction.requestedBy,
                    performedByUsername: transaction.requestedByUsername,
                    source: 'bot:/admin-esub',
                });
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
