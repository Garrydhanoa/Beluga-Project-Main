const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Logger = require('../utils/logger');
const { TEAM_ROLES, TEAM_COLORS } = require('../constants/roles');
const { getTeamSchedule, AAA_AA_ONLY_TEAMS, ALL_DIVISION_TEAMS } = require('../constants/schedule');
const path = require('path');
const fs = require('fs');

// Team logo URLs (hosted on Discord CDN or external)
// For local logos, we'll attach them
function findTeamLogo(teamName) {
    try {
        const logosDir = path.join(__dirname, '../../IMAGES/logos');
        
        if (!fs.existsSync(logosDir)) {
            return null;
        }
        
        const files = fs.readdirSync(logosDir);
        const normalizedTeamName = teamName.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Try exact match first
        for (const file of files) {
            const fileNameWithoutExt = path.parse(file).name.toLowerCase();
            if (fileNameWithoutExt === teamName.toLowerCase()) {
                return path.join(logosDir, file);
            }
        }
        
        // Try fuzzy match
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
        
        return null;
    } catch (error) {
        return null;
    }
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

    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        const division = interaction.options.getString('division');
        
        if (focusedOption.name === 'team') {
            let teams = ALL_TEAMS;
            
            // Filter teams based on division if selected
            if (division === 'MAJORS') {
                teams = ALL_DIVISION_TEAMS;
            }
            
            // Filter based on user input
            const filtered = teams.filter(team => 
                team.toLowerCase().includes(focusedOption.value.toLowerCase())
            );
            
            await interaction.respond(
                filtered.slice(0, 25).map(team => ({ name: team, value: team }))
            );
        }
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

            // Try to attach team logo as thumbnail
            const logoPath = findTeamLogo(teamName);
            const files = [];
            
            if (logoPath && fs.existsSync(logoPath)) {
                const logoAttachment = new AttachmentBuilder(logoPath, { name: 'team_logo.png' });
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
