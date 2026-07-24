/**
 * Register → MMR Updater bridge.
 *
 * When a player finishes the /register flow their Discord ID is appended to the
 * SalSheet (column P) at a known row. This module tells the standalone TRN scraper
 * to run a SINGLE MMR update for that row, tagged source='register', so the website's
 * MMR Updater page shows it in the Done list "from register command".
 *
 * It writes NOTHING itself — it just POSTs the row to the scraper's /enqueue-register
 * endpoint. The scraper drains the queue and runs the single update when idle. The
 * website never resets players; a single update only overwrites that one row.
 *
 * Fully fire-and-forget + non-fatal: a failure here must never affect registration.
 */

const Logger = require('../utils/logger');

// Same default the website proxy uses. Overridable via env for flexibility.
const SCRAPER_URL = (process.env.TRN_SCRAPER_URL || 'https://rl-scraper-production.up.railway.app')
    .replace(/\/$/, '');
// Shared secret so the scraper accepts our calls once auth is enabled (set the SAME
// TRN_SCRAPER_TOKEN on the bot + website + scraper). Empty = not sent (scraper open).
const SCRAPER_TOKEN = process.env.TRN_SCRAPER_TOKEN || '';
const authHeaders = () => (SCRAPER_TOKEN ? { 'X-Auth-Token': SCRAPER_TOKEN } : {});

/**
 * Queue a single MMR update for a player's sheet row.
 * @param {number} rowIndex  1-based SalSheet row where the Discord ID lives.
 * @param {string} discordId The player's Discord ID (for cross-service matching).
 * @param {string} source    Tag for the panel ('register' | 'rejoin' | ...).
 */
async function enqueueRegisterUpdate(rowIndex, discordId, source = 'register') {
    if (!Number.isInteger(rowIndex)) {
        Logger.warning(`registerQueue: skipping enqueue — invalid rowIndex ${rowIndex}`);
        return false;
    }
    try {
        const res = await fetch(`${SCRAPER_URL}/enqueue-register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({
                row_index: rowIndex,
                discord_id: discordId != null ? String(discordId) : null,
                source: source || 'register',
            }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`scraper ${res.status}: ${text.slice(0, 200)}`);
        }
        Logger.success(`registerQueue: queued MMR update for row ${rowIndex} (discord ${discordId}, ${source})`);
        return true;
    } catch (err) {
        // Non-fatal: the bulk run will pick this player up later even if this fails.
        Logger.error(`registerQueue: failed to queue MMR update for row ${rowIndex}: ${err?.message || err}`);
        return false;
    }
}

/**
 * A member rejoined the server — resolve their SalSheet row (via the scraper's cached
 * search) and queue a single MMR pull so they update immediately instead of waiting
 * for the next bulk run. Fully fire-and-forget + non-fatal; silently no-ops if the
 * player isn't in the SalSheet (they may register later).
 * @param {string} discordId
 */
async function enqueueRejoinUpdate(discordId) {
    const id = discordId != null ? String(discordId) : '';
    if (!id) return false;
    try {
        const res = await fetch(`${SCRAPER_URL}/search?q=${encodeURIComponent(id)}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`scraper search ${res.status}`);
        const rows = await res.json().catch(() => []);
        const match = Array.isArray(rows) ? rows.find((r) => String(r.discord_id) === id) : null;
        if (!match || !Number.isInteger(match.row_index)) {
            Logger.info(`registerQueue(rejoin): ${id} not in the SalSheet — skipping`);
            return false;
        }
        return enqueueRegisterUpdate(match.row_index, id, 'rejoin');
    } catch (err) {
        Logger.error(`registerQueue(rejoin): failed for ${id}: ${err?.message || err}`);
        return false;
    }
}

module.exports = { enqueueRegisterUpdate, enqueueRejoinUpdate };
