const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ManualSalaryDB, SalaryLockNotificationDB } = require('../utils/database');
const { ROLES } = require('../constants/roles');

// Command-specific channel IDs
const SALARY_ANNOUNCEMENT_CHANNEL_ID = '1430752024630268024';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('update-sal')
        .setDescription('Remove manual salary lock and sync O column with N column (Salary Crew only)')
        .addUserOption(option =>
            option.setName('player')
                .setDescription('The player to update salary for')
                .setRequired(true))
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

            await interaction.deferReply({ ephemeral: true });

            // Check if player has manual override
            const manualOverride = await ManualSalaryDB.get(player.id);
            if (!manualOverride) {
                return await interaction.editReply({
                    content: `❌ ${player} does not have a manual salary override set.`
                });
            }

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
                ['https://www.googleapis.com/auth/spreadsheets']
            );
            const sheets = google.sheets({ version: 'v4', auth });

            // Find the player in SalSheet
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'SalSheet!B2:P',
            });

            const rows = response.data.values || [];
            let playerRow = null;
            let rowIndex = -1;
            let currentNValue = '';
            let currentOValue = '';
            let playerName = '';

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const discordId = row[14] || ''; // Column P
                if (discordId === player.id) {
                    playerRow = row;
                    rowIndex = i + 2; // Sheet row number
                    currentNValue = row[12] || ''; // Column N
                    currentOValue = row[13] || ''; // Column O
                    playerName = row[0] || ''; // Column B
                    break;
                }
            }

            if (!playerRow) {
                return await interaction.editReply({
                    content: `❌ Player ${player} not found in SalSheet.`
                });
            }

            // Update column O to match column N
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `SalSheet!O${rowIndex}`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[currentNValue]]
                }
            });

            // Remove from manual salary database
            const deleted = await ManualSalaryDB.delete(player.id);

            if (!deleted) {
                Logger.error('Failed to remove manual salary override from database');
            }

            // Clear any notification records for this player
            await SalaryLockNotificationDB.delete(player.id);
            Logger.info(`Cleared salary lock notification record for ${playerName}`);

            // Send announcement to salary channel (NO PING - synced back)
            try {
                const salaryChannel = await interaction.client.channels.fetch(SALARY_ANNOUNCEMENT_CHANNEL_ID);
                
                // Determine message based on salary change
                let message;
                const oldSalaryNum = parseFloat(currentOValue);
                const newSalaryNum = parseFloat(currentNValue);
                
                if (isNaN(oldSalaryNum) || isNaN(newSalaryNum)) {
                    // If one is not a number, just announce the sync
                    message = `${player}'s salary has been synced back to automatic updates: **${currentNValue}**`;
                } else if (newSalaryNum > oldSalaryNum) {
                    // Synced up
                    message = `${player} has been synced back from **${currentOValue}** to **${currentNValue}** (automatic updates resumed)`;
                } else if (newSalaryNum < oldSalaryNum) {
                    // Synced down
                    message = `${player} has been synced back from **${currentOValue}** to **${currentNValue}** (automatic updates resumed)`;
                } else {
                    // Same value
                    message = `${player}'s salary lock removed at **${currentNValue}** (automatic updates resumed)`;
                }

                await salaryChannel.send(message);
                Logger.info(`Sent salary sync announcement for ${playerName}`);
            } catch (channelError) {
                Logger.error('Failed to send salary sync announcement (non-critical)', channelError);
                // Continue execution even if announcement fails
            }

            await interaction.editReply({
                content: `✅ Successfully removed manual salary lock for ${player}.\n\n` +
                         `Previous O (locked): ${currentOValue}\n` +
                         `Current N: ${currentNValue}\n` +
                         `New O (synced): ${currentNValue}\n\n` +
                         `The salary lock system will now automatically update this player's salary as needed.`
            });

            Logger.info(`${interaction.user.username} removed manual salary lock for ${playerName} and synced O with N`);

        } catch (error) {
            Logger.error('Error in update-sal command', error);
            
            const errorMessage = '❌ An error occurred while updating the salary. Please try again.';
            
            if (interaction.deferred) {
                await interaction.editReply({ content: errorMessage });
            } else {
                await interaction.reply({ content: errorMessage, ephemeral: true });
            }
        }
    }
};
