import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { getPool } from '../../../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status })
}

/**
 * Atomically add multiple teams (with auto-created franchises) to a season.
 * Body: { picks: [{ division, franchiseId? | name?, rosterLimit? }, ...] }
 *
 * Behavior:
 *   - Each pick missing both franchiseId and name is skipped (not an error).
 *   - Each pick with a name auto-creates a franchise if one with that name doesn't exist.
 *     Names are saved EXACTLY as typed (no division suffix).
 *   - If any pick fails (DB error), the whole batch rolls back. Returns per-pick result.
 *   - On success, every team has its franchise_id set.
 *
 * Returns: { ok, results: [{ index, division, name, franchiseId, teamId, status, error? }, ...] }
 *   status ∈ 'created' | 'updated' | 'skipped'
 */
export async function POST(request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const seasonId = Number(id)
  if (!Number.isInteger(seasonId)) return badRequest('Invalid id')

  let body
  try { body = await request.json() } catch { return badRequest('Invalid JSON') }

  const picks = Array.isArray(body.picks) ? body.picks : null
  if (!picks) return badRequest('picks array required')

  await ensureLeagueSchema()

  const pool = getPool()
  const client = await pool.connect()
  const results = []

  try {
    await client.query('BEGIN')

    for (let index = 0; index < picks.length; index += 1) {
      const pick = picks[index] || {}
      const division = (pick.division || '').trim()
      const rawName = pick.name && String(pick.name).trim()
      const franchiseId = pick.franchiseId ? Number(pick.franchiseId) : null
      const rosterLimit = Number.isFinite(Number(pick.rosterLimit)) ? Number(pick.rosterLimit) : 4

      if (!division) {
        results.push({ index, status: 'skipped', error: 'no division' })
        continue
      }

      if (!franchiseId && !rawName) {
        results.push({ index, division, status: 'skipped', error: 'empty pick' })
        continue
      }

      // Resolve / create the franchise.
      let resolvedFranchiseId = franchiseId
      let resolvedFranchiseName = null

      if (resolvedFranchiseId) {
        const fr = await client.query(
          'SELECT id, name FROM team_franchises WHERE id = $1',
          [resolvedFranchiseId]
        )
        if (!fr.rows.length) {
          results.push({ index, division, status: 'error', error: `franchise ${resolvedFranchiseId} not found` })
          throw new Error(`franchise ${resolvedFranchiseId} not found`)
        }
        resolvedFranchiseName = fr.rows[0].name
      } else {
        // Create or fetch existing franchise by name. The constraint UNIQUE(name)
        // means typing the same name twice always returns the same row.
        const fr = await client.query(
          `INSERT INTO team_franchises (name, default_division)
           VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           RETURNING id, name`,
          [rawName, division]
        )
        resolvedFranchiseId = fr.rows[0].id
        resolvedFranchiseName = fr.rows[0].name
      }

      // Now upsert the team for this season.
      const teamName = (rawName && rawName.length) ? rawName : resolvedFranchiseName

      // Look up by (season_id, franchise_id, division) — NOT just (season_id, franchise_id).
      // A franchise can legitimately field separate teams in Majors / AAA / AA in the
      // same season, so we must scope by division to avoid clobbering one with another.
      const existing = await client.query(
        `SELECT id FROM teams
         WHERE season_id = $1 AND franchise_id = $2 AND division = $3
         LIMIT 1`,
        [seasonId, resolvedFranchiseId, division]
      )

      let teamId
      let resultStatus

      if (existing.rows.length) {
        teamId = existing.rows[0].id
        await client.query(
          `UPDATE teams SET is_active = TRUE, name = $1,
             roster_limit = COALESCE($2, roster_limit),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [teamName, rosterLimit, teamId]
        )
        resultStatus = 'updated'
      } else {
        // Insert a fresh row for this season/division/franchise combination.
        // Conflict target (season_id, division, name) — handles the edge case
        // where someone typed the same team name twice for the same division
        // (the conflicting row gets re-linked to this franchise).
        const inserted = await client.query(
          `INSERT INTO teams (season_id, division, name, roster_limit, franchise_id, is_active)
           VALUES ($1, $2, $3, $4, $5, TRUE)
           ON CONFLICT (season_id, division, name) DO UPDATE
             SET franchise_id = EXCLUDED.franchise_id,
                 is_active = TRUE,
                 updated_at = CURRENT_TIMESTAMP
           RETURNING id`,
          [seasonId, division, teamName, rosterLimit, resolvedFranchiseId]
        )
        teamId = inserted.rows[0].id
        resultStatus = 'created'
      }

      results.push({
        index,
        division,
        name: teamName,
        franchiseId: resolvedFranchiseId,
        franchiseName: resolvedFranchiseName,
        teamId,
        status: resultStatus,
      })
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    return NextResponse.json({
      ok: false,
      error: err.message || 'bulk-teams failed',
      results, // partial results recorded BEFORE the failure
    }, { status: 500 })
  } finally {
    client.release()
  }

  // Report per-division summary so the wizard can verify.
  const summary = results.reduce((acc, r) => {
    if (r.status === 'created' || r.status === 'updated') {
      const d = r.division
      acc[d] = (acc[d] || 0) + 1
    }
    return acc
  }, {})

  return NextResponse.json({ ok: true, results, summary })
}
