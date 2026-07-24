/**
 * Award-role snapshot + memory.
 *
 * The admin lists award role IDs (Site Content → app_config.award_roles JSON
 * [{roleId,label}]). Two things run off that list:
 *
 *  1) award_role_holders — a CURRENT, in-guild snapshot rebuilt every 10 min so
 *     the website can show award badges on player pages without live Discord
 *     access. Members who leave the server drop out of it.
 *
 *  2) award_role_memory — a DURABLE "last-known award roles per member" set that
 *     SURVIVES leaving the server. It is pruned only when staff actually removes
 *     a role from an in-guild member (guildMemberUpdate); a member simply leaving
 *     never touches it. On rejoin the bot re-grants the remembered roles
 *     (restoreAwardRoles), then normal tracking resumes.
 *
 * Design note on why prune lives ONLY in the guildMemberUpdate path: the periodic
 * reconciliation below is add-only. If it also pruned "in-guild members who don't
 * hold the role", it could wipe a member who just rejoined before their restore
 * landed. Precise removal via the update event avoids that race.
 */
const { pool, isDatabaseAvailable } = require('./database');
const { getConfig } = require('./appConfig');
const Logger = require('./logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

let _memoryTableReady = false;
async function ensureAwardMemoryTable() {
    if (_memoryTableReady) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS award_role_memory (
            role_id TEXT NOT NULL,
            discord_id TEXT NOT NULL,
            remembered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (role_id, discord_id)
        )
    `);
    _memoryTableReady = true;
}

// guildMemberUpdate is noisy (fires on nickname/role/presence-ish changes), so
// cache the configured award-role id set instead of hitting app_config each time.
let _awardSetCache = null;
let _awardSetAt = 0;
const AWARD_SET_TTL = 60 * 1000;
async function getAwardRoleSet(force = false) {
    const now = Date.now();
    if (!force && _awardSetCache && now - _awardSetAt < AWARD_SET_TTL) return _awardSetCache;
    let roles;
    try { roles = JSON.parse((await getConfig('award_roles')) || '[]'); } catch { roles = []; }
    const set = new Set(
        (Array.isArray(roles) ? roles : [])
            .map((r) => (r && r.roleId != null ? String(r.roleId) : null))
            .filter(Boolean)
    );
    _awardSetCache = set;
    _awardSetAt = now;
    return set;
}

async function syncAwardRoles(client) {
    if (!db()) return;
    try {
        await ensureAwardMemoryTable();
        let roles;
        try { roles = JSON.parse((await getConfig('award_roles')) || '[]'); } catch { roles = []; }
        if (!Array.isArray(roles) || !roles.length) return;
        const guild = client.guilds.cache.first();
        if (!guild) return;
        // role.members only reflects the MEMBER CACHE — right after boot that's
        // often just a handful, so award roles would show only 1-2 holders. Fetch
        // the full member list once so every role's members are populated.
        try { await guild.members.fetch(); } catch (e) { Logger.warning?.(`awardSync: members.fetch failed (${e?.message || e}) — using cache`); }
        for (const r of roles) {
            if (!r?.roleId) continue;
            const role = await guild.roles.fetch(String(r.roleId)).catch(() => null);
            await pool.query(`DELETE FROM award_role_holders WHERE role_id = $1`, [String(r.roleId)]);
            if (!role) continue;
            for (const [memberId] of role.members) {
                // Current in-guild snapshot for site badges…
                // eslint-disable-next-line no-await-in-loop
                await pool.query(
                    `INSERT INTO award_role_holders (role_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [String(r.roleId), memberId]
                );
                // …and ADD-ONLY into durable memory (backfills existing holders,
                // catches any add event we missed). Never prunes here — see header.
                // eslint-disable-next-line no-await-in-loop
                await pool.query(
                    `INSERT INTO award_role_memory (role_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [String(r.roleId), memberId]
                );
            }
        }
    } catch (err) {
        Logger.error('syncAwardRoles failed', err);
    }
}

/**
 * React to a member's roles changing while they are IN the guild:
 *   - gained an award role → remember it
 *   - lost an award role   → forget it (this is the ONLY prune path)
 */
async function syncMemberAwardMemory(oldMember, newMember) {
    if (!db()) return;
    try {
        const member = newMember || oldMember;
        if (!member || member.user?.bot) return;
        const awardSet = await getAwardRoleSet();
        if (!awardSet.size) return;
        await ensureAwardMemoryTable();

        const oldRoles = oldMember?.roles?.cache;
        const newRoles = newMember?.roles?.cache;
        if (!newRoles) return; // nothing to diff against

        const discordId = member.id;
        for (const roleId of awardSet) {
            const had = oldRoles ? oldRoles.has(roleId) : false;
            const has = newRoles.has(roleId);
            if (has && !had) {
                // eslint-disable-next-line no-await-in-loop
                await pool.query(
                    `INSERT INTO award_role_memory (role_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [roleId, discordId]
                );
            } else if (!has && had) {
                // eslint-disable-next-line no-await-in-loop
                await pool.query(
                    `DELETE FROM award_role_memory WHERE role_id = $1 AND discord_id = $2`,
                    [roleId, discordId]
                );
            }
        }
    } catch (err) {
        Logger.error(`syncMemberAwardMemory failed (${err?.code || ''} ${err?.message || err})`);
    }
}

/**
 * Re-grant a rejoining member the award roles they held when they left.
 * Only restores roles that are still configured, still exist in the guild, and
 * aren't already held. Returns the number of roles added.
 */
async function restoreAwardRoles(member) {
    if (!db() || !member || member.user?.bot) return 0;
    try {
        await ensureAwardMemoryTable();
        const awardSet = await getAwardRoleSet();
        if (!awardSet.size) return 0;
        const { rows } = await pool.query(
            `SELECT role_id FROM award_role_memory WHERE discord_id = $1`,
            [member.id]
        );
        if (!rows.length) return 0;

        let added = 0;
        for (const { role_id } of rows) {
            const roleId = String(role_id);
            if (!awardSet.has(roleId)) continue;                 // de-configured since
            if (member.roles.cache.has(roleId)) continue;        // already has it
            const role = member.guild.roles.cache.get(roleId)
                || await member.guild.roles.fetch(roleId).catch(() => null);
            if (!role) continue;                                 // deleted in Discord
            try {
                // eslint-disable-next-line no-await-in-loop
                await member.roles.add(role, 'Restoring award role after rejoin');
                added++;
            } catch (e) {
                Logger.warning?.(`restoreAwardRoles: could not add ${roleId} to ${member.id} (${e?.code || ''} ${e?.message || e})`);
            }
        }
        if (added) Logger.info?.(`restoreAwardRoles: restored ${added} award role(s) to ${member.user?.tag || member.id}`);
        return added;
    } catch (err) {
        Logger.error(`restoreAwardRoles failed (${err?.code || ''} ${err?.message || err})`);
        return 0;
    }
}

function startAwardSync(client, intervalMs = 10 * 60 * 1000) {
    setTimeout(() => syncAwardRoles(client), 20 * 1000);
    setInterval(() => syncAwardRoles(client), intervalMs);
}

module.exports = {
    syncAwardRoles,
    startAwardSync,
    ensureAwardMemoryTable,
    syncMemberAwardMemory,
    restoreAwardRoles,
    getAwardRoleSet,
};
