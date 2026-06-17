/**
 * Current league week from the active season's start_date (UTC, matching the
 * website's computeWeekNumber and the week-thread auto-open logic). Returns null
 * if there's no start date or the season hasn't started. Read-only helper so the
 * /standings and /power-rankings commands can label graphics with a week number
 * without duplicating (or touching) the week-thread creation code.
 */
function computeCurrentWeek(season) {
    if (!season || !season.start_date) return null;
    const start = new Date(season.start_date);
    if (isNaN(start)) return null;
    const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const ref = new Date();
    const refUTC = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
    const diffMs = refUTC - startUTC;
    if (diffMs < 0) return null;
    const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
    return week >= 1 ? week : null;
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
