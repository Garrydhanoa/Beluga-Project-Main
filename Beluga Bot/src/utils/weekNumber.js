const { currentLeagueWeek } = require('./leagueWeek');

/**
 * Current league week from the active season's start_date. Rolls over at 9:00 AM
 * MONDAY US EASTERN (see utils/leagueWeek.js) — the same instant the week-thread
 * watcher auto-opens the week, so the bot never labels a graphic "Week 6" before
 * week 6's threads exist. Returns null if there's no start date or the season
 * hasn't opened yet.
 *
 * Read-only helper so /standings and /power-rankings can label graphics without
 * duplicating (or touching) the week-thread creation code.
 */
function computeCurrentWeek(season) {
    if (!season || !season.start_date) return null;
    return currentLeagueWeek(season.start_date);
}

/** Week chosen by the user (option) or the computed current week; may be null. */
function resolveWeek(interaction, season) {
    const opt = interaction.options.getInteger ? interaction.options.getInteger('week') : null;
    if (opt && opt > 0) return opt;
    return computeCurrentWeek(season);
}

/** A ```WEEK N``` code-block header (empty string when week is unknown). */
function weekHeader(week) {
    return week != null ? `\`\`\`\nWEEK ${week}\n\`\`\`` : '';
}

module.exports = { computeCurrentWeek, resolveWeek, weekHeader };
