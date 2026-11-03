/**
 * Rogue staff brake. Too many bans or kicks from one person in a few minutes freezes
 * their moderation commands and alerts the Directors, because the people who could
 * sabotage the league are exactly the ones holding these commands.
 *
 * It can only stop the bot's own commands. A right-click ban is counted and alerted by
 * outsideActions.js but can't be blocked, and removing someone's roles stays a human
 * decision. Directors are alerted rather than frozen, because nobody outranks them.
 */

const { EmbedBuilder } = require('discord.js');
const { pool } = require('../utils/database');
const Logger = require('../utils/logger');
const { CHANNELS, STAFF_ROLES, getSettings, asInt } = require('./modConfig');
const posting = require('./modPosting');
const { getGuild } = require('./modGuild');
const { RANK, rankOf, isFrozen } = require('./modPerms');

const recent = new Map();   // staffId -> timestamps

async function note(client, actor, kind) {
    try {
        if (!actor?.id) return;
        const settings = await getSettings();
        const limit = asInt(settings.rogue_action_limit, 5);
        const windowMs = asInt(settings.rogue_window_minutes, 10) * 60 * 1000;
        const now = Date.now();
        const stamps = (recent.get(actor.id) || []).filter((t) => now - t < windowMs);
        stamps.push(now);
        recent.set(actor.id, stamps);
        if (stamps.length < limit) return;
        recent.delete(actor.id);
        await trip(client, actor, `${stamps.length} bans or kicks in ${asInt(settings.rogue_window_minutes, 10)} minutes (latest: ${kind})`);
    } catch (err) {
        Logger.error('Rogue staff brake failed', err);
    }
}

async function trip(client, actor, why) {
    const guild = getGuild(client);
    const member = guild ? await guild.members.fetch(actor.id).catch(() => null) : null;
    const isDirector = rankOf(member) >= RANK.DIRECTOR;
    if (!isDirector && !(await isFrozen(actor.id))) {
        await pool.query(
            `INSERT INTO mod_staff_freezes (staff_id, staff_name, reason) VALUES ($1, $2, $3)`,
            [actor.id, actor.name || null, why],
        );
    }
    await posting.sendTo(client, CHANNELS.DIRECTOR_CHAT, {
        content: `<@&${STAFF_ROLES.DIRECTOR}>`,
        embeds: [new EmbedBuilder()
            .setTitle('Rogue staff brake')
            .setDescription(isDirector
                ? `<@${actor.id}> tripped the limit, but Directors can't be frozen. Please check this.`
                : `<@${actor.id}>'s moderation commands are frozen until a Director clears them in the Mod Logs tab.`)
            .addFields({ name: 'Why', value: posting.clip(why) })
            .setColor(posting.COLORS.ban)
            .setTimestamp()],
        allowedMentions: { parse: [], roles: [STAFF_ROLES.DIRECTOR] },
    }, 'a rogue staff alert');
    require('./actions').logJob('moderation.rogue-brake', `the rogue staff brake tripped for ${actor.name || actor.id}: ${why}`, {
        target: actor.id, details: [['Why', why], ['Frozen', isDirector ? 'No, they are a Director' : 'Yes']],
    });
}

async function unfreeze(staffId, actor) {
    const { rowCount } = await pool.query(
        `UPDATE mod_staff_freezes SET unfrozen_at = NOW(), unfrozen_by_id = $2, unfrozen_by_name = $3
          WHERE staff_id = $1 AND unfrozen_at IS NULL`,
        [String(staffId), actor?.id || null, actor?.name || null],
    );
    return { summary: rowCount ? 'Their moderation access is restored.' : 'They were not frozen.', problems: [] };
}

module.exports = { note, unfreeze };
