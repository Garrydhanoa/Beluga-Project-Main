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

/**
 * Queue a single MMR update for a freshly-registered player's sheet row.
 * @param {number} rowIndex  1-based SalSheet row where the Discord ID was written.
 * @param {string} discordId The player's Discord ID (for cross-service matching).
 */
async function enqueueRegisterUpdate(rowIndex, discordId) {
    if (!Number.isInteger(rowIndex)) {
        Logger.warning(`registerQueue: skipping enqueue — invalid rowIndex ${rowIndex}`);
        return false;
    }
    try {
        const res = await fetch(`${SCRAPER_URL}/enqueue-register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                row_index: rowIndex,
                discord_id: discordId != null ? String(discordId) : null,
                source: 'register',
            }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`scraper ${res.status}: ${text.slice(0, 200)}`);
        }
        Logger.success(`registerQueue: queued MMR update for row ${rowIndex} (discord ${discordId})`);
        return true;
    } catch (err) {
        // Non-fatal: registration already succeeded; the bulk run will pick this
        // player up later even if this enqueue failed.
        Logger.error(`registerQueue: failed to queue MMR update for row ${rowIndex}: ${err?.message || err}`);
        return false;
    }
}

module.exports = { enqueueRegisterUpdate };
