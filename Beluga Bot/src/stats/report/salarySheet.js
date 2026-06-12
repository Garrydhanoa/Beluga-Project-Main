/**
 * Reads player salaries from the league SalSheet (the same sheet the register /
 * whois / roster commands use). Discord ID is column P (index 15), salary is
 * column O (index 14). Cached briefly so cap checks don't hammer the Sheets API.
 *
 * Returns { ok, map } so callers can tell "sheet unreadable" (don't block) from
 * "sheet read, this player just isn't on it" (block + tell salary crew).
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../../config/config');
const Logger = require('../../utils/logger');

const SPREADSHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
const SALSHEET_RANGE = 'SalSheet!A:W';
const DISCORD_COL = 15; // Column P
const SALARY_COL = 14;  // Column O
const CACHE_TTL_MS = 5 * 60 * 1000;

let _auth = null;
let _cache = null;
let _cacheAt = 0;

async function authorize() {
    if (_auth) return _auth;
    let credentials;
    if (config.sheets?.credentialsJson) {
        credentials = config.sheets.credentialsJson;
    } else {
        const credPath = path.join(__dirname, '../../../', config.sheets?.credentials || 'credentials.json');
        credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    }
    const { client_email, private_key } = credentials;
    _auth = new google.auth.JWT(
        client_email, null, String(private_key).replace(/\\n/g, '\n'),
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    return _auth;
}

function parseSalary(raw) {
    if (raw == null) return null;
    const n = Number(String(raw).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
}

/** @returns {Promise<{ ok: boolean, map: Map<string, number> }>} */
async function getSalaryMap({ force = false } = {}) {
    if (!force && _cache && Date.now() - _cacheAt < CACHE_TTL_MS) {
        return { ok: true, map: _cache };
    }
    try {
        const auth = await authorize();
        const sheets = google.sheets({ version: 'v4', auth });
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: SALSHEET_RANGE });
        const rows = res.data.values || [];
        const map = new Map();
        for (const row of rows) {
            if (!row || row.length <= DISCORD_COL) continue;
            const discordId = String(row[DISCORD_COL] || '').trim();
            if (!/^\d{16,20}$/.test(discordId)) continue;
            const salary = parseSalary(row[SALARY_COL]);
            if (salary != null) map.set(discordId, salary);
        }
        _cache = map;
        _cacheAt = Date.now();
        Logger.info(`SalSheet salary map loaded (${map.size} players)`);
        return { ok: true, map };
    } catch (err) {
        Logger.error('getSalaryMap (SalSheet) failed', err);
        // Fall back to the last good cache if we have one.
        if (_cache) return { ok: true, map: _cache };
        return { ok: false, map: new Map() };
    }
}

module.exports = { getSalaryMap, parseSalary, SPREADSHEET_ID };
