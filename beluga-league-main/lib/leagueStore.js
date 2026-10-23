import { getPool, query } from './db'
import { ensureLeagueSchema } from './leagueSchema'

function mapSeason(row) {
  return {
    id: row.id,
    seasonNumber: row.season_number,
    // snake_case alias: several public pages read `season.season_number`.
    season_number: row.season_number,
    name: row.name,
    status: row.status,
    year: row.year ?? null,
    statusLabel: row.status_label ?? null,
    description: row.description ?? null,
    recruitingOpen: row.recruiting_open ?? false,
    startDate: row.start_date ? new Date(row.start_date).toISOString().slice(0, 10) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapTeam(row) {
  return {
    id: row.id,
    seasonId: row.season_id,
    franchiseId: row.franchise_id ?? null,
    division: row.division,
    name: row.name,
    rosterLimit: row.roster_limit,
    isActive: row.is_active,
    hasLogo: Boolean(row.logo_mime && row.logo_data),
    logoMime: row.logo_mime || null,
    discordRoleId: row.discord_role_id ?? null,
    discordGmRoleId: row.discord_gm_role_id ?? null,
    discordCaptainRoleId: row.discord_captain_role_id ?? null,
    discordNpRoleId: row.discord_np_role_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getSeasons() {
  await ensureLeagueSchema()
  const result = await query('SELECT * FROM seasons ORDER BY season_number DESC')
  return result.rows.map(mapSeason)
}

export async function getActiveSeason() {
  await ensureLeagueSchema()
  const active = await query('SELECT * FROM seasons WHERE status = $1 ORDER BY season_number DESC LIMIT 1', ['active'])
  if (active.rows.length > 0) return mapSeason(active.rows[0])

  const fallback = await query('SELECT * FROM seasons ORDER BY season_number DESC LIMIT 1')
  if (fallback.rows.length > 0) return mapSeason(fallback.rows[0])

  return null
}

export async function getSeasonByNumber(seasonNumber) {
  await ensureLeagueSchema()
  const n = Number(seasonNumber)
  if (!Number.isFinite(n)) return null
  const result = await query('SELECT * FROM seasons WHERE season_number = $1', [n])
  return result.rows.length ? mapSeason(result.rows[0]) : null
}

/**
 * Resolve a public `?season=` query param to a season row.
 * Accepts a season NUMBER, or 'active'/'current'/'' → the active season. Falls
 * back to the active season when the requested one doesn't exist, so every public
 * page keeps working (and defaults to current) with no param.
 */
export async function resolveSeason(seasonParam) {
  if (seasonParam === null || seasonParam === undefined) return getActiveSeason()
  const raw = String(seasonParam).trim().toLowerCase()
  if (!raw || raw === 'active' || raw === 'current') return getActiveSeason()
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) {
    const byNum = await getSeasonByNumber(n)
    if (byNum) return byNum
  }
  return getActiveSeason()
}

export async function createSeason(seasonNumber, name = null) {
  await ensureLeagueSchema()
  const result = await query(
    `INSERT INTO seasons (season_number, name, status)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [seasonNumber, name, 'draft']
  )
  return mapSeason(result.rows[0])
}

export async function startSeason(seasonId) {
  await ensureLeagueSchema()
  await query('UPDATE seasons SET status = $1 WHERE status = $2', ['archived', 'active'])
  const result = await query(
    'UPDATE seasons SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
    ['active', seasonId]
  )
  return result.rows.length ? mapSeason(result.rows[0]) : null
}

export async function getSeasonById(seasonId) {
  await ensureLeagueSchema()
  const result = await query('SELECT * FROM seasons WHERE id = $1', [seasonId])
  return result.rows.length ? mapSeason(result.rows[0]) : null
}

export async function updateSeason(seasonId, patch) {
  await ensureLeagueSchema()
  const fields = []
  const values = []
  let i = 1
  if (patch.seasonNumber !== undefined) { fields.push(`season_number = $${i++}`); values.push(Number(patch.seasonNumber)) }
  if (patch.name !== undefined) { fields.push(`name = $${i++}`); values.push(patch.name) }
  if (patch.year !== undefined) { fields.push(`year = $${i++}`); values.push(patch.year != null ? Number(patch.year) : null) }
  if (patch.statusLabel !== undefined) { fields.push(`status_label = $${i++}`); values.push(patch.statusLabel) }
  if (patch.description !== undefined) { fields.push(`description = $${i++}`); values.push(patch.description) }
  if (patch.recruitingOpen !== undefined) { fields.push(`recruiting_open = $${i++}`); values.push(Boolean(patch.recruitingOpen)) }
  if (patch.startDate !== undefined) {
    if (patch.startDate === null || patch.startDate === '') {
      fields.push(`start_date = NULL`)
    } else {
      fields.push(`start_date = $${i++}`); values.push(patch.startDate)
    }
  }
  if (!fields.length) return getSeasonById(seasonId)
  values.push(seasonId)
  const result = await query(
    `UPDATE seasons SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${i} RETURNING *`,
    values
  )
  return result.rows.length ? mapSeason(result.rows[0]) : null
}

export async function archiveSeason(seasonId) {
  await ensureLeagueSchema()
  const result = await query(
    `UPDATE seasons SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
    [seasonId]
  )
  return result.rows.length ? mapSeason(result.rows[0]) : null
}

export async function deleteSeason(seasonId) {
  await ensureLeagueSchema()
  await query('DELETE FROM seasons WHERE id = $1', [seasonId])
}

export async function getSeasonSummaries() {
  await ensureLeagueSchema()
  const result = await query(`
    SELECT s.*,
      COALESCE(team_counts.cnt, 0) AS team_count,
      COALESCE(match_counts.cnt, 0) AS match_count
    FROM seasons s
    LEFT JOIN (
      SELECT season_id, COUNT(*)::int AS cnt FROM teams WHERE is_active = TRUE GROUP BY season_id
    ) team_counts ON team_counts.season_id = s.id
    LEFT JOIN (
      SELECT season_id, COUNT(*)::int AS cnt FROM schedule_matches GROUP BY season_id
    ) match_counts ON match_counts.season_id = s.id
    ORDER BY s.season_number DESC
  `)
  return result.rows.map((row) => ({
    ...mapSeason(row),
    teamCount: Number(row.team_count) || 0,
    matchCount: Number(row.match_count) || 0,
  }))
}

export async function getTeams(seasonId) {
  await ensureLeagueSchema()
  const result = await query(
    'SELECT * FROM teams WHERE season_id = $1 ORDER BY division, name',
    [seasonId]
  )
  return result.rows.map(mapTeam)
}

export async function createTeam({ seasonId, division, name, rosterLimit }) {
  await ensureLeagueSchema()
  const result = await query(
    `INSERT INTO teams (season_id, division, name, roster_limit)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [seasonId, division, name, rosterLimit]
  )
  return mapTeam(result.rows[0])
}

export async function updateTeam(teamId, patch) {
  await ensureLeagueSchema()
  const fields = []
  const values = []
  let index = 1

  const addField = (column, value) => {
    fields.push(`${column} = $${index}`)
    values.push(value)
    index += 1
  }

  if (patch.name !== undefined) addField('name', patch.name)
  if (patch.division !== undefined) addField('division', patch.division)
  if (patch.rosterLimit !== undefined) addField('roster_limit', patch.rosterLimit)
  if (patch.isActive !== undefined) addField('is_active', patch.isActive)
  if (patch.discordRoleId !== undefined) addField('discord_role_id', patch.discordRoleId || null)
  if (patch.discordGmRoleId !== undefined) addField('discord_gm_role_id', patch.discordGmRoleId || null)
  if (patch.discordCaptainRoleId !== undefined) addField('discord_captain_role_id', patch.discordCaptainRoleId || null)
  if (patch.discordNpRoleId !== undefined) addField('discord_np_role_id', patch.discordNpRoleId || null)
  if (patch.slogan !== undefined) addField('slogan', patch.slogan || null)

  if (fields.length === 0) return null

  values.push(teamId)
  const result = await query(
    `UPDATE teams SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${index} RETURNING *`,
    values
  )
  return result.rows.length ? mapTeam(result.rows[0]) : null
}

export async function deleteTeam(teamId) {
  await ensureLeagueSchema()
  const result = await query(
    'UPDATE teams SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
    [teamId]
  )
  return result.rows.length ? mapTeam(result.rows[0]) : null
}

export async function hardDeleteTeam(teamId) {
  await ensureLeagueSchema()
  await query('DELETE FROM teams WHERE id = $1', [teamId])
}

export async function setTeamActive(teamId, isActive) {
  await ensureLeagueSchema()
  const result = await query(
    `UPDATE teams SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
    [Boolean(isActive), teamId]
  )
  return result.rows.length ? mapTeam(result.rows[0]) : null
}

export async function getTeamsForSeasonGrouped(seasonId) {
  await ensureLeagueSchema()
  const result = await query(`
    SELECT t.*, f.name AS franchise_name, f.is_active AS franchise_active
    FROM teams t
    LEFT JOIN team_franchises f ON f.id = t.franchise_id
    WHERE t.season_id = $1
    ORDER BY t.division, t.name
  `, [seasonId])
  const grouped = {}
  for (const row of result.rows) {
    const team = mapTeam(row)
    team.franchiseName = row.franchise_name ?? null
    team.franchiseActive = row.franchise_active ?? null
    if (!grouped[team.division]) grouped[team.division] = []
    grouped[team.division].push(team)
  }
  return grouped
}

export async function setTeamLogo(teamId, { mime, data }) {
  await ensureLeagueSchema()
  const result = await query(
    `UPDATE teams
     SET logo_mime = $1, logo_data = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3
     RETURNING *`,
    [mime, data, teamId]
  )
  return result.rows.length ? mapTeam(result.rows[0]) : null
}

export async function getTeamLogo(teamId) {
  await ensureLeagueSchema()
  const result = await query(
    'SELECT logo_mime, logo_data FROM teams WHERE id = $1',
    [teamId]
  )
  if (!result.rows.length) return null
  return {
    mime: result.rows[0].logo_mime,
    data: result.rows[0].logo_data,
  }
}

export async function getRosterEntries(seasonId) {
  await ensureLeagueSchema()
  const result = await query(
    `
      SELECT
        rm.id,
        rm.season_id,
        rm.team_id,
        rm.discord_id,
        rm.discord_username,
        rm.display_name,
        rm.role,
        rm.is_active,
        rm.updated_at,
        t.name AS team_name,
        t.division AS team_division,
        t.roster_limit
      FROM team_roster_members rm
      JOIN teams t ON rm.team_id = t.id
      WHERE rm.season_id = $1
        AND rm.is_active = TRUE
        AND t.is_active = TRUE
      ORDER BY t.division, t.name, rm.role, rm.display_name
    `,
    [seasonId]
  )

  return result.rows.map((row) => ({
    id: row.id,
    seasonId: row.season_id,
    teamId: row.team_id,
    discordId: row.discord_id,
    discordUsername: row.discord_username,
    displayName: row.display_name,
    role: row.role,
    updatedAt: row.updated_at,
    team: {
      id: row.team_id,
      name: row.team_name,
      division: row.team_division,
      rosterLimit: row.roster_limit,
    },
  }))
}

function toDivisionValue(division) {
  const raw = String(division || '').trim().toUpperCase()
  if (raw === 'MAJORS') return 'Majors'
  return raw || null
}

export async function getScheduleMatches(seasonId, { publishedOnly = true } = {}) {
  await ensureLeagueSchema()

  const params = [seasonId]
  let where = 'WHERE sm.season_id = $1'
  if (publishedOnly) {
    params.push(true)
    where += ` AND sm.is_published = $${params.length}`
  }

  const result = await query(
    `
      SELECT
        sm.id,
        sm.season_id,
        sm.division,
        sm.week,
        sm.is_published,
        sm.match_order,
        sm.home_team_id,
        sm.away_team_id,
        ht.name AS home_team_name,
        at.name AS away_team_name,
        sm.created_at,
        sm.updated_at
      FROM schedule_matches sm
      LEFT JOIN teams ht ON ht.id = sm.home_team_id
      LEFT JOIN teams at ON at.id = sm.away_team_id
      ${where}
      ORDER BY sm.week ASC, sm.division ASC, sm.match_order ASC, sm.id ASC
    `,
    params
  )

  return result.rows.map((row) => ({
    id: row.id,
    seasonId: row.season_id,
    division: row.division,
    week: row.week,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeTeam: row.home_team_name,
    awayTeam: row.away_team_name,
    isPublished: row.is_published,
    matchOrder: row.match_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function replaceScheduleMatches(seasonId, schedule, { published = false } = {}) {
  await ensureLeagueSchema()
  const pool = getPool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      'DELETE FROM schedule_matches WHERE season_id = $1 AND is_published = $2',
      [seasonId, published]
    )

    for (let i = 0; i < schedule.length; i += 1) {
      const item = schedule[i]
      const division = toDivisionValue(item.division)
      const week = Number(item.week)
      const homeTeam = String(item.homeTeam || '').trim()
      const awayTeam = String(item.awayTeam || '').trim()

      if (!division || !Number.isInteger(week) || week <= 0 || !homeTeam || !awayTeam || homeTeam === awayTeam) {
        continue
      }

      const homeResult = await client.query(
        'SELECT id FROM teams WHERE season_id = $1 AND division = $2 AND name = $3 AND is_active = TRUE LIMIT 1',
        [seasonId, division, homeTeam]
      )
      const awayResult = await client.query(
        'SELECT id FROM teams WHERE season_id = $1 AND division = $2 AND name = $3 AND is_active = TRUE LIMIT 1',
        [seasonId, division, awayTeam]
      )

      if (!homeResult.rows.length || !awayResult.rows.length) {
        continue
      }

      await client.query(
        `
          INSERT INTO schedule_matches (
            season_id, division, week, home_team_id, away_team_id, is_published, match_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [seasonId, division, week, homeResult.rows[0].id, awayResult.rows[0].id, published, i]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Playoff reads and writes now live in lib/playoffStore.js.
//
// getPlayoffMatchups() returned only team NAMES (no ids, no seeds, no scores,
// no is_finals) and ignored is_published entirely. replacePlayoffBrackets() was
// worse: it DELETED every bracket in the season — all three divisions — and
// rebuilt them from names, silently dropping any matchup whose name did not
// resolve, and it omitted the NOT NULL round_order column, so it threw on every
// single call and had never once succeeded. With a matchup now carrying seeds,
// scores, a winner and graph wiring, a name-keyed bulk replace would destroy all
// of it; playoffStore.js edits one matchup at a time instead.

export async function getStandingsFromRecords(seasonId, division) {
  await ensureLeagueSchema()
  const div = toDivisionValue(division)
  const params = [seasonId]
  let where = 'WHERE tr.season_id = $1'

  if (div) {
    params.push(div)
    where += ` AND tr.division = $${params.length}`
  }

  const result = await query(
    `
      SELECT
        tr.*,
        t.name AS team_name,
        t.division AS team_division
      FROM team_records tr
      JOIN teams t ON t.id = tr.team_id
      ${where}
      ORDER BY tr.wins DESC, tr.losses ASC, tr.goals_for DESC, tr.goals_against ASC, t.name ASC
    `,
    params
  )

  return result.rows.map((row, index) => ({
    rank: index + 1,
    team: row.team_name,
    division: row.team_division,
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    goalDiff: Number(row.goals_for || 0) - Number(row.goals_against || 0),
    goalsFor: Number(row.goals_for || 0),
    goalsAgainst: Number(row.goals_against || 0),
  }))
}
