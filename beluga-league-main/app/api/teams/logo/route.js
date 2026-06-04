import { NextResponse } from 'next/server'
import { query } from '../../../../lib/db'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'

export const dynamic = 'force-dynamic'

/**
 * Public team-logo read.
 *
 * Lookup order:
 *   1. Per-season team row (`teams.logo_data`) for the given teamId
 *   2. The team's franchise logo (`team_franchises.logo_data`) — fallback
 *
 * This means admins can upload once on any team card and the logo
 * surfaces everywhere the franchise appears, including past seasons.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const teamId = Number(searchParams.get('teamId'))
  const byName = searchParams.get('name')

  await ensureLeagueSchema()

  let row = null

  if (Number.isInteger(teamId)) {
    const r = await query(
      `SELECT t.logo_mime AS team_mime, t.logo_data AS team_data,
              f.logo_mime AS franchise_mime, f.logo_data AS franchise_data
       FROM teams t
       LEFT JOIN team_franchises f ON f.id = t.franchise_id
       WHERE t.id = $1
       LIMIT 1`,
      [teamId]
    )
    row = r.rows[0] || null
  } else if (byName) {
    // Fallback: lookup by team name. Resolves to franchise logo if no team logo.
    // Useful for the public schedule which has team names but not always team IDs.
    const r = await query(
      `SELECT t.logo_mime AS team_mime, t.logo_data AS team_data,
              f.logo_mime AS franchise_mime, f.logo_data AS franchise_data
       FROM teams t
       LEFT JOIN team_franchises f ON f.id = t.franchise_id
       WHERE LOWER(t.name) = LOWER($1)
       ORDER BY t.id DESC
       LIMIT 1`,
      [byName]
    )
    row = r.rows[0] || null
    if (!row) {
      // Try franchise name directly
      const fr = await query(
        `SELECT NULL::text AS team_mime, NULL::bytea AS team_data,
                logo_mime AS franchise_mime, logo_data AS franchise_data
         FROM team_franchises
         WHERE LOWER(name) = LOWER($1)
         LIMIT 1`,
        [byName]
      )
      row = fr.rows[0] || null
    }
  } else {
    return NextResponse.json({ error: 'teamId or name required' }, { status: 400 })
  }

  // No DB/franchise logo found. If we have a team NAME, fall back to the static
  // /logos/<name>.png file via a redirect instead of erroring — most teams only
  // have static logos, so this avoids 404 spam and the <img> still resolves.
  const staticFallback = () =>
    byName
      ? NextResponse.redirect(new URL(`/logos/${encodeURIComponent(byName)}.png`, request.url), 302)
      : NextResponse.json({ error: 'Logo not found' }, { status: 404 })

  if (!row) return staticFallback()

  const mime = row.team_data ? row.team_mime : row.franchise_mime
  const data = row.team_data || row.franchise_data

  if (!data) return staticFallback()

  return new NextResponse(data, {
    headers: {
      'Content-Type': mime || 'application/octet-stream',
      // No caching so a re-uploaded logo shows up INSTANTLY everywhere.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  })
}
