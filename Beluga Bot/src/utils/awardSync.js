/**
 * Award-role snapshot — the admin lists award role IDs (Site Content →
 * app_config.award_roles JSON [{roleId,label}]). Every 10 minutes the bot
 * snapshots who holds each role into award_role_holders so the website can
 * show award badges on player pages without live Discord access.
 */
const { pool, isDatabaseAvailable } = require('./database');
const { getConfig } = require('./appConfig');
const Logger = require('./logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function syncAwardRoles(client) {
    if (!db()) return;
    try {
        let roles;
        try { roles = JSON.parse((await getConfig('award_roles')) || '[]'); } catch { roles = []; }
        if (!Array.isArray(roles) || !roles.length) return;
        const guild = client.guilds.cache.first();
        if (!guild) return;
        for (const r of roles) {
            if (!r?.roleId) continue;
            const role = await guild.roles.fetch(String(r.roleId)).catch(() => null);
            await pool.query(`DELETE FROM award_role_holders WHERE role_id = $1`, [String(r.roleId)]);
            if (!role) continue;
            for (const [memberId] of role.members) {
                // eslint-disable-next-line no-await-in-loop
                await pool.query(
                    `INSERT INTO award_role_holders (role_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [String(r.roleId), memberId]
                );
            }
        }
    } catch (err) {
        Logger.error('syncAwardRoles failed', err);
    }
}

function startAwardSync(client, intervalMs = 10 * 60 * 1000) {
    setTimeout(() => syncAwardRoles(client), 20 * 1000);
    setInterval(() => syncAwardRoles(client), intervalMs);
}

module.exports = { syncAwardRoles, startAwardSync };
