/**
 * Writes individual SalSheet cells for a player, found by Discord ID (column P).
 *
 * googleSheetsService is read-only, and the writers in roleSync.js and drop.js are
 * private, so this is the one place that writes cells without an interaction. A
 * player can have more than one row, so every matching row is written.
 *
 * Writes run one at a time and back off on 429, because the quota is shared with
 * the role sync and the MMR scraper.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { config } = require('../config/config');
const Logger = require('./logger');

const SPREADSHEET_ID = process.env.SHEET_ID_PLAYERS || '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';
const INDEX_TTL_MS = 60 * 1000;
const MAX_ATTEMPTS = 4;

let sheets = null;
let index = null;   // Map<discordId, number[]> of 1-based row numbers
let indexAt = 0;
let chain = Promise.resolve();

async function client() {
    if (sheets) return sheets;
    let credentials = config.sheets.credentialsJson;
    if (!credentials) {
        credentials = JSON.parse(fs.readFileSync(path.join(__dirname, '../../', config.sheets.credentials), 'utf8'));
    }
    const key = String(credentials.private_key).replace(/\\n/g, '\n');
    const auth = new google.auth.JWT(credentials.client_email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
    await auth.authorize();
    sheets = google.sheets({ version: 'v4', auth });
    return sheets;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withBackoff(fn) {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            const status = err?.code || err?.response?.status;
            if (attempt >= MAX_ATTEMPTS || !(status === 429 || status >= 500)) throw err;
            await sleep(1000 * 2 ** attempt);
        }
    }
}

async function loadIndex(force = false) {
    if (!force && index && Date.now() - indexAt < INDEX_TTL_MS) return index;
    const api = await client();
    const res = await withBackoff(() => api.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'SalSheet!P:P' }));
    const next = new Map();
    (res.data.values || []).forEach((row, i) => {
        const id = String(row[0] || '').trim();
        if (!id) return;
        if (!next.has(id)) next.set(id, []);
        next.get(id).push(i + 1);
    });
    index = next;
    indexAt = Date.now();
    return index;
}

async function rowsFor(discordId) {
    const id = String(discordId);
    let found = (await loadIndex()).get(id);
    if (!found) found = (await loadIndex(true)).get(id);
    return found || [];
}

/**
 * @param {string} discordId
 * @param {Object<string,string>} cells e.g. { L: 'YES' } or { I: 'YES', K: 'NO' }
 * @returns {Promise<{ok:boolean, rows:number, error?:string}>} `rows: 0` means they
 *   simply aren't on the sheet, which is not a failure.
 */
function setCells(discordId, cells) {
    const run = async () => {
        try {
            const rows = await rowsFor(discordId);
            if (!rows.length) return { ok: true, rows: 0 };
            const data = [];
            for (const row of rows) {
                for (const [column, value] of Object.entries(cells)) {
                    data.push({ range: `SalSheet!${column}${row}`, values: [[value]] });
                }
            }
            const api = await client();
            await withBackoff(() => api.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: { valueInputOption: 'RAW', data },
            }));
            return { ok: true, rows: rows.length };
        } catch (err) {
            Logger.warning(`SalSheet write failed for ${discordId}: ${err.message}`);
            return { ok: false, rows: 0, error: err.message };
        }
    };
    const result = chain.then(run, run);
    chain = result.then(() => {}, () => {});
    return result;
}

module.exports = { setCells };
