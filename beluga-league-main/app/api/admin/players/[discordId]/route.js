import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../../lib/adminAuth'
import { ensureLeagueSchema } from '../../../../../lib/leagueSchema'
import { query } from '../../../../../lib/db'
import { resolveMember } from '../../../../../lib/discordMembers'

export const dynamic = 'force-dynamic'

function badRequest(msg) {
  return NextResponse.json({ error: msg }, { status: 400 })
}

export async function GET(_request, { params }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const { discordId } = await params
  const id = String(discordId || '').trim()
  if (!id) return badRequest('discordId required')

  await ensureLeagueSchema()

  // Identity: latest display name / username for this discord id, resolved from
  // every source the directory lists from (roster + transactions + manual_salaries)
  // so a player who appears only via a transaction or salary row never 404s.
  const idRes = await query(`
    WITH identities AS (
      SELECT discord_id, display_name, discord_username, updated_at AS seen_at
      FROM team_roster_members WHERE discord_id = $1
      UNION ALL
      SELECT discord_id, display_name, discord_username, performed_at AS seen_at
      FROM transactions WHERE discord_id = $1
      UNION ALL
      SELECT discord_id, username AS display_name, username AS discord_username, updated_at AS seen_at
      FROM manual_salaries WHERE discord_id = $1
    )
    SELECT discord_id,
      (ARRAY_REMOVE(ARRAY_AGG(display_name ORDER BY seen_at DESC), NULL))[1] AS display_name,
      (ARRAY_REMOVE(ARRAY_AGG(discord_username ORDER BY seen_at DESC), NULL))[1] AS discord_username,
      MAX(seen_at) AS last_seen
    FROM identities
    GROUP BY discord_id
  `, [id])
  if (!idRes.rows.length) return NextResponse.json({ player: null }, { status: 404 })
  const identity = idRes.rows[0]
  const member = await resolveMember(id).catch(() => null)

  // Roster history: which team/division/season they've appeared on.
  const rosterRes = await query(`
    SELECT rm.season_id, s.season_number, s.year, s.status AS season_status,
      rm.team_id, t.name AS team_name, t.division,
      rm.role, rm.is_active AS roster_active, t.is_active AS team_active,
      rm.updated_at,
      t.franchise_id, f.name AS franchise_name
    FROM team_roster_members rm
    JOIN teams t ON t.id = rm.team_id
    LEFT JOIN seasons s ON s.id = rm.season_id
    LEFT JOIN team_franchises f ON f.id = t.franchise_id
    WHERE rm.discord_id = $1
    ORDER BY s.season_number DESC NULLS LAST, t.division, rm.updated_at DESC
  `, [id])

  // Stats per season (player_records joined to season + team).
  const statsRes = await query(`
    SELECT pr.id, pr.season_id, s.season_number, pr.division,
      pr.team_id, t.name AS team_name,
      pr.player_name, pr.platform, pr.platform_id,
      pr.games_played, pr.goals, pr.assists, pr.saves, pr.shots, pr.score,
      pr.manual_override
    FROM player_records pr
    LEFT JOIN seasons s ON s.id = pr.season_id
    LEFT JOIN teams t ON t.id = pr.team_id
    WHERE pr.platform_id = $1
    ORDER BY s.season_number DESC NULLS LAST
  `, [id])

  // Transactions touching this player.
  const txRes = await query(`
    SELECT tx.id, tx.season_id, s.season_number, tx.type, tx.details,
      tx.team_id, tx.team_name_snapshot,
      tx.paired_team_id, tx.paired_team_name_snapshot,
      tx.performed_by_discord_id, tx.performed_by_username, tx.source,
      tx.performed_at,
      t.name AS team_name_resolved,
      pt.name AS paired_team_name_resolved
    FROM transactions tx
    LEFT JOIN seasons s ON s.id = tx.season_id
    LEFT JOIN teams t ON t.id = tx.team_id
    LEFT JOIN teams pt ON pt.id = tx.paired_team_id
    WHERE tx.discord_id = $1
    ORDER BY tx.performed_at DESC, tx.id DESC
  `, [id])

  return NextResponse.json({
    player: {
      discordId: identity.discord_id,
      displayName: member?.displayName || identity.display_name || identity.discord_username || `User ${String(identity.discord_id).slice(-4)}`,
      discordUsername: member?.username || identity.discord_username,
      avatarUrl: member?.avatarUrl || null,
      inGuild: member?.isInGuild ?? null,
      lastSeen: identity.last_seen,
    },
    rosterHistory: rosterRes.rows.map((r) => ({
      seasonId: r.season_id,
      seasonNumber: r.season_number,
      seasonYear: r.year,
      seasonStatus: r.season_status,
      teamId: r.team_id,
      teamName: r.team_name,
      division: r.division,
      role: r.role,
      rosterActive: r.roster_active,
      teamActive: r.team_active,
      updatedAt: r.updated_at,
      franchiseId: r.franchise_id,
      franchiseName: r.franchise_name,
    })),
    stats: statsRes.rows.map((r) => ({
      id: r.id,
      seasonId: r.season_id,
      seasonNumber: r.season_number,
      division: r.division,
      teamId: r.team_id,
      teamName: r.team_name,
      playerName: r.player_name,
      platform: r.platform,
      platformId: r.platform_id,
      gamesPlayed: Number(r.games_played || 0),
      goals: Number(r.goals || 0),
      assists: Number(r.assists || 0),
      saves: Number(r.saves || 0),
      shots: Number(r.shots || 0),
      score: Number(r.score || 0),
      manualOverride: !!r.manual_override,
    })),
    transactions: txRes.rows.map((r) => ({
      id: r.id,
      seasonId: r.season_id,
      seasonNumber: r.season_number,
      type: r.type,
      details: r.details || {},
      teamId: r.team_id,
      teamName: r.team_name_resolved || r.team_name_snapshot,
      pairedTeamId: r.paired_team_id,
      pairedTeamName: r.paired_team_name_resolved || r.paired_team_name_snapshot,
      performedByDiscordId: r.performed_by_discord_id,
      performedByUsername: r.performed_by_username,
      source: r.source,
      performedAt: r.performed_at,
    })),
  })
}
