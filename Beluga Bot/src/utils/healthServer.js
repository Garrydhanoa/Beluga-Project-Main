const express = require('express');
const { config } = require('../config/config');

// Create a simple health check server for Railway
function createHealthServer(bot) {
    const app = express();
    const port = process.env.PORT || 3000;

    // Health check endpoint
    app.get('/', (req, res) => {
        const stats = bot.getStats();
        const isHealthy = bot.isClientReady() && stats.errorCount < 10;
        
        res.status(isHealthy ? 200 : 503).json({
            status: isHealthy ? 'healthy' : 'unhealthy',
            bot: config.bot.name,
            version: config.bot.version,
            uptime: Math.floor(stats.uptime / 1000),
            ready: stats.isReady,
            guilds: stats.guildCount,
            errors: stats.errorCount,
            lastError: stats.lastError ? stats.lastError.message : null,
            timestamp: new Date().toISOString()
        });
    });

    // Basic ping endpoint
    app.get('/ping', (req, res) => {
        res.json({ pong: true, timestamp: new Date().toISOString() });
    });

    // Start the server
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`Health server running on port ${port}`);
    });

    return server;
}

module.exports = { createHealthServer };
