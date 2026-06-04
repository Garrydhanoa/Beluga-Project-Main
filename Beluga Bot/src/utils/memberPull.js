const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('./logger');
const { syncGuildToDb } = require('./memberStore');

/**
 * Performs automatic member pull from Discord server to Google Sheets with smart ID matching
 * @param {Client} client - Discord client instance
 * @param {string} confirmationChannelId - Channel ID to send confirmation messages to
 */
async function performMemberPull(client, confirmationChannelId = '1403961461776060416') {
    try {
        Logger.info('Starting automatic member pull with smart ID matching...');
        
        // Get the first available guild (server)
        const guild = client.guilds.cache.first();
        if (!guild) {
            throw new Error('No guild found');
        }

        Logger.info(`Performing member pull for guild: ${guild.name}`);

        // Get all roles from the server
        const roles = Array.from(guild.roles.cache.values())
            .filter(role => !role.managed && role.name !== '@everyone')
            .sort((a, b) => b.position - a.position);

        Logger.info(`Found ${roles.length} roles`);

        // Get all members from the server
        Logger.info('Fetching all guild members...');
        await guild.members.fetch();

        // Persist members + roles to Postgres so the website has a single source
        // of identity (display names, avatars) + an exact member count. Non-fatal.
        try {
            await syncGuildToDb(guild);
        } catch (dbErr) {
            Logger.error('Member DB sync failed (continuing with sheet pull)', dbErr);
        }

        const currentMembers = Array.from(guild.members.cache.values())
            .filter(member => !member.user.bot);
        
        // Sort members by join date (oldest to newest)
        currentMembers.sort((a, b) => {
            const dateA = a.joinedAt ? a.joinedAt.getTime() : 0;
            const dateB = b.joinedAt ? b.joinedAt.getTime() : 0;
            return dateA - dateB; // Oldest first
        });
        
        Logger.info(`Found ${currentMembers.length} current members (excluding bots), sorted oldest to newest`);

        // Get existing user mapping from Google Sheets
        const existingUserMapping = await getExistingUserMapping();
        Logger.info(`Found ${Object.keys(existingUserMapping).length} existing users in spreadsheet`);

        // Build headers maintaining existing role column positions
        const { headers, roleMapping } = await buildStableHeaders(roles);
        Logger.info(`Headers built with ${headers.length - 4} role columns (${roleMapping.newRoles.length} new roles added to end)`);
        
        // Build the updated spreadsheet data with smart matching
        const updatedRows = await buildSmartUpdatedRows(currentMembers, existingUserMapping, roles, headers, roleMapping);
        
        Logger.info(`Uploading updated data for ${updatedRows.length - 1} total rows to Google Sheets...`);
        
        // Upload to Google Sheets
        await uploadToGoogleSheets(updatedRows);
        
        // Calculate statistics
        const currentMemberIds = new Set(currentMembers.map(m => m.user.id));
        const existingMemberIds = new Set(Object.keys(existingUserMapping));
        const newMembers = currentMembers.filter(m => !existingMemberIds.has(m.user.id));
        const updatedMembers = currentMembers.filter(m => existingMemberIds.has(m.user.id));
        const preservedMembers = Object.keys(existingUserMapping).filter(id => !currentMemberIds.has(id));
        
        // Send confirmation message to specified channel
        try {
            const channel = await client.channels.fetch(confirmationChannelId);
            if (channel && channel.isTextBased()) {
                await channel.send({
                    content: `✅ **Smart Member Pull Completed**\n\n` +
                            `• **Server:** ${guild.name}\n` +
                            `• **Current Members:** ${currentMembers.length}\n` +
                            `• **Updated Existing:** ${updatedMembers.length}\n` +
                            `• **New Members Added:** ${newMembers.length}\n` +
                            `• **Preserved (Not in Server):** ${preservedMembers.length}\n` +
                            `• **Roles Tracked:** ${roles.length}\n` +
                            `• **Sorted:** Oldest to Newest (by join date)\n` +
                            `• **Time:** ${new Date().toLocaleString()}\n\n` +
                            `**Spreadsheet:** https://docs.google.com/spreadsheets/d/1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs/edit?gid=0#gid=0`
                });
                Logger.info('Confirmation message sent to channel');
            }
        } catch (channelError) {
            Logger.error('Failed to send confirmation message to channel', channelError);
        }
        
        Logger.success(`Smart member pull completed - updated ${updatedMembers.length}, added ${newMembers.length}, preserved ${preservedMembers.length}`);
        return true;
        
    } catch (error) {
        Logger.error('Failed to perform smart member pull', error);
        
        // Try to send error message to confirmation channel
        try {
            const channel = await client.channels.fetch(confirmationChannelId);
            if (channel && channel.isTextBased()) {
                await channel.send({
                    content: `❌ **Smart Member Pull Failed**\n\n` +
                            `• **Error:** ${error.message}\n` +
                            `• **Time:** ${new Date().toLocaleString()}\n\n` +
                            `Please check the bot logs for more details.`
                });
            }
        } catch (channelError) {
            Logger.error('Failed to send error message to channel', channelError);
        }
        
        throw error;
    }
}

async function uploadToGoogleSheets(rows) {
    try {
        // Get Google Sheets credentials
        let credentials;
        if (config.sheets.credentialsJson) {
            credentials = config.sheets.credentialsJson;
            Logger.info('Using Google credentials from environment variable');
        } else {
            const credentialsPath = path.join(__dirname, '../../', config.sheets.credentials);
            if (!fs.existsSync(credentialsPath)) {
                throw new Error('Google Sheets credentials not found');
            }
            credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            Logger.info('Using Google credentials from file');
        }

        const { client_email, private_key } = credentials;
        
        const auth = new google.auth.JWT(
            client_email,
            null,
            private_key.replace(/\\n/g, '\n'),
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        // Spreadsheet ID and range
        const spreadsheetId = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
        const range = 'Member Pull!A1';
        
        Logger.info(`Uploading ${rows.length} rows to Google Sheets...`);
        
        // First, get the sheet ID for "Member Pull"
        const spreadsheetInfo = await sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'sheets.properties'
        });
        
        // Find the sheet ID for "Member Pull"
        let memberPullSheet = spreadsheetInfo.data.sheets.find(
            sheet => sheet.properties.title === 'Member Pull'
        );
        
        if (!memberPullSheet) {
            Logger.warning('Member Pull sheet not found, creating it...');
            // Create the sheet if it doesn't exist
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: {
                                title: 'Member Pull'
                            }
                        }
                    }]
                }
            });
            
            // Get the new sheet ID
            const updatedSpreadsheet = await sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'sheets.properties'
            });
            
            const newSheet = updatedSpreadsheet.data.sheets.find(
                sheet => sheet.properties.title === 'Member Pull'
            );
            
            if (!newSheet) {
                throw new Error('Failed to create Member Pull sheet');
            }
            
            memberPullSheet = newSheet;
        }
        
        const sheetId = memberPullSheet.properties.sheetId;
        
        // Clear existing data first
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'Member Pull',
        });
        
        // Update with new data
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range,
            valueInputOption: 'RAW',
            resource: {
                values: rows
            },
        });
        
        // Auto-resize columns for better readability with the correct sheet ID
        try {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [{
                        autoResizeDimensions: {
                            dimensions: {
                                sheetId: sheetId,
                                dimension: 'COLUMNS',
                                startIndex: 0,
                                endIndex: rows[0].length
                            }
                        }
                    }]
                }
            });
            Logger.success('Successfully resized columns for better readability');
        } catch (resizeError) {
            // Don't fail the whole operation if resize fails
            Logger.warning('Failed to auto-resize columns: ' + resizeError.message);
        }
        
        Logger.success('Data successfully uploaded to Google Sheets');
        return true;
        
    } catch (error) {
        Logger.error('Failed to upload to Google Sheets', error);
        throw new Error(`Google Sheets upload failed: ${error.message}`);
    }
}

/**
 * Builds smart updated rows that preserve existing data and add new members
 * @param {Array} currentMembers - Current Discord server members
 * @param {Object} existingUserMapping - Mapping of user IDs to sheet rows
 * @param {Array} roles - Server roles
 * @param {Array} headers - Column headers
 * @param {Object} roleMapping - Role to column mapping with status info
 * @returns {Array} Updated rows for the spreadsheet
 */
async function buildSmartUpdatedRows(currentMembers, existingUserMapping, roles, headers, roleMapping) {
    try {
        Logger.info('Building smart updated rows with ID matching...');
        
        // Start with headers
        const updatedRows = [headers];
        
        // If no existing data, just create fresh data
        if (Object.keys(existingUserMapping).length === 0) {
            Logger.info('No existing data found, creating fresh spreadsheet');
            const memberRows = currentMembers.map(member => createMemberRow(member, roles, roleMapping));
            return [headers, ...memberRows];
        }
        
        // First, read existing data to preserve structure
        const existingData = await getExistingSheetData();
        
        // Create sets for easier lookup
        const currentMemberIds = new Set(currentMembers.map(m => m.user.id));
        const existingMemberIds = new Set(Object.keys(existingUserMapping));
        
        // Step 1: Process existing rows - update if user still in server, clear data if not (keep only User ID)
        for (let i = 1; i < existingData.length; i++) {
            const existingRow = existingData[i];
            const userId = existingRow[1]; // User ID is in column 1 (index 1)
            
            if (!userId) {
                // Skip rows without user ID
                continue;
            }
            
            if (currentMemberIds.has(userId)) {
                // User is still in server - update their data
                const member = currentMembers.find(m => m.user.id === userId);
                const updatedRow = createMemberRow(member, roles, roleMapping);
                updatedRows.push(updatedRow);
                Logger.info(`Updated existing user: ${member.user.username}`);
            } else {
                // User not in server - keep only User ID, clear everything else
                const clearedRow = createClearedRow(userId, headers.length);
                updatedRows.push(clearedRow);
                Logger.info(`Cleared data for user not in server (kept User ID): ${userId}`);
            }
        }
        
        // Step 2: Add new members (those not in existing mapping) in oldest to newest order
        const newMembers = currentMembers.filter(member => !existingMemberIds.has(member.user.id));
        
        if (newMembers.length > 0) {
            Logger.info(`Adding ${newMembers.length} new members to spreadsheet`);
            for (const member of newMembers) {
                const newRow = createMemberRow(member, roles, roleMapping);
                updatedRows.push(newRow);
                Logger.info(`Added new user: ${member.user.username}`);
            }
        }
        
        Logger.info(`Built ${updatedRows.length - 1} data rows (excluding header)`);
        return updatedRows;
        
    } catch (error) {
        Logger.error('Failed to build smart updated rows', error);
        // Fallback to simple member list if smart update fails
        const memberRows = currentMembers.map(member => createMemberRow(member, roles, roleMapping));
        return [headers, ...memberRows];
    }
}

/**
 * Creates a spreadsheet row for a Discord member
 * @param {GuildMember} member - Discord guild member
 * @param {Array} roles - Server roles
 * @param {Object} roleMapping - Role to column mapping with status info
 * @returns {Array} Member data row
 */
function createMemberRow(member, roles, roleMapping) {
    const joinDate = member.joinedAt ? member.joinedAt.toISOString().split('T')[0] : 'Unknown';
    const baseInfo = [
        member.user.username,
        member.user.id,
        member.displayName,
        joinDate
    ];
    
    // Create array for role data based on roleMapping
    const totalRoleColumns = roleMapping.orderedRoles.length;
    const roleData = new Array(totalRoleColumns).fill('❌');
    
    // Fill in roles based on their fixed column positions
    roleMapping.orderedRoles.forEach((roleName, index) => {
        if (roleName.startsWith('Removed - ')) {
            // Removed role - keep as ❌
            roleData[index] = '❌';
        } else {
            // Active role - check if member has it
            const role = roles.find(r => r.name === roleName);
            if (role && member.roles.cache.has(role.id)) {
                roleData[index] = role.name;
            }
        }
    });
    
    return [...baseInfo, ...roleData];
}

/**
 * Creates a cleared spreadsheet row that keeps only the User ID
 * @param {string} userId - Discord user ID to preserve
 * @param {number} totalColumns - Total number of columns in the spreadsheet
 * @returns {Array} Cleared row with only User ID populated
 */
function createClearedRow(userId, totalColumns) {
    // Create an array filled with empty strings
    const clearedRow = new Array(totalColumns).fill('');
    
    // Set only the User ID (index 1, since: Username=0, User ID=1, Display Name=2, Join Date=3, then roles...)
    clearedRow[1] = userId;
    
    return clearedRow;
}

/**
 * Gets the complete existing sheet data for processing
 * @returns {Array} Existing sheet data including headers
 */
async function getExistingSheetData() {
    try {
        // Get Google Sheets credentials
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
        const spreadsheetId = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
        
        // Read existing data from Member Pull sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Member Pull',
        });
        
        return response.data.values || [];
        
    } catch (error) {
        Logger.error('Failed to get existing sheet data', error);
        return [];
    }
}

/**
 * Builds stable headers that maintain existing role column positions
 * Adds new roles to the end, marks removed roles as "Removed"
 * @param {Array} currentRoles - Current Discord server roles
 * @returns {Object} Object with headers array and roleMapping info
 */
async function buildStableHeaders(currentRoles) {
    try {
        Logger.info('Building stable headers from existing sheet structure...');
        
        const existingData = await getExistingSheetData();
        
        // Base columns that always exist
        const baseColumns = ['Username', 'User ID', 'Display Name', 'Join Date'];
        
        // If no existing data, create fresh headers
        if (existingData.length === 0) {
            Logger.info('No existing data - creating fresh headers');
            const roleNames = currentRoles.map(role => role.name);
            return {
                headers: [...baseColumns, ...roleNames],
                roleMapping: {
                    orderedRoles: roleNames,
                    removedRoles: [],
                    newRoles: roleNames,
                    roleToColumn: Object.fromEntries(roleNames.map((name, idx) => [name, idx + 4]))
                }
            };
        }
        
        // Get existing role columns (everything after the base columns)
        const existingHeaders = existingData[0] || [];
        const existingRoleColumns = existingHeaders.slice(4); // Skip base columns
        
        Logger.info(`Found ${existingRoleColumns.length} existing role columns in sheet`);
        
        // Create set of current role names for quick lookup
        const currentRoleNames = new Set(currentRoles.map(role => role.name));
        
        // Build ordered roles maintaining existing positions
        const orderedRoles = [];
        const removedRoles = [];
        const roleToColumn = {};
        
        // Process existing role columns
        existingRoleColumns.forEach((existingRoleName) => {
            // Skip if already marked as removed
            if (existingRoleName.startsWith('Removed - ')) {
                orderedRoles.push(existingRoleName);
                return;
            }
            
            // Check if this role still exists in the server
            if (currentRoleNames.has(existingRoleName)) {
                // Role still exists - keep it in same position
                orderedRoles.push(existingRoleName);
                roleToColumn[existingRoleName] = orderedRoles.length - 1 + 4; // +4 for base columns
            } else {
                // Role was removed - mark it
                const removedLabel = `Removed - ${existingRoleName}`;
                orderedRoles.push(removedLabel);
                removedRoles.push(existingRoleName);
                Logger.info(`Marking role as removed: ${existingRoleName}`);
            }
        });
        
        // Find new roles that weren't in the sheet
        const existingRoleSet = new Set(existingRoleColumns.filter(name => !name.startsWith('Removed - ')));
        const newRoles = currentRoles
            .map(role => role.name)
            .filter(name => !existingRoleSet.has(name));
        
        // Add new roles to the end
        if (newRoles.length > 0) {
            Logger.info(`Adding ${newRoles.length} new roles to end: ${newRoles.join(', ')}`);
            newRoles.forEach(roleName => {
                orderedRoles.push(roleName);
                roleToColumn[roleName] = orderedRoles.length - 1 + 4; // +4 for base columns
            });
        }
        
        const headers = [...baseColumns, ...orderedRoles];
        
        Logger.info(`Built stable headers with ${orderedRoles.length} role columns (${removedRoles.length} removed, ${newRoles.length} new)`);
        
        return {
            headers,
            roleMapping: {
                orderedRoles,
                removedRoles,
                newRoles,
                roleToColumn
            }
        };
        
    } catch (error) {
        Logger.error('Failed to build stable headers', error);
        // Fallback to simple headers
        const baseColumns = ['Username', 'User ID', 'Display Name', 'Join Date'];
        const roleNames = currentRoles.map(role => role.name);
        return {
            headers: [...baseColumns, ...roleNames],
            roleMapping: {
                orderedRoles: roleNames,
                removedRoles: [],
                newRoles: roleNames,
                roleToColumn: Object.fromEntries(roleNames.map((name, idx) => [name, idx + 4]))
            }
        };
    }
}

/**
 * Reads existing data from Google Sheets to create a mapping of user IDs to row positions
 * @returns {Object} Object with userIds as keys and row indices as values
 */
async function getExistingUserMapping() {
    try {
        Logger.info('Reading existing data from Google Sheets...');
        
        // Get Google Sheets credentials
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
        const spreadsheetId = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
        
        // Read existing data from Member Pull sheet
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: 'Member Pull',
        });
        
        const rows = response.data.values || [];
        const userMapping = {};
        
        if (rows.length === 0) {
            Logger.info('No existing data found in Member Pull sheet');
            return userMapping;
        }
        
        // Find User ID column (should be index 1 based on current structure)
        const headers = rows[0];
        const userIdColumnIndex = headers.indexOf('User ID');
        
        if (userIdColumnIndex === -1) {
            Logger.warning('User ID column not found in existing data');
            return userMapping;
        }
        
        Logger.info(`Found User ID column at index ${userIdColumnIndex}`);
        
        // Create mapping of user IDs to row indices (excluding header row)
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row[userIdColumnIndex]) {
                userMapping[row[userIdColumnIndex]] = i; // Store 1-based row index (excluding header)
            }
        }
        
        Logger.info(`Found ${Object.keys(userMapping).length} existing users in spreadsheet`);
        return userMapping;
        
    } catch (error) {
        Logger.error('Failed to read existing user mapping from Google Sheets', error);
        return {}; // Return empty mapping on error - will default to full rewrite
    }
}

module.exports = {
    performMemberPull,
    getExistingUserMapping,
    buildSmartUpdatedRows,
    buildStableHeaders,
    createMemberRow,
    createClearedRow,
    getExistingSheetData
};