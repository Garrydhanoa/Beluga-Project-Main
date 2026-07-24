const { pool, isDatabaseAvailable } = require('./database');
const Logger = require('./logger');

/**
 * memberStore — persists the Discord guild's members and roles into the shared
 * Postgres so the website has a single source of identity (display names,
 * avatars) and an exact member count. The bot owns these tables and creates them
 * itself (mirrors lib/leagueSchema.js) so it never depends on the website having
 * migrated first.
 *
 * Called from performMemberPull() after the guild fetch. Always non-fatal: a DB
 * hiccup must never break the existing Google-Sheets member pull.
 */

let tablesReady = false;

async function ensureMemberTables() {
    if (!isDatabaseAvailable()) return false;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS discord_members (
                discord_id TEXT PRIMARY KEY,
                username TEXT,
                display_name TEXT,
                avatar_url TEXT,
                is_bot BOOLEAN NOT NULL DEFAULT FALSE,
                is_in_guild BOOLEAN NOT NULL DEFAULT TRUE,
                joined_at TIMESTAMP,
                synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_discord_members_in_guild ON discord_members(is_in_guild, is_bot)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS discord_roles (
                role_id TEXT PRIMARY KEY,
                name TEXT,
                color TEXT,
                position INTEGER NOT NULL DEFAULT 0,
                is_managed BOOLEAN NOT NULL DEFAULT FALSE,
                synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_discord_roles_position ON discord_roles(position DESC)`);

        tablesReady = true;
        return true;
    } catch (err) {
        Logger.error('ensureMemberTables failed', err);
        return false;
    }
}

/**
 * Upsert all members + roles for a guild into the DB and flag anyone no longer
 * in the guild as is_in_guild = FALSE (we keep their row so historical names/
 * avatars still resolve).
 * @param {Guild} guild
 */
async function syncGuildToDb(guild) {
    if (!isDatabaseAvailable() || !guild) return false;
    if (!tablesReady) {
        const ok = await ensureMemberTables();
        if (!ok) return false;
    }

    let rejoinedIds = [];
    try {
        // ---- Members ----
        const members = Array.from(guild.members.cache.values());
        const currentIds = members.map((m) => m.user.id);
        if (members.length > 0) {
            // Detect rejoiners BEFORE the upsert below flips is_in_guild → TRUE:
            // members present in the snapshot whose stored row still says they had
            // left. Their award roles should be re-granted (handled by the caller).
            try {
                const prior = await pool.query(
                    `SELECT discord_id FROM discord_members WHERE is_in_guild = FALSE AND discord_id = ANY($1::text[])`,
                    [currentIds]
                );
                rejoinedIds = prior.rows.map((r) => String(r.discord_id)).filter(Boolean);
            } catch { rejoinedIds = []; }

            // Batched multi-row upsert to keep round-trips down.
            const CHUNK = 200;
            for (let i = 0; i < members.length; i += CHUNK) {
                const slice = members.slice(i, i + CHUNK);
                const values = [];
                const params = [];
                slice.forEach((m, idx) => {
                    const base = idx * 6;
                    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, TRUE, $${base + 6})`);
                    let avatar = null;
                    try {
                        avatar = m.displayAvatarURL({ extension: 'png', size: 256 });
                    } catch {
                        avatar = m.user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || null;
                    }
                    params.push(
                        m.user.id,
                        m.user.username || null,
                        m.displayName || m.user.globalName || m.user.username || null,
                        avatar,
                        !!m.user.bot,
                        m.joinedAt ? m.joinedAt.toISOString() : null
                    );
                });
                await pool.query(
                    `INSERT INTO discord_members
                        (discord_id, username, display_name, avatar_url, is_bot, is_in_guild, joined_at)
                     VALUES ${values.join(', ')}
                     ON CONFLICT (discord_id) DO UPDATE SET
                        username = EXCLUDED.username,
                        display_name = EXCLUDED.display_name,
                        avatar_url = EXCLUDED.avatar_url,
                        is_bot = EXCLUDED.is_bot,
                        is_in_guild = TRUE,
                        joined_at = COALESCE(EXCLUDED.joined_at, discord_members.joined_at),
                        synced_at = CURRENT_TIMESTAMP`,
                    params
                );
            }

            // Anyone in the table but not in the current guild snapshot has left.
            await pool.query(
                `UPDATE discord_members
                 SET is_in_guild = FALSE, synced_at = CURRENT_TIMESTAMP
                 WHERE is_in_guild = TRUE AND discord_id <> ALL($1::text[])`,
                [currentIds]
            );
        }

        // ---- Roles ----
        const roles = Array.from(guild.roles.cache.values()).filter((r) => r.name !== '@everyone');
        if (roles.length > 0) {
            const values = [];
            const params = [];
            roles.forEach((r, idx) => {
                const base = idx * 5;
                values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
                params.push(
                    r.id,
                    r.name || null,
                    r.color ? r.hexColor : null,
                    r.position || 0,
                    !!r.managed
                );
            });
            await pool.query(
                `INSERT INTO discord_roles (role_id, name, color, position, is_managed)
                 VALUES ${values.join(', ')}
                 ON CONFLICT (role_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    color = EXCLUDED.color,
                    position = EXCLUDED.position,
                    is_managed = EXCLUDED.is_managed,
                    synced_at = CURRENT_TIMESTAMP`,
                params
            );
            // Drop roles that no longer exist in the guild.
            const currentRoleIds = roles.map((r) => r.id);
            await pool.query(
                `DELETE FROM discord_roles WHERE role_id <> ALL($1::text[])`,
                [currentRoleIds]
            );
        }

        // Store the AUTHORITATIVE live counts in site_config so the website shows
        // the true current Discord member count (the discord_members row count can
        // lag if is_in_guild flips haven't caught up). humanCount excludes bots.
        try {
            const humanCount = members.filter((m) => !m.user.bot).length;
            const botCount = members.length - humanCount;
            await pool.query(`
                INSERT INTO site_config (key, value, updated_at)
                VALUES ('discord_stats', $1::jsonb, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
            `, [JSON.stringify({
                humanCount,
                botCount,
                totalCount: members.length,
                guildMemberCount: guild.memberCount ?? members.length,
                syncedAt: new Date().toISOString(),
            })]);
        } catch (e) {
            // site_config may not exist yet on a fresh DB; non-fatal.
        }

        Logger.success(`Synced ${members.length} members + ${roles.length} roles to DB`);
        return { ok: true, rejoinedIds };
    } catch (err) {
        Logger.error('syncGuildToDb failed', err);
        return { ok: false, rejoinedIds };
    }
}

module.exports = { ensureMemberTables, syncGuildToDb };
