/**
 * Game of the Week + Player of the Week — computed per division when a week
 * FULLY closes (every thread of that season+week is_closed, regardless of
 * whether it was closed from the bot or the website).
 *
 * GotW pick (drama score): series closeness (decider games worth most),
 * total goals, overtime games, and upset factor. PotW: best weighted per-game
 * line across the week (goals 30, assists 15, saves 20, shots 5, score/100×25,
 * demos +5/−2, MVP +12 — the operator-approved weighting).
 *
 * Posts a result-card graphic to the admin-configured channel
 * (app_config.stats_channel_id); posts "no games reported" when a division
 * closed with nothing reported. Failures are logged to the log channel.
 * Also refreshes power rankings for all divisions on each week close.
 */

const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { pool, isDatabaseAvailable } = require('../utils/database');
const { getConfig } = require('../utils/appConfig');
const { buildResultCard } = require('./report/resultCard');
const { logEdge } = require('./report/logChannel');
const Logger = require('../utils/logger');

function db() {
    return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function pickGameOfWeek(seasonId, division, week) {
    const r = await pool.query(
        `SELECT s.id, s.home_score, s.away_score, s.is_forfeit,
            ht.name AS home, at.name AS away,
            COALESCE(SUM(g.home_goals),0)::int AS hg, COALESCE(SUM(g.away_goals),0)::int AS ag,
            COALESCE(SUM(CASE WHEN g.overtime THEN 1 ELSE 0 END),0)::int AS ot
         FROM stats_series s
         LEFT JOIN stats_games g ON g.series_id = s.id
         LEFT JOIN teams ht ON ht.id = s.home_team_id
         LEFT JOIN teams at ON at.id = s.away_team_id
         WHERE s.season_id=$1 AND s.division=$2 AND s.week=$3 AND s.status='confirmed' AND s.is_forfeit=FALSE
         GROUP BY s.id, ht.name, at.name`,
        [seasonId, division, week]
    );
    if (!r.rows.length) return null;
    let best = null;
    for (const s of r.rows) {
        const games = Number(s.home_score) + Number(s.away_score);
        const closeness = games > 0 ? (1 - Math.abs(s.home_score - s.away_score) / games) * 40 : 0;
        const drama = closeness + Number(s.ot) * 12 + (Number(s.hg) + Number(s.ag)) * 0.8 + games * 4;
        if (!best || drama > best.drama) best = { ...s, drama };
    }
    return best;
}

async function pickPlayerOfWeek(seasonId, division, week) {
    const r = await pool.query(
        `SELECT gp.discord_id, t.name AS team,
            COUNT(*)::int AS games,
            SUM(gp.goals)::int AS goals, SUM(gp.assists)::int AS assists, SUM(gp.saves)::int AS saves,
            SUM(gp.shots)::int AS shots, SUM(gp.score)::int AS score,
            SUM(gp.demos_inflicted)::int AS dinf, SUM(gp.demos_taken)::int AS dtak,
            SUM(CASE WHEN gp.mvp THEN 1 ELSE 0 END)::int AS mvps
         FROM stats_game_players gp
         JOIN stats_series s ON s.id = gp.series_id
         LEFT JOIN teams t ON t.id = gp.team_id
         WHERE s.season_id=$1 AND s.division=$2 AND s.week=$3 AND s.status='confirmed' AND gp.discord_id IS NOT NULL
         GROUP BY gp.discord_id, t.name`,
        [seasonId, division, week]
    );
    if (!r.rows.length) return null;
    let best = null;
    for (const p of r.rows) {
        const per = (Number(p.goals) * 30 + Number(p.assists) * 15 + Number(p.saves) * 20 + Number(p.shots) * 5 +
            Number(p.score) / 100 * 25 + Number(p.dinf) * 5 - Number(p.dtak) * 2 + Number(p.mvps) * 12) / Number(p.games);
        if (!best || per > best.formScore) best = { ...p, formScore: Math.round(per * 10) / 10 };
    }
    const nm = await pool.query(
        `SELECT display_name, username FROM discord_members WHERE discord_id = $1`, [best.discord_id]
    ).catch(() => ({ rows: [] }));
    best.name = nm.rows[0]?.display_name || nm.rows[0]?.username || `User ${String(best.discord_id).slice(-4)}`;
    return best;
}

async function postWeekHighlights(client, seasonId, division, week) {
    const channelId = await getConfig('stats_channel_id');
    if (!channelId) {
        Logger.warning('GotW skipped: stats_channel_id not set in app_config (set it in the website admin Settings).');
        // Surface it where staff actually look (log channel + Admin → Logs).
        await logEdge(client, {
            summary: `Week ${week} ${division} highlights SKIPPED — no stats channel configured. Set it in website Admin → Site Content.`,
            division, pingSalaryCrew: false, pingInThread: false,
        });
        return;
    }
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const gotw = await pickGameOfWeek(seasonId, division, week);
    if (!gotw) {
        await channel.send(`📭 **${division} — Week ${week}:** no games reported.`).catch(() => {});
        return;
    }
    const potw = await pickPlayerOfWeek(seasonId, division, week);

    const homeWon = Number(gotw.home_score) > Number(gotw.away_score);
    const card = await buildResultCard({
        winnerName: homeWon ? gotw.home : gotw.away,
        loserName: homeWon ? gotw.away : gotw.home,
        winnerScore: homeWon ? gotw.home_score : gotw.away_score,
        loserScore: homeWon ? gotw.away_score : gotw.home_score,
        division, week, isForfeit: false,
    });
    const embed = new EmbedBuilder()
        .setColor(0xA78BFA)
        .setTitle(`🌊 ${division} — Week ${week} Highlights`)
        .addFields({ name: '🎮 Game of the Week', value: `**${gotw.home} ${gotw.home_score}–${gotw.away_score} ${gotw.away}** (${gotw.hg}-${gotw.ag} goals${gotw.ot ? `, ${gotw.ot} OT` : ''})` })
        .setTimestamp();
    if (potw) {
        embed.addFields({
            name: '⭐ Player of the Week',
            value: `<@${potw.discord_id}> (${potw.team || '—'}) — ${potw.goals}G ${potw.assists}A ${potw.saves}SV · ${potw.mvps} MVP${potw.mvps === 1 ? '' : 's'} · form ${potw.formScore}`,
        });
    }
    if (card) embed.setImage('attachment://gotw.png');
    await channel.send({ embeds: [embed], files: card ? [new AttachmentBuilder(card, { name: 'gotw.png' })] : [] });
}

/**
 * Sweep: find weeks whose threads are now ALL closed and that haven't been
 * processed yet → post highlights per division + refresh power rankings.
 * Runs on the watcher interval; idempotent via app_config marker keys.
 */
async function checkClosedWeeks(client) {
    if (!db()) return;
    try {
        const weeks = await pool.query(`
            SELECT season_id, week_number
            FROM week_threads
            WHERE season_id IS NOT NULL AND week_number < 90
            GROUP BY season_id, week_number
            HAVING COUNT(*) > 0 AND COUNT(*) FILTER (WHERE is_closed = FALSE) = 0
        `);
        for (const w of weeks.rows) {
            const key = `week_closed_processed:${w.season_id}:${w.week_number}`;
            // eslint-disable-next-line no-await-in-loop
            const done = await getConfig(key);
            if (done) continue;
            const { setConfig } = require('../utils/appConfig');
            // eslint-disable-next-line no-await-in-loop
            await setConfig(key, new Date().toISOString()); // mark first (avoid double-posting on errors)
            Logger.info(`Week ${w.week_number} (season ${w.season_id}) fully closed — posting highlights + refreshing power rankings`);
            for (const division of ['Majors', 'AAA', 'AA']) {
                try {
                    // eslint-disable-next-line no-await-in-loop
                    await postWeekHighlights(client, w.season_id, division, w.week_number);
                } catch (err) {
                    Logger.error(`GotW failed for ${division} W${w.week_number}`, err);
                    // eslint-disable-next-line no-await-in-loop
                    await logEdge(client, { summary: `Game-of-the-Week failed for ${division} Week ${w.week_number}.`, error: err, division, pingInThread: false });
                }
                try {
                    const { refreshPowerRankings } = require('./powerRankings');
                    // Snapshot THIS week specifically — closing week 4 must not
                    // overwrite week 3, and trend then reads off week 3.
                    // eslint-disable-next-line no-await-in-loop
                    await refreshPowerRankings(w.season_id, division, w.week_number);
                } catch (err) {
                    Logger.error(`Power-rankings refresh failed for ${division}`, err);
                }
            }
        }
    } catch (err) {
        Logger.error('checkClosedWeeks failed', err);
    }
}

module.exports = { checkClosedWeeks, postWeekHighlights, pickGameOfWeek, pickPlayerOfWeek };
