/**
 * Fixed channel IDs + tunables for the stats report flow (operator-provided).
 */
const { ROLES } = require('../../constants/roles');

module.exports = {
    // Single edge-case / error log channel (everything abnormal goes here).
    LOG_CHANNEL_ID: '1512286372772184208',
    // Captains chat (used to announce a force-closed week, etc.).
    CAPTAINS_CHAT_ID: '1156814623576698898',
    // Where the final confirmation card posts, per division (DB division strings).
    DIVISION_RESULT_CHANNELS: {
        Majors: '1156814623576698890',
        AAA: '1242326300790620210',
        AA: '1156814623576698891',
    },
    SALARY_CREW_ROLE_ID: ROLES.SALARY_CREW,
    // A pending report is abandoned-pinged after this long with no progress.
    ABANDON_PING_MS: 24 * 60 * 60 * 1000,
    // Idle "Report Series" panel is reposted to the bottom of the thread after this.
    PANEL_REPOST_MS: 5 * 60 * 60 * 1000,
    // Special select values.
    VAL_SKIP: '__skip__',
    VAL_SEARCH: '__search__',
    VAL_UNSET: '__unset__',
};
