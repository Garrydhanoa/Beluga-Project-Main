/**
 * "What league week is it right now?" — in US EASTERN time, rolling over at
 * 9:00 AM on the season's start weekday (Monday).
 *
 * WHY THIS EXISTS: the week number used to be plain UTC date math. Railway runs
 * in UTC, so the week rolled over at 00:00 UTC Monday — which is 8:00 PM SUNDAY
 * Eastern in summer and 7:00 PM Sunday in winter. Week threads were therefore
 * auto-opening on Sunday evening, a day early by the league's own clock.
 *
 * The rollover is now pinned to 09:00 America/New_York, DST included: Intl
 * resolves the zone's real offset for the instant in question, so nothing has to
 * track EDT vs EST by hand.
 *
 * The trick below is the 9-hour shift. Take the wall-clock time in Eastern,
 * subtract the opening hour, and the CALENDAR DATE of the result tells you which
 * league week you are in:
 *     Mon 08:59 ET  -  9h  ->  Sun 23:59  ->  still the previous week
 *     Mon 09:00 ET  -  9h  ->  Mon 00:00  ->  the new week
 *
 * KEEP IN LOCK-STEP with beluga-league-main/lib/weekThreadStore.js
 * (computeWeekNumber), which mirrors this for the admin panel.
 */

const LEAGUE_TZ = 'America/New_York';
const WEEK_OPEN_HOUR = 9; // 9:00 AM Eastern, Monday

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Wall-clock parts of `date` as seen in `timeZone`.
 * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number}}
 */
function zonedParts(date, timeZone = LEAGUE_TZ) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const out = {};
    for (const p of fmt.formatToParts(date)) {
        if (p.type !== 'literal') out[p.type] = Number(p.value);
    }
    // Some ICU builds report midnight as hour 24 under hour12:false.
    out.hour %= 24;
    return out;
}

/** Midnight UTC of a yyyy-mm-dd (or Date) — the season start, as a plain day. */
function startDayUTC(startDate) {
    if (!startDate) return null;
    const d = startDate instanceof Date ? startDate : new Date(startDate);
    if (Number.isNaN(d.getTime())) return null;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The current league week, or null before the season opens.
 *
 * @param {string|Date} startDate season start_date (must be a Monday)
 * @param {Date} [now] override for testing
 * @param {object} [opts] { timeZone, openHour }
 * @returns {number|null}
 */
function currentLeagueWeek(startDate, now = new Date(), opts = {}) {
    const timeZone = opts.timeZone || LEAGUE_TZ;
    const openHour = opts.openHour == null ? WEEK_OPEN_HOUR : opts.openHour;

    const startUTC = startDayUTC(startDate);
    if (startUTC == null) return null;

    const p = zonedParts(now, timeZone);
    // Eastern wall clock re-expressed as a UTC instant, purely so we can do
    // calendar arithmetic on it; the zone offset is already baked into `p`.
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const shifted = new Date(wall - openHour * 60 * 60 * 1000);
    const shiftedDayUTC = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());

    const diff = shiftedDayUTC - startUTC;
    if (diff < 0) return null; // before 9am ET on the season's opening Monday
    const week = Math.floor(diff / WEEK_MS) + 1;
    return week >= 1 ? week : null;
}

/**
 * The exact instant week N opens (09:00 Eastern on that week's Monday), as a
 * real Date. Used for logging so "why hasn't it opened yet" is answerable.
 */
function weekOpensAt(startDate, weekNumber, opts = {}) {
    const timeZone = opts.timeZone || LEAGUE_TZ;
    const openHour = opts.openHour == null ? WEEK_OPEN_HOUR : opts.openHour;
    const startUTC = startDayUTC(startDate);
    if (startUTC == null || !(weekNumber >= 1)) return null;

    const monday = new Date(startUTC + (weekNumber - 1) * WEEK_MS);
    // Find the UTC instant whose Eastern wall clock is that Monday at openHour.
    // Guess with a fixed offset, then correct once using the real offset —
    // one pass is enough because zone offsets change by at most a couple hours.
    let guess = new Date(Date.UTC(
        monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), openHour + 5, 0, 0
    ));
    for (let i = 0; i < 3; i += 1) {
        const p = zonedParts(guess, timeZone);
        const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
        const want = Date.UTC(
            monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), openHour, 0, 0
        );
        const drift = wall - want;
        if (drift === 0) break;
        guess = new Date(guess.getTime() - drift);
    }
    return guess;
}

/** "Mon, Aug 4, 9:00 AM EDT" — for log lines and staff-facing copy. */
function formatEastern(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'unknown';
    return date.toLocaleString('en-US', {
        timeZone: LEAGUE_TZ,
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
}

module.exports = {
    LEAGUE_TZ,
    WEEK_OPEN_HOUR,
    zonedParts,
    currentLeagueWeek,
    weekOpensAt,
    formatEastern,
};
