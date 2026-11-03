/**
 * Who may do what. Every command and every `md:` control checks here.
 *
 * Salary Crew is deliberately not a rank: everyone in it is an Admin or a Director,
 * so their staff role already decides their powers.
 */

const { pool } = require('../utils/database');
const higgenLog = require('../utils/higgenLog');
const { STAFF_ROLES } = require('./modConfig');
const { db } = require('./modSchema');

const RANK = { NONE: 0, TRIAL: 1, MODERATOR: 2, ADMIN: 3, DIRECTOR: 4 };
const RANK_NAME = { 0: 'Member', 1: 'Trial Moderator', 2: 'Moderator', 3: 'Admin', 4: 'Director' };

// Lowest rank allowed to run each action.
const ACTION_RANK = {
    note: RANK.TRIAL,
    warn: RANK.TRIAL,
    timeout: RANK.TRIAL,
    untimeout: RANK.TRIAL,
    modlog: RANK.TRIAL,
    case: RANK.TRIAL,
    reason: RANK.TRIAL,
    evidence: RANK.TRIAL,
    // Any staff member can start these two, but only a Director's goes straight through.
    // Everyone else's becomes a request in #director-chat.
    kick: RANK.TRIAL,
    ban: RANK.TRIAL,
    strike: RANK.ADMIN,
    suspend: RANK.ADMIN,
    unsuspend: RANK.ADMIN,
    release: RANK.ADMIN,
    unban: RANK.ADMIN,
    unstrike: RANK.DIRECTOR,
    void: RANK.DIRECTOR,
    setstrikes: RANK.DIRECTOR,
    decide: RANK.DIRECTOR,
    filter: RANK.ADMIN,
    reportHold: RANK.ADMIN,
};

function rankOf(member) {
    const roles = member?.roles?.cache;
    if (!roles) return RANK.NONE;
    if (roles.has(STAFF_ROLES.DIRECTOR)) return RANK.DIRECTOR;
    if (roles.has(STAFF_ROLES.ADMIN)) return RANK.ADMIN;
    if (roles.has(STAFF_ROLES.MODERATOR)) return RANK.MODERATOR;
    if (roles.has(STAFF_ROLES.TRIAL_MODERATOR)) return RANK.TRIAL;
    return RANK.NONE;
}

function isAllowed(rank, action) {
    return rank >= (ACTION_RANK[action] ?? RANK.DIRECTOR);
}

/**
 * Staff can't action themselves or an equal/higher rank. Directors are the one
 * exception: the rulebook says Directors can receive strikes, and without this
 * nobody could ever issue one.
 *
 * @returns {string|null} why it's refused, or null when allowed
 */
function targetProblem(actorId, actorRank, targetId, targetRank) {
    if (String(actorId) === String(targetId)) return 'You cannot action yourself.';
    if (targetRank >= actorRank && !(actorRank === RANK.DIRECTOR && targetRank === RANK.DIRECTOR)) {
        return `You cannot action a ${RANK_NAME[targetRank]}.`;
    }
    return null;
}

async function isFrozen(staffId) {
    if (!db()) return false;
    try {
        const { rows } = await pool.query(
            'SELECT 1 FROM mod_staff_freezes WHERE staff_id = $1 AND unfrozen_at IS NULL LIMIT 1',
            [String(staffId)],
        );
        return rows.length > 0;
    } catch {
        return false;
    }
}

/**
 * Gate at the top of a command or control. Replies and marks the audit row when
 * refused, so a caller only needs `if (!rank) return;`.
 *
 * @returns {Promise<number|null>} the actor's rank, or null when refused
 */
async function requireAction(interaction, action) {
    const rank = rankOf(interaction.member);
    if (!isAllowed(rank, action)) {
        const need = RANK_NAME[ACTION_RANK[action] ?? RANK.DIRECTOR];
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: `They need to be a ${need} or higher.` });
        await interaction.reply({ content: `This needs ${need} or higher.`, flags: 64 });
        return null;
    }
    if (rank >= RANK.TRIAL && await isFrozen(interaction.user.id)) {
        higgenLog.markSubRouterOutcome(interaction, { outcome: 'denied', note: 'Their moderation access is frozen by the rogue staff brake.' });
        await interaction.reply({ content: 'Your moderation access is frozen until a Director reviews it.', flags: 64 });
        return null;
    }
    return rank;
}

module.exports = { RANK, RANK_NAME, ACTION_RANK, rankOf, isAllowed, targetProblem, isFrozen, requireAction };
