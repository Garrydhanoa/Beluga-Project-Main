const { config } = require('../config/config');

function getGuild(client) {
    return client.guilds.cache.get(config.discord.guildId) || client.guilds.cache.first() || null;
}

module.exports = { getGuild };
