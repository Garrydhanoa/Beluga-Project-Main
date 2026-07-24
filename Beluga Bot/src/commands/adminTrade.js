const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { LeagueDB, TransactionDB, isDatabaseAvailable } = require('../utils/database');
const { ROLES, TEAM_ROLES, TEAM_NAMES, getTeamChoices } = require('../constants/roles');
const { teamAutocomplete } = require('../utils/teamRoles');

// Command-specific constants
const TRANSACTION_REQUEST_CHANNEL_ID = '1178913188750823544';
const TRANSACTION_CONFIRMATION_CHANNEL_ID = '1156814623371169801';
const DEFAULT_ROSTER_LIMIT = 4;

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
        .setName('admintrade')
        .setDescription('Execute a trade directly (Salary Crew only)')
        .addStringOption(option =>
            option
                .setName('team1')
                .setDescription('First team in the trade')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option
                .setName('team2')
                .setDescription('Second team in the trade')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addUserOption(option =>
            option
                .setName('team1_player1')
                .setDescription('Player from Team 1 going to Team 2')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('team2_player1')
                .setDescription('Player from Team 2 going to Team 1')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('team1_player2')
                .setDescription('Player from Team 1 going to Team 2')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('team2_player2')
                .setDescription('Player from Team 2 going to Team 1')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('team1_player3')
                .setDescription('Player from Team 1 going to Team 2')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('team2_player3')
                .setDescription('Player from Team 2 going to Team 1')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('team1_player4')
                .setDescription('Player from Team 1 going to Team 2')
                .setRequired(false)
        )
        .addUserOption(option =>
            option
                .setName('team2_player4')
                .setDescription('Player from Team 2 going to Team 1')
                .setRequired(false)
        ),

    // Live team list from the current season (DB). No division option here, so
    // list every active team once; getFocused() targets team1 or team2.
    async autocomplete(interaction) {
        await teamAutocomplete(interaction, { valueField: 'name', perDivision: false });
    },

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const executorMember = await interaction.guild.members.fetch(interaction.user.id);
            
            // Check if user is Salary Crew
            if (!executorMember.roles.cache.has(ROLES.SALARY_CREW)) {
                return await interaction.editReply({
                    content: '❌ Only Salary Crew members can use this command.',
                });
            }

            const team1 = interaction.options.getString('team1');
            const team2 = interaction.options.getString('team2');

            // Cannot trade between same team
            if (team1 === team2) {
                return await interaction.editReply({
                    content: '❌ Cannot trade between the same team.',
                });
            }

            // Collect players from both teams
            const team1Players = [];
            const team2Players = [];
            
            for (let i = 1; i <= 4; i++) {
                const team1User = interaction.options.getUser(`team1_player${i}`);
                const team2User = interaction.options.getUser(`team2_player${i}`);
                
                if (team1User) team1Players.push(team1User);
                if (team2User) team2Players.push(team2User);
            }

            if (team1Players.length === 0 || team2Players.length === 0) {
                return await interaction.editReply({
                    content: '❌ You must select at least one player from each team.',
                });
            }

            // Validate all Team 1 players
            const team1PlayerData = [];
            
            for (const player of team1Players) {
                const member = await interaction.guild.members.fetch(player.id);
                
                // Check if player is on Team 1
                const playerTeam = getUserTeam(member);
                if (playerTeam !== team1) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is not on ${team1}.`,
                    });
                }
                
                // Check if player is GM
                if (isGM(member)) {
                    return await interaction.editReply({
                        content: `❌ General Managers cannot be traded.`,
                    });
                }
                
                const division = getPlayerDivision(member, team1);
                if (!division) {
                    return await interaction.editReply({
                        content: `❌ Could not determine division for ${player.username}.`,
                    });
                }
                
                team1PlayerData.push({
                    id: player.id,
                    username: player.username,
                    division: division,
                    member: member
                });
            }

            // Validate all Team 2 players
            const team2PlayerData = [];
            
            for (const player of team2Players) {
                const member = await interaction.guild.members.fetch(player.id);
                
                // Check if player is on Team 2
                const playerTeam = getUserTeam(member);
                if (playerTeam !== team2) {
                    return await interaction.editReply({
                        content: `❌ ${player.username} is not on ${team2}.`,
                    });
                }
                
                // Check if player is GM
                if (isGM(member)) {
                    return await interaction.editReply({
                        content: `❌ General Managers cannot be traded.`,
                    });
                }
                
                const division = getPlayerDivision(member, team2);
                if (!division) {
                    return await interaction.editReply({
                        content: `❌ Could not determine division for ${player.username}.`,
                    });
                }
                
                team2PlayerData.push({
                    id: player.id,
                    username: player.username,
                    division: division,
                    member: member
                });
            }

            // Check roster limits after trade for both teams
            const divisionChanges = { [team1]: {}, [team2]: {} };
            
            // Calculate changes for team1
            for (const player of team1PlayerData) {
                divisionChanges[team1][player.division] = (divisionChanges[team1][player.division] || 0) - 1;
            }
            for (const player of team2PlayerData) {
                divisionChanges[team1][player.division] = (divisionChanges[team1][player.division] || 0) + 1;
            }
            
            // Calculate changes for team2
            for (const player of team2PlayerData) {
                divisionChanges[team2][player.division] = (divisionChanges[team2][player.division] || 0) - 1;
            }
            for (const player of team1PlayerData) {
                divisionChanges[team2][player.division] = (divisionChanges[team2][player.division] || 0) + 1;
            }

            // Validate roster limits
            for (const team of [team1, team2]) {
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

            // Execute the trade
            // Remove all captain roles from traded players
            const allTradedPlayerData = [...team1PlayerData, ...team2PlayerData];
            
            for (const player of allTradedPlayerData) {
                // Remove all captain roles
                for (const captainRoleId of Object.values(ROLES.CAPTAINS)) {
                    if (player.member.roles.cache.has(captainRoleId)) {
                        await player.member.roles.remove(captainRoleId);
                    }
                }
            }

            // Move Team 1 players to Team 2
            for (const player of team1PlayerData) {
                const oldRoleId = TEAM_ROLES[player.division][team1];
                const newRoleId = TEAM_ROLES[player.division][team2];
                
                if (oldRoleId) await player.member.roles.remove(oldRoleId);
                if (newRoleId) await player.member.roles.add(newRoleId);
            }

            // Move Team 2 players to Team 1
            for (const player of team2PlayerData) {
                const oldRoleId = TEAM_ROLES[player.division][team2];
                const newRoleId = TEAM_ROLES[player.division][team1];
                
                if (oldRoleId) await player.member.roles.remove(oldRoleId);
                if (newRoleId) await player.member.roles.add(newRoleId);
            }

            // Send confirmation to transaction channel
            const transactionChannel = await interaction.guild.channels.fetch(TRANSACTION_CONFIRMATION_CHANNEL_ID);

            const team1PlayersText = team1PlayerData.map(p => `<@${p.id}> (${p.division})`).join('\n');
            const team2PlayersText = team2PlayerData.map(p => `<@${p.id}> (${p.division})`).join('\n');
            
            // Build player pings for content (all traded players)
            const allPlayerPings = [...team1PlayerData, ...team2PlayerData].map(p => `<@${p.id}>`).join(' ');

            const confirmationEmbed = new EmbedBuilder()
                .setTitle(`Admin Trade Executed`)
                .setDescription(`**${team1}** ↔️ **${team2}**`)
                .addFields(
                    { name: `${team1} Sent`, value: team1PlayersText, inline: true },
                    { name: `${team2} Sent`, value: team2PlayersText, inline: true },
                    { name: 'Executed By', value: interaction.user.username, inline: false }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            await transactionChannel.send({
                content: allPlayerPings,
                embeds: [confirmationEmbed]
            });

            await interaction.editReply({
                content: `✅ Trade successfully executed between ${team1} and ${team2}!`,
            });

            try {
                const team1Id = await TransactionDB.findTeamIdByName(team1PlayerData[0]?.division, team1);
                const team2Id = await TransactionDB.findTeamIdByName(team2PlayerData[0]?.division, team2);
                for (const p of (team1PlayerData || [])) {
                    await TransactionDB.log({
                        discordId: p.id, discordUsername: p.username,
                        teamId: team2Id, teamNameSnapshot: team2,
                        pairedTeamId: team1Id, pairedTeamNameSnapshot: team1,
                        type: 'trade_in',
                        details: { division: p.division, from: team1, to: team2, adminTrade: true },
                        performedByDiscordId: interaction.user.id,
                        performedByUsername: interaction.user.username,
                        source: 'bot:/admin-trade',
                    });
                    await TransactionDB.log({
                        discordId: p.id, discordUsername: p.username,
                        teamId: team1Id, teamNameSnapshot: team1,
                        pairedTeamId: team2Id, pairedTeamNameSnapshot: team2,
                        type: 'trade_out',
                        details: { division: p.division, from: team1, to: team2, adminTrade: true },
                        performedByDiscordId: interaction.user.id,
                        performedByUsername: interaction.user.username,
                        source: 'bot:/admin-trade',
                    });
                }
                for (const p of (team2PlayerData || [])) {
                    await TransactionDB.log({
                        discordId: p.id, discordUsername: p.username,
                        teamId: team1Id, teamNameSnapshot: team1,
                        pairedTeamId: team2Id, pairedTeamNameSnapshot: team2,
                        type: 'trade_in',
                        details: { division: p.division, from: team2, to: team1, adminTrade: true },
                        performedByDiscordId: interaction.user.id,
                        performedByUsername: interaction.user.username,
                        source: 'bot:/admin-trade',
                    });
                    await TransactionDB.log({
                        discordId: p.id, discordUsername: p.username,
                        teamId: team2Id, teamNameSnapshot: team2,
                        pairedTeamId: team1Id, pairedTeamNameSnapshot: team1,
                        type: 'trade_out',
                        details: { division: p.division, from: team2, to: team1, adminTrade: true },
                        performedByDiscordId: interaction.user.id,
                        performedByUsername: interaction.user.username,
                        source: 'bot:/admin-trade',
                    });
                }
            } catch (txErr) {
                Logger.warning('admin-trade tx logging failed (non-fatal): ' + txErr.message);
            }

            Logger.success(`Admin trade executed by ${interaction.user.username} between ${team1} and ${team2}`);

        } catch (error) {
            Logger.error('Failed to execute admintrade command', error);
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred while processing the trade. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    }
};
