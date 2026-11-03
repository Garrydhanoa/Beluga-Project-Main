/**
 * The Ballchasing report guard. A suspended player showing up in a report freezes it
 * until staff decide, so a series can't quietly count with someone who shouldn't have
 * played. flow.js calls this after the salary cap check, so staff never get a report
 * the cap would have refused anyway.
 */

const { pool } = require('../utils/database');
const { suspensionLine } = require('./modViews');

/**
 * @param {Array} games the report's games, each with players[].discordId
 * @returns {Promise<Array<{discordId, name, suspensionId, caseId, text}>>}
 */
async function suspendedPlayers(games) {
    const seen = new Map();
    for (const game of games || []) {
        for (const player of game.players || []) {
            if (!player.discordId) continue;
            const earliest = seen.get(player.discordId);
            const at = game.playedAt ? new Date(game.playedAt) : null;
            if (!earliest) seen.set(player.discordId, { name: player.ingameName || null, at });
            else if (at && (!earliest.at || at > earliest.at)) earliest.at = at;
        }
    }
    if (!seen.size) return [];
    const { rows } = await pool.query(
        `SELECT * FROM mod_suspensions WHERE status IN ('active','queued') AND discord_id = ANY($1::text[]) ORDER BY id`,
        [[...seen.keys()]],
    );
    const found = [];
    for (const row of rows) {
        const player = seen.get(row.discord_id);
        // A game played before the suspension began is fine, however late it's reported.
        if (player.at && row.starts_at && player.at < new Date(row.starts_at)) continue;
        found.push({
            discordId: row.discord_id, name: player.name, suspensionId: row.id, caseId: row.case_id,
            text: suspensionLine(row),
        });
    }
    return found;
}

/** Staff already ruled on this one, so the clock shouldn't alert about it too. */
async function markHandled(seriesId, players) {
    for (const player of players || []) {
        await pool.query(
            `INSERT INTO mod_thread_notices (suspension_id, thread_id, kind) VALUES ($1, $2, 'played_alert') ON CONFLICT DO NOTHING`,
            [player.suspensionId, `series:${seriesId}`],
        );
    }
}

module.exports = { suspendedPlayers, markHandled };
