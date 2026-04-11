const { SlashCommandBuilder } = require('discord.js');
const { google } = require('googleapis');
const { config } = require('../config/config');
const Logger = require('../utils/logger');
const { ROLES } = require('../constants/roles');
const fs = require('fs');
const path = require('path');

const MODERATOR_ROLE_ID = '1156814621429215239';
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('updatetracker')
        .setDescription('[Salary Crew/Moderator Only] Update a user\'s tracker URL')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to update the tracker for')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Add a new tracker or replace an existing one?')
                .setRequired(true)
                .addChoices(
                    { name: 'Add New Tracker', value: 'add' },
                    { name: 'Replace Existing Tracker', value: 'replace' }
                ))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Is this a main account or alt account?')
                .setRequired(true)
                .addChoices(
                    { name: 'Main Account', value: 'main' },
                    { name: 'Alt Account', value: 'alt' }
                ))
        .addStringOption(option =>
            option.setName('new_tracker')
                .setDescription('The new tracker URL to add/use')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('old_tracker')
                .setDescription('The old tracker URL to replace (required for replace action)')
                .setRequired(false)),

    async execute(interaction) {
        // Defer reply as NON-EPHEMERAL (public) as requested
        try {
            await interaction.deferReply({ ephemeral: false });
        } catch (deferError) {
            Logger.error('Failed to defer interaction reply', deferError);
            return;
        }

        try {
            const executor = interaction.member;
            
            // Check if user has Salary Crew or Moderator role
            const isSalaryCrew = executor.roles.cache.has(ROLES.SALARY_CREW);
            const isModerator = executor.roles.cache.has(MODERATOR_ROLE_ID);
            
            if (!isSalaryCrew && !isModerator) {
                await interaction.editReply({
                    content: '❌ **Permission Denied**\n\nYou must be a Salary Crew member or Moderator to use this command.'
                });
                return;
            }

            // Get options
            const targetUser = interaction.options.getUser('user');
            const action = interaction.options.getString('action'); // 'add' or 'replace'
            const accountType = interaction.options.getString('type'); // 'main' or 'alt'
            const newTracker = interaction.options.getString('new_tracker').trim();
            const oldTracker = interaction.options.getString('old_tracker')?.trim();

            Logger.info(`${executor.user.username} ${action} tracker for ${targetUser.username}: ${newTracker} (${accountType})`);

            // Validate that old_tracker is provided for replace action
            if (action === 'replace' && !oldTracker) {
                await interaction.editReply({
                    content: '❌ **Missing Old Tracker**\n\nFor "Replace Existing Tracker" action, you must provide the `old_tracker` option.'
                });
                return;
            }

            // Validate new tracker URL
            const newValidation = validateTrackerUrl(newTracker);
            if (!newValidation.isValid) {
                await interaction.editReply({
                    content: `❌ **Invalid New Tracker URL:**\n${newValidation.error}\n\nPlease ensure the URL is from https://rocketleague.tracker.network/`
                });
                return;
            }

            const normalizedNewTracker = normalizeTrackerUrl(newTracker);

            // Handle ADD action
            if (action === 'add') {
                await handleAddAction(interaction, targetUser, accountType, normalizedNewTracker, executor);
                return;
            }

            // Handle REPLACE action
            if (action === 'replace') {
                // Validate old tracker URL
                const oldValidation = validateTrackerUrl(oldTracker);
                if (!oldValidation.isValid) {
                    await interaction.editReply({
                        content: `❌ **Invalid Old Tracker URL:**\n${oldValidation.error}\n\nPlease ensure the URL is from https://rocketleague.tracker.network/`
                    });
                    return;
                }

                const normalizedOldTracker = normalizeTrackerUrl(oldTracker);
                await handleReplaceAction(interaction, targetUser, accountType, normalizedOldTracker, normalizedNewTracker, executor);
                return;
            }

        } catch (error) {
            Logger.error('Failed to process updatetracker command', error);
            
            try {
                await interaction.editReply({ 
                    content: '❌ An error occurred while updating the tracker. Please try again later or contact an administrator.'
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },
};

/**
 * Handle ADD action - add a new tracker to main or alt accounts
 */
async function handleAddAction(interaction, targetUser, accountType, newTracker, executor) {
    try {
        const { sheets } = await getGoogleSheetsClient();
        
        // Read data from Registrations sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Registrations!A:E',
        });
        
        const rows = response.data.values || [];
        
        if (rows.length === 0) {
            await interaction.editReply({
                content: '❌ **No Data Found**\n\nThe Registrations sheet is empty.'
            });
            return;
        }

        // Find the user in column B (index 1)
        let userRow = -1;
        let existingMainAccount = '';
        let existingAltAccounts = '';
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row[1] === targetUser.id) {
                userRow = i + 1; // Convert to 1-based index
                existingMainAccount = row[3] || ''; // Column D
                existingAltAccounts = row[4] || ''; // Column E
                break;
            }
        }

        if (userRow === -1) {
            await interaction.editReply({
                content: `❌ **User Not Found**\n\n<@${targetUser.id}> is not registered in the system.`
            });
            return;
        }

        // Handle MAIN account ADD
        if (accountType === 'main') {
            // Check if main account already exists
            if (existingMainAccount && existingMainAccount.trim().length > 0) {
                await interaction.editReply({
                    content: `❌ **Main Account Already Exists**\n\n` +
                            `<@${targetUser.id}> already has a main account:\n` +
                            `• **Existing Main:** ${existingMainAccount}\n\n` +
                            `❗ **You cannot have more than 1 main account.**\n\n` +
                            `If you want to change the main account, use the **"Replace Existing Tracker"** action instead.`
                });
                return;
            }

            // Add main account
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `Registrations!D${userRow}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[newTracker]]
                }
            });

            await interaction.editReply({
                content: `✅ **Main Account Added Successfully**\n\n` +
                        `• **User:** <@${targetUser.id}>\n` +
                        `• **Account Type:** Main Account (Column D)\n` +
                        `• **Row:** ${userRow}\n` +
                        `• **New Tracker:** ${newTracker}\n\n` +
                        `Added by: ${executor.user.username}`
            });

            Logger.success(`Main account added for ${targetUser.username} by ${executor.user.username}`);
            return;
        }

        // Handle ALT account ADD
        if (accountType === 'alt') {
            // Check if tracker already exists in alt accounts
            if (existingAltAccounts) {
                const altUrls = existingAltAccounts.split('\n').map(url => url.trim()).filter(url => url);
                
                for (const altUrl of altUrls) {
                    if (trackerUrlsMatch(altUrl, newTracker)) {
                        await interaction.editReply({
                            content: `❌ **Tracker Already Exists**\n\n` +
                                    `This tracker URL already exists in the alt accounts for <@${targetUser.id}>:\n` +
                                    `• **Existing:** ${altUrl}`
                        });
                        return;
                    }
                }
            }

            // Check if tracker matches main account
            if (existingMainAccount && trackerUrlsMatch(existingMainAccount, newTracker)) {
                await interaction.editReply({
                    content: `❌ **Tracker Already Exists**\n\n` +
                            `This tracker URL is already set as the main account for <@${targetUser.id}>.`
                });
                return;
            }

            // Add to alt accounts
            let updatedAltAccounts = existingAltAccounts.trim();
            if (updatedAltAccounts.length > 0) {
                updatedAltAccounts += '\n';
            }
            updatedAltAccounts += newTracker;

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `Registrations!E${userRow}`,
                valueInputOption: 'RAW',
                resource: {
                    values: [[updatedAltAccounts]]
                }
            });

            const altCount = updatedAltAccounts.split('\n').filter(url => url.trim()).length;

            await interaction.editReply({
                content: `✅ **Alt Account Added Successfully**\n\n` +
                        `• **User:** <@${targetUser.id}>\n` +
                        `• **Account Type:** Alt Account (Column E)\n` +
                        `• **Row:** ${userRow}\n` +
                        `• **New Tracker:** ${newTracker}\n` +
                        `• **Total Alt Accounts:** ${altCount}\n\n` +
                        `Added by: ${executor.user.username}`
            });

            Logger.success(`Alt account added for ${targetUser.username} by ${executor.user.username}`);
            return;
        }

    } catch (error) {
        Logger.error('Failed to handle add action', error);
        await interaction.editReply({
            content: `❌ **Error Adding Tracker**\n\n${error.message}`
        });
    }
}

/**
 * Handle REPLACE action - replace an existing tracker
 */
async function handleReplaceAction(interaction, targetUser, accountType, oldTracker, newTracker, executor) {
    try {
        // First, get user's current trackers to validate against duplicates
        const { sheets } = await getGoogleSheetsClient();
        
        // Read data from Registrations sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Registrations!A:E',
        });
        
        const rows = response.data.values || [];
        
        // Find the user in column B (index 1)
        let userRow = -1;
        let existingMainAccount = '';
        let existingAltAccounts = '';
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row[1] === targetUser.id) {
                userRow = i + 1; // Convert to 1-based index
                existingMainAccount = row[3] || ''; // Column D
                existingAltAccounts = row[4] || ''; // Column E
                break;
            }
        }

        if (userRow === -1) {
            await interaction.editReply({
                content: `❌ **User Not Found**\n\n<@${targetUser.id}> is not registered in the system.`
            });
            return;
        }

        // Check if new tracker already exists in main account (and it's not the one being replaced)
        if (existingMainAccount && trackerUrlsMatch(existingMainAccount, newTracker)) {
            // Only block if we're not replacing this exact tracker
            if (!trackerUrlsMatch(existingMainAccount, oldTracker) || accountType !== 'main') {
                await interaction.editReply({
                    content: `❌ **Tracker Already Exists**\n\n` +
                            `The new tracker URL already exists as the main account for <@${targetUser.id}>:\n` +
                            `• **Existing Main:** ${existingMainAccount}\n\n` +
                            `Cannot replace with a tracker that already exists.`
                });
                return;
            }
        }

        // Check if new tracker already exists in alt accounts (and it's not the one being replaced)
        if (existingAltAccounts) {
            const altUrls = existingAltAccounts.split('\n').map(url => url.trim()).filter(url => url);
            
            for (const altUrl of altUrls) {
                if (trackerUrlsMatch(altUrl, newTracker)) {
                    // Only block if we're not replacing this exact tracker
                    if (!trackerUrlsMatch(altUrl, oldTracker) || accountType !== 'alt') {
                        await interaction.editReply({
                            content: `❌ **Tracker Already Exists**\n\n` +
                                    `The new tracker URL already exists in the alt accounts for <@${targetUser.id}>:\n` +
                                    `• **Existing Alt:** ${altUrl}\n\n` +
                                    `Cannot replace with a tracker that already exists.`
                        });
                        return;
                    }
                }
            }
        }

        // Search for the tracker in the sheet
        const searchResult = await searchTrackerInSheet(targetUser.id, oldTracker, accountType);
        
        if (!searchResult.found) {
            // If not found, scan all rows to see if it exists anywhere
            const globalSearch = await searchTrackerGlobally(oldTracker);
            
            if (globalSearch.found) {
                await interaction.editReply({
                    content: `❌ **Tracker Not Found for Specified User**\n\n` +
                            `The tracker was not found for <@${targetUser.id}> in the ${accountType === 'main' ? 'Main Account' : 'Alt Accounts'} section.\n\n` +
                            `However, it was found for:\n` +
                            `• **User:** <@${globalSearch.userId}>\n` +
                            `• **Account Type:** ${globalSearch.accountType}\n` +
                            `• **Row:** ${globalSearch.row}\n\n` +
                            `Please verify the user and account type.`
                });
            } else {
                await interaction.editReply({
                    content: `❌ **Tracker Not Found**\n\n` +
                            `The old tracker URL was not found:\n` +
                            `• **User:** <@${targetUser.id}>\n` +
                            `• **Account Type:** ${accountType === 'main' ? 'Main Account' : 'Alt Account'}\n` +
                            `• **Tracker:** ${oldTracker}\n\n` +
                            `It does not exist in the Registration sheet for this user or in the specified account type section.`
                });
            }
            return;
        }

        // Update the tracker
        const updateResult = await updateTracker(
            searchResult.row, 
            searchResult.column, 
            searchResult.cellValue, 
            oldTracker, 
            newTracker
        );
        
        if (!updateResult.success) {
            await interaction.editReply({
                content: `❌ **Update Failed**\n\n${updateResult.error}`
            });
            return;
        }

        // Success message
        await interaction.editReply({
            content: `✅ **Tracker Replaced Successfully**\n\n` +
                    `• **User:** <@${targetUser.id}>\n` +
                    `• **Account Type:** ${accountType === 'main' ? 'Main Account (Column D)' : 'Alt Account (Column E)'}\n` +
                    `• **Row:** ${searchResult.row}\n` +
                    `• **Old Tracker:** ${oldTracker}\n` +
                    `• **New Tracker:** ${newTracker}\n\n` +
                    `Updated by: ${executor.user.username}`
        });

        Logger.success(`Tracker replaced for ${targetUser.username} by ${executor.user.username}`);

    } catch (error) {
        Logger.error('Failed to handle replace action', error);
        await interaction.editReply({
            content: `❌ **Error Replacing Tracker**\n\n${error.message}`
        });
    }
}

/**
 * Validates a single tracker URL
 * @param {string} url - Tracker URL to validate
 * @returns {Object} Validation result
 */
function validateTrackerUrl(url) {
    if (!url) {
        return { isValid: false, error: 'Please provide a tracker URL.' };
    }

    const urlPattern = /^https?:\/\//i;
    if (!urlPattern.test(url)) {
        return { isValid: false, error: 'URL must start with http:// or https://' };
    }

    const trackerPattern = /^https?:\/\/rocketleague\.tracker\.network\/rocket-league\/profile\/([^\/]+)\/([^\/\s]+)/i;
    const match = url.match(trackerPattern);

    if (!match) {
        return { isValid: false, error: 'Please provide a valid Rocket League tracker network URL.' };
    }

    const platform = match[1].toLowerCase();
    const username = match[2];

    const validPlatforms = ['steam', 'epic', 'psn', 'xbl', 'switch'];
    if (!validPlatforms.includes(platform)) {
        return { 
            isValid: false, 
            error: 'Invalid platform "' + platform + '". Valid platforms: steam, epic, psn (PlayStation), xbl (Xbox), switch (Nintendo Switch)' 
        };
    }

    if (!username || username.length < 2) {
        return { isValid: false, error: 'Username appears to be too short or invalid.' };
    }

    return { 
        isValid: true, 
        platform: platform,
        username: username,
        fullUrl: url
    };
}

/**
 * Normalizes tracker URL by removing query parameters and trailing segments, then adds /overview
 * Examples:
 * - https://rocketleague.tracker.network/rocket-league/profile/psn/maximb_14/overview -> base URL + /overview
 * - https://rocketleague.tracker.network/rocket-league/profile/epic/adevilzdragon/mmr?playlist=13 -> base URL + /overview
 * - https://rocketleague.tracker.network/rocket-league/profile/steam/user123 -> base URL + /overview
 * @param {string} url - Tracker URL to normalize
 * @returns {string} Normalized base URL with /overview appended
 */
function normalizeTrackerUrl(url) {
    try {
        const trackerPattern = /^(https?:\/\/rocketleague\.tracker\.network\/rocket-league\/profile\/[^\/]+\/[^\/\s?]+)/i;
        const match = url.match(trackerPattern);
        
        if (match) {
            const baseUrl = match[1];
            // Always ensure /overview is appended
            return baseUrl + '/overview';
        }
        
        return url;
    } catch (error) {
        Logger.error('Failed to normalize tracker URL', error);
        return url;
    }
}

/**
 * Compares two tracker URLs for fuzzy matching
 * @param {string} url1 - First URL
 * @param {string} url2 - Second URL
 * @returns {boolean} True if URLs match (fuzzy)
 */
function trackerUrlsMatch(url1, url2) {
    const normalized1 = normalizeTrackerUrl(url1.toLowerCase().trim());
    const normalized2 = normalizeTrackerUrl(url2.toLowerCase().trim());
    
    return normalized1 === normalized2;
}

/**
 * Initialize Google Sheets API
 * @returns {Object} Sheets API instance and auth
 */
async function getGoogleSheetsClient() {
    try {
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
        
        return { sheets, auth };
    } catch (error) {
        Logger.error('Failed to initialize Google Sheets client', error);
        throw error;
    }
}

/**
 * Search for a tracker in the sheet for a specific user and account type
 * @param {string} userId - Discord user ID
 * @param {string} trackerUrl - Normalized tracker URL to search for
 * @param {string} accountType - 'main' or 'alt'
 * @returns {Object} Search result with found flag, row, column, and cell value
 */
async function searchTrackerInSheet(userId, trackerUrl, accountType) {
    try {
        const { sheets } = await getGoogleSheetsClient();
        
        // Read data from Registrations sheet (columns A through E)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Registrations!A:E',
        });
        
        const rows = response.data.values || [];
        
        if (rows.length === 0) {
            Logger.warning('No data found in Registrations sheet');
            return { found: false };
        }

        // Column indices: A=0, B=1, C=2, D=3, E=4
        const columnIndex = accountType === 'main' ? 3 : 4; // D=3 for main, E=4 for alt
        
        // Find the user in column B (index 1)
        for (let i = 1; i < rows.length; i++) { // Start from 1 to skip header
            const row = rows[i];
            
            // Check if this is the correct user
            if (row[1] !== userId) continue;
            
            const cellValue = row[columnIndex] || '';
            
            // For alt accounts, need to handle multiple URLs separated by newlines
            if (accountType === 'alt') {
                const altUrls = cellValue.split('\n').map(url => url.trim()).filter(url => url);
                
                // Check if any alt URL matches
                for (const altUrl of altUrls) {
                    if (trackerUrlsMatch(altUrl, trackerUrl)) {
                        return {
                            found: true,
                            row: i + 1, // Convert to 1-based index
                            column: columnIndex === 3 ? 'D' : 'E',
                            cellValue: cellValue,
                            userId: row[1]
                        };
                    }
                }
            } else {
                // Main account - direct comparison
                if (trackerUrlsMatch(cellValue, trackerUrl)) {
                    return {
                        found: true,
                        row: i + 1, // Convert to 1-based index
                        column: columnIndex === 3 ? 'D' : 'E',
                        cellValue: cellValue,
                        userId: row[1]
                    };
                }
            }
        }

        // Not found for this user
        return { found: false };

    } catch (error) {
        Logger.error('Failed to search tracker in sheet', error);
        throw error;
    }
}

/**
 * Search for a tracker globally in all rows and columns D and E
 * @param {string} trackerUrl - Normalized tracker URL to search for
 * @returns {Object} Search result with found flag, userId, accountType, and row
 */
async function searchTrackerGlobally(trackerUrl) {
    try {
        const { sheets } = await getGoogleSheetsClient();
        
        // Read data from Registrations sheet (columns A through E)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Registrations!A:E',
        });
        
        const rows = response.data.values || [];
        
        if (rows.length === 0) {
            return { found: false };
        }

        // Search in all rows
        for (let i = 1; i < rows.length; i++) { // Start from 1 to skip header
            const row = rows[i];
            const userId = row[1];
            
            // Check main account (column D, index 3)
            const mainAccount = row[3] || '';
            if (mainAccount && trackerUrlsMatch(mainAccount, trackerUrl)) {
                return {
                    found: true,
                    userId: userId,
                    accountType: 'Main Account',
                    row: i + 1
                };
            }
            
            // Check alt accounts (column E, index 4)
            const altAccounts = row[4] || '';
            if (altAccounts) {
                const altUrls = altAccounts.split('\n').map(url => url.trim()).filter(url => url);
                
                for (const altUrl of altUrls) {
                    if (trackerUrlsMatch(altUrl, trackerUrl)) {
                        return {
                            found: true,
                            userId: userId,
                            accountType: 'Alt Account',
                            row: i + 1
                        };
                    }
                }
            }
        }

        return { found: false };

    } catch (error) {
        Logger.error('Failed to search tracker globally', error);
        throw error;
    }
}

/**
 * Update tracker in the sheet
 * @param {number} row - Row number (1-based)
 * @param {string} column - Column letter ('D' or 'E')
 * @param {string} cellValue - Current cell value
 * @param {string} oldTracker - Old tracker URL to replace
 * @param {string} newTracker - New tracker URL
 * @returns {Object} Update result with success flag and error message if any
 */
async function updateTracker(row, column, cellValue, oldTracker, newTracker) {
    try {
        const { sheets } = await getGoogleSheetsClient();
        
        let newCellValue;
        
        if (column === 'D') {
            // Main account - simple replacement
            newCellValue = newTracker;
        } else {
            // Alt account - need to replace specific URL while keeping others
            const altUrls = cellValue.split('\n').map(url => url.trim()).filter(url => url);
            
            // Replace the matching URL
            const updatedUrls = altUrls.map(url => {
                if (trackerUrlsMatch(url, oldTracker)) {
                    return newTracker;
                }
                return url;
            });
            
            newCellValue = updatedUrls.join('\n');
        }

        // Update the cell
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `Registrations!${column}${row}`,
            valueInputOption: 'RAW',
            resource: {
                values: [[newCellValue]]
            }
        });

        Logger.success(`Successfully updated tracker in row ${row}, column ${column}`);
        return { success: true };

    } catch (error) {
        Logger.error('Failed to update tracker', error);
        return { 
            success: false, 
            error: `Failed to update the sheet: ${error.message}` 
        };
    }
}