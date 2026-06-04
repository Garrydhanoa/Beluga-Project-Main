import { query } from './db'

/**
 * Single source of Discord identity for the website. The bot populates
 * `discord_members` (and `discord_roles`) on every member pull; the website only
 * reads. Discord IDs are join keys — never show them as names. Always show
 * display_name (falling back through username only as a last resort).
 *
 * All helpers are non-throwing: if the table doesn't exist yet (fresh DB before
 * the bot's first pull) they degrade to empty results.
 */

let memberCache = null
let memberCacheAt = 0
const MEMBER_TTL_MS = 30 * 1000

/**
 * @returns {Promise<Map<string, {discordId, displayName, username, avatarUrl, isInGuild, isBot}>>}
 */
export async function getMemberMap() {
  const now = Date.now()
  if (memberCache && now - memberCacheAt < MEMBER_TTL_MS) return memberCache

  const map = new Map()
  try {
    const r = await query(`
      SELECT discord_id, username, display_name, avatar_url, is_in_guild, is_bot
      FROM discord_members
    `)
    for (const row of r.rows) {
      map.set(String(row.discord_id), {
        discordId: String(row.discord_id),
        displayName: row.display_name || row.username || null,
        username: row.username || null,
        avatarUrl: row.avatar_url || null,
        isInGuild: row.is_in_guild,
        isBot: row.is_bot,
      })
    }
  } catch {
    /* table may not exist yet */
  }

  memberCache = map
  memberCacheAt = now
  return map
}

/**
 * Resolve a single Discord ID to a friendly display object.
 * @param {string} discordId
 * @param {Map} [map] optional pre-fetched member map
 */
export async function resolveMember(discordId, map = null) {
  if (!discordId) return null
  const m = map || (await getMemberMap())
  return m.get(String(discordId)) || null
}

/**
 * Exact count of real (non-bot) members currently in the guild.
 * Prefers the AUTHORITATIVE live count the bot stores in site_config on each
 * member pull (the discord_members row count can lag behind is_in_guild flips).
 * Falls back to counting in-guild non-bot rows.
 * @returns {Promise<number|null>} null if unknown
 */
export async function getGuildMemberCount() {
  // 1) Authoritative live count from the bot's last member pull.
  try {
    const r = await query(`SELECT value FROM site_config WHERE key = 'discord_stats'`)
    const v = r.rows[0]?.value
    const n = v && typeof v.humanCount === 'number' ? v.humanCount : null
    if (Number.isFinite(n)) return n
  } catch {
    /* fall through */
  }
  // 2) Fallback: count in-guild non-bot rows.
  try {
    const r = await query(`
      SELECT COUNT(*)::int AS n
      FROM discord_members
      WHERE is_in_guild = TRUE AND is_bot = FALSE
    `)
    const n = r.rows[0]?.n
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * Substring search over members for the ticket-creation "do you mean?" picker.
 * Matches display name OR username, in-guild members first.
 * @param {string} q
 * @param {number} [limit=12]
 */
export async function searchMembers(q, limit = 12) {
  const term = String(q || '').trim()
  if (!term) return []
  try {
    const r = await query(
      `SELECT discord_id, username, display_name, avatar_url, is_in_guild
       FROM discord_members
       WHERE is_bot = FALSE
         AND (display_name ILIKE $1 OR username ILIKE $1 OR discord_id = $2)
       ORDER BY is_in_guild DESC,
         (LOWER(display_name) = LOWER($2)) DESC,
         (display_name ILIKE $3) DESC,
         display_name ASC
       LIMIT $4`,
      [`%${term}%`, term, `${term}%`, limit]
    )
    return r.rows.map((row) => ({
      id: String(row.discord_id),
      displayName: row.display_name || row.username || null,
      username: row.username || null,
      avatarUrl: row.avatar_url || null,
      inGuild: row.is_in_guild,
    }))
  } catch {
    return []
  }
}

/**
 * Roles for the ticket-creation role picker, highest position first.
 * @returns {Promise<Array<{id, name, color, position}>>}
 */
export async function getRoles() {
  try {
    const r = await query(`
      SELECT role_id, name, color, position
      FROM discord_roles
      WHERE is_managed = FALSE
      ORDER BY position DESC, name ASC
    `)
    return r.rows.map((row) => ({
      id: String(row.role_id),
      name: row.name,
      color: row.color || null,
      position: row.position,
    }))
  } catch {
    return []
  }
}

/**
 * Build a function that rewrites raw Discord mentions in transcript text into
 * readable names: `<@id>`/`<@!id>` → `@DisplayName`, `<@&id>` → `@RoleName`.
 * Loads the member + role maps once so a whole transcript can be resolved cheaply.
 * @returns {Promise<(content: string) => string>}
 */
export async function getMentionResolver() {
  const [members, roles] = await Promise.all([getMemberMap(), getRoles()])
  const roleMap = new Map(roles.map((r) => [r.id, r]))
  return (content) => resolveMentions(content, members, roleMap)
}

/** Pure mention rewrite given pre-fetched maps. */
export function resolveMentions(content, memberMap, roleMap) {
  if (!content || typeof content !== 'string') return content
  return content
    // User mentions <@123> or <@!123>
    .replace(/<@!?(\d+)>/g, (_m, id) => {
      const member = memberMap?.get?.(String(id))
      return `@${member?.displayName || member?.username || 'unknown-user'}`
    })
    // Role mentions <@&123>
    .replace(/<@&(\d+)>/g, (_m, id) => {
      const role = roleMap?.get?.(String(id))
      return `@${role?.name || 'unknown-role'}`
    })
}

/**
 * Pick the best display name for an identity, preferring the Discord member
 * record, then any DB-stored display name, then username, and only ever falling
 * back to the raw ID when nothing else exists.
 */
export function bestName({ member = null, displayName = null, username = null, discordId = null } = {}) {
  return (
    member?.displayName ||
    displayName ||
    member?.username ||
    username ||
    (discordId ? `User ${String(discordId).slice(-4)}` : null) ||
    'Unknown'
  )
}
