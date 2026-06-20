const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextInputBuilder, TextInputStyle, ModalBuilder } = require('discord.js');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../config/config');
const Logger = require('../utils/logger');

// Registration states
const REGISTRATION_STATES = {
    WELCOME: 'welcome',
    MAIN_ACCOUNT: 'main_account',
    ALT_ACCOUNTS: 'alt_accounts',
    COMPLETE: 'complete'
};

// In-memory storage for registration sessions
const registrationSessions = new Map();

// Global tracking of processed interactions to prevent duplicates
const processedInteractions = new Set();

// Clear old interactions every 5 minutes to prevent memory leaks
setInterval(() => {
    processedInteractions.clear();
}, 5 * 60 * 1000);

class RegistrationSession {
    constructor(userId, username, displayName) {
        this.userId = userId;
        this.username = username;
        this.displayName = displayName;
        this.state = REGISTRATION_STATES.WELCOME;
        this.mainAccount = null;
        this.altAccounts = [];
        this.createdAt = Date.now();
        this.lastInteractionId = null;
        this.processingInteraction = false;
    }

    addAltAccount(url) {
        if (!this.altAccounts.includes(url) && url !== this.mainAccount) {
            this.altAccounts.push(url);
            return true;
        }
        return false;
    }

    removeLastAlt() {
        return this.altAccounts.pop();
    }

    isExpired() {
        // Sessions expire after 30 minutes
        return Date.now() - this.createdAt > 30 * 60 * 1000;
    }

    acquireLock(interactionId) {
        if (this.processingInteraction) {
            return false;
        }
        this.processingInteraction = true;
        this.lastInteractionId = interactionId;
        return true;
    }

    releaseLock() {
        this.processingInteraction = false;
    }
}

class GoogleSheetsManager {
    constructor() {
        this.auth = null;
        this.sheets = null;
        this.spreadsheetId = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
    }

    async initialize() {
        try {
            if (this.auth) return true; // Already initialized
            
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

    async checkUserRegistration(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            const range = 'SalSheet!G:P';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range,
            });
            
            const rows = response.data.values || [];
            
            // Convert userId to string to ensure proper comparison
            const userIdString = String(userId);
            
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                // Check column P (index 9 in G:P range) for Discord ID
                if (row.length >= 10 && String(row[9]) === userIdString) {
                    // Check if they have ANY content in columns G (index 0) or H (index 1)
                    const mainTracker = row[0];
                    const altTracker = row[1];
                    
                    // More thorough check - if either column has any non-empty content
                    const hasMainTracker = mainTracker && 
                        typeof mainTracker === 'string' && 
                        mainTracker.trim().length > 0;
                    
                    const hasAltTracker = altTracker && 
                        typeof altTracker === 'string' && 
                        altTracker.trim().length > 0;
                    
                    const isRegistered = hasMainTracker || hasAltTracker;
                    
                    Logger.info(`Registration check for user ${userId}: mainTracker="${mainTracker}", altTracker="${altTracker}", isRegistered=${isRegistered}`);
                    
                    return isRegistered;
                }
            }
            
            Logger.info(`User ${userId} not found in spreadsheet - allowing registration`);
            return false;
        } catch (error) {
            Logger.error('Failed to check user registration', error);
            return false; // Default to false on error to allow registration
        }
    }

    async saveRegistration(session) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            // Get the "Registrations" sheet to find the next available row
            const range = 'Registrations!A:E';
            const response = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range,
            });
            
            const rows = response.data.values || [];
            
            // Find the next available row (first empty row)
            let nextRowIndex = rows.length + 1; // +1 because sheets are 1-indexed
            
            // Format main account URL
            const mainAccount = session.mainAccount || '';
            
            // Format alt accounts as simple URLs separated by line breaks
            let altAccountsFormatted = '';
            if (session.altAccounts.length > 0) {
                altAccountsFormatted = session.altAccounts.join('\n');
            }

            // Prepare the data for the new row
            // Column A: username, Column B: user id, Column C: display name, Column D: main account, Column E: alt accounts
            const rowData = [
                session.username,           // Column A
                session.userId,             // Column B  
                session.displayName,        // Column C
                mainAccount,                // Column D
                altAccountsFormatted        // Column E
            ];

            // Add the data to the next available row in the Registrations sheet
            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `Registrations!A${nextRowIndex}:E${nextRowIndex}`,
                valueInputOption: 'RAW', // Use RAW to preserve formatting and not create hyperlinks
                resource: {
                    values: [rowData]
                },
            });

            Logger.success(`Registration saved for user ${session.userId} in Registrations sheet row ${nextRowIndex}`);
            return true;
        } catch (error) {
            Logger.error('Failed to save registration', error);
            return false;
        }
    }

    /**
     * Append the user's Discord ID to the SalSheet Discord-ID column (column P,
     * the same column checkUserRegistration reads at index 9 of G:P).
     *
     * The ID is written at the FIRST empty cell AFTER the LAST filled cell — i.e.
     * appended at the very end of the existing IDs. Mid-list gaps (left behind
     * when an ID is removed) are intentionally skipped so a removed ID's slot is
     * never reused. Non-fatal: failures here never block registration.
     */
    async appendDiscordIdToSalSheet(userId) {
        try {
            if (!this.sheets) {
                await this.initialize();
            }

            // Read only the Discord-ID column (P).
            const res = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.spreadsheetId,
                range: 'SalSheet!P:P',
            });
            const col = res.data.values || []; // [ [id], [id], [], [id], ... ]

            // Find the LAST row (1-indexed) that actually contains an ID. Scanning
            // for the max filled index means any empty gaps above it are ignored,
            // so we always append below the newest ID.
            let lastFilledRow = 0;
            for (let i = 0; i < col.length; i++) {
                const cell = col[i] && col[i][0];
                if (cell !== undefined && cell !== null && String(cell).trim().length > 0) {
                    lastFilledRow = i + 1; // sheets are 1-indexed
                }
            }

            const targetRow = lastFilledRow + 1; // first empty cell after the last ID

            await this.sheets.spreadsheets.values.update({
                spreadsheetId: this.spreadsheetId,
                range: `SalSheet!P${targetRow}`,
                valueInputOption: 'RAW',
                resource: { values: [[String(userId)]] },
            });

            Logger.success(`Discord ID ${userId} appended to SalSheet!P${targetRow}`);
            // Return the row we wrote so the caller can queue an MMR update for it.
            return targetRow;
        } catch (error) {
            Logger.error('Failed to append Discord ID to SalSheet', error);
            return false;
        }
    }
}

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

// Create singleton instance
const sheetsManager = new GoogleSheetsManager();

// Embeds and UI components
function createWelcomeEmbed() {
    return new EmbedBuilder()
        .setTitle('🎮 Beluga League Registration')
        .setDescription('**Welcome to the registration process!**\n\nThis process will help you register your Rocket League tracker URLs for the Beluga League.\n\n**What you\'ll need:**\n• Your main Rocket League tracker URL\n• URLs for any alt accounts (optional but recommended)\n\n**Find your tracker at:** [🔗 https://rocketleague.tracker.network/](https://rocketleague.tracker.network/)\n\n⚠️ **IMPORTANT:** If you have alt accounts and don\'t register them, you may face penalties for smurfing!')
        .setColor(0x0099FF)
        .setTimestamp()
        .setFooter({ text: 'Click "Start Registration" to begin' });
}

function createMainAccountEmbed(session) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Registration - Step 1: Main Account')
        .setDescription('**Enter your main Rocket League tracker URL**\n\nFind your profile at [🔗 https://rocketleague.tracker.network/](https://rocketleague.tracker.network/)\n\n**Example:** `https://rocketleague.tracker.network/rocket-league/profile/steam/yourname`')
        .setColor(0x0099FF)
        .setTimestamp();

    if (session.mainAccount) {
        const validation = validateTrackerUrl(session.mainAccount);
        embed.addFields([
            {
                name: '✅ Main Account Set',
                value: `**Platform:** ${validation.platform.toUpperCase()}\n**Username:** ${validation.username}\n**URL:** ${session.mainAccount}`,
                inline: false
            }
        ]);
    }

    return embed;
}

function createAltAccountsEmbed(session) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Registration - Step 2: Alt Accounts')
        .setDescription('**Alt Accounts (Optional but Recommended)**\n\n⚠️ **WARNING:** If you have additional accounts and don\'t register them, you will be **SEVERELY PUNISHED** for smurfing/alt account violations!\n\nAdd all your alternative Rocket League accounts below.')
        .setColor(0xFFA500)
        .setTimestamp();

    // Show main account
    if (session.mainAccount) {
        const mainValidation = validateTrackerUrl(session.mainAccount);
        embed.addFields([
            {
                name: '✅ Main Account',
                value: `**Platform:** ${mainValidation.platform.toUpperCase()}\n**Username:** ${mainValidation.username}`,
                inline: false
            }
        ]);
    }

    // Show alt accounts
    if (session.altAccounts.length > 0) {
        const altAccountsList = session.altAccounts.map((altUrl, index) => {
            const validation = validateTrackerUrl(altUrl);
            return `**Alt ${index + 1}:** ${validation.platform.toUpperCase()} - ${validation.username}`;
        }).join('\n');

        embed.addFields([
            {
                name: `✅ Alt Accounts (${session.altAccounts.length})`,
                value: altAccountsList,
                inline: false
            }
        ]);
    }

    return embed;
}

function createSummaryEmbed(session) {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Registration - Final Review')
        .setDescription('**Please review your registration details below:**\n\nIf everything looks correct, click "Complete Registration" to save your information.')
        .setColor(0x00FF00)
        .setTimestamp();

    // Main account
    const mainValidation = validateTrackerUrl(session.mainAccount);
    embed.addFields([
        {
            name: '🎯 Main Account',
            value: `**Platform:** ${mainValidation.platform.toUpperCase()}\n**Username:** ${mainValidation.username}\n**URL:** ${session.mainAccount}`,
            inline: false
        }
    ]);

    // Alt accounts
    if (session.altAccounts.length > 0) {
        const altList = session.altAccounts.map((altUrl, index) => {
            const validation = validateTrackerUrl(altUrl);
            return `**${index + 1}.** ${validation.platform.toUpperCase()} - ${validation.username}`;
        }).join('\n');

        embed.addFields([
            {
                name: `📋 Alt Accounts (${session.altAccounts.length})`,
                value: altList,
                inline: false
            }
        ]);
    } else {
        embed.addFields([
            {
                name: '📋 Alt Accounts',
                value: 'None registered',
                inline: false
            }
        ]);
    }

    embed.addFields([
        {
            name: '📊 Summary',
            value: `**Total Accounts:** ${1 + session.altAccounts.length}\n**User:** ${session.displayName}`,
            inline: false
        }
    ]);

    return embed;
}

// Button builders
function createWelcomeButtons() {
    return new ActionRowBuilder().addComponents([
        new ButtonBuilder()
            .setCustomId('start_registration')
            .setLabel('Start Registration')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🚀')
    ]);
}

function createMainAccountButtons(session) {
    const buttons = [
        new ButtonBuilder()
            .setCustomId('enter_main_account')
            .setLabel(session.mainAccount ? 'Change Main Account' : 'Enter Main Account')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯')
    ];

    if (session.mainAccount) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId('next_to_alts')
                .setLabel('Next: Alt Accounts')
                .setStyle(ButtonStyle.Success)
                .setEmoji('➡️')
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId('cancel_registration')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    return new ActionRowBuilder().addComponents(buttons);
}

function createAltAccountsButtons(session) {
    const buttons = [
        new ButtonBuilder()
            .setCustomId('add_alt_account')
            .setLabel('Add Alt Account')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('➕')
    ];

    if (session.altAccounts.length > 0) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId('remove_last_alt')
                .setLabel('Remove Last Alt')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('🗑️')
        );
    }

    buttons.push(
        new ButtonBuilder()
            .setCustomId('next_to_summary')
            .setLabel('Next: Review')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➡️'),
        new ButtonBuilder()
            .setCustomId('back_to_main')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️')
    );

    return new ActionRowBuilder().addComponents(buttons);
}

function createSummaryButtons() {
    return new ActionRowBuilder().addComponents([
        new ButtonBuilder()
            .setCustomId('complete_registration')
            .setLabel('Complete Registration')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId('back_to_alts')
            .setLabel('Back: Edit Alts')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⬅️'),
        new ButtonBuilder()
            .setCustomId('cancel_registration')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    ]);
}

async function sendRegistrationAnnouncement(client, session) {
    try {
        // Changed to use the config value for the registration channel
        const registrationChannelId = config.bot.registrationChannelId;
        const registrationChannel = client.channels.cache.get(registrationChannelId);

        if (!registrationChannel) {
            Logger.warning(`Registration channel not found: ${registrationChannelId}`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('🎮 New Player Registration')
            .setColor(0x00FF00)
            .setTimestamp()
            .setFooter({ text: 'React to take this registration' });

        // Add user information
        embed.addFields([
            {
                name: '👤 User Information',
                value: `**Username:** ${session.username}\n**Display Name:** **__${session.displayName}__**\n**User ID:** ${session.userId}`,
                inline: false
            }
        ]);

        // Add main account
        const mainValidation = validateTrackerUrl(session.mainAccount);
        embed.addFields([
            {
                name: 'Main Account',
                value: `**Platform:** ${mainValidation.platform.toUpperCase()}\n**Username:** [${mainValidation.username}](${session.mainAccount})`,
                inline: false
            }
        ]);

        // Add alt accounts
        if (session.altAccounts.length > 0) {
            const maxAltsToShow = Math.min(20, session.altAccounts.length);
            
            for (let i = 0; i < maxAltsToShow; i++) {
                const altUrl = session.altAccounts[i];
                const validation = validateTrackerUrl(altUrl);
                
                embed.addFields([
                    {
                        name: `Alt Account ${i + 1}`,
                        value: `**Platform:** ${validation.platform.toUpperCase()}\n**Username:** [${validation.username}](${altUrl})`,
                        inline: true
                    }
                ]);
            }

            if (session.altAccounts.length > 20) {
                embed.addFields([
                    {
                        name: '📝 Additional Accounts',
                        value: `... and ${session.altAccounts.length - 20} more alt accounts`,
                        inline: false
                    }
                ]);
            }
        }

        await registrationChannel.send({ embeds: [embed] });

        if (session.altAccounts.length > 20) {
            const allAlts = session.altAccounts.map((altUrl, index) => {
                const validation = validateTrackerUrl(altUrl);
                return `${index + 1}. ${validation.platform.toUpperCase()}: ${validation.username} - ${altUrl}`;
            }).join('\n');

            await registrationChannel.send({
                content: `**Full Alt Account List for ${session.displayName}:**\n\`\`\`\n${allAlts}\n\`\`\``
            });
        }
        
        Logger.success(`Registration announcement sent to channel ${registrationChannelId}`);
    } catch (error) {
        Logger.error('Failed to send registration announcement', error);
    }
}

// Utility function for safe interaction replies
async function safeReply(interaction, options) {
    try {
        if (interaction.replied) {
            return await interaction.followUp(options);
        } else if (interaction.deferred) {
            return await interaction.editReply(options);
        } else {
            return await interaction.reply(options);
        }
    } catch (error) {
        // If we get here, the interaction is probably invalid, just log it
        Logger.warning(`Failed to respond to interaction: ${error.message}`);
        return null;
    }
}

// Utility function for safe interaction updates
async function safeUpdate(interaction, options) {
    try {
        return await interaction.update(options);
    } catch (error) {
        // If interaction is already acknowledged or unknown, try to followUp instead
        try {
            Logger.warning(`Failed to update interaction: ${error.message}, trying followUp instead`);
            return await interaction.followUp({ ...options, flags: 64 });
        } catch (followupError) {
            Logger.warning(`Failed to followUp after update error: ${followupError.message}`);
            return null;
        }
    }
}

// Utility function for safely showing modals
async function safeShowModal(interaction, modal) {
    try {
        await interaction.showModal(modal);
        return true;
    } catch (error) {
        Logger.warning(`Failed to show modal: ${error.message}`);
        
        // Try to reply with an error message if possible
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ There was an issue showing the form. Please try again.',
                    flags: 64
                });
            } else {
                await interaction.followUp({
                    content: '❌ There was an issue showing the form. Please try again.',
                    flags: 64
                });
            }
        } catch (followupError) {
            // At this point, just log the issue
            Logger.error(`Could not notify user about modal failure: ${followupError.message}`);
        }
        return false;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register')
        .setDescription('Register your RL trackers for the Beluga League'),

    async execute(interaction) {
        try {
            // IMMEDIATE deferral to prevent timeout - this must be first
            await interaction.deferReply({ 
                flags: 64 // Keep registration private
            });

            Logger.info(`User ${interaction.user.tag} initiated registration`);

            // Clean up any existing session first to prevent duplicates and old data
            if (registrationSessions.has(interaction.user.id)) {
                registrationSessions.delete(interaction.user.id);
                Logger.info(`Cleaned up existing session for user ${interaction.user.id}`);
            }

            // Check if user is already registered (background check)
            const isAlreadyRegistered = await sheetsManager.checkUserRegistration(interaction.user.id);
            
            if (isAlreadyRegistered) {
                const helpChannelId = '1304231187547684864';
                const helpChannel = interaction.client.channels.cache.get(helpChannelId);
                const helpChannelMention = helpChannel ? `<#${helpChannelId}>` : 'the help channel';
                
                const alreadyRegisteredEmbed = new EmbedBuilder()
                    .setTitle('❌ Already Registered')
                    .setDescription(`You have already registered your tracker information. If you need to update your information, please create a ticket in ${helpChannelMention} for assistance.`)
                    .setColor(0xFF0000)
                    .setTimestamp();
                
                await interaction.editReply({ 
                    embeds: [alreadyRegisteredEmbed],
                    components: [] // Ensure no components for already registered users
                });
                return;
            }

            // Create new registration session
            const session = new RegistrationSession(
                interaction.user.id,
                interaction.user.username,
                interaction.member.displayName || interaction.user.username
            );

            // Store session
            registrationSessions.set(interaction.user.id, session);

            // Send welcome embed
            const embed = createWelcomeEmbed();
            const buttons = createWelcomeButtons();

            await interaction.editReply({
                embeds: [embed],
                components: [buttons]
            });

            Logger.success(`Registration started for ${interaction.user.tag}`);
        } catch (error) {
            Logger.error('Failed to start registration', error);
            
            // Clean up session on error
            if (registrationSessions.has(interaction.user.id)) {
                registrationSessions.delete(interaction.user.id);
            }
            
            try {
                await interaction.editReply({
                    content: '❌ An error occurred starting registration. Please try again later.',
                    embeds: [],
                    components: []
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    async handleButton(interaction) {
        try {
            // Check if this interaction has been processed already
            const interactionKey = `button:${interaction.id}`;
            if (processedInteractions.has(interactionKey)) {
                Logger.warning(`Skipping already processed button interaction: ${interaction.customId} from ${interaction.user.tag}`);
                return;
            }

            // Mark as processed immediately
            processedInteractions.add(interactionKey);
            
            Logger.info(`Button interaction received: ${interaction.customId} from ${interaction.user.tag}`);
            
            // Get session first
            const session = registrationSessions.get(interaction.user.id);
            
            // Check session exists
            if (!session || session.isExpired()) {
                await safeUpdate(interaction, {
                    content: '❌ Your registration session has expired or you have already registered. Please run /register again if already not registered.',
                    embeds: [],
                    components: []
                });
                if (session) registrationSessions.delete(interaction.user.id);
                return;
            }
            
            // For modal buttons, don't defer. For other buttons, defer to prevent timeout
            const modalButtons = ['enter_main_account', 'add_alt_account'];
            if (!modalButtons.includes(interaction.customId)) {
                if (!interaction.replied && !interaction.deferred) {
                    try {
                        await interaction.deferUpdate();
                    } catch (deferError) {
                        Logger.warning(`Failed to defer interaction: ${deferError.message}`);
                        return;
                    }
                }
            }
            
            // Handle different buttons
            switch (interaction.customId) {
                case 'start_registration':
                    session.state = REGISTRATION_STATES.MAIN_ACCOUNT;
                    
                    // Use editReply since this was deferred
                    await interaction.editReply({
                        embeds: [createMainAccountEmbed(session)],
                        components: [createMainAccountButtons(session)]
                    });
                    break;
                    
                case 'enter_main_account': {
                    // Show modal for main account input
                    const mainModal = new ModalBuilder()
                        .setCustomId('main_account_modal')
                        .setTitle('Main Account Tracker');
                        
                    const mainTrackerInput = new TextInputBuilder()
                        .setCustomId('tracker_url')
                        .setLabel('Main Account Tracker URL')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('https://rocketleague.tracker.network/rocket-league/profile/platform/username')
                        .setRequired(true)
                        .setMaxLength(200);
                        
                    if (session.mainAccount) {
                        mainTrackerInput.setValue(session.mainAccount);
                    }
                    
                    mainModal.addComponents(new ActionRowBuilder().addComponents(mainTrackerInput));
                    
                    // Show modal with enhanced error handling
                    await safeShowModal(interaction, mainModal);
                    break;
                }
                
                case 'next_to_alts':
                    session.state = REGISTRATION_STATES.ALT_ACCOUNTS;
                    
                    await interaction.editReply({
                        embeds: [createAltAccountsEmbed(session)],
                        components: [createAltAccountsButtons(session)]
                    });
                    break;
                    
                case 'add_alt_account': {
                    // Show modal for alt account input
                    const altModal = new ModalBuilder()
                        .setCustomId('alt_account_modal')
                        .setTitle('Alt Account Tracker');
                        
                    const altTrackerInput = new TextInputBuilder()
                        .setCustomId('tracker_url')
                        .setLabel('Alt Account Tracker URL')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('https://rocketleague.tracker.network/rocket-league/profile/platform/username')
                        .setRequired(true)
                        .setMaxLength(200);
                        
                    altModal.addComponents(new ActionRowBuilder().addComponents(altTrackerInput));
                    
                    // Show modal with enhanced error handling
                    await safeShowModal(interaction, altModal);
                    break;
                }
                
                case 'remove_last_alt':
                    session.removeLastAlt();
                    
                    await interaction.editReply({
                        embeds: [createAltAccountsEmbed(session)],
                        components: [createAltAccountsButtons(session)]
                    });
                    break;
                    
                case 'next_to_summary':
                    session.state = REGISTRATION_STATES.COMPLETE;
                    
                    await interaction.editReply({
                        embeds: [createSummaryEmbed(session)],
                        components: [createSummaryButtons()]
                    });
                    break;
                    
                case 'back_to_main':
                    session.state = REGISTRATION_STATES.MAIN_ACCOUNT;
                    
                    await interaction.editReply({
                        embeds: [createMainAccountEmbed(session)],
                        components: [createMainAccountButtons(session)]
                    });
                    break;
                    
                case 'back_to_alts':
                    session.state = REGISTRATION_STATES.ALT_ACCOUNTS;
                    
                    await interaction.editReply({
                        embeds: [createAltAccountsEmbed(session)],
                        components: [createAltAccountsButtons(session)]
                    });
                    break;
                    
                case 'complete_registration':
                    await interaction.editReply({
                        content: '⏳ Saving your registration to the database...',
                        embeds: [],
                        components: []
                    });

                    // Save to Google Sheets
                    const saved = await sheetsManager.saveRegistration(session);
                    
                    if (!saved) {
                        await interaction.editReply({
                            content: '❌ Failed to save your registration. Please try again or contact an administrator.',
                            embeds: [],
                            components: []
                        });
                        return;
                    }

                    // Extra step: append the Discord ID to the end of the SalSheet
                    // Discord-ID column (column P). Non-fatal — never blocks success.
                    // Returns the row it wrote to (or false on failure).
                    let salSheetRow = false;
                    try {
                        salSheetRow = await sheetsManager.appendDiscordIdToSalSheet(session.userId);
                    } catch (salSheetError) {
                        Logger.error('SalSheet Discord-ID append failed (registration still saved)', salSheetError);
                    }

                    // Queue an MMR Updater single-update for this new row so the
                    // website pulls their trackers "from register command". Fully
                    // fire-and-forget + non-fatal — never blocks the registration.
                    if (Number.isInteger(salSheetRow)) {
                        try {
                            const { enqueueRegisterUpdate } = require('../stats/registerQueue');
                            enqueueRegisterUpdate(salSheetRow, session.userId).catch(() => {});
                        } catch (queueError) {
                            Logger.error('Failed to queue register MMR update (registration still saved)', queueError);
                        }
                    }

                    // Send registration announcement
                    await sendRegistrationAnnouncement(interaction.client, session);

                    // Success message
                    const confirmEmbed = new EmbedBuilder()
                        .setTitle('✅ Registration Complete!')
                        .setDescription(`**${session.displayName}**, your registration has been submitted successfully!\n\n📊 **Summary:**\n• Main Account: ✅\n• Alt Accounts: ${session.altAccounts.length}\n• Total Trackers: ${1 + session.altAccounts.length}\n\nYour trackers have been saved to our database. You should receive further instructions soon.`)
                        .setColor(0x00FF00)
                        .setTimestamp();

                    await interaction.editReply({
                        content: null,
                        embeds: [confirmEmbed],
                        components: []
                    });

                    // Clean up session
                    registrationSessions.delete(interaction.user.id);
                    Logger.success(`Registration completed for ${session.username} (${session.userId}) with ${1 + session.altAccounts.length} trackers`);
                    break;
                    
                case 'cancel_registration':
                    registrationSessions.delete(interaction.user.id);
                    
                    await interaction.editReply({
                        content: '❌ Registration cancelled.',
                        embeds: [],
                        components: []
                    });
                    break;
                    
                default:
                    Logger.warning(`Unknown button interaction: ${interaction.customId} from ${interaction.user.tag}`);
                    
                    await interaction.editReply({
                        content: '❌ Unknown action. Please try again.',
                        embeds: [],
                        components: []
                    });
            }
        } catch (error) {
            Logger.error(`Failed to handle button interaction: ${interaction.customId}`, error);
            
            try {
                // Use the appropriate method based on interaction state
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: '❌ An error occurred. Please try again.',
                        flags: 64
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: '❌ An error occurred. Please try again.',
                        embeds: [],
                        components: []
                    });
                } else {
                    await interaction.followUp({
                        content: '❌ An error occurred. Please try again.',
                        flags: 64
                    });
                }
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    },

    async handleModalSubmit(interaction) {
        try {
            // Check if this interaction has been processed already
            const interactionKey = `modal:${interaction.id}`;
            if (processedInteractions.has(interactionKey)) {
                Logger.warning(`Skipping already processed modal submission: ${interaction.customId} from ${interaction.user.tag}`);
                return;
            }
            
            // Mark as processed immediately
            processedInteractions.add(interactionKey);
            
            Logger.info(`Modal submission received: ${interaction.customId} from ${interaction.user.tag}`);
            
            // Get session
            const session = registrationSessions.get(interaction.user.id);
            
            // Check session exists
            if (!session || session.isExpired()) {
                await safeReply(interaction, {
                    content: '❌ Your registration session has expired or you have already registered. Please run /register again if already not registered.',
                    flags: 64
                });
                if (session) registrationSessions.delete(interaction.user.id);
                return;
            }
            
            // Get tracker URL from modal
            const trackerUrl = interaction.fields.getTextInputValue('tracker_url').trim();
            const validationResult = validateTrackerUrl(trackerUrl);
            
            // Validate URL
            if (!validationResult.isValid) {
                await safeReply(interaction, {
                    content: `❌ ${validationResult.error}\n\n**Expected format:** \`https://rocketleague.tracker.network/rocket-league/profile/PLATFORM/USERNAME\`\n\n**Examples:**\n• \`https://rocketleague.tracker.network/rocket-league/profile/steam/johndoe\`\n• \`https://rocketleague.tracker.network/rocket-league/profile/epic/JohnDoe\``,
                    flags: 64
                });
                return;
            }
            
            // Handle different modals
            if (interaction.customId === 'main_account_modal') {
                session.mainAccount = trackerUrl;
                
                await safeReply(interaction, {
                    embeds: [createMainAccountEmbed(session)],
                    components: [createMainAccountButtons(session)],
                    flags: 64
                });
            } else if (interaction.customId === 'alt_account_modal') {
                const added = session.addAltAccount(trackerUrl);
                
                if (!added) {
                    await safeReply(interaction, {
                        content: '❌ This tracker URL has already been added as your main account or another alt account.',
                        flags: 64
                    });
                    return;
                }
                
                await safeReply(interaction, {
                    embeds: [createAltAccountsEmbed(session)],
                    components: [createAltAccountsButtons(session)],
                    flags: 64
                });
            }
        } catch (error) {
            Logger.error(`Failed to handle modal submission: ${interaction.customId}`, error);
            
            try {
                await safeReply(interaction, {
                    content: '❌ An error occurred processing your input. Please try again.',
                    flags: 64
                });
            } catch (followupError) {
                Logger.error('Failed to send error message', followupError);
            }
        }
    }
};

// Clean up expired sessions every 10 minutes
setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;
    
    for (const [userId, session] of registrationSessions.entries()) {
        if (session.isExpired()) {
            registrationSessions.delete(userId);
            expiredCount++;
        }
    }
    
    if (expiredCount > 0) {
        Logger.info(`Cleaned up ${expiredCount} expired registration sessions`);
    }
}, 10 * 60 * 1000);