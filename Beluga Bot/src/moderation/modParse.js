/**
 * Parses the free-text lengths staff type into commands and the Mod Logs tab.
 * Website copy: beluga-league-main/lib/modStore.js (parseDuration).
 */

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800, mo: 2592000, y: 31536000 };

function unitKey(word) {
    const w = String(word || '').toLowerCase();
    if (w.startsWith('mo')) return 'mo';
    if (w.startsWith('y')) return 'y';
    if (w.startsWith('w')) return 'w';
    if (w.startsWith('d')) return 'd';
    if (w.startsWith('h')) return 'h';
    if (w.startsWith('s')) return 's';
    if (w.startsWith('m')) return 'm';
    return null;
}

/** "10m", "2 days", "1 week", "1h 30m", "6mo" → seconds, or null when unreadable. */
function parseDuration(text) {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) return null;
    let total = 0;
    let matched = '';
    const re = /(\d+(?:\.\d+)?)\s*(years?|y|months?|mo|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;
    for (let m = re.exec(raw); m; m = re.exec(raw)) {
        const key = unitKey(m[2]);
        if (!key) return null;
        total += parseFloat(m[1]) * UNIT_SECONDS[key];
        matched += m[0];
    }
    if (!total) return null;
    // Anything left over means the text was not really a duration.
    if (raw.replace(/\s+/g, '').length !== matched.replace(/\s+/g, '').length) return null;
    return Math.round(total);
}

/**
 * "3 series", "2 weeks", "10 days", "1 season", "indefinite".
 * @returns {{unit:string,total:number|null}|null}
 */
function parseSuspensionLength(text) {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) return null;
    if (/^(indefinite|indefinitely|permanent|until further notice)$/.test(raw)) return { unit: 'indefinite', total: null };
    const m = raw.match(/^(\d+)\s*(series|games?|seasons?|weeks?|w|days?|d)$/);
    if (!m) return null;
    const total = parseInt(m[1], 10);
    if (!total) return null;
    const word = m[2];
    if (word === 'series' || word.startsWith('game')) return { unit: 'series', total };
    if (word.startsWith('season')) return { unit: 'seasons', total };
    if (word.startsWith('w')) return { unit: 'weeks', total };
    return { unit: 'days', total };
}

module.exports = { parseDuration, parseSuspensionLength };
