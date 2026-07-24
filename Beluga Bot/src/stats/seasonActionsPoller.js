/**
 * Season actions poller — the "post the approval embed" half of the director-gated
 * Start-New-Season / Delete-Season flow. Mirrors mmrOutbox.js.
 *
 * Picks up season_action_requests rows the website inserted (status='pending_post'),
 * posts an approval embed to the director channel with ✅ / ❌ reactions, and flips the
 * row to 'awaiting_approval' with a 24h expiry. A second sweep expires stale requests.
 * The actual DB mutation is done by seasonApprovals.js once 3 directors react ✅.
 */

const { EmbedBuilder } = require('discord.js');
const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');

const DIRECTOR_CHANNEL_ID = process.env.DIRECTOR_APPROVAL_CHANNEL_ID || '1473156680568016906';

function dbAvailable() {
  return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

function buildEmbed(row) {
  const p = row.payload || {};
  const isReset = row.action === 'reset';
  const who = row.initiated_by_discord_id
    ? `<@${row.initiated_by_discord_id}>`
    : (row.initiated_by_username || 'Unknown');

  const lines = [`**Initiated by:** ${who}`, ''];
  if (isReset) {
    lines.push(`**Archive:** Season ${p.oldSeasonNumber ?? '—'} (kept forever, still browsable)`);
    lines.push(`**Create + activate:** Season ${p.newSeasonNumber}${p.newName ? ` — ${p.newName}` : ''}`);
    lines.push('**Teams:** carried over with logos, colors & Discord roles — **rosters emptied**');
    lines.push('**Schedule:** not generated (add/adjust teams first)');
    lines.push('**Standings / power rankings / stats:** start fresh for the new season');
  } else {
    lines.push(`**Delete:** Season ${p.seasonNumber}${p.name ? ` — ${p.name}` : ''} (${p.status})`);
    lines.push('Removes its teams, rosters, schedule, brackets, series & games + per-season stat aggregates.');
    lines.push('**Lifetime player stats are kept.** If it is the active season, the newest remaining one is auto-activated.');
  }
  lines.push('');
  lines.push('React ✅ to approve — needs **3 distinct directors**. Any ❌ withdraws it. Expires in 24h.');

  return new EmbedBuilder()
    .setColor(isReset ? 0x3498db : 0xe74c3c)
    .setTitle(isReset ? '🔄 Start New Season — Director Approval' : '🗑️ Delete Season — Director Approval')
    .setDescription(lines.join('\n'))
    .setTimestamp(new Date());
}

async function postPending(client) {
  if (!dbAvailable()) return;
  let rows;
  try {
    const res = await pool.query(
      "SELECT * FROM season_action_requests WHERE status = 'pending_post' ORDER BY id ASC LIMIT 5"
    );
    rows = res.rows;
  } catch (err) {
    if (!/relation .* does not exist/.test(String(err.message))) {
      Logger.error(`seasonActions postPending query failed: ${err?.message || err}`);
    }
    return;
  }

  for (const row of rows) {
    try {
      const channel = await client.channels.fetch(DIRECTOR_CHANNEL_ID).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`director channel ${DIRECTOR_CHANNEL_ID} unavailable or not text-based`);
      }
      const msg = await channel.send({ embeds: [buildEmbed(row)] });
      await msg.react('✅').catch(() => {});
      await msg.react('❌').catch(() => {});
      await pool.query(
        `UPDATE season_action_requests
         SET status = 'awaiting_approval', approval_channel_id = $2, approval_message_id = $3,
             posted_at = now(), expires_at = now() + interval '24 hours'
         WHERE id = $1`,
        [row.id, DIRECTOR_CHANNEL_ID, msg.id]
      );
      Logger.info(`Season action #${row.id} (${row.action}) posted for director approval`);
    } catch (err) {
      Logger.error(`Season action #${row.id} post failed: ${err?.code || ''} ${err?.message || err}`);
      await pool.query(
        "UPDATE season_action_requests SET status = 'failed', result = $2 WHERE id = $1",
        [row.id, String(err?.message || err).slice(0, 300)]
      ).catch(() => {});
    }
  }
}

async function sweepExpired(client) {
  if (!dbAvailable()) return;
  let rows;
  try {
    const res = await pool.query(
      `SELECT * FROM season_action_requests
       WHERE status = 'awaiting_approval' AND expires_at IS NOT NULL AND expires_at < now()
       LIMIT 10`
    );
    rows = res.rows;
  } catch {
    return;
  }
  for (const row of rows) {
    await pool.query("UPDATE season_action_requests SET status = 'expired' WHERE id = $1", [row.id]).catch(() => {});
    try {
      const channel = await client.channels.fetch(row.approval_channel_id).catch(() => null);
      if (channel && row.approval_message_id) {
        const msg = await channel.messages.fetch(row.approval_message_id).catch(() => null);
        if (msg && msg.embeds?.[0]) {
          const e = EmbedBuilder.from(msg.embeds[0]).setColor(0x95a5a6).setFooter({ text: '⌛ Expired — no action taken' });
          await msg.edit({ embeds: [e] }).catch(() => {});
        }
      }
    } catch { /* best effort */ }
    Logger.info(`Season action #${row.id} expired without approval`);
  }
}

function startSeasonActionsPoller(client, intervalMs = 15 * 1000) {
  setInterval(() => { postPending(client); sweepExpired(client); }, intervalMs);
  setTimeout(() => { postPending(client); sweepExpired(client); }, 8 * 1000);
  Logger.info('Season actions poller started');
}

module.exports = { startSeasonActionsPoller, postPending, sweepExpired };
