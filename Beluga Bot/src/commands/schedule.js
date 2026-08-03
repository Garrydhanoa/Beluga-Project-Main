const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Logger = require('../utils/logger');
const { getTeamSchedule } = require('../constants/schedule');
const { attachTeamLogo, teamAutocomplete, findTeam, getTeamColorInt } = require('../utils/teamRoles');
const { siteFooter } = require('../utils/siteFooter');

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

            // Validate against the live DB (active season), not a hardcoded list.
            const team = await findTeam(teamName, division);
            if (!team) {
                const inAnyDivision = await findTeam(teamName);
                if (inAnyDivision) {
                    return await interaction.editReply({
                        content: `**${teamName}** does not play in the ${division} division. They play in ${inAnyDivision.division}.`,
                    });
                }
                return await interaction.editReply({
                    content: `Unknown team: **${teamName}**`,
                });
            }

            // Get the schedule for this team (DB-driven).
            const teamSchedule = await getTeamSchedule(teamName, division);

            if (Object.keys(teamSchedule).length === 0) {
                return await interaction.editReply({
                    content: `No schedule found for **${teamName}** in ${division}.`,
                });
            }

            // Build the schedule embed (team color from the DB franchise color).
            const teamColor = await getTeamColorInt(team.id);

            // Build schedule lines for every week actually present (numeric-sorted),
            // so matches aren't dropped if a season runs beyond week 8.
            const scheduleLines = [];
            const weekNums = Object.keys(teamSchedule)
                .map((k) => parseInt(k.replace(/^Week\s+/i, ''), 10))
                .filter((n) => Number.isFinite(n))
                .sort((a, b) => a - b);
            for (const week of weekNums) {
                const matches = teamSchedule[`Week ${week}`];
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

            // Try to attach team logo as thumbnail (from DB, exact team id)
            const logoAttachment = await attachTeamLogo(team.id, teamName);
            const files = [];

            if (logoAttachment) {
                files.push(logoAttachment);
                scheduleEmbed.setThumbnail('attachment://team_logo.png');
            }

            await interaction.editReply({
                content: siteFooter(interaction.guild),
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
