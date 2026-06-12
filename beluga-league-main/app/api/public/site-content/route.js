import { NextResponse } from 'next/server'
import { ensureLeagueSchema } from '../../../../lib/leagueSchema'
import { query } from '../../../../lib/db'

export const dynamic = 'force-dynamic'

// Public site content: random active quotes (with author identity) + the
// active montage videos (max 2). ?player=<discordId> adds that player's quotes.
export async function GET(request) {
  await ensureLeagueSchema()
  const url = new URL(request.url)
  const playerId = url.searchParams.get('player')

  const [quotes, montage, playerQuotes] = await Promise.all([
    query(`
      SELECT q.text, q.author_discord_id, m.display_name AS author_name, m.username AS author_username
      FROM site_quotes q
      LEFT JOIN discord_members m ON m.discord_id = q.author_discord_id
      WHERE q.is_active = TRUE AND q.player_discord_id IS NULL
      ORDER BY RANDOM() LIMIT 6
    `).catch(() => ({ rows: [] })),
    query(`SELECT youtube_url, title FROM site_montage WHERE is_active = TRUE ORDER BY display_order, id LIMIT 2`).catch(() => ({ rows: [] })),
    playerId
      ? query(`
          SELECT q.text, q.author_discord_id, m.display_name AS author_name
          FROM site_quotes q
          LEFT JOIN discord_members m ON m.discord_id = q.author_discord_id
          WHERE q.is_active = TRUE AND q.player_discord_id = $1
          ORDER BY RANDOM() LIMIT 3
        `, [String(playerId)]).catch(() => ({ rows: [] }))
      : Promise.resolve({ rows: [] }),
  ])

  return NextResponse.json({
    quotes: quotes.rows.map((q) => ({
      text: q.text,
      author: q.author_name || q.author_username || 'Beluga staff',
      authorId: q.author_discord_id,
    })),
    montage: montage.rows,
    playerQuotes: playerQuotes.rows.map((q) => ({ text: q.text, author: q.author_name || 'Beluga staff' })),
  })
}
