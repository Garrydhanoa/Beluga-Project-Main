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
const higgenLog = require('./utils/higgenLog');

class BelugaLeagueBot {
    constructor() {
        this.client = new Client({ 
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMembers,  // Required for member fetching
                GatewayIntentBits.MessageContent, // Required for reading message content
                GatewayIntentBits.GuildPresences,  // Required for tracking presence updates
                GatewayIntentBits.GuildMessageReactions,  // Required for reaction events
                GatewayIntentBits.DirectMessages  // Required for the DM Center inbox
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

            // Keep the audit log inside its 30-day retention window
            this.startAuditLogPrune();

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

            // DM Center: deliver blasts queued from the website admin panel.
            // Fires on a Postgres NOTIFY (near-instant) with a poll fallback.
            try {
                const { startDmSender } = require('./dm/dmSender');
                startDmSender(client);
            } catch (dmError) {
                Logger.error('Failed to start DM sender', dmError);
            }

            // DM inbox: deliver staff replies typed on the website (2s drain).
            try {
                const { startDmInbox } = require('./dm/dmInbox');
                startDmInbox(client);
            } catch (dmInboxError) {
                Logger.error('Failed to start DM inbox', dmInboxError);
            }

            // Director-gated season lifecycle (Start New Season / Delete Season):
            // post approval embeds for website-queued requests, and collect the 3
            // director ✅ reactions that trigger the archive+new-season / delete.
            try {
                const { startSeasonActionsPoller } = require('./stats/seasonActionsPoller');
                const { registerSeasonApprovalHandlers } = require('./stats/seasonApprovals');
                startSeasonActionsPoller(client);
                registerSeasonApprovalHandlers(client);
            } catch (seasonError) {
                Logger.error('Failed to start season actions poller/approvals', seasonError);
            }
        });

        this.client.on(Events.InteractionCreate, async (interaction) => {
            // Autocomplete interactions are not repliable, handle them separately.
            // Deliberately NOT audited: it fires on every keystroke and would bury
            // the log in thousands of useless rows.
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

            // AUDIT: describe the interaction the moment it lands, before any
            // dispatch can throw or the token can expire, so the record survives
            // whatever happens next. The `finally` below always writes the row —
            // including on the early `return`s in the routing branches.
            const auditStartedAt = Date.now();
            let audit = null;
            try { audit = higgenLog.describeInteraction(interaction); } catch { /* never block a user */ }
            let auditOutcome = 'success';
            let auditNote = null;
            // The sub-routers swallow their own errors, so ask them what really
            // happened instead of assuming the dispatch succeeded.
            const drainAudit = (handledBy) => {
                auditNote = handledBy;
                const reported = higgenLog.takeSubRouterOutcome(interaction.id);
                if (reported) {
                    auditOutcome = reported.outcome;
                    if (reported.note) auditNote = `${handledBy} ${reported.note}`;
                }
            };

            try {
                // Stats report flow — buttons, select menus, and the group-link
                // modal all use persistent `rs:` customIds. Route them first.
                if (typeof interaction.customId === 'string' && reportIds.isReportId(interaction.customId)) {
                    await reportRouter.route(interaction);
                    drainAudit('Handled by the stats series-report flow.');
                    return;
                }

                // Configurable ticket system (`tk:` ids — panels, open flow, close controls).
                if (typeof interaction.customId === 'string' && ticketSystem.isTicketId(interaction.customId)) {
                    await ticketSystem.route(interaction);
                    drainAudit('Handled by the ticket system.');
                    return;
                }

                // Applications bridge (`ap:` ids — votes + accept/deny).
                if (typeof interaction.customId === 'string' && appBridge.isAppId(interaction.customId)) {
                    await appBridge.route(interaction);
                    drainAudit('Handled by the applications voting panel.');
                    return;
                }

                // Week-thread guarded delete (`wt:` ids — force-delete confirm).
                if (typeof interaction.customId === 'string' && interaction.customId.startsWith('wt:')) {
                    const weekCmd = this.commandHandler.getCommand('week-thread');
                    if (weekCmd?.handleButton && await weekCmd.handleButton(interaction)) {
                        auditNote = 'Handled by the week-thread force-delete confirmation.';
                        return;
                    }
                }

                if (interaction.isCommand()) {
                    const command = this.commandHandler.getCommand(interaction.commandName);

                    if (!command) {
                        Logger.warning(`Unknown command attempted: ${interaction.commandName}`);
                        auditOutcome = 'unhandled';
                        auditNote = 'The bot has no command by that name — it may have been renamed or removed without re-registering.';
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
                        auditNote = 'Handled by the registration flow.';
                    } else {
                        auditOutcome = 'unhandled';
                    }
                }
                else if (interaction.isStringSelectMenu()) {
                    // Handle select menu interactions (for platform selection)
                    const registerCommand = this.commandHandler.getCommand('register');
                    if (registerCommand && registerCommand.handleSelectMenu) {
                        await registerCommand.handleSelectMenu(interaction);
                        auditNote = 'Handled by the registration flow.';
                    } else {
                        auditOutcome = 'unhandled';
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
                            auditNote = 'Opened the registration flow from the register panel.';
                        } else {
                            auditOutcome = 'unhandled';
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
                            auditNote = 'Handled by the registration flow.';
                        } else {
                            auditOutcome = 'unhandled';
                        }
                    } else {
                        // Nothing in the bot claims this customId — the member sees
                        // "This interaction failed" and previously nothing was logged.
                        auditOutcome = 'unhandled';
                    }
                }
            } catch (error) {
                auditOutcome = 'failed';
                Logger.error(`Error handling interaction`, error);
                higgenLog.logFailure({ eventType: 'interaction_error', desc: audit, error });

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
            } finally {
                // Always record the interaction — `finally` also runs for the early
                // `return`s in the routing branches above, so nothing slips through.
                higgenLog.logInteraction(audit, {
                    outcome: auditOutcome,
                    durationMs: Date.now() - auditStartedAt,
                    note: auditNote,
                });
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

                // DMs go to the DM Center inbox instead of the in-server AI path.
                // The bot stays silent unless staff enabled AI for that person.
                if (!message.guild) {
                    try {
                        const { captureIncomingDm } = require('./dm/dmInbox');
                        await captureIncomingDm(message, { aiChat: this.aiChat });
                    } catch (dmErr) {
                        Logger.error('DM inbox capture failed', dmErr);
                    }
                    return;
                }

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

                // AUDIT: the entire transaction workflow (sign / adminsign / drop /
                // ir / captain / trade / esub / massdrop) and the director-gated
                // season actions are approved by REACTING, not by clicking — so
                // without this the most sensitive actions in the league would leave
                // no trace. Scoped to reactions on the BOT's own messages (that's
                // what every approval embed is) so casual emoji in general chat
                // don't flood the log, and skipping the bot's own seed reactions.
                try {
                    if (!user?.bot) {
                        if (reaction.message?.partial) await reaction.message.fetch().catch(() => {});
                        if (reaction.message?.author?.id === this.client.user?.id) {
                            const member = reaction.message.guild
                                ? await reaction.message.guild.members.fetch(user.id).catch(() => null)
                                : null;
                            higgenLog.logReaction({
                                user,
                                member,
                                emoji: reaction.emoji?.name || reaction.emoji?.toString() || '?',
                                message: reaction.message,
                                guild: reaction.message.guild,
                            });
                        }
                    }
                } catch { /* auditing must never break an approval */ }

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

        // A member joined (or REJOINED) the server → queue a single MMR pull so they
        // update immediately instead of waiting for the next bulk run (which skips
        // players not in the server). Non-fatal + fire-and-forget; no-ops if they're
        // not in the SalSheet.
        this.client.on(Events.GuildMemberAdd, async (member) => {
            try {
                if (member.user?.bot) return;
                const { enqueueRejoinUpdate } = require('./stats/registerQueue');
                await enqueueRejoinUpdate(member.id);
            } catch (error) {
                Logger.error('guildMemberAdd rejoin MMR enqueue failed', error);
            }
            // Re-grant any award roles this member held when they last left. Kept
            // separate from the MMR enqueue so a failure in one doesn't skip the
            // other. Non-fatal + best-effort; no-ops if nothing is remembered.
            try {
                if (member.user?.bot) return;
                const { restoreAwardRoles } = require('./utils/awardSync');
                await restoreAwardRoles(member);
            } catch (error) {
                Logger.error('guildMemberAdd award-role restore failed', error);
            }
            // Greet them: welcome message + welcome card in the welcome channel AND
            // as a DM (mirrored into the DM Center). Fires on every join, rejoins
            // included. Own try/catch so it can't skip the two above.
            try {
                if (member.user?.bot) return;
                const { sendJoinWelcome } = require('./utils/welcome');
                await sendJoinWelcome(member);
            } catch (error) {
                Logger.error('guildMemberAdd welcome failed', error);
            }
        });

        // A member's roles changed while they are IN the guild → keep award-role
        // memory in sync (gain = remember, staff removal = forget). This is the
        // only place memory is pruned; leaving the server never forgets.
        this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
            try {
                if ((newMember || oldMember)?.user?.bot) return;
                const { syncMemberAwardMemory } = require('./utils/awardSync');
                await syncMemberAwardMemory(oldMember, newMember);
            } catch (error) {
                Logger.error('guildMemberUpdate award-memory sync failed', error);
            }
            // Need Rank just landed on them (they verified but aren't in the sheet
            // yet — roleSync grants it) → DM the "go register" follow-up. This event
            // is noisy, so bail on the cheap in-memory role check before any DB work;
            // welcome_log then keeps it to once ever per person.
            try {
                if ((newMember || oldMember)?.user?.bot) return;
                const newRoles = newMember?.roles?.cache;
                if (!newRoles) return;
                const { ROLES } = require('./constants/roles');
                const gained = newRoles.has(ROLES.NEED_RANK) && !oldMember?.roles?.cache?.has(ROLES.NEED_RANK);
                if (!gained) return;
                const { sendNeedRankDm } = require('./utils/welcome');
                await sendNeedRankDm(newMember);
            } catch (error) {
                Logger.error('guildMemberUpdate need-rank welcome DM failed', error);
            }
        });

        // A member left the server. Intentionally a NO-OP for award-role memory:
        // memory persists precisely so their roles can be restored on rejoin.
        this.client.on(Events.GuildMemberRemove, (member) => {
            try {
                if (member?.user?.bot) return;
                Logger.info?.(`guildMemberRemove: ${member?.user?.tag || member?.id} left — award-role memory preserved for rejoin`);
            } catch (error) {
                Logger.error('guildMemberRemove handler failed', error);
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

    /**
     * Audit-log retention. The log keeps 30 days and prunes itself — the bot is the
     * always-on service and owns the DB, so it does the sweeping rather than relying
     * on someone opening the admin page. Runs a minute after boot, then daily.
     */
    startAuditLogPrune() {
        const sweep = async () => {
            try {
                const removed = await higgenLog.prune();
                if (removed) Logger.info(`Audit log pruned: removed ${removed} entries older than ${higgenLog.RETENTION_DAYS} days`);
            } catch (error) {
                Logger.error('Audit log prune failed', error);
            }
        };
        setTimeout(sweep, 60 * 1000).unref?.();
        this.auditPruneInterval = setInterval(sweep, 24 * 60 * 60 * 1000);
        Logger.info('Audit log retention sweep started (30-day window)');
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

        // Clear the audit retention sweep and drain any buffered log rows, so a
        // restart (or a crash-triggered shutdown) doesn't lose the last few seconds
        // of the record — which is exactly when the interesting entries happen.
        if (this.auditPruneInterval) {
            clearInterval(this.auditPruneInterval);
        }
        try {
            await higgenLog.flush();
        } catch (error) {
            Logger.error('Failed to flush the audit log on shutdown', error);
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