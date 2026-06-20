const { Client, GatewayIntentBits, Events, ActivityType, Partials } = require('discord.js');
const { config, validateConfig } = require('./config/config');
const CommandHandler = require('./commands/index');
const Logger = require('./utils/logger');
const { createHealthServer } = require('./utils/healthServer');
const { performMemberPull } = require('./utils/memberPull');
const { performRoleSync } = require('./utils/roleSync');
const { updateAllRosters } = require('./utils/rosterManager');
const AIChatHandler = require('./utils/aiChat');
const { initializeDatabase } = require('./utils/database');
const { startBirthdayChecker } = require('./utils/birthdayChecker');
const {
    initializeWeekThreadsTable,
    startPendingWeekThreadWatcher,
} = require('./commands/week-thread');
const { startTicketSync } = require('./utils/ticketSync');
const { collectImageUrls } = require('./utils/tenor');
const { initAISettings } = require('./utils/aiSettings');
const reportRouter = require('./stats/report/router');
const reportIds = require('./stats/report/ids');
const { startPanelReposter } = require('./stats/report/panel');
const { startTeamConstantsSync } = require('./utils/constantsSync');
const ticketSystem = require('./tickets/ticketSystem');
const appBridge = require('./applications/appBridge');

class BelugaLeagueBot {
    constructor() {
        this.client = new Client({ 
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMembers,  // Required for member fetching
                GatewayIntentBits.MessageContent, // Required for reading message content
                GatewayIntentBits.GuildPresences,  // Required for tracking presence updates
                GatewayIntentBits.GuildMessageReactions  // Required for reaction events
            ],
            partials: [Partials.Message, Partials.Channel, Partials.Reaction] // Required for reactions on old messages
        });
        
        this.commandHandler = new CommandHandler();
        this.aiChat = new AIChatHandler();
        this.isReady = false;
        this.startTime = Date.now();
        this.errorCount = 0;
        this.lastError = null;
        this.healthServer = null;
        this.memberPullInterval = null;
        this.aiCleanupInterval = null;
    }

    async initialize() {
        try {
            // Log environment info for debugging
            Logger.info('Starting Beluga League Bot...');
            Logger.info(`Node.js version: ${process.version}`);
            Logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
            
            // Validate configuration
            Logger.info('Validating configuration...');
            validateConfig();
            Logger.success('Configuration validation passed');

            // Load commands
            Logger.info('Loading commands...');
            await this.commandHandler.loadCommands();
            Logger.success('Commands loaded successfully');
            
            // Initialize database (optional - continues without it)
            Logger.info('Initializing database...');
            const dbInitialized = await initializeDatabase();
            if (dbInitialized) {
                Logger.success('Database initialized successfully');
            } else {
                Logger.warning('Continuing without database - tickets will not persist across restarts');
            }
            
            // Set up event listeners
            this.setupEventListeners();
            
            // Login to Discord
            Logger.info('Connecting to Discord...');
            await this.client.login(config.discord.token);

            // Start health server for Railway
            if (process.env.RAILWAY_ENVIRONMENT || process.env.PORT) {
                Logger.info('Starting health server for Railway...');
                this.healthServer = createHealthServer(this);
            }
            
        } catch (error) {
            Logger.error('Failed to initialize bot', error);
            this.errorCount++;
            this.lastError = error;
            
            // Wait a bit before exiting to allow logs to flush
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        }
    }

    setupEventListeners() {
        this.client.once(Events.ClientReady, async (client) => {
            this.isReady = true;
            Logger.success(`${config.bot.name} is online!`);
            Logger.bot(`Logged in as ${client.user.tag}`);
            Logger.info(`Bot is serving ${client.guilds.cache.size} guild(s)`);
            
            // Set bot activity
           client.user.setActivity('Rocket League', {
                type: ActivityType.Streaming,
                url: 'https://www.youtube.com/watch?v=xvFZjo5PgG0'
            });
            
            // Load active tickets from database
            try {
                const ticketCommand = this.commandHandler.getCommand('openticket');
                if (ticketCommand && ticketCommand.loadActiveTickets) {
                    await ticketCommand.loadActiveTickets();
                    Logger.success('Loaded active tickets from database');
                }
            } catch (error) {
                Logger.error('Failed to load active tickets', error);
            }
            
            // Start automatic member pull every 30 minutes (role sync runs after each member pull)
            this.startAutomaticMemberPull();
            
            // Start AI cleanup routine
            this.startAICleanup();

            // Wire the AI chat bot to the Discord client (for real-time activity
            // logging) and load the persisted active-provider selection.
            this.aiChat.attachClient(client);
            try {
                await initAISettings();
            } catch (aiSettingsError) {
                Logger.warning('AI settings init failed', aiSettingsError?.message);
            }
            
            // Start birthday checker
            startBirthdayChecker(client);
            
            // Initialize rosters on startup
            Logger.info('Initializing rosters on startup...');
            try {
                await updateAllRosters(client);
                Logger.success('Rosters initialized successfully');
            } catch (rosterError) {
                Logger.error('Failed to initialize rosters on startup', rosterError);
            }
            
            // Initialize week threads table + the single DB-driven watcher. The
            // watcher auto-opens the current week (from the season start_date),
            // creates threads for any materialized rows, reconciles closures, and
            // processes website delete actions. There is no separate hardcoded
            // auto-creator anymore (that caused duplicate threads).
            Logger.info('Initializing week thread system...');
            try {
                await initializeWeekThreadsTable();
                startPendingWeekThreadWatcher(client, 60 * 1000);
                Logger.success('Week thread system initialized');
            } catch (weekThreadError) {
                Logger.error('Failed to initialize week thread system', weekThreadError);
            }

            // Ticket website-sync: backfill transcripts + poll website close requests.
            try {
                startTicketSync(client, 20 * 1000);
            } catch (ticketSyncError) {
                Logger.error('Failed to start ticket sync', ticketSyncError);
            }

            // Stats report panels: keep the idle "Report Series" panel at the
            // bottom of each open week thread.
            try {
                startPanelReposter(client);
            } catch (panelError) {
                Logger.error('Failed to start report panel reposter', panelError);
            }

            // Hydrate team constants (roles/names/colors) from the database so
            // every command resolves roles from the website's data, refreshed
            // every few minutes.
            try {
                startTeamConstantsSync();
            } catch (syncError) {
                Logger.error('Failed to start team constants sync', syncError);
            }

            // Week-close sweep: when every thread of a week is closed (bot OR
            // website), post Game/Player of the Week and refresh power rankings.
            try {
                const { ensureAppConfig } = require('./utils/appConfig');
                const { checkClosedWeeks } = require('./stats/gameOfWeek');
                ensureAppConfig().then(() => checkClosedWeeks(client));
                setInterval(() => checkClosedWeeks(client), 5 * 60 * 1000);
            } catch (gowError) {
                Logger.error('Failed to start week-close sweep', gowError);
            }

            // Configurable ticket panels + the applications → Discord bridge.
            try {
                ticketSystem.startTicketPanelPoller(client);
                appBridge.startApplicationPoller(client);
            } catch (sysError) {
                Logger.error('Failed to start ticket/application systems', sysError);
            }

            // Award-role snapshots (admin-configured role IDs → player badges).
            try {
                const { startAwardSync } = require('./utils/awardSync');
                startAwardSync(client);
            } catch (awardError) {
                Logger.error('Failed to start award sync', awardError);
            }

            // MMR Updater outbox: post player pings / staff reports queued by the
            // standalone TRN scraper (only when the operator has armed sheet writes).
            try {
                const { startMmrOutboxPoller } = require('./stats/mmrOutbox');
                startMmrOutboxPoller(client);
            } catch (mmrError) {
                Logger.error('Failed to start MMR outbox poller', mmrError);
            }
        });

        this.client.on(Events.InteractionCreate, async (interaction) => {
            try {
                // Autocomplete interactions are not repliable, handle them separately
                if (interaction.isAutocomplete()) {
                    try {
                        const command = this.commandHandler.getCommand(interaction.commandName);
                        if (command && command.autocomplete) {
                            await command.autocomplete(interaction);
                        }
                    } catch (error) {
                        // Silently handle autocomplete errors (they spam the console)
                        if (error.code !== 10062 && error.code !== 'InteractionAlreadyReplied') {
                            Logger.error(`Error in autocomplete for ${interaction.commandName}`, error);
                        }
                    }
                    return;
                }

                // Check if interaction is still valid for other interaction types
                if (!interaction.isRepliable()) {
                    return; // Silently ignore non-repliable interactions
                }

                // Stats report flow — buttons, select menus, and the group-link
                // modal all use persistent `rs:` customIds. Route them first.
                if (typeof interaction.customId === 'string' && reportIds.isReportId(interaction.customId)) {
                    await reportRouter.route(interaction);
                    return;
                }

                // Configurable ticket system (`tk:` ids — panels, open flow, close controls).
                if (typeof interaction.customId === 'string' && ticketSystem.isTicketId(interaction.customId)) {
                    await ticketSystem.route(interaction);
                    return;
                }

                // Applications bridge (`ap:` ids — votes + accept/deny).
                if (typeof interaction.customId === 'string' && appBridge.isAppId(interaction.customId)) {
                    await appBridge.route(interaction);
                    return;
                }

                if (interaction.isCommand()) {
                    const command = this.commandHandler.getCommand(interaction.commandName);

                    if (!command) {
                        Logger.warning(`Unknown command attempted: ${interaction.commandName}`);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ 
                                content: '❌ Unknown command!', 
                                flags: 64 // MessageFlags.Ephemeral
                            });
                        }
                        return;
                    }

                    await command.execute(interaction);
                }
                else if (interaction.isModalSubmit()) {
                    // Handle modal submissions (for registration)
                    const registerCommand = this.commandHandler.getCommand('register');
                    if (registerCommand && registerCommand.handleModalSubmit) {
                        await registerCommand.handleModalSubmit(interaction);
                    }
                }
                else if (interaction.isStringSelectMenu()) {
                    // Handle select menu interactions (for platform selection)
                    const registerCommand = this.commandHandler.getCommand('register');
                    if (registerCommand && registerCommand.handleSelectMenu) {
                        await registerCommand.handleSelectMenu(interaction);
                    }
                }
                else if (interaction.isButton()) {
                    // Add debug logging for button interactions
                    Logger.info(`Button interaction received: ${interaction.customId} from ${interaction.user.tag}`);

                    // Registration panel "Register" button → starts the register flow.
                    if (interaction.customId === 'panel_register_start') {
                        const panelRegister = this.commandHandler.getCommand('panel-register');
                        if (panelRegister && panelRegister.handleButton) {
                            await panelRegister.handleButton(interaction);
                        }
                        return;
                    }

                    // Handle button interactions (for navigation) - only for register command buttons
                    if (interaction.customId.includes('registration') || 
                        interaction.customId.includes('main_account') ||
                        interaction.customId.includes('alt_account') ||
                        interaction.customId.includes('start_') ||
                        interaction.customId.includes('next_') ||
                        interaction.customId.includes('back_') ||
                        interaction.customId.includes('enter_') ||
                        interaction.customId.includes('add_') ||
                        interaction.customId.includes('remove_') ||
                        interaction.customId.includes('complete_') ||
                        interaction.customId.includes('cancel_')) {
                        
                        const registerCommand = this.commandHandler.getCommand('register');
                        if (registerCommand && registerCommand.handleButton) {
                            await registerCommand.handleButton(interaction);
                        }
                    }
                }
            } catch (error) {
                Logger.error(`Error handling interaction`, error);
                
                // More robust error handling
                try {
                    const errorMessage = 'There was an error while processing this interaction!';
                    
                    if (interaction.replied) {
                        await interaction.followUp({ 
                            content: errorMessage, 
                            flags: 64 // MessageFlags.Ephemeral
                        });
                    } else if (interaction.deferred) {
                        await interaction.editReply({ content: errorMessage });
                    } else {
                        await interaction.reply({ 
                            content: errorMessage, 
                            flags: 64 // MessageFlags.Ephemeral
                        });
                    }
                } catch (followupError) {
                    Logger.error('Failed to send error message to user', followupError);
                }
            }
        });

        // Handle message events for Blitz sandbagging response, clanker responses, and AI chat
        this.client.on(Events.MessageCreate, async (message) => {
            try {
                // Capture EVERY message (including bot messages) in tracked ticket
                // channels AND week-thread channels into their live transcript
                // mirrors. Runs before the bot-author early-return below so bot
                // replies appear in transcripts too.
                try {
                    const ticketCmd = this.commandHandler.getCommand('openticket');
                    if (ticketCmd && ticketCmd.captureTicketMessage) {
                        await ticketCmd.captureTicketMessage(message);
                    }
                    const weekCmd = this.commandHandler.getCommand('week-thread');
                    if (weekCmd && weekCmd.captureThreadMessage) {
                        await weekCmd.captureThreadMessage(message);
                    }
                } catch (capErr) {
                    // non-fatal
                }

                // Ignore messages from bots
                if (message.author.bot) return;

                // Ignore @everyone/@here pings to prevent spam responses
                if (message.mentions.everyone) return;

                // Never respond in DMs — server channels only
                if (!message.guild) return;

                // AI chat: respond only when the bot is directly mentioned.
                if (message.mentions.has(this.client.user)) {
                    Logger.info(`AI chat triggered by mention from ${message.author.tag} in ${message.guild?.name}`);

                    // Show typing indicator for a more natural feel
                    await message.channel.sendTyping();

                    // Strip the bot mention from the message text
                    const cleanedMessage = message.content
                        .replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '')
                        .trim();

                    const displayName = message.member?.displayName || message.author.username;

                    // Gather any images (uploads, embeds, Tenor/Giphy links) for vision
                    let imageUrls = [];
                    try {
                        imageUrls = await collectImageUrls(message);
                    } catch (imgErr) {
                        Logger.warning('Image collection failed:', imgErr.message);
                    }

                    if (imageUrls.length > 0) {
                        Logger.info(`Detected ${imageUrls.length} image(s) - running vision (Gemma → Mistral)`);
                        const visionResult = await this.aiChat.analyzeImage(
                            imageUrls[0],
                            cleanedMessage || "What's in this image?",
                            displayName
                        );

                        if (visionResult) {
                            this.aiChat.updateConversationHistory(
                                message.author.id,
                                cleanedMessage || "What's in this image?",
                                visionResult.response,
                                displayName,
                                visionResult.context
                            );
                            setTimeout(async () => {
                                await this.sendAIReply(message, visionResult.response);
                            }, 500 + Math.random() * 1200);
                            return;
                        }
                        // Vision failed on every provider → fall through to a normal
                        // text reply so the user still gets an answer.
                    }

                    // If an image was attached but vision failed everywhere, tell the
                    // model so it can acknowledge that honestly instead of ignoring it.
                    const userPrompt = imageUrls.length > 0
                        ? `${cleanedMessage || 'I shared an image.'}\n\n[Note: an image/GIF was attached but it could not be analyzed right now — let them know politely and offer to help another way.]`
                        : (cleanedMessage || 'Hello!');

                    const aiResponse = await this.aiChat.generateAIResponse(
                        message.author.id,
                        userPrompt,
                        displayName,
                        message.guild?.name
                    );

                    setTimeout(async () => {
                        await this.sendAIReply(message, aiResponse);
                    }, 500 + Math.random() * 1200);
                    return;
                }
            } catch (error) {
                Logger.error('Error handling message events', error);
            }
        });

        // Handle message reaction add for transaction approvals
        this.client.on(Events.MessageReactionAdd, async (reaction, user) => {
            try {
                // When a reaction is added to a message
                if (reaction.partial) {
                    try {
                        await reaction.fetch();
                    } catch (error) {
                        Logger.error('Failed to fetch partial reaction', error);
                        return;
                    }
                }

                // Check if it's a transaction message
                const signCommand = this.commandHandler.getCommand('sign');
                if (signCommand && signCommand.handleReaction) {
                    await signCommand.handleReaction(reaction, user, this.client);
                }

                const adminSignCommand = this.commandHandler.getCommand('adminsign');
                if (adminSignCommand && adminSignCommand.handleReaction) {
                    await adminSignCommand.handleReaction(reaction, user, this.client);
                }

                const dropCommand = this.commandHandler.getCommand('drop');
                if (dropCommand && dropCommand.handleReaction) {
                    await dropCommand.handleReaction(reaction, user, this.client);
                }

                const irCommand = this.commandHandler.getCommand('ir');
                if (irCommand && irCommand.handleReaction) {
                    await irCommand.handleReaction(reaction, user, this.client);
                }

                const captainCommand = this.commandHandler.getCommand('captain');
                if (captainCommand && captainCommand.handleReaction) {
                    await captainCommand.handleReaction(reaction, user, this.client);
                }

                const tradeCommand = this.commandHandler.getCommand('trade');
                if (tradeCommand && tradeCommand.handleReaction) {
                    await tradeCommand.handleReaction(reaction, user, this.client);
                }

                const esubCommand = this.commandHandler.getCommand('esub');
                if (esubCommand && esubCommand.handleReaction) {
                    await esubCommand.handleReaction(reaction, user, this.client);
                }

                const adminEsubCommand = this.commandHandler.getCommand('adminesub');
                if (adminEsubCommand && adminEsubCommand.handleReaction) {
                    await adminEsubCommand.handleReaction(reaction, user, this.client);
                }

                const signAsNPCaptainCommand = this.commandHandler.getCommand('sign-as-np-captain');
                if (signAsNPCaptainCommand && signAsNPCaptainCommand.handleReaction) {
                    await signAsNPCaptainCommand.handleReaction(reaction, user, this.client);
                }

                const massDropCommand = this.commandHandler.getCommand('massdrop');
                if (massDropCommand && massDropCommand.handleReaction) {
                    await massDropCommand.handleReaction(reaction, user, this.client);
                }
            } catch (error) {
                Logger.error('Error handling reaction add', error);
            }
        });

        this.client.on(Events.Error, (error) => {
            Logger.error('Discord client error', error);
            this.errorCount++;
            this.lastError = error;
        });

        this.client.on(Events.Warn, (warning) => {
            Logger.warning(`Discord client warning: ${warning}`);
        });

        this.client.on(Events.Disconnect, () => {
            Logger.warning('Bot disconnected from Discord');
        });

        this.client.on(Events.Reconnecting, () => {
            Logger.info('Bot reconnecting to Discord...');
        });

        this.client.on(Events.Resume, () => {
            Logger.info('Bot resumed connection to Discord');
        });

        // Graceful shutdown handlers
        process.on('SIGINT', () => {
            Logger.info('Received SIGINT, shutting down gracefully...');
            this.shutdown();
        });

        process.on('SIGTERM', () => {
            Logger.info('Received SIGTERM, shutting down gracefully...');
            this.shutdown();
        });

        process.on('unhandledRejection', (error) => {
            Logger.error('Unhandled promise rejection:', error);
            this.errorCount++;
            this.lastError = error;
        });

        process.on('uncaughtException', (error) => {
            Logger.error('Uncaught exception:', error);
            this.errorCount++;
            this.lastError = error;
            this.shutdown();
        });
    }

    // Helper function to sanitize messages and prevent ALL pings
    sanitizeResponse(response) {
        if (typeof response !== 'string') return response;
        
        let sanitized = response
            // Prevent @everyone/@here pings
            .replace(/@everyone/gi, '@\u200beveryone')
            .replace(/@here/gi, '@\u200bhere')
            // Prevent any @ mentions by adding zero-width space after @
            .replace(/@(?![\u200b])/g, '@\u200b')
            // Double-check specific patterns
            .replace(/<@[!&]?\d+>/g, (match) => match.replace('@', '@\u200b'));
        
        // Ensure Discord 2000 character limit compliance
        if (sanitized.length > 2000) {
            Logger.warning(`Response truncated from ${sanitized.length} to 2000 characters`);
            sanitized = sanitized.substring(0, 1985) + '\n...[truncated]';
        }
        
        return sanitized;
    }

    // Send an AI reply with all pinging disabled. allowedMentions { parse: [] }
    // is the real guarantee: even if the text contains <@id>/@everyone, Discord
    // renders the name but notifies nobody (the "special box" that isn't a ping).
    // sanitizeResponse stays as a second, text-level safety net.
    async sendAIReply(message, text) {
        const content = this.sanitizeResponse(text);
        try {
            await message.reply({ content, allowedMentions: { parse: [] } });
        } catch (err) {
            Logger.warning('Failed to send AI reply:', err.message);
        }
    }

    startAutomaticMemberPull() {
        // Clear any existing interval
        if (this.memberPullInterval) {
            clearInterval(this.memberPullInterval);
        }

        // Set up automatic member pull every 30 minutes followed by role sync
        this.memberPullInterval = setInterval(async () => {
            try {
                Logger.info('Running scheduled member pull...');
                await performMemberPull(this.client);
                Logger.success('Member pull completed, starting role sync...');
                
                // Run role sync after member pull completes
                await performRoleSync(this.client);
            } catch (error) {
                Logger.error('Scheduled member pull or role sync failed', error);
            }
        }, 30 * 60 * 1000); // 30 minutes

        Logger.info('Automatic member pull and role sync scheduled to run every 30 minutes');
        
        // Run initial member pull and role sync after 1 minute to allow bot to fully initialize
        setTimeout(async () => {
            try {
                Logger.info('Running initial member pull...');
                await performMemberPull(this.client);
                Logger.success('Initial member pull completed, starting role sync...');
                
                // Run role sync after initial member pull completes
                await performRoleSync(this.client);
            } catch (error) {
                Logger.error('Initial member pull or role sync failed', error);
            }
        }, 60 * 1000); // 1 minute delay
    }

    startAICleanup() {
        // Clean up AI conversation history every hour
        this.aiCleanupInterval = setInterval(() => {
            try {
                this.aiChat.cleanup();
                Logger.info('AI conversation history cleaned up');
            } catch (error) {
                Logger.error('AI cleanup failed', error);
            }
        }, 60 * 60 * 1000); // 1 hour

        Logger.info('AI cleanup routine started');
    }

    async expireAllTransactions() {
        Logger.info('Expiring all pending transactions...');
        const transactionCommands = [
            'sign', 
            'adminsign', 
            'drop', 
            'ir', 
            'captaincontrol', 
            'trade', 
            'esub', 
            'adminesub', 
            'nonplayingsign'
        ];

        let expiredCount = 0;
        for (const commandName of transactionCommands) {
            try {
                const command = this.commandHandler.getCommand(commandName);
                if (command && typeof command.expireAllTransactions === 'function') {
                    const count = await command.expireAllTransactions(this.client);
                    expiredCount += count || 0;
                    Logger.info(`Expired ${count || 0} transactions for ${commandName}`);
                }
            } catch (error) {
                Logger.error(`Failed to expire transactions for ${commandName}`, error);
            }
        }

        Logger.success(`Expired ${expiredCount} total pending transactions`);
        return expiredCount;
    }

    async shutdown() {
        Logger.info('Shutting down bot...');
        
        // Expire all pending transactions before shutdown
        try {
            await this.expireAllTransactions();
        } catch (error) {
            Logger.error('Failed to expire transactions during shutdown', error);
        }
        
        // Clear the member pull interval
        if (this.memberPullInterval) {
            clearInterval(this.memberPullInterval);
            Logger.info('Member pull interval cleared');
        }
        
        // Clear the AI cleanup interval
        if (this.aiCleanupInterval) {
            clearInterval(this.aiCleanupInterval);
            Logger.info('AI cleanup interval cleared');
        }
        
        if (this.healthServer) {
            Logger.info('Closing health server...');
            this.healthServer.close();
        }
        
        if (this.client) {
            Logger.info('Destroying Discord client...');
            await this.client.destroy();
        }
        
        Logger.success('Bot shut down successfully');
        process.exit(0);
    }

    getClient() {
        return this.client;
    }

    isClientReady() {
        return this.isReady;
    }

    getStats() {
        return {
            uptime: Date.now() - this.startTime,
            errorCount: this.errorCount,
            lastError: this.lastError,
            isReady: this.isReady,
            guildCount: this.client?.guilds?.cache?.size || 0
        };
    }
}

// Only auto-start if not running in Cloudflare Workers
if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    const bot = new BelugaLeagueBot();
    bot.initialize().catch(error => {
        Logger.error('Failed to start bot', error);
        process.exit(1);
    });
    module.exports = bot;
} else {
    // Export class for other environments
    module.exports = { BelugaLeagueBot };
}