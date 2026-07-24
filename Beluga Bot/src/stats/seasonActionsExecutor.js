/**
 * Season lifecycle executor — the DB half of the director-gated Start-New-Season /
 * Delete-Season flow. Called by seasonApprovals.js ONLY after 3 distinct directors
 * have reacted ✅ to the approval embed. Runs the mutation in a single transaction.
 *
 *  reset:  archive the active season → create + activate the new one → copy teams
 *          (division, name, roster_limit, slogan, logo, franchise_id, all four
 *          discord_*_role_id) with EMPTY rosters → copy season_config → NO schedule.
 *          Standings / power rankings / stats start fresh (no rows for the new id).
 *          Open week threads from the old season are marked closed so late captain
 *          reports can't write into the archived season.
 *  delete: delete per-season stat aggregates (keep lifetime) → DELETE the season
 *          (FK cascade removes teams/rosters/schedule/brackets/series/games/threads);
 *          if it was the active season, auto-activate the newest remaining one.
 */

const { pool } = require('../utils/database');
const Logger = require('../utils/logger');

async function executeSeasonAction(row, client) {
  if (row.action === 'reset') return executeReset(row, client);
  if (row.action === 'delete') return executeDelete(row, client);
  throw new Error(`unknown season action: ${row.action}`);
}

async function executeReset(row) {
  const p = row.payload || {};
  const newSeasonNumber = Number(p.newSeasonNumber);
  if (!Number.isInteger(newSeasonNumber) || newSeasonNumber <= 0) {
    throw new Error('invalid new season number');
  }

  const dbClient = await pool.connect();
  let oldId = row.season_id;
  let newId = null;
  let copiedTeams = 0;
  try {
    await dbClient.query('BEGIN');

    if (!oldId) {
      const a = await dbClient.query(
        "SELECT id FROM seasons WHERE status = 'active' ORDER BY season_number DESC LIMIT 1"
      );
      oldId = a.rows[0]?.id || null;
    }

    const clash = await dbClient.query('SELECT 1 FROM seasons WHERE season_number = $1', [newSeasonNumber]);
    if (clash.rowCount) throw new Error(`season ${newSeasonNumber} already exists`);

    // Archive whatever is active (keeps all its data — pure flag flip).
    await dbClient.query("UPDATE seasons SET status = 'archived', updated_at = now() WHERE status = 'active'");

    const created = await dbClient.query(
      `INSERT INTO seasons (season_number, name, status, start_date)
       VALUES ($1, $2, 'active', $3) RETURNING id`,
      [newSeasonNumber, p.newName || null, p.startDate || null]
    );
    newId = created.rows[0].id;

    if (p.carryTeams !== false && oldId) {
      // Carry teams over with identity (logo/roles/franchise), empty rosters, no schedule.
      const ins = await dbClient.query(
        `INSERT INTO teams (season_id, division, name, roster_limit, is_active, logo_mime, logo_data,
                            franchise_id, discord_role_id, discord_gm_role_id, discord_captain_role_id,
                            discord_np_role_id, slogan)
         SELECT $1, division, name, roster_limit, TRUE, logo_mime, logo_data,
                franchise_id, discord_role_id, discord_gm_role_id, discord_captain_role_id,
                discord_np_role_id, slogan
         FROM teams WHERE season_id = $2 AND is_active = TRUE
         ON CONFLICT (season_id, division, name) DO NOTHING`,
        [newId, oldId]
      );
      copiedTeams = ins.rowCount;
    }

    if (p.copyConfig !== false && oldId) {
      await dbClient.query(
        `INSERT INTO season_config (season_id, teams_per_division, weeks, onfield_caps)
         SELECT $1, teams_per_division, weeks, onfield_caps FROM season_config WHERE season_id = $2
         ON CONFLICT (season_id) DO NOTHING`,
        [newId, oldId]
      );
    }

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    dbClient.release();
    throw err;
  }
  dbClient.release();

  // Post-commit, best-effort: stop late reports writing into the archived season.
  if (oldId) {
    await pool.query(
      `UPDATE week_threads SET is_closed = TRUE, closed_at = now()
       WHERE season_id = $1 AND is_closed = FALSE`,
      [oldId]
    ).catch((e) => Logger.error(`season reset: closing old week threads failed: ${e?.message || e}`));
  }

  await pool.query(
    `INSERT INTO stats_audit_log (action, actor_discord_id, actor_name, actor_source, detail)
     VALUES ('season.reset', $1, $2, 'bot', $3::jsonb)`,
    [row.initiated_by_discord_id, row.initiated_by_username,
     JSON.stringify({ oldSeasonId: oldId, newSeasonId: newId, newSeasonNumber, copiedTeams })]
  ).catch(() => {});

  return `Season ${newSeasonNumber} is now active · ${copiedTeams} team(s) carried over (rosters empty, no schedule).`;
}

async function executeDelete(row) {
  const seasonId = row.season_id;
  if (!seasonId) throw new Error('no season_id on delete request');

  const dbClient = await pool.connect();
  let wasActive = false;
  let promoteId = null;
  try {
    await dbClient.query('BEGIN');

    const cur = await dbClient.query('SELECT status, season_number FROM seasons WHERE id = $1', [seasonId]);
    if (!cur.rowCount) throw new Error('season not found');
    wasActive = cur.rows[0].status === 'active';

    if (wasActive) {
      const other = await dbClient.query(
        'SELECT id FROM seasons WHERE id <> $1 ORDER BY season_number DESC LIMIT 1',
        [seasonId]
      );
      promoteId = other.rows[0]?.id || null;
    }

    // Per-season aggregates have no FK cascade — delete them explicitly; keep lifetime.
    await dbClient.query('DELETE FROM stats_player_season WHERE season_id = $1', [seasonId]);
    await dbClient.query('DELETE FROM stats_team_season WHERE season_id = $1', [seasonId]);

    // The season row — FK cascade removes teams, rosters, schedule_matches, playoff_*,
    // team/player_records, season_config, season_champions, power_rankings, stats_series
    // (→ games → game_players), week_threads, week_thread_actions.
    await dbClient.query('DELETE FROM seasons WHERE id = $1', [seasonId]);

    if (promoteId) {
      await dbClient.query("UPDATE seasons SET status = 'active', updated_at = now() WHERE id = $1", [promoteId]);
    }

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    dbClient.release();
    throw err;
  }
  dbClient.release();

  await pool.query(
    `INSERT INTO stats_audit_log (action, actor_discord_id, actor_name, actor_source, detail)
     VALUES ('season.delete', $1, $2, 'bot', $3::jsonb)`,
    [row.initiated_by_discord_id, row.initiated_by_username,
     JSON.stringify({ seasonId, wasActive, promotedSeasonId: promoteId })]
  ).catch(() => {});

  return `Season deleted${wasActive && promoteId ? ` · activated season id ${promoteId}` : ''}.`;
}

module.exports = { executeSeasonAction };
