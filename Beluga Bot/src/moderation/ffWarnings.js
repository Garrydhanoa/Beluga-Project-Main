/**
 * GM forfeit warnings (rule 4.5): 2 forfeits in one league level is the first warning,
 * 3 the second, 4+ the third and removal. This only tells staff. Forfeit punishments
 * were deliberately left to people, so nothing here touches a GM.
 *
 * It counts stats_series directly, because /report-ff is not the only way a forfeit
 * gets recorded (in-thread forfeits and website entries skip that command).
 */

const { EmbedBuilder } = require('discord.js');
const { pool } = require('../utils/database');
const { ROLES } = require('../constants/roles');
const { divisionLabel } = require('../utils/divisionLabels');
const { CHANNELS } = require('./modConfig');
const posting = require('./modPosting');

const LEVELS = [
    { level: 1, forfeits: 2, text: 'first warning' },
    { level: 2, forfeits: 3, text: 'second warning' },
    { level: 3, forfeits: 4, text: 'third warning, and rule 4.5 calls for removal' },
];

async function tickForfeits(client) {
    const season = await pool.query(`SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    const seasonId = season.rows[0]?.id;
    if (!seasonId) return;
    const { rows } = await pool.query(
        `SELECT t.id, t.name, t.division, COUNT(*)::int AS forfeits
           FROM teams t
           JOIN stats_series s ON (s.home_team_id = t.id OR s.away_team_id = t.id)
          WHERE t.season_id = $1 AND s.season_id = $1 AND s.status = 'confirmed' AND s.is_forfeit = TRUE
            AND (s.winner_team_id IS NULL OR s.winner_team_id <> t.id)
          GROUP BY t.id, t.name, t.division
         HAVING COUNT(*) >= 2`,
        [seasonId],
    );
    for (const team of rows) {
        for (const step of LEVELS) {
            if (team.forfeits < step.forfeits) continue;
            const claimed = await pool.query(
                `INSERT INTO mod_ff_warnings (season_id, team_id, level, forfeits) VALUES ($1, $2, $3, $4)
                 ON CONFLICT DO NOTHING RETURNING level`,
                [seasonId, team.id, step.level, team.forfeits],
            );
            if (!claimed.rows.length) continue;
            await posting.sendTo(client, CHANNELS.TIMEOUT_LOG, {
                content: `<@&${ROLES.SALARY_CREW}>`,
                embeds: [new EmbedBuilder()
                    .setTitle(`GM forfeit warning: ${team.name}`.slice(0, 256))
                    .setDescription(`${team.name} (${divisionLabel(team.division)}) has ${team.forfeits} forfeits this season. Under rule 4.5 that is the ${step.text}. Nothing has been done automatically.`)
                    .setColor(posting.COLORS.warn)
                    .setTimestamp()],
                allowedMentions: { parse: [], roles: [ROLES.SALARY_CREW] },
            }, 'a GM forfeit warning');
            require('./actions').logJob('moderation.ff-warning', `${team.name} reached GM forfeit warning level ${step.level} with ${team.forfeits} forfeits`, {
                details: [['Team', team.name], ['Forfeits', String(team.forfeits)], ['Level', String(step.level)]],
            });
        }
    }
}

module.exports = { tickForfeits };
