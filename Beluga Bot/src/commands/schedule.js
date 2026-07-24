const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Logger = require('../utils/logger');
const { TEAM_ROLES, TEAM_COLORS } = require('../constants/roles');
const { getTeamSchedule, AAA_AA_ONLY_TEAMS, ALL_DIVISION_TEAMS } = require('../constants/schedule');
const { attachTeamLogo, teamAutocomplete } = require('../utils/teamRoles');

// Team logo for embeds — DB only (team→franchise logo). Returns an
// AttachmentBuilder named team_logo.png or null. (Was IMAGES/logos/*.png.)
async function teamLogoAttachment(teamName) {
    return attachTeamLogo(null, teamName);
}

// Build team choices based on division
function getTeamChoicesForDivision(division) {
    if (division === 'MAJORS') {
        return ALL_DIVISION_TEAMS.map(team => ({ name: team, value: team }));
    } else {
        // AAA and AA have all 16 teams
        return [...ALL_DIVISION_TEAMS, ...AAA_AA_ONLY_TEAMS].map(team => ({ name: team, value: team }));
    }
}

// All possible teams for autocomplete
const ALL_TEAMS = [...ALL_DIVISION_TEAMS, ...AAA_AA_ONLY_TEAMS];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('View the match schedule for a team')
        .addStringOption(option =>
            option
                .setName('division')
                .setDescription('Select the division')
                .setRequired(true)
                .addChoices(
                    { name: 'Majors', value: 'MAJORS' },
                    { name: 'AAA', value: 'AAA' },
                    { name: 'AA', value: 'AA' }
                )
        )
        .addStringOption(option =>
            option
                .setName('team')
                .setDescription('Select the team')
                .setRequired(true)
                .setAutocomplete(true)
        ),

    // Live team list from the current season (DB), filtered by the chosen division.
    async autocomplete(interaction) {
        await teamAutocomplete(interaction, { valueField: 'name', divisionOptionName: 'division' });
    },

    async execute(interaction) {
        try {
            await interaction.deferReply();

            const division = interaction.options.getString('division');
            const teamName = interaction.options.getString('team');

            // Validate team exists in the selected division
            if (division === 'MAJORS' && AAA_AA_ONLY_TEAMS.includes(teamName)) {
                return await interaction.editReply({
                    content: `**${teamName}** does not play in the MAJORS division. They only play in AAA and AA.`,
                });
            }

            // Check if team exists
            if (!ALL_TEAMS.includes(teamName)) {
                return await interaction.editReply({
                    content: `Unknown team: **${teamName}**`,
                });
            }

            // Get the schedule for this team (DB-first, falls back to hardcoded)
            const teamSchedule = await getTeamSchedule(teamName, division);

            if (Object.keys(teamSchedule).length === 0) {
                return await interaction.editReply({
                    content: `No schedule found for **${teamName}** in ${division}.`,
                });
            }

            // Build the schedule embed
            const teamColor = TEAM_COLORS[teamName] || 0x3498DB;
            
            // Build schedule lines for all weeks
            const scheduleLines = [];
            for (let week = 1; week <= 8; week++) {
                const weekKey = `Week ${week}`;
                const matches = teamSchedule[weekKey];
                
                if (matches && matches.length > 0) {
                    for (const match of matches) {
                        scheduleLines.push({
                            week: week,
                            opponent: match.opponent,
                            isHome: match.isHome
                        });
                    }
                }
            }

            // Format the schedule description
            const formattedSchedule = scheduleLines.map(match => {
                const homeIndicator = match.isHome ? '(H)' : '(A)';
                return `**Week ${match.week}** vs ${match.opponent} ${homeIndicator}`;
            }).join('\n');

            const scheduleEmbed = new EmbedBuilder()
                .setTitle(`${teamName}`)
                .setDescription(`**${division} Division Schedule**\n\n${formattedSchedule}`)
                .setColor(teamColor)
                .setFooter({ text: `${division} Division | (H) Home | (A) Away` })
                .setTimestamp();

            // Try to attach team logo as thumbnail (from DB)
            const logoAttachment = await teamLogoAttachment(teamName);
            const files = [];

            if (logoAttachment) {
                files.push(logoAttachment);
                scheduleEmbed.setThumbnail('attachment://team_logo.png');
            }

            await interaction.editReply({
                embeds: [scheduleEmbed],
                files: files
            });

            Logger.info(`Schedule viewed: ${teamName} ${division} by ${interaction.user.tag}`);

        } catch (error) {
            Logger.error('Failed to execute schedule command', error);
            
            try {
                await interaction.editReply({
                    content: 'An error occurred while fetching the schedule. Please try again later.',
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    }
};
