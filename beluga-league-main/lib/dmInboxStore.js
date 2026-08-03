import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

/**
 * DM inbox store — the two-way conversation half of the DM Center.
 *
 * The bot records incoming DMs and delivers outgoing ones (Beluga Bot/src/dm/
 * dmInbox.js). The website reads conversations and queues replies by inserting
 * an outgoing row with status='queued'; the bot drains those every 2 seconds.
 */

export const DM_MAX_LEN = 2000

/**
 * AI personas. `professional` is the bot's normal voice; `unhinged` is the roast
 * persona. Kept in sync with MODES in `Beluga Bot/src/ai/persona.js`.
 *
 * The persona belongs to the PERSON, not to a DM thread — it lives in the
 * `ai_personas` table and applies in server channels as well as in DMs. That is
 * why it is separate from `dm_conversations.ai_enabled`, which only controls
 * whether the bot auto-answers this person's DMs at all.
 */
export const DM_AI_MODES = ['professional', 'unhinged']
export const DM_AI_DEFAULT_MODE = 'professional'

function normalizeMode(mode) {
  const m = String(mode || '').toLowerCase().trim()
  return DM_AI_MODES.includes(m) ? m : DM_AI_DEFAULT_MODE
}

/** Conversation list, newest activity first. Unread ones surface at the top. */
export async function listConversations({ limit = 100, search = '' } = {}) {
  await ensureLeagueSchema()
  const term = String(search || '').trim()

  const r = await query(
    `SELECT c.discord_id, c.last_message_at, c.last_message_preview, c.last_direction,
            c.unread_count, c.ai_enabled, p.mode AS ai_mode, c.archived,
            COALESCE(c.display_name, m.display_name, m.username) AS display_name,
            COALESCE(m.avatar_url, c.avatar_url) AS avatar_url,
            m.is_in_guild
       FROM dm_conversations c
       LEFT JOIN discord_members m ON m.discord_id = c.discord_id
       LEFT JOIN ai_personas p ON p.discord_id = c.discord_id
      WHERE c.archived = FALSE
        AND ($1 = '' OR COALESCE(c.display_name, m.display_name, m.username, '') ILIKE $2)
      ORDER BY (c.unread_count > 0) DESC, c.last_message_at DESC
      LIMIT $3`,
    [term, `%${term}%`, Math.min(Number(limit) || 100, 300)]
  )

  return r.rows.map((row) => ({
    discordId: String(row.discord_id),
    displayName: row.display_name || `User ${String(row.discord_id).slice(-4)}`,
    avatarUrl: row.avatar_url || null,
    lastMessageAt: row.last_message_at,
    preview: row.last_message_preview || '',
    lastDirection: row.last_direction || 'in',
    unread: Number(row.unread_count) || 0,
    aiEnabled: Boolean(row.ai_enabled),
    aiMode: normalizeMode(row.ai_mode),
    inGuild: row.is_in_guild === null ? null : Boolean(row.is_in_guild),
  }))
}

/**
 * Total unread across every conversation — drives the sidebar badge.
 *
 * NOTE the key name: `unreadConversations`, NOT `conversations`. The inbox route
 * spreads this alongside the conversation ARRAY, and a `conversations` key here
 * would silently overwrite that array with a number — which crashed the client.
 */
export async function getUnreadTotal() {
  await ensureLeagueSchema()
  try {
    const r = await query(
      `SELECT COALESCE(SUM(unread_count), 0)::int AS n,
              COUNT(*) FILTER (WHERE unread_count > 0)::int AS convos
         FROM dm_conversations WHERE archived = FALSE`
    )
    return { unread: r.rows[0]?.n || 0, unreadConversations: r.rows[0]?.convos || 0 }
  } catch {
    return { unread: 0, unreadConversations: 0 }
  }
}

/**
 * One conversation's messages, oldest→newest for rendering.
 * `afterId` returns only newer messages, which is what the 2s poll uses so an
 * open chat doesn't re-download its whole history every tick.
 */
export async function getConversation(discordId, { limit = 100, afterId = null } = {}) {
  await ensureLeagueSchema()
  const id = String(discordId)

  const convo = await query(
    `SELECT c.discord_id, c.unread_count, c.ai_enabled, p.mode AS ai_mode,
            COALESCE(c.display_name, m.display_name, m.username) AS display_name,
            COALESCE(m.avatar_url, c.avatar_url) AS avatar_url,
            m.is_in_guild
       FROM dm_conversations c
       LEFT JOIN discord_members m ON m.discord_id = c.discord_id
       LEFT JOIN ai_personas p ON p.discord_id = c.discord_id
      WHERE c.discord_id = $1`,
    [id]
  )

  // A conversation may not exist yet (staff starting a brand-new DM) — fall
  // back to the Discord directory so the header still shows a real person.
  let header = convo.rows[0]
  if (!header) {
    const m = await query(
      `SELECT m.discord_id, m.display_name, m.username, m.avatar_url, m.is_in_guild,
              p.mode AS ai_mode
         FROM discord_members m
         LEFT JOIN ai_personas p ON p.discord_id = m.discord_id
        WHERE m.discord_id = $1`,
      [id]
    )
    const row = m.rows[0]
    if (!row) return null
    header = {
      discord_id: id,
      unread_count: 0,
      ai_enabled: false,
      // A persona may already be set for someone who has never DMed the bot.
      ai_mode: row.ai_mode || DM_AI_DEFAULT_MODE,
      display_name: row.display_name || row.username,
      avatar_url: row.avatar_url,
      is_in_guild: row.is_in_guild,
    }
  }

  const messages = afterId
    ? await query(
        `SELECT * FROM dm_messages WHERE discord_id = $1 AND id > $2 ORDER BY id ASC LIMIT 200`,
        [id, Number(afterId)]
      )
    : await query(
        `SELECT * FROM (
            SELECT * FROM dm_messages WHERE discord_id = $1 ORDER BY id DESC LIMIT $2
         ) t ORDER BY id ASC`,
        [id, Math.min(Number(limit) || 100, 300)]
      )

  return {
    conversation: {
      discordId: id,
      displayName: header.display_name || `User ${id.slice(-4)}`,
      avatarUrl: header.avatar_url || null,
      unread: Number(header.unread_count) || 0,
      aiEnabled: Boolean(header.ai_enabled),
      aiMode: normalizeMode(header.ai_mode),
      inGuild: header.is_in_guild === null ? null : Boolean(header.is_in_guild),
    },
    messages: messages.rows.map((m) => ({
      id: m.id,
      direction: m.direction,
      content: m.content || '',
      attachments: Array.isArray(m.attachments) ? m.attachments : [],
      authorName: m.author_name || null,
      source: m.source,
      status: m.status,
      error: m.error || null,
      createdAt: m.created_at,
      sentAt: m.sent_at,
    })),
  }
}

/**
 * Queue a staff reply. Inserted as 'queued'; the bot delivers it within ~2s and
 * flips it to 'sent' or 'failed'. Returns the row so the UI can render it
 * immediately with a "sending" state.
 */
export async function queueReply({ discordId, content, authorName, authorDiscordId }) {
  await ensureLeagueSchema()
  const id = String(discordId)
  const text = String(content || '').slice(0, DM_MAX_LEN)
  if (!text.trim()) return { error: 'Message is empty.' }

  const r = await query(
    `INSERT INTO dm_messages
        (discord_id, direction, content, author_name, author_discord_id, source, status)
     VALUES ($1, 'out', $2, $3, $4, 'staff', 'queued')
     RETURNING *`,
    [id, text, authorName || null, authorDiscordId || null]
  )

  // Create/bump the conversation so a brand-new thread appears in the list.
  await query(
    `INSERT INTO dm_conversations
        (discord_id, last_message_at, last_message_preview, last_direction, unread_count)
     VALUES ($1, CURRENT_TIMESTAMP, $2, 'out', 0)
     ON CONFLICT (discord_id) DO UPDATE SET
        last_message_at = CURRENT_TIMESTAMP,
        last_message_preview = EXCLUDED.last_message_preview,
        last_direction = 'out',
        archived = FALSE,
        updated_at = CURRENT_TIMESTAMP`,
    [id, text.replace(/\s+/g, ' ').slice(0, 140)]
  )

  // Backfill name/avatar from the Discord directory for a fresh conversation.
  await query(
    `UPDATE dm_conversations c
        SET display_name = COALESCE(c.display_name, m.display_name, m.username),
            avatar_url = COALESCE(c.avatar_url, m.avatar_url)
       FROM discord_members m
      WHERE m.discord_id = c.discord_id AND c.discord_id = $1`,
    [id]
  ).catch(() => {})

  const row = r.rows[0]
  return {
    message: {
      id: row.id,
      direction: 'out',
      content: row.content,
      attachments: [],
      authorName: row.author_name,
      source: 'staff',
      status: 'queued',
      createdAt: row.created_at,
    },
  }
}

/** Clear the unread counter when staff open a conversation. */
export async function markRead(discordId) {
  await ensureLeagueSchema()
  await query(`UPDATE dm_conversations SET unread_count = 0 WHERE discord_id = $1`, [String(discordId)])
  return true
}

/**
 * Update the AI settings for one person.
 *
 * The two halves are independent and stored separately on purpose:
 *   - `enabled` → `dm_conversations.ai_enabled`, DM-only ("auto-answer their DMs")
 *   - `mode`    → `ai_personas.mode`, global ("which voice, everywhere")
 *
 * Pass `null`/undefined for whichever you aren't changing. Setting only a mode
 * does NOT create a conversation row, so staff can mark someone unhinged for the
 * server without a phantom empty thread appearing in the inbox.
 */
export async function setAiEnabled(discordId, enabled, mode, actor = {}) {
  await ensureLeagueSchema()
  const id = String(discordId)

  if (enabled != null) {
    await query(
      `INSERT INTO dm_conversations (discord_id, ai_enabled) VALUES ($1, $2)
       ON CONFLICT (discord_id) DO UPDATE SET ai_enabled = EXCLUDED.ai_enabled,
                                             updated_at = CURRENT_TIMESTAMP`,
      [id, Boolean(enabled)]
    )
  }

  if (mode != null) await setPersona(id, mode, actor)

  return getAiState(id)
}

/** Current AI state for one person, with defaults applied. */
export async function getAiState(discordId) {
  await ensureLeagueSchema()
  const r = await query(
    `SELECT c.ai_enabled, p.mode
       FROM (SELECT $1::text AS discord_id) x
       LEFT JOIN dm_conversations c ON c.discord_id = x.discord_id
       LEFT JOIN ai_personas p ON p.discord_id = x.discord_id`,
    [String(discordId)]
  )
  return {
    aiEnabled: Boolean(r.rows[0]?.ai_enabled),
    aiMode: normalizeMode(r.rows[0]?.mode),
  }
}

/**
 * Set someone's persona. Works for ANY discord id — they do not need to have
 * ever DMed the bot, which is the point: this is how staff mark a member
 * unhinged for the server.
 */
export async function setPersona(discordId, mode, actor = {}) {
  await ensureLeagueSchema()
  const next = normalizeMode(mode)
  const r = await query(
    `INSERT INTO ai_personas (discord_id, mode, set_by, set_by_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (discord_id) DO UPDATE SET
        mode = EXCLUDED.mode,
        set_by = EXCLUDED.set_by,
        set_by_name = EXCLUDED.set_by_name,
        updated_at = CURRENT_TIMESTAMP
     RETURNING mode`,
    [String(discordId), next, actor.discordUserId || null, actor.discordUsername || null]
  )
  return normalizeMode(r.rows[0]?.mode)
}

/**
 * Everyone currently on a NON-default persona, newest first. This is the list
 * staff need — "who is the bot currently roasting" — not every member.
 */
export async function listPersonas() {
  await ensureLeagueSchema()
  const r = await query(
    `SELECT p.discord_id, p.mode, p.set_by_name, p.updated_at,
            COALESCE(m.display_name, m.username, c.display_name) AS display_name,
            COALESCE(m.avatar_url, c.avatar_url) AS avatar_url
       FROM ai_personas p
       LEFT JOIN discord_members m ON m.discord_id = p.discord_id
       LEFT JOIN dm_conversations c ON c.discord_id = p.discord_id
      WHERE p.mode <> $1
      ORDER BY p.updated_at DESC
      LIMIT 200`,
    [DM_AI_DEFAULT_MODE]
  )
  return r.rows.map((row) => ({
    discordId: String(row.discord_id),
    displayName: row.display_name || `User ${String(row.discord_id).slice(-4)}`,
    avatarUrl: row.avatar_url || null,
    mode: normalizeMode(row.mode),
    setByName: row.set_by_name || null,
    updatedAt: row.updated_at,
  }))
}
