/**
 * Invite campaign — startup wiring (called once from the bot's ready handler).
 *
 * Event hooks (join / leave / invite create+delete) are attached in bot.js next to
 * the other member handlers; this starts the background jobs.
 */

const Logger = require('../utils/logger');
const { db, ensureInviteSchema } = require('./inviteSchema');
const inviteCache = require('./inviteCache');
const tracker = require('./inviteTracker');
const { checkEndDate } = require('./inviteCampaign');
const { startLiveBoard } = require('./liveBoard');
const { startInviteActions } = require('./inviteActions');
const { getGuild } = require('./inviteNotify');

async function startInvites(client) {
    if (!db()) {
        Logger.warning('Invite tracking not started (no database).');
        return;
    }
    if (!(await ensureInviteSchema())) return;
    const guild = getGuild(client);
    if (guild) {
        try {
            const n = await inviteCache.refresh(guild);
            Logger.info(`Invite tracking: cached ${n} invite(s).`);
        } catch (err) {
            Logger.error('Invite tracking: could not read the invite list (does the bot have Manage Server?)', err);
        }
    }
    // First run records every member's join source (lifetime backfill); later runs
    // catch anything missed while offline.
    setTimeout(() => tracker.reconcile(client), 20 * 1000);
    setInterval(() => tracker.reconcile(client), 30 * 60 * 1000);
    setInterval(() => { tracker.expireClaimWindows(); checkEndDate(client); }, 5 * 60 * 1000);
    setTimeout(() => { tracker.expireClaimWindows(); checkEndDate(client); }, 60 * 1000);
    startLiveBoard(client);
    startInviteActions(client);
    Logger.info('Invite tracking started');
}

module.exports = { startInvites };
