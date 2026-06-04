import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../../lib/leagueSchema'
import { query } from '../../../../../../lib/db'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const fid = Number(id)
  if (!Number.isInteger(fid)) return badRequest('Invalid id')

  await ensureLeagueSchema()

  const [seasonsRes, txRes, championsRes, rosterRes] = await Promise.all([
    query(`
      SELECT t.id AS team_id, t.season_id, t.division, t.name, t.is_active,
        s.season_number, s.year, s.name AS season_name, s.status AS season_status
      FROM teams t
      JOIN seasons s ON s.id = t.season_id
      WHERE t.franchise_id = $1
      ORDER BY s.season_number DESC NULLS LAST
    `, [fid]),
    query(`
      SELECT tx.id, tx.type, tx.discord_id, tx.discord_username, tx.display_name,
        tx.team_name_snapshot, tx.paired_team_name_snapshot, tx.performed_at, tx.details,
        s.season_number
      FROM transactions tx
      LEFT JOIN seasons s ON s.id = tx.season_id
      WHERE tx.franchise_id = $1
      ORDER BY tx.performed_at DESC, tx.id DESC
      LIMIT 200
    `, [fid]),
    query(`
      SELECT c.season_id, c.division, s.season_number, s.year
      FROM season_champions c
      JOIN seasons s ON s.id = c.season_id
      WHERE c.franchise_id = $1
      ORDER BY s.season_number DESC NULLS LAST
    `, [fid]),
    query(`
      SELECT DISTINCT ON (rm.discord_id, t.season_id)
        rm.discord_id, rm.discord_username, rm.display_name, rm.role,
        rm.is_active, t.season_id, s.season_number, t.name AS team_name
      FROM team_roster_members rm
      JOIN teams t ON t.id = rm.team_id
      LEFT JOIN seasons s ON s.id = t.season_id
      WHERE t.franchise_id = $1
      ORDER BY rm.discord_id, t.season_id DESC NULLS LAST
    `, [fid]),
  ])

  return NextResponse.json({
    seasonsPlayed: seasonsRes.rows.map((r) => ({
      teamId: r.team_id,
      seasonId: r.season_id,
      seasonNumber: r.season_number,
      year: r.year,
      seasonName: r.season_name,
      seasonStatus: r.season_status,
      division: r.division,
      teamName: r.name,
      isActive: r.is_active,
    })),
    transactions: txRes.rows.map((r) => ({
      id: r.id,
      type: r.type,
      discordId: r.discord_id,
      discordUsername: r.discord_username,
      displayName: r.display_name || r.discord_username || r.discord_id,
      teamNameSnapshot: r.team_name_snapshot,
      pairedTeamNameSnapshot: r.paired_team_name_snapshot,
      seasonNumber: r.season_number,
      performedAt: r.performed_at,
      details: r.details || {},
    })),
    championships: championsRes.rows.map((r) => ({
      seasonId: r.season_id,
      seasonNumber: r.season_number,
      year: r.year,
      division: r.division,
    })),
    pastPlayers: rosterRes.rows.map((r) => ({
      discordId: r.discord_id,
      discordUsername: r.discord_username,
      displayName: r.display_name || r.discord_username,
      role: r.role,
      seasonNumber: r.season_number,
      teamName: r.team_name,
    })),
  })
}
