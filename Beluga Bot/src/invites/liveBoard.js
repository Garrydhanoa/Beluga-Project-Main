/**
 * The live invite leaderboard — campaign top 10 in the channel staff pick on the
 * admin Invites tab (`invite_settings.live_board_channel_id`).
 *
 * Every 30 s:
 *  - channel changed / cleared  → delete the old message, post in the new one;
 *  - someone posted after it    → delete + repost so it stays at the BOTTOM (sticky);
 *  - message deleted            → repost;
 *  - otherwise                  → edit only if the content actually changed
 *    (relative end-date timestamps tick client-side, so they never force an edit).
 */

const Logger = require('../utils/logger');
const higgenLog = require('../utils/higgenLog');
const { db, getSettings, setSetting } = require('./inviteSchema');
const { fetchChannel } = require('./inviteNotify');
const { buildLiveBoard } = require('./inviteViews');

let running = false;
let lastKey = null;
let lastFailure = null;

async function deleteMessage(client, channelId, messageId) {
    if (!channelId || !messageId) return;
    const ch = await fetchChannel(client, channelId);
    if (!ch) return;
    try { await ch.messages.delete(messageId); } catch { /* already gone */ }
}

async function post(client, channel, view) {
    const msg = await channel.send({ embeds: view.embeds, allowedMentions: { parse: [] } });
    await setSetting('live_board_message_id', msg.id);
    await setSetting('live_board_posted_channel_id', channel.id);
    lastKey = view.key;
    return msg;
}

async function refreshBoard(client, { force = false } = {}) {
    if (running || !db()) return;
    running = true;
    try {
        const s = await getSettings();
        const want = s.live_board_channel_id || null;
        const postedIn = s.live_board_posted_channel_id || null;
        const messageId = s.live_board_message_id || null;

        if (postedIn && postedIn !== want) {
            await deleteMessage(client, postedIn, messageId);
            await setSetting('live_board_message_id', null);
            await setSetting('live_board_posted_channel_id', null);
            lastKey = null;
        }
        if (!want) return;

        const channel = await fetchChannel(client, want);
        if (!channel) throw new Error(`The live-board channel ${want} is missing or the bot cannot see it.`);
        const view = await buildLiveBoard();

        const currentId = postedIn === want ? messageId : null;
        if (!currentId) { await post(client, channel, view); return; }

        const latest = await channel.messages.fetch({ limit: 1 }).then((c) => c.first()).catch(() => null);
        if (!latest || latest.id !== currentId) {
            await deleteMessage(client, want, currentId);
            await post(client, channel, view);
            return;
        }
        if (force || view.key !== lastKey) {
            await latest.edit({ embeds: view.embeds });
            lastKey = view.key;
        }
        lastFailure = null;
    } catch (err) {
        // Log once per distinct problem, not every 30 seconds.
        const sig = `${err.code || ''}:${err.message}`;
        if (sig !== lastFailure) {
            lastFailure = sig;
            Logger.warning(`Invite live board update failed: ${err.message}`);
            higgenLog.logFailure({ summary: `The live invite leaderboard could not be updated: ${err.message}`, error: err, action: 'invites.live-board', where: 'Live invite leaderboard' });
        }
    } finally {
        running = false;
    }
}

function startLiveBoard(client) {
    setInterval(() => { refreshBoard(client).catch(() => {}); }, 30 * 1000);
    setTimeout(() => { refreshBoard(client).catch(() => {}); }, 15 * 1000);
}

module.exports = { startLiveBoard, refreshBoard };
