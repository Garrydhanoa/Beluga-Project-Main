const { REST, Routes } = require('discord.js');
const { config, validateConfig } = require('./src/config/config');
const CommandHandler = require('./src/commands/index');
const Logger = require('./src/utils/logger');

/**
 * Normalize a command JSON object into a stable, comparable shape so we can
 * detect whether a Discord-side command actually differs from our local
 * definition. Discord adds extra fields on remote (id, application_id, etc.)
 * and applies defaults to omitted fields, so a naive deep-equal is too noisy.
 */
function normalizeCommand(cmd) {
    if (!cmd) return null;
    const opts = Array.isArray(cmd.options) ? cmd.options.map(normalizeOption) : [];
    return {
        name: cmd.name,
        description: cmd.description || '',
        type: cmd.type ?? 1,
        default_member_permissions: cmd.default_member_permissions == null ? null : String(cmd.default_member_permissions),
        dm_permission: cmd.dm_permission ?? true,
        nsfw: cmd.nsfw ?? false,
        options: opts,
    };
}

function normalizeOption(opt) {
    return {
        name: opt.name,
        description: opt.description || '',
        type: opt.type,
        required: !!opt.required,
        choices: Array.isArray(opt.choices)
            ? opt.choices.map((c) => ({ name: c.name, value: c.value }))
            : [],
        options: Array.isArray(opt.options) ? opt.options.map(normalizeOption) : [],
        min_value: opt.min_value ?? null,
        max_value: opt.max_value ?? null,
        min_length: opt.min_length ?? null,
        max_length: opt.max_length ?? null,
        autocomplete: !!opt.autocomplete,
        channel_types: Array.isArray(opt.channel_types) ? [...opt.channel_types].sort() : [],
    };
}

function commandsDiffer(local, remote) {
    return JSON.stringify(normalizeCommand(local)) !== JSON.stringify(normalizeCommand(remote));
}

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

    async registerCommands({ force = false } = {}) {
        try {
            const localCommands = this.commandHandler.getCommandsData();
            const localByName = new Map(localCommands.map((c) => [c.name, c]));

            const route = config.discord.guildId
                ? Routes.applicationGuildCommands(config.discord.applicationId, config.discord.guildId)
                : Routes.applicationCommands(config.discord.applicationId);

            if (force) {
                Logger.info(`--force passed: putting all ${localCommands.length} commands (overwrite)`);
                await this.rest.put(route, { body: localCommands });
                Logger.success(`✅ Force-registered ${localCommands.length} commands`);
                return;
            }

            // Diff-based: fetch what Discord currently has and compute add/update/delete sets.
            const remoteCommands = await this.rest.get(route);
            const remoteByName = new Map(remoteCommands.map((c) => [c.name, c]));

            const toAdd = [];
            const toUpdate = [];
            const toDelete = [];

            for (const local of localCommands) {
                const remote = remoteByName.get(local.name);
                if (!remote) {
                    toAdd.push(local);
                } else if (commandsDiffer(local, remote)) {
                    toUpdate.push({ id: remote.id, command: local });
                }
            }
            for (const remote of remoteCommands) {
                if (!localByName.has(remote.name)) {
                    toDelete.push(remote);
                }
            }

            Logger.info(`Diff summary: +${toAdd.length} new, ~${toUpdate.length} updated, -${toDelete.length} removed, ${remoteCommands.length - toDelete.length - toUpdate.length} unchanged`);

            for (const cmd of toAdd) {
                await this.rest.post(route, { body: cmd });
                Logger.success(`  + added /${cmd.name}`);
            }
            for (const { id, command } of toUpdate) {
                await this.rest.patch(`${route}/${id}`, { body: command });
                Logger.success(`  ~ updated /${command.name}`);
            }
            for (const remote of toDelete) {
                await this.rest.delete(`${route}/${remote.id}`);
                Logger.success(`  - removed /${remote.name}`);
            }

            if (toAdd.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
                Logger.success('✅ All commands already up-to-date — nothing to do.');
            } else {
                Logger.success(`✅ Diff registration complete (${config.discord.guildId ? 'guild' : 'global'} scope)`);
            }
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
            const force = args.includes('--force');
            await registrar.registerCommands({ force });
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
  --force       Overwrite all commands (legacy bulk-PUT) instead of diff
  (no options)  Diff-based register: add new, update changed, remove deleted

Examples:
  node registerCommands.js                # Diff-based update (recommended)
  node registerCommands.js --force        # Force re-register everything
  node registerCommands.js --list         # List commands
  node registerCommands.js --clear        # Clear commands
`);
    process.exit(0);
}

main();
