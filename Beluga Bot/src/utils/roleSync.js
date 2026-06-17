const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { config } = require('../config/config');
const Logger = require('./logger');
const { ManualSalaryDB, SalaryLockNotificationDB, isDatabaseAvailable } = require('./database');
const { updateAllRosters } = require('./rosterManager');
const { ROLES, TEAM_ROLES, NP_ROLES } = require('../constants/roles');

// Channel IDs (roleSync-specific)
const TRANSACTION_CHANNEL_ID = '1156814622322602104';
const INRESERVE_RELEASE_CHANNEL_ID = '1263723227872755732';
const SALARY_ANNOUNCEMENT_CHANNEL_ID = '1430752024630268024';
const ROSTER_ALERT_CHANNEL_ID = '1299015210702737429'; // Salary Crew alerts for locked players
const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

class RoleSyncManager {
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
            Logger.error('Failed to initialize Google Sheets for role sync', error);
            return false;
        }
    }

    async checkControlPanel() {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'CONTROL PANEL!B5';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });

            const value = response.data.values?.[0]?.[0];
            const isOn = value && value.toString().toUpperCase() === 'ON';
            
            Logger.info(`Control Panel B5 status: ${value || 'EMPTY'} - Sync ${isOn ? 'ENABLED' : 'DISABLED'}`);
            return isOn;
        } catch (error) {
            Logger.error('Failed to check control panel', error);
            return false;
        }
    }

    async checkSalaryLockControl() {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'CONTROL PANEL!B2';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });

            const value = response.data.values?.[0]?.[0];
            const isOn = value && value.toString().toUpperCase() === 'ON';
            
            Logger.info(`Control Panel B2 (Salary Lock) status: ${value || 'EMPTY'} - ${isOn ? 'ENABLED' : 'DISABLED'}`);
            return isOn;
        } catch (error) {
            Logger.error('Failed to check salary lock control panel', error);
            return false;
        }
    }

    async updateOColumnWithLogAndDiscord(client) {
        try {
            Logger.info('===== Starting Salary Lock Update =====');

            // Check if database is available first
            if (!isDatabaseAvailable()) {
                Logger.warning('Database not available - skipping salary lock update (requires manual salary override data from database)');
                Logger.info('Salary Lock system requires database to verify which players have locked salaries');
                return;
            }

            // Check if salary lock system is enabled
            const isEnabled = await this.checkSalaryLockControl();
            if (!isEnabled) {
                Logger.info('Salary Lock system is disabled in Control Panel B2');
                return;
            }

            if (!this.sheets) {
                await this.initialize();
            }

            // Get all manual salary overrides
            const manualOverrides = await ManualSalaryDB.getAll();
            const manualOverrideMap = new Map();
            manualOverrides.forEach(override => {
                manualOverrideMap.set(override.discord_id, parseFloat(override.salary));
            });

            Logger.info(`Loaded ${manualOverrides.length} manual salary overrides`);

            // Get SalSheet data (columns B, N, O, P)
            const salSheetRange = 'SalSheet!B2:P';
            const salResponse = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: salSheetRange,
            });

            const salRows = salResponse.data.values || [];
            if (salRows.length === 0) {
                Logger.info('No data found in SalSheet');
                return;
            }

            const updates = [];
            const colorUpdates = [];
            const logsToCreate = [];
            const lockedPlayerNotifications = []; // Track locked players eligible for increases

            for (let i = 0; i < salRows.length; i++) {
                const row = salRows[i];
                const nameVal = row[0] || ''; // Column B
                const nVal = row[12] || ''; // Column N (index 12 in B:P range)
                const oVal = row[13] || ''; // Column O (index 13 in B:P range)
                const discordId = row[14] || ''; // Column P (index 14 in B:P range)

                // Skip empty rows
                if (nameVal === '' && oVal === '' && nVal === '') continue;

                // Check if this user has a manual override (locked)
                if (discordId && manualOverrideMap.has(discordId)) {
                    const manualSalary = manualOverrideMap.get(discordId);
                    Logger.info(`Skipping ${nameVal} - has manual salary override: ${manualSalary}`);
                    
                    // Check if they're eligible for an increase (N column is 1 or more higher than locked O)
                    if (!isNaN(parseFloat(nVal)) && !isNaN(parseFloat(oVal))) {
                        const nNum = parseFloat(nVal);
                        const oNum = parseFloat(oVal);
                        
                        // If N is at least 1 higher than locked O, calculate expected salary
                        // using the SAME logic as the salary lock system (Case 4)
                        if (nNum >= oNum + 1) {
                            let expectedSalary = oNum;
                            
                            // Increment by 1 until we can't anymore (same as Case 4 logic)
                            while ((nNum - expectedSalary) >= 1) {
                                expectedSalary += 1;
                            }
                            
                            // Check if we should send notification (not sent before for this expected salary)
                            const shouldNotify = await SalaryLockNotificationDB.shouldNotify(discordId, expectedSalary);
                            
                            if (shouldNotify) {
                                lockedPlayerNotifications.push({
                                    discordId: discordId,
                                    username: nameVal,
                                    lockedSalary: oNum,
                                    expectedSalary: expectedSalary
                                });
                            }
                        }
                    }
                    
                    continue;
                }

                const oHasLetters = /[a-zA-Z]/.test(oVal);
                const rowIndex = i + 2; // Row number in sheet (starting from 2)
                let newOValue = oVal;
                let backgroundColor = null;
                let shouldLog = false;

                // Case 1: O empty but N has value
                if ((oVal === '' || oVal === null) && nVal !== '') {
                    newOValue = nVal;
                    backgroundColor = { red: 0.99, green: 0.90, blue: 0.80 }; // #fce5cd
                    shouldLog = true;
                }
                // Case 2: N has letters but O doesn't
                else if (/[a-zA-Z]/.test(nVal) && !oHasLetters) {
                    newOValue = nVal;
                    backgroundColor = { red: 0.99, green: 0.90, blue: 0.80 }; // #fce5cd
                    shouldLog = true;
                }
                // Case 3: O has letters but N has numbers (NEW - RED HIGHLIGHT)
                else if (oHasLetters && !isNaN(parseFloat(nVal)) && nVal !== '') {
                    newOValue = nVal;
                    backgroundColor = { red: 1.0, green: 0.0, blue: 0.0 }; // RED
                    shouldLog = true;
                }
                // Case 4: Both numeric
                else if (!isNaN(parseFloat(oVal)) && !isNaN(parseFloat(nVal))) {
                    const oNum = parseFloat(oVal);
                    const nNum = parseFloat(nVal);
                    let currentO = oNum;
                    let incremented = false;

                    while ((nNum - currentO) >= 1) {
                        currentO += 1;
                        incremented = true;
                    }

                    if (incremented) {
                        newOValue = currentO;
                        backgroundColor = { red: 1.0, green: 0.0, blue: 0.0 }; // RED
                        shouldLog = true;
                    }
                }

                // If there's a change, add to updates
                if (shouldLog && newOValue !== oVal) {
                    // Ensure we're storing numbers without apostrophes
                    const cleanValue = String(newOValue).replace(/^'/, '');
                    
                    updates.push({
                        range: `SalSheet!O${rowIndex}`,
                        values: [[cleanValue]]
                    });

                    if (backgroundColor) {
                        colorUpdates.push({
                            rowIndex: rowIndex,
                            color: backgroundColor
                        });
                    }

                    logsToCreate.push({
                        name: nameVal,
                        oldValue: oVal,
                        newValue: cleanValue,
                        discordId: discordId
                    });
                }
            }

            // Apply value updates with USER_ENTERED to ensure proper number formatting
            if (updates.length > 0) {
                await this.sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        valueInputOption: 'USER_ENTERED', // Changed from RAW to USER_ENTERED for proper number formatting
                        data: updates
                    }
                });
                Logger.success(`Updated ${updates.length} salary values in column O`);
            }

            // Apply color updates
            if (colorUpdates.length > 0) {
                const salSheetId = await this.getSheetId('SalSheet');
                const requests = colorUpdates.map(update => ({
                    repeatCell: {
                        range: {
                            sheetId: salSheetId,
                            startRowIndex: update.rowIndex - 1,
                            endRowIndex: update.rowIndex,
                            startColumnIndex: 14, // Column O
                            endColumnIndex: 15
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: update.color
                            }
                        },
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                }));

                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: { requests }
                });
                Logger.success(`Applied ${colorUpdates.length} color updates`);
            }

            // Create log entries and send Discord notifications
            for (const log of logsToCreate) {
                await this.logAndNotify(log.name, log.oldValue, log.newValue, log.discordId, client);
            }

            // Send notifications for locked players eligible for increases
            if (lockedPlayerNotifications.length > 0) {
                try {
                    const rosterAlertChannel = await client.channels.fetch(ROSTER_ALERT_CHANNEL_ID);
                    
                    for (const notification of lockedPlayerNotifications) {
                        const playerMention = notification.discordId ? `<@${notification.discordId}>` : notification.username;
                        
                        const message = `⚠️ **Salary Lock Alert**\n\n` +
                            `${playerMention} is supposed to be a **${notification.expectedSalary}** salary but they are locked in the database at **${notification.lockedSalary}**.\n\n` +
                            `Use \`/update-sal\` to sync them back to their current automatic salary.`;
                        
                        await rosterAlertChannel.send(message);
                        
                        // Record that we sent this notification
                        await SalaryLockNotificationDB.record(
                            notification.discordId,
                            notification.username,
                            notification.lockedSalary,
                            notification.expectedSalary
                        );
                        
                        Logger.info(`Sent salary lock notification for ${notification.username} (locked at ${notification.lockedSalary}, should be ${notification.expectedSalary})`);
                    }
                    
                    Logger.success(`Sent ${lockedPlayerNotifications.length} salary lock notifications`);
                } catch (notifyError) {
                    Logger.error('Failed to send locked player notifications', notifyError);
                }
            }

            // Process log sheet for checked boxes
            await this.processLogSheet();

            Logger.success('===== Salary Lock Update Complete =====');

        } catch (error) {
            Logger.error('Failed to update salary lock system', error);
        }
    }

    async logAndNotify(name, oldVal, newVal, discordId, client) {
        try {
            const now = new Date();
            const estTime = now.toLocaleTimeString('en-US', { 
                timeZone: 'America/New_York',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            const estDate = now.toLocaleDateString('en-US', { 
                timeZone: 'America/New_York',
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
            const logMessage = `${name} SAL was changed to ${newVal}`;

            // Append log row to SAL Lock LOG sheet
            const logRow = [name, estDate, estTime, logMessage, '', ''];
            const appendResponse = await this.sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'SAL Lock LOG!A:F',
                valueInputOption: 'RAW',
                resource: {
                    values: [logRow]
                }
            });

            // Get the row number where data was appended
            const updatedRange = appendResponse.data.updates.updatedRange; // e.g. "SAL Lock LOG!A5:F5"
            const rowMatch = updatedRange.match(/!A(\d+)/);
            const rowNumber = rowMatch ? parseInt(rowMatch[1]) : null;
            
            if (!rowNumber) {
                Logger.error('Failed to parse appended row number from response');
                return;
            }

            // Insert checkbox in column E of the appended row
            await this.sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: [{
                        setDataValidation: {
                            range: {
                                sheetId: await this.getSheetId('SAL Lock LOG'),
                                startRowIndex: rowNumber - 1, // Convert to 0-indexed
                                endRowIndex: rowNumber, // Exclusive end
                                startColumnIndex: 4, // Column E
                                endColumnIndex: 5
                            },
                            rule: {
                                condition: {
                                    type: 'BOOLEAN'
                                },
                                showCustomUi: true
                            }
                        }
                    }]
                }
            });

            // Send Discord notification to salary announcement channel
            try {
                const salaryChannel = await client.channels.fetch(SALARY_ANNOUNCEMENT_CHANNEL_ID);
                
                // Create clickable player mention if Discord ID is available
                const playerMention = discordId && discordId.trim() !== '' ? `<@${discordId}>` : name;
                
                // Check if NS or empty old salary
                const isNewSalary = !oldVal || oldVal === '' || oldVal.toUpperCase() === 'NS';
                
                let message;
                if (isNewSalary) {
                    // New salary assignment
                    message = `${playerMention} you are a **${newVal}** salary`;
                } else {
                    // Salary increase
                    message = `<@&${ROLES.SALARY_CREW}>\n${playerMention} is being moved up from a **${oldVal}** to **${newVal}**`;
                }

                await salaryChannel.send(message);

                Logger.info(`Sent salary announcement for ${name}`);
            } catch (discordError) {
                Logger.error('Failed to send Discord notification', discordError);
            }

            Logger.info(`Logged and notified: ${logMessage}`);

        } catch (error) {
            Logger.error(`Failed to log and notify for ${name}`, error);
        }
    }

    async processLogSheet() {
        try {
            // Get log sheet data
            const logResponse = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'SAL Lock LOG!A2:F',
            });

            const logRows = logResponse.data.values || [];
            if (logRows.length === 0) return;

            const salResponse = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'SalSheet!B2:B',
            });
            const salNames = salResponse.data.values || [];

            const colorUpdates = [];
            const logUpdates = [];
            const salSheetId = await this.getSheetId('SalSheet');

            for (let i = 0; i < logRows.length; i++) {
                const row = logRows[i];
                const name = row[0] || '';
                const checked = row[4] === true || row[4] === 'TRUE';
                const doneText = row[5] || '';

                if (checked && doneText === '') {
                    // Remove numbers in parentheses from nickname
                    const cleanName = name.replace(/\s*\([^)]*\)/g, '').trim();

                    // Find row in SalSheet
                    for (let j = 0; j < salNames.length; j++) {
                        const salName = (salNames[j][0] || '').replace(/\s*\([^)]*\)/g, '').trim();
                        if (salName === cleanName) {
                            // Reset column O color to default
                            colorUpdates.push({
                                range: {
                                    sheetId: salSheetId, // SalSheet
                                    startRowIndex: j + 1,
                                    endRowIndex: j + 2,
                                    startColumnIndex: 14, // Column O
                                    endColumnIndex: 15
                                },
                                color: { red: 0.99, green: 0.90, blue: 0.80 } // #fce5cd
                            });
                            break;
                        }
                    }

                    // Remove checkbox and mark as DONE
                    logUpdates.push({
                        range: `SAL Lock LOG!E${i + 2}`,
                        values: [['']]
                    });
                    logUpdates.push({
                        range: `SAL Lock LOG!F${i + 2}`,
                        values: [['DONE by automation']]
                    });
                }
            }

            // Apply color updates
            if (colorUpdates.length > 0) {
                const requests = colorUpdates.map(update => ({
                    repeatCell: {
                        range: update.range,
                        cell: {
                            userEnteredFormat: {
                                backgroundColor: update.color
                            }
                        },
                        fields: 'userEnteredFormat.backgroundColor'
                    }
                }));

                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: { requests }
                });
                Logger.success(`Reset ${colorUpdates.length} salary cell colors after acknowledgment`);
            }

            // Apply log updates
            if (logUpdates.length > 0) {
                await this.sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        valueInputOption: 'RAW',
                        data: logUpdates
                    }
                });
                Logger.success(`Marked ${logUpdates.length / 2} log entries as DONE`);
            }

        } catch (error) {
            Logger.error('Failed to process log sheet', error);
        }
    }

    async getSheetId(sheetName) {
        try {
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: SPREADSHEET_ID
            });

            const sheet = response.data.sheets?.find(s => s.properties?.title === sheetName);
            return sheet?.properties?.sheetId || 0;
        } catch (error) {
            Logger.error(`Failed to get sheet ID for ${sheetName}`, error);
            return 0;
        }
    }

    async getAllPlayerData() {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'SalSheet!A:W';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range,
            });

            const rows = response.data.values || [];
            const players = [];

            // Skip header row (index 0)
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                
                // Column P (index 15) is Discord ID
                const discordId = row[15] ? String(row[15]).trim() : null;
                if (!discordId) continue;

                const playerData = {
                    rowIndex: i + 1,
                    discordId: discordId,
                    username: row[1] || '', // Column B
                    salary: row[14] || '', // Column O
                    freeAgent: row[8] || '', // Column I
                    eligible: row[9] || '', // Column J
                    inReserve: row[10] || '', // Column K
                    suspended: row[11] || '', // Column L
                    division: row[17] ? row[17].toUpperCase() : '', // Column R
                    rfa: row[20] || '', // Column U
                    rfaExpiry: row[21] || '', // Column V
                    irExpiry: row[22] || '' // Column W
                };

                players.push(playerData);
            }

            Logger.info(`Loaded ${players.length} players from SalSheet`);
            return players;
        } catch (error) {
            Logger.error('Failed to get player data', error);
            return [];
        }
    }

    async updatePlayerStatus(rowIndex, updates) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const batchUpdates = [];

            if (updates.freeAgent !== undefined) {
                batchUpdates.push({
                    range: `SalSheet!I${rowIndex}`,
                    values: [[updates.freeAgent]]
                });
            }

            if (updates.inReserve !== undefined) {
                batchUpdates.push({
                    range: `SalSheet!K${rowIndex}`,
                    values: [[updates.inReserve]]
                });
            }

            if (updates.rfa !== undefined) {
                batchUpdates.push({
                    range: `SalSheet!U${rowIndex}`,
                    values: [[updates.rfa]]
                });
            }

            if (updates.rfaExpiry !== undefined) {
                batchUpdates.push({
                    range: `SalSheet!V${rowIndex}`,
                    values: [[updates.rfaExpiry]]
                });
            }

            if (updates.irExpiry !== undefined) {
                batchUpdates.push({
                    range: `SalSheet!W${rowIndex}`,
                    values: [[updates.irExpiry]]
                });
            }

            if (batchUpdates.length > 0) {
                await this.sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        valueInputOption: 'RAW',
                        data: batchUpdates
                    }
                });
            }

            return true;
        } catch (error) {
            Logger.error(`Failed to update player status for row ${rowIndex}`, error);
            return false;
        }
    }
}

const roleSyncManager = new RoleSyncManager();

async function performRoleSync(client) {
    try {
        // ===== STEP 1: Salary Lock Update (runs first) =====
        await roleSyncManager.updateOColumnWithLogAndDiscord(client);

        // ===== STEP 2: Role Sync (runs after salary lock) =====
        Logger.info('===== Starting Role Sync =====');

        // Check control panel
        const isEnabled = await roleSyncManager.checkControlPanel();
        if (!isEnabled) {
            Logger.info('Role sync is disabled in Control Panel');
            return;
        }

        // Get guild
        const guild = client.guilds.cache.first();
        if (!guild) {
            Logger.error('No guild found for role sync');
            return;
        }

        // Use cached members from memberPull (which runs before roleSync)
        // memberPull already fetches all members, so we can reuse that data
        Logger.info(`Using cached guild members from memberPull (${guild.members.cache.size} members available)`);
        
        // If cache is suspiciously small, try one fetch attempt
        if (guild.members.cache.size < 50) {
            Logger.warning(`Member cache seems small (${guild.members.cache.size}), attempting single fetch...`);
            try {
                await guild.members.fetch({ 
                    force: true,
                    time: 120000
                });
                Logger.info(`Fetch successful, now have ${guild.members.cache.size} members`);
            } catch (fetchError) {
                Logger.warning(`Fetch failed: ${fetchError.message}. Continuing with ${guild.members.cache.size} cached members`);
            }
        }

        // Get all player data from sheet
        const players = await roleSyncManager.getAllPlayerData();
        if (players.length === 0) {
            Logger.warning('No players found in sheet');
            return;
        }

        // Set of all Discord IDs present in the sal sheet (used by the verification gate)
        const sheetIdSet = new Set(players.map(p => p.discordId));

        // ===== Verification gate (runs over ALL guild members) =====
        // - Unverified takes priority: any member with the Unverified role has the
        //   bot-controlled auto roles stripped and is skipped for the rest of sync.
        // - Both Unverified + Verified  -> remove Verified (Unverified wins), strip, skip.
        // - Neither role                -> add Unverified, strip, skip.
        // - Verified only               -> allowed through to normal sync; if they
        //                                   aren't in the sheet, give them Need Rank.
        // Team / Captain / GM / NP roles are never touched here (transaction roles).
        const blockedIds = new Set();
        let strippedCount = 0;
        let needRankNotInSheet = 0;

        for (const member of guild.members.cache.values()) {
            try {
                if (member.user.bot) continue;

                const hasUnverified = member.roles.cache.has(ROLES.UNVERIFIED);
                const hasVerified = member.roles.cache.has(ROLES.VERIFIED);

                // Verified-only members are the only ones allowed through to normal sync.
                if (hasVerified && !hasUnverified) {
                    if (!sheetIdSet.has(member.id) && !member.roles.cache.has(ROLES.NEED_RANK)) {
                        await member.roles.add(ROLES.NEED_RANK);
                        Logger.info(`Added Need Rank role to ${member.user.username} (verified, not in sheet)`);
                        needRankNotInSheet++;
                    }
                    continue;
                }

                // Everyone else is blocked from normal sync this run.
                blockedIds.add(member.id);

                // Both roles present -> Unverified wins, strip the Verified role.
                if (hasUnverified && hasVerified) {
                    await member.roles.remove(ROLES.VERIFIED);
                    Logger.info(`Removed Verified role from ${member.user.username} (had both; Unverified takes priority)`);
                }

                // Neither verification role present -> mark them Unverified.
                if (!hasUnverified && !hasVerified) {
                    await member.roles.add(ROLES.UNVERIFIED);
                    Logger.info(`Added Unverified role to ${member.user.username} (had neither verification role)`);
                }

                // Strip the bot-controlled auto roles (keeps team/captain/GM/NP roles).
                const removed = await stripBotAutoRoles(member);
                if (removed.length > 0) {
                    strippedCount++;
                    Logger.info(`Stripped bot auto roles from ${member.user.username}: ${removed.join(', ')}`);
                }
            } catch (gateError) {
                Logger.error(`Verification gate error for ${member.id}:`, gateError);
            }
        }

        Logger.info(`Verification gate: ${blockedIds.size} member(s) blocked/stripped, ${needRankNotInSheet} verified member(s) not in sheet given Need Rank`);

        const today = new Date();
        const todayString = today.toLocaleDateString('en-US', { timeZone: 'America/New_York' }); // MM/DD/YYYY format in EST

        let syncedCount = 0;
        let errorCount = 0;
        let skippedCount = 0;

        for (const playerData of players) {
            try {
                // Check if member exists in server
                const member = guild.members.cache.get(playerData.discordId);
                if (!member) {
                    skippedCount++;
                    continue; // User not in server, skip
                }

                // Skip members blocked by the verification gate (Unverified / unverified-equivalent).
                // Their bot-controlled roles were already stripped above.
                if (blockedIds.has(member.id)) {
                    skippedCount++;
                    continue;
                }

                // Always remove Need Rank for anyone found in the sheet.
                if (member.roles.cache.has(ROLES.NEED_RANK)) {
                    await member.roles.remove(ROLES.NEED_RANK);
                    Logger.info(`Removed Need Rank role from ${member.user.username} (found in sheet)`);
                }

                // Update Discord nickname if different from sheet
                if (playerData.username && playerData.username.trim() !== '') {
                    const currentNickname = member.nickname || member.user.username;
                    if (currentNickname !== playerData.username && member.manageable) {
                        try {
                            await member.setNickname(playerData.username);
                            Logger.info(`Updated Discord nickname to: ${playerData.username} (was: ${currentNickname})`);
                        } catch (nickError) {
                            Logger.warning(`Failed to update nickname for ${member.user.username}: ${nickError.message}`);
                        }
                    }
                }

                // Check if player has salary (Column O).
                // A player has NO salary when the cell is:
                //   - empty / whitespace-only / a stray apostrophe ("'", " "), OR
                //   - the league's "no salary" sentinel "NS" (column N and O both
                //     read "NS" for freshly-added players with no salary yet).
                // Either way they must take the no-salary path → get the No Salary
                // role and NEVER Ineligible. (Verified against live SalSheet rows
                // 480-493, which are "NS" players.)
                const salaryRaw = (playerData.salary || '').replace(/^'/, '').trim();
                const hasSalary = salaryRaw !== '' && salaryRaw.toUpperCase() !== 'NS';

                if (!hasSalary) {
                    // No salary - remove all league-related roles and keep only NO_SALARY role
                    await cleanupNoSalaryPlayer(member);
                    syncedCount++;
                    continue;
                }

                // Has salary - process all role checks
                const updates = {};

                // Check if player is not eligible (Column J = NO) - if so, set FA to NO
                if (playerData.eligible !== 'YES' && playerData.freeAgent === 'YES') {
                    Logger.info(`Player ${member.user.username} is not eligible - setting FA to NO`);
                    updates.freeAgent = 'NO';
                    playerData.freeAgent = 'NO'; // Update local data immediately for role sync
                }

                // Check IR expiry (Column K and W)
                if (playerData.inReserve === 'YES' && playerData.irExpiry) {
                    const irExpiryDate = new Date(playerData.irExpiry);
                    const irExpiryString = irExpiryDate.toLocaleDateString('en-US');
                    
                    if (irExpiryString === todayString) {
                        Logger.info(`IR expiry reached for ${member.user.username}`);
                        
                        // Get current team BEFORE removing roles
                        const currentTeam = getPlayerCurrentTeam(member);
                        
                        // Update Discord nickname from sheet BEFORE moving to FA
                        if (playerData.username && playerData.username.trim() !== '') {
                            const currentNickname = member.nickname || member.user.username;
                            if (currentNickname !== playerData.username && member.manageable) {
                                try {
                                    await member.setNickname(playerData.username);
                                    Logger.info(`Updated nickname during IR release: ${playerData.username}`);
                                } catch (nickError) {
                                    Logger.warning(`Failed to update nickname during IR release: ${nickError.message}`);
                                }
                            }
                        }
                        
                        // Move to FA
                        updates.inReserve = 'NO';
                        updates.freeAgent = 'YES';
                        updates.irExpiry = '';
                        
                        // Remove team roles
                        await removeAllTeamRoles(member);
                        
                        // Add FA role
                        const faRoleId = ROLES.FREE_AGENTS[playerData.division];
                        if (faRoleId) {
                            await member.roles.add(faRoleId);
                            Logger.info(`Added ${playerData.division} FA role to ${member.user.username}`);
                        }
                        
                        // Send notification to IR release channel
                        const irReleaseChannel = await client.channels.fetch(INRESERVE_RELEASE_CHANNEL_ID);
                        await irReleaseChannel.send({
                            content: `📋 **IR Release to Free Agent**\n\n${member} has been released from **In Reserve (IR)** to **Free Agent**.\n\n**Former Team:** ${currentTeam || 'Unknown'}\n**Division:** ${playerData.division}\n**Released On:** ${todayString}`
                        });
                        
                        Logger.success(`IR release completed for ${member.user.username} from ${currentTeam || 'Unknown'}`);
                    }
                }

                // Check RFA expiry (Column U and V)
                if (playerData.rfa === 'YES' && playerData.rfaExpiry) {
                    // Parse the stored expiry datetime (format: "M/D/YYYY, H:MM AM/PM EST")
                    const expiryString = playerData.rfaExpiry.replace(' EST', '').replace(' est', '');
                    const rfaExpiryDate = new Date(expiryString);
                    
                    // Get current time in EST for comparison
                    const nowEST = new Date(today.toLocaleString('en-US', { timeZone: 'America/New_York' }));
                    
                    // Check if current time has passed the expiry time
                    if (nowEST >= rfaExpiryDate) {
                        Logger.info(`RFA expiry reached for ${member.user.username} (Expiry: ${playerData.rfaExpiry})`);
                        
                        // Get current team BEFORE removing roles
                        const currentTeam = getPlayerCurrentTeam(member);
                        
                        // Update Discord nickname from sheet BEFORE moving to FA
                        if (playerData.username && playerData.username.trim() !== '') {
                            const currentNickname = member.nickname || member.user.username;
                            if (currentNickname !== playerData.username && member.manageable) {
                                try {
                                    await member.setNickname(playerData.username);
                                    Logger.info(`Updated nickname during IR release: ${playerData.username}`);
                                } catch (nickError) {
                                    Logger.warning(`Failed to update nickname during IR release: ${nickError.message}`);
                                }
                            }
                        }


                        // Release from RFA to FA
                        updates.rfa = '';
                        updates.rfaExpiry = '';
                        updates.freeAgent = 'YES';
                        
                        // Add FA role
                        const faRoleId = ROLES.FREE_AGENTS[playerData.division];
                        if (faRoleId) {
                            await member.roles.add(faRoleId);
                            Logger.info(`Added ${playerData.division} FA role to ${member.user.username}`);
                        }
                        
                        // Send notification with current EST time
                        const rfaChannel = await client.channels.fetch(INRESERVE_RELEASE_CHANNEL_ID);
                        const releaseTimeEST = today.toLocaleString('en-US', {
                            timeZone: 'America/New_York',
                            month: 'numeric',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        }) + ' EST';
                        
                        await rfaChannel.send({
                            content: `🔓 **RFA Released to FA**\n\n${member} has been released from **Restricted Free Agent (RFA)** status and is now a **Free Agent**.\n\n**Division:** ${playerData.division}\n**RFA Expired At:** ${playerData.rfaExpiry}\n**Released On:** ${releaseTimeEST}`
                        });
                    }
                }

                // Update sheet if any changes
                if (Object.keys(updates).length > 0) {
                    await roleSyncManager.updatePlayerStatus(playerData.rowIndex, updates);
                    // Update local data for role sync
                    Object.assign(playerData, updates);
                }

                // Remove NO_SALARY role if present (they have salary)
                if (member.roles.cache.has(ROLES.NO_SALARY)) {
                    await member.roles.remove(ROLES.NO_SALARY);
                    Logger.info(`Removed NO_SALARY role from ${member.user.username}`);
                }

                // Sync FA role
                await syncFreeAgentRole(member, playerData);

                // Sync division role
                await syncDivisionRole(member, playerData);

                // Sync suspended role
                await syncSuspendedRole(member, playerData);

                // Sync eligible/ineligible role
                await syncEligibleRole(member, playerData);

                syncedCount++;

            } catch (error) {
                Logger.error(`Error syncing roles for ${playerData.discordId}:`, error);
                errorCount++;
            }
        }

        Logger.success(`===== Role Sync Complete =====`);
        Logger.info(`Synced: ${syncedCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);

        // Update rosters after role sync
        try {
            Logger.info('Updating rosters after role sync...');
            await updateAllRosters(client);
        } catch (rosterError) {
            Logger.error('Failed to update rosters after role sync', rosterError);
        }

    } catch (error) {
        Logger.error('Role sync failed', error);
    }
}

async function syncFreeAgentRole(member, playerData) {
    // Determine what the correct FA role should be
    const shouldHaveFARole = playerData.freeAgent === 'YES' && playerData.division;
    const correctFARoleId = shouldHaveFARole ? ROLES.FREE_AGENTS[playerData.division] : null;
    
    // Check current FA roles
    const currentFARoles = [];
    for (const [division, faRoleId] of Object.entries(ROLES.FREE_AGENTS)) {
        if (member.roles.cache.has(faRoleId)) {
            currentFARoles.push({ division, faRoleId });
        }
    }
    
    // Only make changes if current state differs from desired state
    const hasCorrectRole = correctFARoleId && member.roles.cache.has(correctFARoleId);
    const hasIncorrectRoles = currentFARoles.length > 0 && (!correctFARoleId || currentFARoles.some(r => r.faRoleId !== correctFARoleId));
    
    if (hasCorrectRole && currentFARoles.length === 1) {
        // Already correct - no changes needed
        return;
    }
    
    // Remove incorrect FA roles
    if (hasIncorrectRoles) {
        for (const { division, faRoleId } of currentFARoles) {
            if (faRoleId !== correctFARoleId) {
                await member.roles.remove(faRoleId);
                Logger.info(`Removed ${division} FA role from ${member.user.username}`);
            }
        }
    }

    // Add correct FA role if needed
    if (correctFARoleId && !member.roles.cache.has(correctFARoleId)) {
        await member.roles.add(correctFARoleId);
        Logger.info(`Added ${playerData.division} FA role to ${member.user.username}`);
    }
}

async function syncDivisionRole(member, playerData) {
    // Determine correct division role
    const correctDivisionRoleId = playerData.division ? ROLES.DIVISIONS[playerData.division] : null;
    
    // Check current division roles
    const currentDivisionRoles = [];
    for (const [division, divisionRoleId] of Object.entries(ROLES.DIVISIONS)) {
        if (member.roles.cache.has(divisionRoleId)) {
            currentDivisionRoles.push({ division, divisionRoleId });
        }
    }
    
    // Only make changes if current state differs from desired state
    const hasCorrectRole = correctDivisionRoleId && member.roles.cache.has(correctDivisionRoleId);
    const hasIncorrectRoles = currentDivisionRoles.length > 0 && (!correctDivisionRoleId || currentDivisionRoles.some(r => r.divisionRoleId !== correctDivisionRoleId));
    
    if (hasCorrectRole && currentDivisionRoles.length === 1) {
        // Already correct - no changes needed
        return;
    }
    
    // Remove incorrect division roles
    if (hasIncorrectRoles) {
        for (const { division, divisionRoleId } of currentDivisionRoles) {
            if (divisionRoleId !== correctDivisionRoleId) {
                await member.roles.remove(divisionRoleId);
                Logger.info(`Removed ${division} division role from ${member.user.username}`);
            }
        }
    }

    // Add correct division role if needed
    if (correctDivisionRoleId && !member.roles.cache.has(correctDivisionRoleId)) {
        await member.roles.add(correctDivisionRoleId);
        Logger.info(`Added ${playerData.division} division role to ${member.user.username}`);
    }
}

async function syncSuspendedRole(member, playerData) {
    const shouldBeSuspended = playerData.suspended === 'YES';
    const hasSuspended = member.roles.cache.has(ROLES.SUSPENDED);

    if (shouldBeSuspended && !hasSuspended) {
        await member.roles.add(ROLES.SUSPENDED);
        Logger.info(`Added Suspended role to ${member.user.username}`);
    } else if (!shouldBeSuspended && hasSuspended) {
        await member.roles.remove(ROLES.SUSPENDED);
        Logger.info(`Removed Suspended role from ${member.user.username}`);
    }
}

async function syncEligibleRole(member, playerData) {
    // Column J (eligible). Only an explicit, non-blank value that ISN'T "YES"
    // marks a player Ineligible. A BLANK eligibility cell must never add the
    // Ineligible role — a blank/empty row should fall through to No Salary, not
    // get flagged. (Players reach this function only on the has-salary path.)
    const eligibleVal = (playerData.eligible || '').trim().toUpperCase();
    const hasIneligible = member.roles.cache.has(ROLES.INELIGIBLE);
    const explicitlyIneligible = eligibleVal !== '' && eligibleVal !== 'YES';

    if (!explicitlyIneligible && hasIneligible) {
        await member.roles.remove(ROLES.INELIGIBLE);
        Logger.info(`Removed Ineligible role from ${member.user.username}`);
    } else if (explicitlyIneligible && !hasIneligible) {
        await member.roles.add(ROLES.INELIGIBLE);
        Logger.info(`Added Ineligible role to ${member.user.username}`);
    }
}

// Strips ONLY the roles the bot controls in auto role sync, leaving transaction
// roles (team, captain), GM roles, and NP roles untouched so they can be
// restored manually / via the sheet role sync. Returns the list of removed
// role labels for logging.
async function stripBotAutoRoles(member) {
    const removed = [];

    if (member.roles.cache.has(ROLES.NEED_RANK)) {
        await member.roles.remove(ROLES.NEED_RANK);
        removed.push('Need Rank');
    }
    if (member.roles.cache.has(ROLES.NO_SALARY)) {
        await member.roles.remove(ROLES.NO_SALARY);
        removed.push('No Salary');
    }
    if (member.roles.cache.has(ROLES.SUSPENDED)) {
        await member.roles.remove(ROLES.SUSPENDED);
        removed.push('Suspended');
    }
    if (member.roles.cache.has(ROLES.INELIGIBLE)) {
        await member.roles.remove(ROLES.INELIGIBLE);
        removed.push('Ineligible');
    }
    for (const [division, divisionRoleId] of Object.entries(ROLES.DIVISIONS)) {
        if (member.roles.cache.has(divisionRoleId)) {
            await member.roles.remove(divisionRoleId);
            removed.push(`${division} Division`);
        }
    }
    for (const [division, faRoleId] of Object.entries(ROLES.FREE_AGENTS)) {
        if (member.roles.cache.has(faRoleId)) {
            await member.roles.remove(faRoleId);
            removed.push(`${division} FA`);
        }
    }

    return removed;
}

async function cleanupNoSalaryPlayer(member) {
    let changesMade = false;
    
    // Add NO_SALARY role if not present
    if (!member.roles.cache.has(ROLES.NO_SALARY)) {
        await member.roles.add(ROLES.NO_SALARY);
        Logger.info(`Added No Salary role to ${member.user.username}`);
        changesMade = true;
    }

    // DO NOT remove team roles or NP roles - they should stay so they can be restored when salary comes back

    // Remove all FA roles if present
    for (const faRoleId of Object.values(ROLES.FREE_AGENTS)) {
        if (member.roles.cache.has(faRoleId)) {
            await member.roles.remove(faRoleId);
            changesMade = true;
        }
    }

    // Remove all division roles if present
    for (const divisionRoleId of Object.values(ROLES.DIVISIONS)) {
        if (member.roles.cache.has(divisionRoleId)) {
            await member.roles.remove(divisionRoleId);
            changesMade = true;
        }
    }

    // Remove suspended role if present
    if (member.roles.cache.has(ROLES.SUSPENDED)) {
        await member.roles.remove(ROLES.SUSPENDED);
        changesMade = true;
    }

    // Remove ineligible role if present
    if (member.roles.cache.has(ROLES.INELIGIBLE)) {
        await member.roles.remove(ROLES.INELIGIBLE);
        changesMade = true;
    }

    if (changesMade) {
        Logger.info(`Cleaned up roles for no-salary player (kept team roles): ${member.user.username}`);
    }
}

async function removeAllTeamRoles(member) {
    for (const division of Object.values(TEAM_ROLES)) {
        for (const roleId of Object.values(division)) {
            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(roleId);
            }
        }
    }
    
    // Also remove NP roles
    for (const npRoleId of Object.values(NP_ROLES)) {
        if (member.roles.cache.has(npRoleId)) {
            await member.roles.remove(npRoleId);
        }
    }
}

function getPlayerCurrentTeam(member) {
    // Check all divisions and teams to find which team role the player has
    for (const [division, teams] of Object.entries(TEAM_ROLES)) {
        for (const [teamName, roleId] of Object.entries(teams)) {
            if (member.roles.cache.has(roleId)) {
                return `${teamName} (${division})`;
            }
        }
    }
    
    // Check NP roles - need to get division from their league role
    for (const [teamName, npRoleId] of Object.entries(NP_ROLES)) {
        if (member.roles.cache.has(npRoleId)) {
            // Get division from league role
            for (const [division, divisionRoleId] of Object.entries(ROLES.DIVISIONS)) {
                if (member.roles.cache.has(divisionRoleId)) {
                    return `${teamName} (${division})`;
                }
            }
        }
    }
    
    return null;
}

function startRoleSyncScheduler(client) {
    Logger.info('Starting role sync scheduler (every 15 minutes)');
    
    // Run immediately on start
    performRoleSync(client);
    
    // Then run every 15 minutes
    setInterval(() => {
        performRoleSync(client);
    }, 30 * 60 * 1000); // 30 minutes in milliseconds
}

module.exports = {
    startRoleSyncScheduler,
    performRoleSync
};
