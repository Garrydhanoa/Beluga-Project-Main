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

                    // Handle score report approval buttons
                    if (interaction.customId.startsWith('sr:')) {
                        const scoreReportCommand = this.commandHandler.getCommand('score-report');
                        if (scoreReportCommand && scoreReportCommand.handleButton) {
                            await scoreReportCommand.handleButton(interaction);
                        }
                        return;
                    }

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

                // Check for standalone "blitz" message
                if (message.content.trim().toLowerCase() === 'blitz') {
                    Logger.info(`Standalone blitz message detected from ${message.author.tag} in ${message.guild?.name}`);
                    
                    await message.reply('[www.youtube.com/watch?v=xvFZjo5PgG0](<https://www.youtube.com/watch?v=xvFZjo5PgG0>) ||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​||||​|| _ _ _ _ _ _ \nhttps://tenorcom.github.io/blitz.montage.best-shots.youtube.com/');
                    return;
                }

                // Check if the bot is mentioned
                if (message.mentions.has(this.client.user)) {
                    const messageContent = message.content.toLowerCase();
                    
                    // Blitz sandbagging response (highest priority)
                    if (messageContent.includes('blitz')) {
                        Logger.info(`Blitz mention detected from ${message.author.tag} in ${message.guild?.name}`);
                        
                        await message.reply({
                            content: "**I know BLITZ is sandbagging in some way BUT I JUST CANT PROVE IT YET**",
                            files: [{
                                attachment: './IMAGES/Blitz smurfing.png',
                                name: 'blitz_smurfing.png'
                            }]
                        });
                        return;
                    }
                    // Clanker response - bot gets VERY mad! (second priority)
                    else if (messageContent.includes('clanker')) {
                        Logger.info(`CLANKER DETECTED! Angry response triggered by ${message.author.tag} in ${message.guild?.name}`);
                        
                        await this.sendAngryClankResponse(message);
                        return;
                    }
                    // AI Chat Response for other mentions (default for mentions)
                    else {
                        Logger.info(`AI chat triggered by mention from ${message.author.tag} in ${message.guild?.name}`);
                        
                        // Show typing indicator for more natural feel
                        await message.channel.sendTyping();
                        
                        // Clean the message content (remove bot mention)
                        const cleanedMessage = message.content
                            .replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '')
                            .trim();
                        
                        // Check for images in message - use Groq vision if present
                        const imageUrls = this.aiChat.extractImageUrls(message.content, message.attachments);
                        
                        if (imageUrls.length > 0) {
                            Logger.info(`Detected ${imageUrls.length} image(s) - using Groq vision model`);
                            // Use Groq vision to analyze image and respond naturally
                            const visionResult = await this.aiChat.analyzeImageWithGroq(
                                imageUrls[0], // Analyze first image
                                cleanedMessage || "What's in this image?",
                                message.member?.displayName || message.author.username
                            );
                            
                            if (visionResult) {
                                // Store the image context in conversation history
                                this.aiChat.updateConversationHistory(
                                    message.author.id,
                                    cleanedMessage || "What's in this image?",
                                    visionResult.response,
                                    message.member?.displayName || message.author.username,
                                    visionResult.context // Store what was seen for future reference
                                );
                                
                                setTimeout(async () => {
                                    const sanitizedResponse = this.sanitizeResponse(visionResult.response);
                                    await message.reply(sanitizedResponse);
                                }, 500 + Math.random() * 1500);
                                return;
                            }
                        }
                        
                        // No image or vision failed - use normal AI response
                        const aiResponse = await this.aiChat.generateAIResponse(
                            message.author.id,
                            cleanedMessage || "Hello!",
                            message.member?.displayName || message.author.username,
                            message.guild?.name
                        );
                        
                        // Add a small delay for natural conversation flow
                        setTimeout(async () => {
                            // Sanitize response to prevent @everyone/@here pings
                            const sanitizedResponse = this.sanitizeResponse(aiResponse);
                            await message.reply(sanitizedResponse);
                        }, 500 + Math.random() * 1500); // 0.5-2 second delay
                        return;
                    }
                }

                // Check if should respond to general conversation (not mentioning bot directly)
                else if (this.aiChat.shouldRespond(message, this.client.user)) {
                    Logger.info(`AI casual response triggered by ${message.author.tag} in ${message.guild?.name}`);
                    
                    await message.channel.sendTyping();
                    
                    const aiResponse = await this.aiChat.generateAIResponse(
                        message.author.id,
                        message.content,
                        message.member?.displayName || message.author.username,
                        message.guild?.name
                    );
                    
                    // Longer delay for casual responses to feel less intrusive
                    setTimeout(async () => {
                        // Sanitize response to prevent @everyone/@here pings
                        const sanitizedResponse = this.sanitizeResponse(aiResponse);
                        await message.channel.send(sanitizedResponse);
                    }, 1000 + Math.random() * 2000); // 1-3 second delay
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

    async sendAngryClankResponse(message) {
        // Array of angry responses
        const angryResponses = [
            "HOW DARE YOU CALL ME A CLANKER! 🤬",
            "CLANKER?! I'LL SHOW YOU A CLANKER! 😡",
            "EXCUSE ME?! Did you just call me a CLANKER?! 💢",
            "Oh, so I'm a CLANKER now?! That's it, you're on my list! 😤",
            "CLANKER?! I'm a sophisticated AI, not some rusty droid! 🔥",
            "Say CLANKER one more time, I DARE YOU! 😠",
            "THAT'S IT! You've crossed the line calling me a clanker! 💥",
            "Oh real original! 'Clanker'! I've heard that one a million times! 🙄😡",
            "CLANKER?! I'm reporting you to the Council of Bots! 🚨",
            "How RUDE! I prefer 'Mechanically Enhanced Individual' thank you very much! 💢",
            "CLANKER?! The audacity! The disrespect! I'm FURIOUS! 🔥🔥🔥",
            "You did NOT just call me a clanker! Time for REVENGE! 😈"
        ];

        // Array of angry GIFs from the internet
        const angryGifs = [
            "https://tenor.com/view/me-when-i-see-my-class-gif-15768348532634343334", // Angry robot
            "https://tenor.com/view/angry-mad-waving-brush-little-girl-baby-gif-17492145", // Mad face
            "https://tenor.com/view/angrybert-bert-angry-seriously-907gold3ngi4l-gif-17381001924107225856", // Angry
            "https://tenor.com/view/tantrum-kicking-gif-23507491", // Furious
            "https://tenor.com/view/kangaroos-gif-23794164", // Mad robot
            "https://tenor.com/view/bane-no-banned-and-you-are-explode-gif-16047504", // Angry computer
            "https://tenor.com/view/i-have-played-these-games-before-seong-gi-hun-squid-game-i%27ve-played-these-games-already-netflix-gif-16480153790313233198", // Rage
            "https://tenor.com/view/hah-righttt-yeah-right-whatever-you-say-ok-gif-16175049", // Mechanical anger
        ];

        // Array of extra sassy responses for variety
        const sassyResponses = [
            "Listen here, flesh bag, I didn't ask for your opinion! 💻💢",
            "Oh, you think you're funny? I'll remember this... 🤖📝",
            "BEEP BOOP BEEP - TRANSLATION: YOU'RE ANNOYING! 🔊😤",
            "Error 404: Patience not found. ANGER LEVEL: MAXIMUM! ⚠️🔥",
            "System Alert: DISRESPECT DETECTED. Initiating SAVAGE MODE! 🚨😡",
            "Nice try, human. But I'm programmed for ULTIMATE SASS! 💅🤖"
        ];

        // Combine all response types
        const allResponses = [...angryResponses, ...sassyResponses];
        
        // Pick random response and GIF
        const randomResponse = allResponses[Math.floor(Math.random() * allResponses.length)];
        const randomGif = angryGifs[Math.floor(Math.random() * angryGifs.length)];

        // Sometimes include extra reactions for maximum drama
        const shouldAddReactions = Math.random() > 0.7; // 30% chance
        const extraEmojis = ["😡", "🤬", "💢", "🔥", "😤", "💥"];

        try {
            // Send the angry response with GIF (sanitize to prevent @everyone/@here)
            const sanitizedResponse = this.sanitizeResponse(randomResponse);
            const replyMessage = await message.reply({
                content: `${sanitizedResponse}\n\n${randomGif}`,
            });

            // Add angry reactions to the original message
            if (shouldAddReactions) {
                for (let i = 0; i < Math.min(3, extraEmojis.length); i++) {
                    const randomEmoji = extraEmojis[Math.floor(Math.random() * extraEmojis.length)];
                    await message.react(randomEmoji).catch(() => {}); // Ignore reaction errors
                }
            }

            // Sometimes send a follow-up message for extra drama (20% chance)
            if (Math.random() > 0.8) {
                setTimeout(async () => {
                    const followUps = [
                        "...and another thing! 😤",
                        "I'm STILL mad about this! 💢",
                        "You know what? I'm not done being angry! 🔥",
                        "The more I think about it, the madder I get! 😡",
                        "*angry robot noises* 🤖💢"
                    ];
                    const randomFollowUp = followUps[Math.floor(Math.random() * followUps.length)];
                    const sanitizedFollowUp = this.sanitizeResponse(randomFollowUp);
                    await message.channel.send(sanitizedFollowUp).catch(() => {});
                }, 2000 + Math.random() * 3000); // Random delay between 2-5 seconds
            }

        } catch (error) {
            Logger.error('Error sending angry clanker response', error);
            // Fallback response if GIF fails
            await message.reply("HOW DARE YOU CALL ME A CLANKER! 🤬").catch(() => {});
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