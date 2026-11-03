/**
 * The 60-second moderation clock. Everything time-driven runs from here off the
 * database, so a restart never skips a lift or an unban.
 *
 * Series are counted by reading stats_series rather than hooking each way a series
 * gets created (captain report, staff report, forfeit, website entry, importer). The
 * ledger is re-evaluated in full on every tick, so a series that gets voided, deleted
 * or edited, or a stat line that arrives late, corrects the count by itself.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { db, ensureModSchema } = require('./modSchema');
const { CHANNELS } = require('./modConfig');
const { getGuild } = require('./modGuild');
const { resolveTeam } = require('./release');
const { lift, activate, syncSheet } = require('./suspensions');
const { tickBans } = require('./bans');
const { remindOpenThreads } = require('./threadNotices');
const posting = require('./modPosting');
const { logJob } = require('./actions');

const TICK_MS = 60 * 1000;
const SLOW_EVERY = 5;           // reminders + sheet retries run every 5th tick
const FLAG_RETENTION_DAYS = 30;

let running = false;
let ticks = 0;

async function endTimeouts() {
    await pool.query(
        `UPDATE mod_cases SET status = 'ended', updated_at = NOW()
          WHERE kind IN ('timeout','filter') AND status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW()`,
    );
}

async function startQueued() {
    const { rows } = await pool.query(
        `SELECT DISTINCT ON (q.discord_id) q.* FROM mod_suspensions q
          WHERE q.status = 'queued'
            AND NOT EXISTS (SELECT 1 FROM mod_suspensions a WHERE a.discord_id = q.discord_id AND a.status = 'active')
          ORDER BY q.discord_id, q.id`,
    );
    for (const row of rows) await activate(row);
}

async function finish(client, guild, row, reason) {
    const done = await lift(client, guild, row, { reason, status: 'served' });
    if (done) {
        logJob('moderation.suspension-served', `the suspension on case ${row.case_id} ended automatically: ${reason}`, {
            target: row.discord_id, details: [['Case', String(row.case_id)], ['Reason', reason]],
        });
    }
}

async function endTimed(client, guild) {
    const { rows } = await pool.query(
        `SELECT * FROM mod_suspensions WHERE status = 'active' AND unit IN ('days','weeks') AND ends_at <= NOW()`,
    );
    for (const row of rows) await finish(client, guild, row, 'Time served');
}

async function endSeasonal(client, guild) {
    const season = await pool.query(`SELECT season_number FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    const current = season.rows[0]?.season_number;
    if (!current) return;
    const { rows } = await pool.query(
        `SELECT * FROM mod_suspensions WHERE status = 'active' AND unit = 'seasons' AND target_season_number <= $1`,
        [current],
    );
    for (const row of rows) await finish(client, guild, row, 'Season suspension served');
}

async function alertPlayed(client, row, seriesId) {
    const { rowCount } = await pool.query(
        `INSERT INTO mod_thread_notices (suspension_id, thread_id, kind) VALUES ($1, $2, 'played_alert') ON CONFLICT DO NOTHING`,
        [row.id, `series:${seriesId}`],
    );
    if (!rowCount) return;
    const { logEdge } = require('../stats/report/logChannel');
    await logEdge(client, {
        summary: `A suspended player was recorded in a series that skipped the report check: <@${row.discord_id}>, series ${seriesId}. It does not count toward their suspension. Please review it.`,
        pingInThread: false,
    });
}

/** Rebuild one suspension's ledger and return how many series now count. */
async function countOne(client, guild, row, team) {
    if (team) {
        await pool.query(
            `INSERT INTO mod_suspension_ledger (suspension_id, series_id, team_id)
             SELECT $1, s.id, $2 FROM stats_series s
              WHERE s.status = 'confirmed' AND (s.home_team_id = $2 OR s.away_team_id = $2)
                AND COALESCE((SELECT MAX(g.played_at) FROM stats_games g WHERE g.series_id = s.id), s.confirmed_at) >= $3
             ON CONFLICT DO NOTHING`,
            [row.id, team.teamId, row.starts_at],
        );
    }
    const { rows: ledger } = await pool.query(
        `SELECT l.series_id, s.status AS series_status,
                EXISTS (SELECT 1 FROM stats_game_players p WHERE p.series_id = l.series_id AND p.discord_id = $2) AS played
           FROM mod_suspension_ledger l
           LEFT JOIN stats_series s ON s.id = l.series_id
          WHERE l.suspension_id = $1`,
        [row.id, row.discord_id],
    );
    let served = 0;
    for (const entry of ledger) {
        let counted = true;
        let reason = null;
        if (!entry.series_status) { counted = false; reason = 'series removed'; }
        else if (entry.series_status !== 'confirmed') { counted = false; reason = 'series not confirmed'; }
        else if (entry.played) { counted = false; reason = 'played in it'; }
        if (counted) served += 1;
        await pool.query(
            `UPDATE mod_suspension_ledger SET counted = $3, reason = $4 WHERE suspension_id = $1 AND series_id = $2`,
            [row.id, entry.series_id, counted, reason],
        );
        if (entry.played && entry.series_status === 'confirmed') await alertPlayed(client, row, entry.series_id);
    }
    return served;
}

async function countSeries(client, guild) {
    const { rows } = await pool.query(
        `SELECT * FROM mod_suspensions WHERE status = 'active' AND unit = 'series'
            AND (review_state IS NULL OR review_state <> 'pending')`,
    );
    for (const row of rows) {
        try {
            const team = await resolveTeam(row.discord_id);
            if (team && (team.teamId !== row.team_id)) {
                await pool.query(
                    'UPDATE mod_suspensions SET team_id = $2, team_name = $3, division = $4 WHERE id = $1',
                    [row.id, team.teamId, team.teamName, team.division],
                );
            }
            const served = await countOne(client, guild, row, team);
            if (served !== row.served) await pool.query('UPDATE mod_suspensions SET served = $2 WHERE id = $1', [row.id, served]);
            if (served >= (row.total || 0)) await finish(client, guild, row, `Served all ${row.total} series`);
        } catch (err) {
            Logger.error(`suspension ${row.id} could not be counted`, err);
            higgenLog.logFailure({
                summary: `The moderation clock could not count suspension ${row.id}: ${err.message}`,
                error: err, action: 'moderation.count', where: 'Moderation clock',
            });
        }
    }
}

/** A new season came in with series still owed, so staff choose what happens. */
async function seasonReview(client) {
    const season = await pool.query(`SELECT id, name FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
    const active = season.rows[0];
    if (!active) return;
    const { rows } = await pool.query(
        `SELECT s.*, c.target_name FROM mod_suspensions s JOIN mod_cases c ON c.id = s.case_id
          WHERE s.status IN ('active','queued') AND s.unit = 'series'
            AND s.season_id IS NOT NULL AND s.season_id <> $1
            AND s.review_season_id IS DISTINCT FROM $1`,
        [active.id],
    );
    for (const row of rows) {
        const left = Math.max((row.total || 0) - (row.served || 0), 0);
        const msg = await posting.sendTo(client, CHANNELS.TIMEOUT_LOG, {
            embeds: [new EmbedBuilder()
                .setTitle(`Unfinished suspension: ${row.target_name || row.discord_id}`.slice(0, 256))
                .setDescription(`<@${row.discord_id}> still owes ${left} series going into ${active.name}. Counting is paused until staff choose.`)
                .addFields({ name: 'Case', value: String(row.case_id), inline: true })
                .setColor(posting.COLORS.suspend)
                .setTimestamp()],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`md:carry:${row.id}`).setLabel('Carry over').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`md:clear:${row.id}`).setLabel('Clear it').setStyle(ButtonStyle.Secondary),
            )],
            allowedMentions: { parse: [] },
        }, 'a season review');
        if (msg) {
            await pool.query(
                `UPDATE mod_suspensions SET review_season_id = $2, review_state = 'pending' WHERE id = $1`,
                [row.id, active.id],
            );
        }
    }
}

async function retrySheets() {
    const { rows } = await pool.query(
        `SELECT DISTINCT discord_id FROM mod_suspensions WHERE sheet_synced = FALSE LIMIT 10`,
    );
    for (const row of rows) await syncSheet(row.discord_id);
}

async function reminders(client) {
    const { rows } = await pool.query(`SELECT * FROM mod_suspensions WHERE status = 'active'`);
    for (const row of rows) {
        try {
            const team = await resolveTeam(row.discord_id);
            if (team) await remindOpenThreads(client, row, team);
        } catch (err) {
            Logger.warning(`suspension ${row.id} reminder failed: ${err.message}`);
        }
    }
}

async function pruneFlags() {
    await pool.query(
        `DELETE FROM mod_flags WHERE case_id IS NULL AND created_at < NOW() - make_interval(days => $1)`,
        [FLAG_RETENTION_DAYS],
    );
}

async function tick(client) {
    if (running || !db()) return;
    running = true;
    try {
        if (!(await ensureModSchema())) return;
        const guild = getGuild(client);
        if (!guild) return;
        ticks += 1;
        await endTimeouts();
        await tickBans(client, guild);
        await startQueued();
        await endTimed(client, guild);
        await endSeasonal(client, guild);
        await seasonReview(client);
        await countSeries(client, guild);
        if (ticks % SLOW_EVERY === 1) {
            await retrySheets();
            await reminders(client);
            await require('./ffWarnings').tickForfeits(client);
            await pruneFlags();
        }
    } catch (err) {
        Logger.error('Moderation clock failed', err);
        higgenLog.logFailure({ summary: `The moderation clock failed: ${err.message}`, error: err, action: 'moderation.tick', where: 'Moderation clock' });
    } finally {
        running = false;
    }
}

function startModerationClock(client) {
    setTimeout(() => tick(client), 20 * 1000);
    setInterval(() => tick(client), TICK_MS);
}

module.exports = { startModerationClock, tick };
