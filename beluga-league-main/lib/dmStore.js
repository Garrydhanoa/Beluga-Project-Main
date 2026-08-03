import { query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

/**
 * DM Center store — target resolution + job queueing.
 *
 * The website resolves and queues; the BOT sends (it owns the Discord token).
 * See Beluga Bot/src/dm/dmSender.js for the other half.
 *
 * Role targets resolve here from the `discord_member_roles` mirror purely so the
 * admin can PREVIEW a count before sending. The bot re-resolves roles live from
 * the guild at send time, so a stale mirror can never cause a mis-targeted DM.
 */

export const DM_DEFAULT_KEY = 'dm_default_message'

export const DM_DEFAULT_FALLBACK =
  '**Beluga League** — a message from league staff.'

/** Discord's hard limit on a single message. */
export const DM_MAX_LEN = 2000

/** Personalization tokens available in the body. */
export const DM_TOKENS = ['name', 'team', 'franchise', 'division', 'season']

const EMPTY_TARGETS = {
  users: [],
  roles: [],
  franchises: [],
  teams: [],
  divisions: [],
  everyone: false,
  freeAgents: false,
  excludeUsers: [],
  excludeRoles: [],
}

/** Coerce whatever the client posted into a safe, fully-populated target shape. */
export function normalizeTargets(raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const ids = (v) =>
    Array.isArray(v) ? [...new Set(v.map((x) => String(x || '').trim()).filter(Boolean))] : []
  const nums = (v) =>
    Array.isArray(v) ? [...new Set(v.map((x) => Number(x)).filter((n) => Number.isFinite(n)))] : []
  const strs = (v) =>
    Array.isArray(v) ? [...new Set(v.map((x) => String(x || '').trim()).filter(Boolean))] : []

  return {
    ...EMPTY_TARGETS,
    users: ids(t.users),
    roles: ids(t.roles),
    franchises: nums(t.franchises),
    teams: nums(t.teams),
    divisions: strs(t.divisions),
    everyone: Boolean(t.everyone),
    freeAgents: Boolean(t.freeAgents),
    excludeUsers: ids(t.excludeUsers),
    excludeRoles: ids(t.excludeRoles),
  }
}

/** True when nothing at all is selected (guards against an accidental empty blast). */
export function hasAnyTarget(t) {
  return Boolean(
    t.users.length ||
      t.roles.length ||
      t.franchises.length ||
      t.teams.length ||
      t.divisions.length ||
      t.everyone ||
      t.freeAgents
  )
}

async function getActiveSeason() {
  const r = await query(
    `SELECT id, season_number FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1`
  )
  return r.rows[0] || null
}

/**
 * Resolve a target selection to a deduplicated recipient list.
 *
 * @returns {Promise<{recipients: Array, season: object|null, warnings: string[]}>}
 *   recipients: [{ discordId, displayName, avatarUrl, inGuild, team, franchise, division }]
 */
export async function resolveRecipients(rawTargets) {
  await ensureLeagueSchema()
  const t = normalizeTargets(rawTargets)
  const warnings = []
  const season = await getActiveSeason()

  // Collected as a Set of discord ids; league context is attached afterwards in
  // one pass so a person picked twice (say via role AND franchise) is identical
  // either way.
  const ids = new Set()

  if (t.everyone) {
    const r = await query(
      `SELECT discord_id FROM discord_members WHERE is_in_guild = TRUE AND is_bot = FALSE`
    )
    r.rows.forEach((x) => ids.add(String(x.discord_id)))
  }

  t.users.forEach((id) => ids.add(id))

  if (t.roles.length) {
    const r = await query(
      `SELECT DISTINCT mr.discord_id
         FROM discord_member_roles mr
         JOIN discord_members m ON m.discord_id = mr.discord_id
        WHERE mr.role_id = ANY($1::text[]) AND m.is_in_guild = TRUE AND m.is_bot = FALSE`,
      [t.roles]
    )
    if (!r.rows.length) {
      warnings.push(
        'No members matched the selected role(s) in the mirror — the bot will still expand roles live when it sends.'
      )
    }
    r.rows.forEach((x) => ids.add(String(x.discord_id)))
  }

  // Roster-based targets all need an active season.
  const needsSeason = t.franchises.length || t.teams.length || t.divisions.length || t.freeAgents
  if (needsSeason && !season) {
    warnings.push('No active season — franchise / team / division / free-agent targets resolved to nobody.')
  }

  if (season && (t.franchises.length || t.teams.length || t.divisions.length)) {
    const r = await query(
      `SELECT DISTINCT trm.discord_id
         FROM team_roster_members trm
         JOIN teams tm ON tm.id = trm.team_id
        WHERE trm.season_id = $1 AND trm.is_active = TRUE AND tm.is_active = TRUE
          AND (
            ($2::int[] <> '{}' AND tm.franchise_id = ANY($2::int[]))
            OR ($3::int[] <> '{}' AND tm.id = ANY($3::int[]))
            OR ($4::text[] <> '{}' AND tm.division = ANY($4::text[]))
          )`,
      [season.id, t.franchises, t.teams, t.divisions]
    )
    r.rows.forEach((x) => ids.add(String(x.discord_id)))
  }

  if (season && t.freeAgents) {
    const r = await query(
      `SELECT m.discord_id
         FROM discord_members m
        WHERE m.is_in_guild = TRUE AND m.is_bot = FALSE
          AND NOT EXISTS (
            SELECT 1 FROM team_roster_members trm
             WHERE trm.discord_id = m.discord_id AND trm.season_id = $1 AND trm.is_active = TRUE
          )`,
      [season.id]
    )
    r.rows.forEach((x) => ids.add(String(x.discord_id)))
  }

  // ---- Exclusions ----
  t.excludeUsers.forEach((id) => ids.delete(id))
  if (t.excludeRoles.length) {
    const r = await query(
      `SELECT DISTINCT discord_id FROM discord_member_roles WHERE role_id = ANY($1::text[])`,
      [t.excludeRoles]
    )
    r.rows.forEach((x) => ids.delete(String(x.discord_id)))
  }

  if (!ids.size) return { recipients: [], season, warnings }

  // ---- Attach names, avatars, and league context for the preview + tokens ----
  const idList = [...ids]
  const memberRows = await query(
    `SELECT discord_id, display_name, username, avatar_url, is_in_guild, is_bot
       FROM discord_members WHERE discord_id = ANY($1::text[])`,
    [idList]
  )
  const memberMap = new Map(memberRows.rows.map((r) => [String(r.discord_id), r]))

  let rosterMap = new Map()
  if (season) {
    const rosterRows = await query(
      `SELECT trm.discord_id, tm.name AS team_name, tm.division, f.name AS franchise_name
         FROM team_roster_members trm
         JOIN teams tm ON tm.id = trm.team_id
         LEFT JOIN team_franchises f ON f.id = tm.franchise_id
        WHERE trm.season_id = $1 AND trm.is_active = TRUE AND trm.discord_id = ANY($2::text[])`,
      [season.id, idList]
    )
    rosterMap = new Map(rosterRows.rows.map((r) => [String(r.discord_id), r]))
  }

  const recipients = idList
    .map((id) => {
      const m = memberMap.get(id)
      const roster = rosterMap.get(id)
      return {
        discordId: id,
        displayName: m?.display_name || m?.username || `User ${id.slice(-4)}`,
        avatarUrl: m?.avatar_url || null,
        inGuild: m ? Boolean(m.is_in_guild) : false,
        known: Boolean(m),
        team: roster?.team_name || null,
        franchise: roster?.franchise_name || null,
        division: roster?.division || null,
      }
    })
    // Bots can't receive DMs, and someone who has left the server can't either.
    .filter((r) => {
      const m = memberMap.get(r.discordId)
      return !m?.is_bot
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  const gone = recipients.filter((r) => r.known && !r.inGuild).length
  if (gone) warnings.push(`${gone} recipient(s) are no longer in the server and will be skipped.`)

  return { recipients, season, warnings }
}

/**
 * Render the final message for one recipient. Kept identical to the bot's copy
 * so the admin preview matches what actually lands in the DM.
 */
export function renderMessage({ defaultText, includeDefault, body, recipient, season }) {
  const parts = []
  if (includeDefault && String(defaultText || '').trim()) parts.push(String(defaultText).trim())
  if (String(body || '').trim()) parts.push(String(body).trim())
  let text = parts.join('\n\n')

  const seasonNo = season?.season_number ?? season?.seasonNumber ?? ''
  const values = {
    name: recipient?.displayName || 'there',
    team: recipient?.team || 'Free Agent',
    franchise: recipient?.franchise || 'Free Agent',
    division: recipient?.division || '—',
    season: seasonNo ? `S${seasonNo}` : '—',
  }
  text = text.replace(/\{(name|team|franchise|division|season)\}/g, (_m, k) => values[k])

  if (text.length > DM_MAX_LEN) text = `${text.slice(0, DM_MAX_LEN - 1)}…`
  return text
}

/** Franchises / teams / divisions / channels for the pickers. */
export async function getTargetOptions() {
  await ensureLeagueSchema()
  const season = await getActiveSeason()

  const [franchises, teams, channels] = await Promise.all([
    query(`SELECT id, name FROM team_franchises WHERE is_active = TRUE ORDER BY name`),
    season
      ? query(
          `SELECT tm.id, tm.name, tm.division, f.name AS franchise_name
             FROM teams tm LEFT JOIN team_franchises f ON f.id = tm.franchise_id
            WHERE tm.season_id = $1 AND tm.is_active = TRUE
            ORDER BY CASE tm.division WHEN 'Majors' THEN 0 WHEN 'AAA' THEN 1 ELSE 2 END, tm.name`,
          [season.id]
        )
      : Promise.resolve({ rows: [] }),
    // Text (0) / announcement (5) / forum (15) channels — the ones worth tagging.
    query(
      `SELECT channel_id, name, parent_name, position
         FROM discord_channels WHERE type IN (0, 5, 15)
        ORDER BY parent_name NULLS FIRST, position, name`
    ).catch(() => ({ rows: [] })),
  ])

  return {
    season: season ? { id: season.id, number: season.season_number } : null,
    franchises: franchises.rows.map((r) => ({ id: r.id, name: r.name })),
    teams: teams.rows.map((r) => ({
      id: r.id,
      name: r.name,
      division: r.division,
      franchise: r.franchise_name || null,
    })),
    divisions: ['Majors', 'AAA', 'AA'],
    channels: channels.rows.map((r) => ({
      id: String(r.channel_id),
      name: r.name,
      category: r.parent_name || null,
    })),
  }
}

/**
 * Queue a job and its target rows, then NOTIFY so the bot picks it up instantly
 * (it also polls every few seconds as a safety net).
 */
export async function createJob({
  createdBy,
  createdByName,
  targets,
  includeDefault,
  defaultText,
  body,
  recipients,
  testOnly = false,
}) {
  await ensureLeagueSchema()

  const jobRes = await query(
    `INSERT INTO dm_jobs
       (created_by, created_by_name, status, targets, include_default, default_text, body, test_only, total)
     VALUES ($1, $2, 'queued', $3::jsonb, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      createdBy || null,
      createdByName || null,
      JSON.stringify(targets || {}),
      Boolean(includeDefault),
      defaultText || null,
      body,
      Boolean(testOnly),
      recipients.length,
    ]
  )
  const job = jobRes.rows[0]

  const CHUNK = 500
  for (let i = 0; i < recipients.length; i += CHUNK) {
    const slice = recipients.slice(i, i + CHUNK)
    const values = slice.map((_, idx) => `($1, $${idx * 2 + 2}, $${idx * 2 + 3})`)
    const params = [job.id, ...slice.flatMap((r) => [r.discordId, r.displayName || null])]
    await query(
      `INSERT INTO dm_job_targets (job_id, discord_id, display_name)
       VALUES ${values.join(', ')} ON CONFLICT (job_id, discord_id) DO NOTHING`,
      params
    )
  }

  // Wake the bot immediately. Non-fatal: the bot's poll fallback catches it.
  await query(`NOTIFY dm_jobs`).catch(() => {})

  return job
}

/** One job with its per-recipient breakdown. */
export async function getJob(id) {
  await ensureLeagueSchema()
  const jobRes = await query(`SELECT * FROM dm_jobs WHERE id = $1`, [Number(id)])
  const job = jobRes.rows[0]
  if (!job) return null

  const targetsRes = await query(
    `SELECT discord_id, display_name, status, reason, sent_at
       FROM dm_job_targets WHERE job_id = $1
      ORDER BY CASE status WHEN 'failed' THEN 0 WHEN 'skipped' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END,
               display_name NULLS LAST`,
    [job.id]
  )

  const counts = { pending: 0, sent: 0, failed: 0, skipped: 0 }
  for (const r of targetsRes.rows) counts[r.status] = (counts[r.status] || 0) + 1

  return { job, targets: targetsRes.rows, counts }
}

/** Recent jobs for the history table. */
export async function listJobs(limit = 25) {
  await ensureLeagueSchema()
  const r = await query(
    `SELECT id, created_by_name, status, targets, include_default, body, test_only,
            total, sent_count, failed_count, skipped_count, created_at, finished_at, error
       FROM dm_jobs ORDER BY id DESC LIMIT $1`,
    [Math.min(Number(limit) || 25, 100)]
  )
  return r.rows
}

/** Flip the cancel flag; the bot checks it between sends. */
export async function cancelJob(id) {
  await ensureLeagueSchema()
  const r = await query(
    `UPDATE dm_jobs
        SET cancel_requested = TRUE,
            status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
            finished_at = CASE WHEN status = 'queued' THEN CURRENT_TIMESTAMP ELSE finished_at END
      WHERE id = $1 RETURNING *`,
    [Number(id)]
  )
  return r.rows[0] || null
}

/**
 * Re-queue ONLY the failed recipients of a finished job, as a new job that
 * reuses the original text verbatim.
 */
export async function retryFailed(id, { createdBy, createdByName } = {}) {
  await ensureLeagueSchema()
  const src = await query(`SELECT * FROM dm_jobs WHERE id = $1`, [Number(id)])
  const job = src.rows[0]
  if (!job) return { error: 'Job not found' }

  const failed = await query(
    `SELECT discord_id, display_name FROM dm_job_targets WHERE job_id = $1 AND status = 'failed'`,
    [job.id]
  )
  if (!failed.rows.length) return { error: 'Nothing failed on that job.' }

  const recipients = failed.rows.map((r) => ({
    discordId: String(r.discord_id),
    displayName: r.display_name,
  }))

  const created = await createJob({
    createdBy,
    createdByName,
    targets: { ...(job.targets || {}), retryOf: job.id },
    includeDefault: job.include_default,
    defaultText: job.default_text,
    body: job.body,
    recipients,
    testOnly: job.test_only,
  })
  return { job: created, count: recipients.length }
}
