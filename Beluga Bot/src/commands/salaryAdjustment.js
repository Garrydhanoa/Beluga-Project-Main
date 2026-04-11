const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ManualSalaryDB } = require('../utils/database');
const { ROLES } = require('../constants/roles');

// Command-specific constants
const SALARY_ANNOUNCEMENT_CHANNEL_ID = '1430752024630268024';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

class GoogleSheetsManager {
    constructor() {
        this.auth = null;
        this.sheets = null;
    }

    async initialize() {
        try {
            if (this.auth) return true;
            
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
            
            this.auth = new google.auth.JWT(
                client_email,
                null,
                private_key.replace(/\\n/g, '\n'),
                ['https://www.googleapis.com/auth/spreadsheets']
            );
            
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });
            return true;
        } catch (error) {
            Logger.error('Failed to initialize Google Sheets', error);
            return false;
        }
    }

    async findPlayer(playerId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'SalSheet!B2:P',
            });

            const rows = response.data.values || [];
            
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const discordId = row[14] || ''; // Column P
                
                if (discordId === playerId) {
                    return {
                        found: true,
                        rowIndex: i + 2, // Sheet row number (1-indexed, +1 for header)
                        playerName: row[0] || '', // Column B
                        oldSalary: row[13] || '', // Column O
                        row: row
                    };
                }
            }

            return { found: false };
        } catch (error) {
            Logger.error('Failed to find player', error);
            throw error;
        }
    }

    async updateSalary(rowIndex, newSalary) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `SalSheet!O${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[newSalary]]
                }
            });

            return true;
        } catch (error) {
            Logger.error('Failed to update salary', error);
            throw error;
        }
    }
}

const sheetsManager = new GoogleSheetsManager();

/**
 * Determines the direction of salary change and returns appropriate message
 * @param {string|number} oldSalary - The old salary value
 * @param {number} newSalary - The new salary value
 * @returns {Object} Object containing direction ('up', 'down', 'new') and formatted message
 */
function determineSalaryChange(oldSalary, newSalary) {
    // Check if this is a new salary (no previous salary)
    const isNewSalary = !oldSalary || 
                       oldSalary === '' || 
                       oldSalary.toString().toUpperCase() === 'NS' ||
                       oldSalary.toString().trim() === '';

    if (isNewSalary) {
        return {
            direction: 'new',
            type: 'New Salary',
            emoji: '📊',
            action: 'assigned'
        };
    }

    // Parse old salary to number for comparison
    const oldSalaryNum = parseFloat(oldSalary);
    const newSalaryNum = parseFloat(newSalary);

    // Handle invalid old salary (contains letters or cannot be parsed)
    if (isNaN(oldSalaryNum)) {
        return {
            direction: 'new',
            type: 'New Salary',
            emoji: '📊',
            action: 'assigned'
        };
    }

    // Compare salaries to determine direction
    if (newSalaryNum > oldSalaryNum) {
        return {
            direction: 'up',
            type: 'Salary Increase',
            emoji: '📈',
            action: 'increased'
        };
    } else if (newSalaryNum < oldSalaryNum) {
        return {
            direction: 'down',
            type: 'Salary Decrease',
            emoji: '📉',
            action: 'decreased'
        };
    } else {
        return {
            direction: 'same',
            type: 'No Change',
            emoji: '➡️',
            action: 'kept at'
        };
    }
}

/**
 * Sends announcement to salary channel with appropriate message based on direction
 * @param {Client} client - Discord client
 * @param {User} player - Discord user object
 * @param {string|number} oldSalary - Old salary value
 * @param {number} newSalary - New salary value
 * @param {Object} changeInfo - Information about the salary change
 */
async function sendSalaryAnnouncement(client, player, oldSalary, newSalary, changeInfo) {
    try {
        const salaryChannel = await client.channels.fetch(SALARY_ANNOUNCEMENT_CHANNEL_ID);
        
        let message;
        
        switch (changeInfo.direction) {
            case 'new':
                // New salary assignment - no ping
                message = `${player} you are a **${newSalary}** salary`;
                break;
                
            case 'up':
                // Salary increase - NO PING (manual adjustment)
                message = `${player} has been manually moved **up** from a **${oldSalary}** to **${newSalary}**`;
                break;
                
            case 'down':
                // Salary decrease - NO PING (manual adjustment)
                message = `${player} has been manually moved **down** from a **${oldSalary}** to **${newSalary}**`;
                break;
                
            case 'same':
                // No change - just notification
                message = `${player}'s salary remains at **${newSalary}**`;
                break;
        }

        await salaryChannel.send(message);
        Logger.info(`Sent salary announcement: ${changeInfo.type} for ${player.username}`);
    } catch (error) {
        Logger.error('Failed to send salary announcement', error);
        throw error;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('salary-adjustment')
        .setDescription('Adjust a player\'s salary (Salary Crew only)')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to adjust salary for')
                .setRequired(true))
        .addNumberOption(option =>
            option.setName('salary')
                .setDescription('The new salary amount (can include decimals like 12.5)')
                .setRequired(true)
                .setMinValue(0))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        try {
            // Check if user has Salary Crew role
            if (!interaction.member.roles.cache.has(ROLES.SALARY_CREW)) {
                return await interaction.reply({
                    content: '❌ You must be a member of Salary Crew to use this command.',
                    ephemeral: true
                });
            }

            const player = interaction.options.getUser('player');
            const newSalary = interaction.options.getNumber('salary');

            await interaction.deferReply({ ephemeral: true });

            Logger.info(`${interaction.user.username} initiated salary adjustment for ${player.username} to ${newSalary}`);

            // Find the player in the sheet
            const playerData = await sheetsManager.findPlayer(player.id);

            if (!playerData.found) {
                return await interaction.editReply({
                    content: `❌ Player ${player} not found in SalSheet. Please ensure they are registered.`
                });
            }

            const { rowIndex, playerName, oldSalary } = playerData;

            // Determine salary change direction
            const changeInfo = determineSalaryChange(oldSalary, newSalary);

            // Handle "no change" case
            if (changeInfo.direction === 'same') {
                return await interaction.editReply({
                    content: `⚠️ The new salary (${newSalary}) is the same as the current salary (${oldSalary}).\n\n` +
                             `No changes were made. If you want to lock this salary from automatic updates, it's already locked in the database.`
                });
            }

            // Update the salary in the sheet
            await sheetsManager.updateSalary(rowIndex, newSalary);
            Logger.success(`Updated salary in sheet: Row ${rowIndex} to ${newSalary}`);

            // Store in manual salary database
            const dbSuccess = await ManualSalaryDB.set(
                player.id,
                playerName || player.username,
                newSalary,
                interaction.user.id,
                interaction.user.username
            );

            if (!dbSuccess) {
                Logger.warning('Failed to store manual salary override in database - continuing anyway');
            } else {
                Logger.success('Stored manual salary override in database');
            }

            // Send announcement to salary channel
            try {
                await sendSalaryAnnouncement(interaction.client, player, oldSalary, newSalary, changeInfo);
            } catch (announcementError) {
                Logger.error('Failed to send salary announcement (non-critical)', announcementError);
                // Continue execution even if announcement fails
            }

            // Build success message
            const oldSalaryDisplay = oldSalary && oldSalary !== '' && oldSalary.toUpperCase() !== 'NS' 
                ? oldSalary 
                : 'None';

            let responseMessage = `✅ **Salary Adjustment Complete**\n\n`;
            responseMessage += `${changeInfo.emoji} **${changeInfo.type}**\n\n`;
            responseMessage += `**Player:** ${playerName || player.username}\n`;
            responseMessage += `**Old Salary:** ${oldSalaryDisplay}\n`;
            responseMessage += `**New Salary:** ${newSalary}\n\n`;
            
            if (changeInfo.direction === 'up') {
                responseMessage += `📈 Salary **increased** by **${(newSalary - parseFloat(oldSalary)).toFixed(1)}**\n\n`;
            } else if (changeInfo.direction === 'down') {
                responseMessage += `📉 Salary **decreased** by **${(parseFloat(oldSalary) - newSalary).toFixed(1)}**\n\n`;
            }
            
            responseMessage += `🔒 This salary is now **locked** and will not be automatically updated by the salary lock system.`;

            await interaction.editReply({
                content: responseMessage
            });

            Logger.success(`${interaction.user.username} successfully ${changeInfo.action} ${playerName}'s salary to ${newSalary}`);

        } catch (error) {
            Logger.error('Error in salary-adjustment command', error);
            
            const errorMessage = '❌ An error occurred while adjusting the salary. Please check the logs and try again.';
            
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorMessage });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                Logger.error('Failed to send error message to user', replyError);
            }
        }
    }
};
