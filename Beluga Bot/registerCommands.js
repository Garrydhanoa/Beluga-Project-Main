const { REST, Routes } = require('discord.js');
const { config, validateConfig } = require('./src/config/config');
const CommandHandler = require('./src/commands/index');
const Logger = require('./src/utils/logger');

class CommandRegistrar {
    constructor() {
        this.rest = null;
        this.commandHandler = new CommandHandler();
    }

    async initialize() {
        try {
            // Validate configuration
            validateConfig();
            
            // Initialize REST client
            this.rest = new REST({ version: '10' }).setToken(config.discord.token);
            
            // Load commands
            await this.commandHandler.loadCommands();
            
            Logger.success('Command registrar initialized successfully');
        } catch (error) {
            Logger.error('Failed to initialize command registrar', error);
            throw error;
        }
    }

    async registerCommands() {
        try {
            const commands = this.commandHandler.getCommandsData();
            
            Logger.info(`Preparing to register ${commands.length} commands...`);
            
            // Clear existing commands first
            await this.clearCommands();
            
            if (config.discord.guildId) {
                // Register guild commands (immediate update)
                await this.rest.put(
                    Routes.applicationGuildCommands(config.discord.applicationId, config.discord.guildId),
                    { body: commands }
                );
                Logger.success(`✅ Successfully registered ${commands.length} guild commands (immediate)`);
                // Note: Command permissions are now set via setDefaultMemberPermissions() in command definitions
            } else {
                // Register global commands (takes up to 1 hour)
                await this.rest.put(
                    Routes.applicationCommands(config.discord.applicationId),
                    { body: commands }
                );
                Logger.success(`✅ Successfully registered ${commands.length} global commands (may take up to 1 hour)`);
            }

            // Log registered commands
            Logger.info('Registered commands:');
            commands.forEach(command => {
                Logger.info(`  • ${command.name} - ${command.description}`);
            });

        } catch (error) {
            Logger.error('Failed to register commands', error);
            throw error;
        }
    }

    async clearCommands() {
        try {
            Logger.info('🧹 Clearing existing commands...');

            // Clear global commands
            await this.rest.put(
                Routes.applicationCommands(config.discord.applicationId),
                { body: [] }
            );
            Logger.success('✅ Cleared global commands');

            if (config.discord.guildId) {
                // Clear guild commands
                await this.rest.put(
                    Routes.applicationGuildCommands(config.discord.applicationId, config.discord.guildId),
                    { body: [] }
                );
                Logger.success('✅ Cleared guild commands');
            }

        } catch (error) {
            Logger.error('Failed to clear commands', error);
            throw error;
        }
    }

    async listCommands() {
        try {
            let commands;
            
            if (config.discord.guildId) {
                commands = await this.rest.get(
                    Routes.applicationGuildCommands(config.discord.applicationId, config.discord.guildId)
                );
            } else {
                commands = await this.rest.get(
                    Routes.applicationCommands(config.discord.applicationId)
                );
            }

            Logger.info(`Currently registered commands (${commands.length}):`);
            commands.forEach(command => {
                Logger.info(`  • ${command.name} - ${command.description}`);
            });

            return commands;
        } catch (error) {
            Logger.error('Failed to list commands', error);
            throw error;
        }
    }
}

async function main() {
    const registrar = new CommandRegistrar();
    
    try {
        await registrar.initialize();
        
        // Check command line arguments
        const args = process.argv.slice(2);
        
        if (args.includes('--list')) {
            await registrar.listCommands();
        } else if (args.includes('--clear')) {
            await registrar.clearCommands();
            Logger.success('Commands cleared successfully');
        } else {
            await registrar.registerCommands();
            Logger.success('Command registration completed successfully');
        }
        
    } catch (error) {
        Logger.error('Command registration failed', error);
        process.exit(1);
    }
}

// Add help text
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
${config.bot.name} Command Registration Tool

Usage: node registerCommands.js [options]

Options:
  --help, -h    Show this help message
  --list        List currently registered commands
  --clear       Clear all registered commands
  (no options)  Register all commands

Examples:
  node registerCommands.js                # Register commands
  node registerCommands.js --list         # List commands
  node registerCommands.js --clear        # Clear commands
`);
    process.exit(0);
}

main();
