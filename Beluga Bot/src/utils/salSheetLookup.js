/**
 * Cached, read-only bulk lookup of the SalSheet, keyed by Discord ID.
 *
 * Existing commands each re-read the sheet for one person with their own column
 * indexes. That's fine for a slash command, but the AI needs a player's salary
 * and League on nearly every message, so this reads the whole tab once and keeps
 * it for 10 minutes.
 *
 * READ ONLY. Nothing here writes to the sheet.
 *
 * Column map (SalSheet!A:W), matching `commands/whois.js`:
 *   B(1) nickname · I(8) FA? · J(9) Eligible? · K(10) IR? · L(11) Suspended?
 *   O(14) SAL lock · P(15) Discord ID · R(17) League · U(20) RFA
 * plus C(2) 2s PEAK and D(3) 3s PEAK.
 */

const { google } = require('googleapis');
const { googleSheetsService } = require('./googleSheets');
const Logger = require('./logger');

// Same salary spreadsheet the slash commands and the website both use.
const SPREADSHEET_ID = process.env.SHEET_ID_PLAYERS || '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
const RANGE = 'SalSheet!A:W';
const TTL_MS = 10 * 60 * 1000;

const cache = { byId: null, fetchedAt: 0, inflight: null };

function normalizeLeague(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return null;
    if (v.includes('major')) return 'Majors';
    if (v.includes('aaa')) return 'AAA';
    if (v.includes('aa')) return 'AA';
    return null;
}

function yes(v) {
    return String(v || '').trim().toUpperCase() === 'YES';
}

function num(v) {
    // Column O carries the sentinel "NS" for players with no salary, so a plain
    // parseFloat would quietly yield NaN.
    const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
}

async function fetchFresh() {
    const auth = await googleSheetsService.authorize();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: RANGE,
    });

    const byId = new Map();
    for (const row of res.data.values || []) {
        const discordId = String(row[15] || '').trim();
        if (!discordId) continue;
        byId.set(discordId, {
            nickname: row[1] || null,
            sal2sPeak: row[2] || null,
            sal3sPeak: row[3] || null,
            freeAgent: yes(row[8]),
            eligible: yes(row[9]),
            salary: num(row[14]),
            league: normalizeLeague(row[17]),
            rfa: yes(row[20]),
            // NOTE: IR (K) and Suspended (L) are deliberately NOT exposed — this
            // feeds the AI, and those are staff-only.
        });
    }
    return byId;
}

/** Whole sheet as a Map<discordId, row>. Serves stale data if a refresh fails. */
async function getSalSheetMap() {
    const fresh = cache.byId && Date.now() - cache.fetchedAt < TTL_MS;
    if (fresh) return cache.byId;
    if (cache.inflight) return cache.inflight;

    cache.inflight = (async () => {
        try {
            const byId = await fetchFresh();
            cache.byId = byId;
            cache.fetchedAt = Date.now();
            return byId;
        } catch (err) {
            Logger.warning(`SalSheet lookup failed (${err.message}); serving ${cache.byId ? 'stale' : 'empty'}`);
            return cache.byId || new Map();
        } finally {
            cache.inflight = null;
        }
    })();
    return cache.inflight;
}

async function getSalSheetRow(discordId) {
    const map = await getSalSheetMap();
    return map.get(String(discordId)) || null;
}

/** Just the League value — the tie-breaker for which division a GM belongs to. */
async function getSheetLeague(discordId) {
    const row = await getSalSheetRow(discordId);
    return row?.league || null;
}

module.exports = { getSalSheetMap, getSalSheetRow, getSheetLeague };
