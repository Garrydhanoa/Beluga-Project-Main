const fs = require('fs');
const path = require('path');
const Logger = require('../utils/logger');

class CommandHandler {
  constructor() {
    this.commands = new Map();
  }

  async loadCommands() {
    const commandsPath = path.join(__dirname, '.');
    const commandFiles = fs.readdirSync(commandsPath)
      .filter(file => file.endsWith('.js') && file !== 'index.js');

    Logger.info(`Loading ${commandFiles.length} commands...`);

    for (const file of commandFiles) {
      try {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if ('data' in command && 'execute' in command) {
          this.commands.set(command.data.name, command);
          Logger.success(`Loaded command: ${command.data.name}`);
        } else {
          Logger.warning(`Command ${file} is missing required "data" or "execute" property`);
        }
      } catch (error) {
        Logger.error(`Failed to load command ${file}`, error);
      }
    }

    return this.commands;
  }

  getCommand(commandName) {
    return this.commands.get(commandName);
  }

  getAllCommands() {
    return Array.from(this.commands.values());
  }

  getCommandsData() {
    return this.getAllCommands().map(command => command.data.toJSON());
  }
}

module.exports = CommandHandler;
