const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');

// Command-specific constants
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

// Check if user has permission to use the command
function hasPermission(member) {
    // Check Salary Crew
    if (member.roles.cache.has(ROLES.SALARY_CREW)) {
        return true;
    }
    
    // Check GM roles
    for (const gmRoleId of Object.values(ROLES.GM_ROLES)) {
        if (member.roles.cache.has(gmRoleId)) {
            return true;
        }
    }
    
    // Check Captain roles
    for (const captainRoleId of Object.values(ROLES.CAPTAINS)) {
        if (member.roles.cache.has(captainRoleId)) {
            return true;
        }
    }
    
    return false;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fa')
        .setDescription('Search for free agents by salary (Salary Crew, GMs, Captains only)')
        .addNumberOption(option =>
            option.setName('salary')
                .setDescription('Enter salary (5 to 20, increments of 0.25, e.g., 12.5)')
                .setRequired(true)
                .setMinValue(5)
                .setMaxValue(20)
                .setAutocomplete(true)),
    
    async autocomplete(interaction) {
        try {
            // Check if interaction is still valid
            if (!interaction.isAutocomplete()) return;
            
            const focusedValue = interaction.options.getFocused();
            
            // Generate salary options from 5 to 20, incrementing by 0.25
            const salaries = [];
            for (let salary = 5; salary <= 20; salary += 0.25) {
                const roundedSalary = Math.round(salary * 100) / 100;
                salaries.push(roundedSalary);
            }
            
            // Filter based on user input
            const filtered = salaries
                .filter(salary => {
                    const salaryStr = salary.toString();
                    return salaryStr.startsWith(focusedValue.toString()) || 
                           salaryStr.includes(focusedValue.toString());
                })
                .slice(0, 25) // Discord limit
                .map(salary => ({
                    name: salary.toString(),
                    value: salary
                }));
            
            // Only respond if interaction hasn't been responded to
            if (!interaction.responded) {
                await interaction.respond(filtered);
            }
        } catch (error) {
            // Silently handle autocomplete errors to avoid console spam
            if (error.code !== 10062 && error.code !== 'InteractionAlreadyReplied') {
                Logger.error('Error in fa autocomplete', error);
            }
        }
    },

    async execute(interaction) {
        try {
            // Check permissions
            if (!hasPermission(interaction.member)) {
                return await interaction.reply({
                    content: '❌ You do not have permission to use this command. Only Salary Crew, GMs, and Captains can search for free agents.',
                    ephemeral: true
                });
            }

            const searchSalary = interaction.options.getNumber('salary');
            
            // Validate salary is in valid increments
            const salaryRemainder = (searchSalary * 100) % 25;
            if (salaryRemainder !== 0) {
                return await interaction.reply({
                    content: '❌ Invalid salary. Please use increments of 0.25 (e.g., 5, 5.25, 5.5, 5.75).',
                    ephemeral: true
                });
            }

            await interaction.deferReply();

            // Initialize Google Sheets
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
                ['https://www.googleapis.com/auth/spreadsheets.readonly']
            );
            const sheets = google.sheets({ version: 'v4', auth });

            // Fetch data from FA SHEET columns C to F
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'FA SHEET!C:F',
            });

            const rows = response.data.values || [];
            
            if (rows.length === 0) {
                return await interaction.editReply({
                    content: '❌ No data found in FA SHEET.'
                });
            }

            // Find all free agents with matching salary
            const matchingFreeAgents = [];
            let division = null;

            for (let i = 1; i < rows.length; i++) { // Start from 1 to skip header row
                const row = rows[i];
                const name = row[0] || ''; // Column C
                const salary = row[1] || ''; // Column D
                const divisionValue = row[2] || ''; // Column E
                const isRFA = row[3] || ''; // Column F

                // Parse salary (handle both string and number formats)
                const rowSalary = parseFloat(salary);
                
                if (rowSalary === searchSalary) {
                    // Set division from the first match
                    if (division === null && divisionValue) {
                        division = divisionValue.toUpperCase();
                    }

                    // Add player to list with RFA indicator
                    const playerName = isRFA && isRFA.toUpperCase() === 'YES' 
                        ? `${name} (RFA)` 
                        : name;
                    
                    if (name) { // Only add if name exists
                        matchingFreeAgents.push(playerName);
                    }
                }
            }

            // Check if any free agents were found
            if (matchingFreeAgents.length === 0) {
                return await interaction.editReply({
                    content: `❌ No free agents found with salary **${searchSalary}**.`
                });
            }

            // Create professional embed
            const embed = new EmbedBuilder()
                .setTitle(`Free Agent Search - ${searchSalary} Salary`)
                .setColor(0x00B563) // Green color
                .setDescription(`**Division:** ${division || 'Not specified'}`)
                .setTimestamp()
                .setFooter({ text: `${matchingFreeAgents.length} player${matchingFreeAgents.length !== 1 ? 's' : ''} found` });

            // Add free agents list - split into multiple fields if needed (max 1024 chars per field)
            const playersPerField = 25; // Conservative estimate to avoid hitting limits
            
            if (matchingFreeAgents.length <= playersPerField) {
                embed.addFields({
                    name: 'Available Players',
                    value: matchingFreeAgents.join('\n'),
                    inline: false
                });
            } else {
                // Split into multiple fields if too many players
                for (let i = 0; i < matchingFreeAgents.length; i += playersPerField) {
                    const chunk = matchingFreeAgents.slice(i, i + playersPerField);
                    const fieldNumber = Math.floor(i / playersPerField) + 1;
                    embed.addFields({
                        name: `Available Players (Part ${fieldNumber})`,
                        value: chunk.join('\n'),
                        inline: false
                    });
                }
            }

            await interaction.editReply({ embeds: [embed] });

            Logger.info(`${interaction.user.username} searched for free agents with salary ${searchSalary}`);

        } catch (error) {
            Logger.error('Error in fa command', error);
            
            const errorMessage = '❌ An error occurred while searching for free agents. Please try again.';
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};
