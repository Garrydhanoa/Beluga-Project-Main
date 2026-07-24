/**
 * Season approvals — reaction handler for the director-gated Start-New-Season /
 * Delete-Season flow. Listens for ✅ / ❌ on the approval embed posted by
 * seasonActionsPoller.js. Requires 3 DISTINCT Director-role members to ✅; any single
 * Director ❌ withdraws it. On the 3rd approval it runs the executor (the actual DB
 * mutation) exactly once.
 *
 * Robustness: on every reaction event it RE-COUNTS the ✅ reactors from Discord
 * (reaction.users.fetch → filter to director-role members), so it survives bot
 * restarts and un-reactions. The bot already runs with GatewayIntentBits
 * .GuildMessageReactions + Partials.Message/Channel/Reaction (see bot.js), which are
 * required for reaction events on uncached/old messages.
 */

const { EmbedBuilder } = require('discord.js');
const { pool, isDatabaseAvailable } = require('../utils/database');
const Logger = require('../utils/logger');
const { executeSeasonAction } = require('./seasonActionsExecutor');

const DIRECTOR_ROLE_ID = process.env.DISCORD_DIRECTOR_ROLE_ID;
const APPROVALS_REQUIRED = 3;

function dbAvailable() {
  return typeof isDatabaseAvailable === 'function' ? isDatabaseAvailable() : isDatabaseAvailable;
}

async function loadRequestByMessage(messageId) {
  const res = await pool
    .query('SELECT * FROM season_action_requests WHERE approval_message_id = $1 LIMIT 1', [String(messageId)])
    .catch(() => ({ rows: [] }));
  return res.rows[0] || null;
}

// Distinct director-role users who reacted with `emojiName` on the message.
async function directorReactors(message, emojiName) {
  const guild = message.guild;
  if (!guild) return [];
  const reaction = message.reactions.cache.find((r) => r.emoji?.name === emojiName);
  if (!reaction) return [];
  const users = await reaction.users.fetch().catch(() => null);
  if (!users) return [];
  const ids = [];
  for (const [, u] of users) {
    if (u.bot) continue;
    const member = await guild.members.fetch(u.id).catch(() => null);
    if (member && DIRECTOR_ROLE_ID && member.roles.cache.has(DIRECTOR_ROLE_ID)) ids.push(u.id);
  }
  return [...new Set(ids)];
}

async function editEmbedFooter(message, color, footer) {
  try {
    const base = message.embeds?.[0] ? EmbedBuilder.from(message.embeds[0]) : new EmbedBuilder();
    base.setColor(color).setFooter({ text: String(footer).slice(0, 2048) });
    await message.edit({ embeds: [base] });
  } catch { /* best effort */ }
}

async function handleReaction(reaction, user, client) {
  try {
    if (!dbAvailable()) return;
    if (user?.bot) return;

    // Hydrate partials (uncached/old messages).
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
    if (reaction.message?.partial) { try { await reaction.message.fetch(); } catch { return; } }

    const name = reaction.emoji?.name;
    if (name !== '✅' && name !== '❌') return;

    const row = await loadRequestByMessage(reaction.message.id);
    if (!row || row.status !== 'awaiting_approval') return;
    if (row.expires_at && new Date(row.expires_at) < new Date()) return;

    if (!DIRECTOR_ROLE_ID) {
      Logger.warning('DISCORD_DIRECTOR_ROLE_ID not set on the bot — cannot gate season-action approvals');
      return;
    }

    const message = reaction.message;
    const [approvers, decliners] = await Promise.all([
      directorReactors(message, '✅'),
      directorReactors(message, '❌'),
    ]);

    // Persist the live approver set so the website poll can show N/3.
    await pool
      .query('UPDATE season_action_requests SET approver_ids = $2::jsonb WHERE id = $1', [row.id, JSON.stringify(approvers)])
      .catch(() => {});

    // Any director ❌ withdraws it (claim atomically to avoid races).
    if (decliners.length > 0) {
      const claim = await pool.query(
        "UPDATE season_action_requests SET status = 'declined', declined_by = $2 WHERE id = $1 AND status = 'awaiting_approval' RETURNING id",
        [row.id, decliners[0]]
      );
      if (claim.rowCount) {
        await editEmbedFooter(message, 0xe74c3c, '🚫 Withdrawn by a director — no action taken');
        Logger.info(`Season action #${row.id} declined by ${decliners[0]}`);
      }
      return;
    }

    if (approvers.length >= APPROVALS_REQUIRED) {
      // Claim the request so we execute exactly once.
      const claim = await pool.query(
        "UPDATE season_action_requests SET status = 'approved' WHERE id = $1 AND status = 'awaiting_approval' RETURNING *",
        [row.id]
      );
      if (!claim.rowCount) return; // another event already claimed it
      const claimed = claim.rows[0];

      await editEmbedFooter(message, 0x2ecc71, `✅ Approved by ${approvers.length} directors — executing…`);
      try {
        const result = await executeSeasonAction(claimed, client);
        await pool.query(
          "UPDATE season_action_requests SET status = 'executed', executed_at = now(), result = $2 WHERE id = $1",
          [row.id, String(result || '').slice(0, 300)]
        );
        await editEmbedFooter(message, 0x2ecc71, `✅ Done — ${result || ''}`);
        await message.channel.send(`✅ **Season action executed.** ${result || ''}`).catch(() => {});
        Logger.success(`Season action #${row.id} executed: ${result}`);
      } catch (err) {
        await pool.query(
          "UPDATE season_action_requests SET status = 'failed', result = $2 WHERE id = $1",
          [row.id, String(err?.message || err).slice(0, 300)]
        ).catch(() => {});
        await editEmbedFooter(message, 0xe74c3c, `⚠️ Execution failed: ${err?.message || err}`);
        Logger.error(`Season action #${row.id} execution failed: ${err?.code || ''} ${err?.message || err}`);
      }
    }
  } catch (err) {
    Logger.error(`season approval handler error: ${err?.code || ''} ${err?.message || err}`);
  }
}

function registerSeasonApprovalHandlers(client) {
  client.on('messageReactionAdd', (reaction, user) => handleReaction(reaction, user, client));
  client.on('messageReactionRemove', (reaction, user) => handleReaction(reaction, user, client));
  Logger.info('Season approval reaction handlers registered');
}

module.exports = { registerSeasonApprovalHandlers, handleReaction };
