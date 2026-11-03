/**
 * Franchise managers = GM + Assistant GM. An AGM has the same bot powers as the
 * GM of the same team (operator rule, S11), so every "is this a GM?" check goes
 * through here instead of reading ROLES.GM_ROLES directly.
 *
 * ROLES.GM_ROLES is kept fresh by constantsSync; ROLES.AGM_ROLES by agmRoleSync.
 */

const { ROLES } = require('../constants/roles');

/** [teamName, roleId, 'gm' | 'agm'] for every manager role, GMs first. */
function managerRoleEntries() {
    return [
        ...Object.entries(ROLES.GM_ROLES).map(([team, id]) => [team, id, 'gm']),
        ...Object.entries(ROLES.AGM_ROLES || {}).map(([team, id]) => [team, id, 'agm']),
    ].filter(([, id]) => Boolean(id));
}

/** Every GM + AGM role id. */
function managerRoleIds() {
    return managerRoleEntries().map(([, id]) => id);
}

/** GM + AGM role ids for one team (by name). */
function managerRoleIdsFor(teamName) {
    return [ROLES.GM_ROLES[teamName], (ROLES.AGM_ROLES || {})[teamName]].filter(Boolean);
}

/** True when the member holds any GM or AGM role. */
function isFranchiseManager(member) {
    return managerRoleIds().some((id) => member?.roles?.cache?.has(id));
}

/** True when the member holds this team's GM or AGM role. */
function managesTeam(member, teamName) {
    return managerRoleIdsFor(teamName).some((id) => member?.roles?.cache?.has(id));
}

/** 'GM' or 'AGM' for the member on this team (null when neither). */
function managerTitle(member, teamName) {
    if (ROLES.GM_ROLES[teamName] && member?.roles?.cache?.has(ROLES.GM_ROLES[teamName])) return 'GM';
    const agm = (ROLES.AGM_ROLES || {})[teamName];
    if (agm && member?.roles?.cache?.has(agm)) return 'AGM';
    return null;
}

module.exports = {
    managerRoleEntries,
    managerRoleIds,
    managerRoleIdsFor,
    isFranchiseManager,
    managesTeam,
    managerTitle,
};
