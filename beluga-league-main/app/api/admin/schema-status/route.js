import { NextResponse } from 'next/server'
import { requireAdmin } from '../../../../lib/adminAuth'
import { ensureLeagueSchema, getLastSchemaReport } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

const EXPECTED_TABLES = [
  'seasons', 'teams', 'team_roster_members', 'roster_syncs',
  'schedule_matches', 'playoff_brackets', 'playoff_rounds', 'playoff_matchups',
  'team_records', 'player_records',
  'team_franchises', 'season_config',
  'season_champions', 'transactions',
]

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  await ensureLeagueSchema()

  const tablesRes = await query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `)
  const present = new Set(tablesRes.rows.map((r) => r.table_name))

  const status = EXPECTED_TABLES.map((t) => ({ table: t, present: present.has(t) }))
  const missing = status.filter((s) => !s.present).map((s) => s.table)

  const overrideCols = await query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'manual_override'
      AND table_name IN ('team_records','player_records')
  `)
  const overridePresent = new Set(overrideCols.rows.map((r) => r.table_name))

  return NextResponse.json({
    expected: status,
    missing,
    manualOverride: {
      team_records: overridePresent.has('team_records'),
      player_records: overridePresent.has('player_records'),
    },
    lastMigration: getLastSchemaReport(),
    allPresentTables: Array.from(present),
  })
}
