const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../src/config/config');

const REQUEST_DELAY_MS = 1250;
const META_BASE_BACKOFF_MS = 15000;
const MAX_RETRIES = 6;

function getCredentials() {
  if (config.sheets.credentialsJson) {
    return config.sheets.credentialsJson;
  }

  const credentialsPath = path.join(__dirname, '..', config.sheets.credentials);
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(`Credentials file not found at: ${credentialsPath}`);
  }

  return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
}

function columnLetter(index) {
  let letter = '';
  let temp = index;
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

function getHeaders(values, count = 3) {
  return values.slice(0, count).map((row) => row || []);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaError(error) {
  const message = error?.message || '';
  return message.includes('Quota exceeded') || error?.code === 429;
}

async function fetchSheetValues(sheetsApi, spreadsheetId, title) {
  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title}'`,
    valueRenderOption: 'FORMULA',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });

  return response.data.values || [];
}

async function fetchSheetValuesWithRetry(sheetsApi, spreadsheetId, title) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      return await fetchSheetValues(sheetsApi, spreadsheetId, title);
    } catch (error) {
      attempt += 1;
      if (!isQuotaError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const backoff = REQUEST_DELAY_MS * attempt * 2;
      console.warn(`Quota hit on ${title}. Retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})...`);
      await sleep(backoff);
    }
  }
  return [];
}

async function fetchSpreadsheetMetaWithRetry(sheetsApi, spreadsheetId) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      return await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId,properties.title,sheets.properties'
      });
    } catch (error) {
      attempt += 1;
      if (!isQuotaError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const backoff = META_BASE_BACKOFF_MS * attempt;
      console.warn(`Quota hit on spreadsheet meta. Retrying in ${backoff}ms (attempt ${attempt}/${MAX_RETRIES})...`);
      await sleep(backoff);
    }
  }
  throw new Error('Failed to fetch spreadsheet metadata after retries.');
}

function extractFormulas(values) {
  const formulas = [];
  let maxCols = 0;

  values.forEach((row, rowIndex) => {
    if (!row) return;
    maxCols = Math.max(maxCols, row.length);
    row.forEach((cell, colIndex) => {
      if (typeof cell === 'string' && cell.startsWith('=')) {
        const rowNumber = rowIndex + 1;
        const colNumber = colIndex + 1;
        formulas.push({
          row: rowNumber,
          col: colNumber,
          a1: `${columnLetter(colNumber)}${rowNumber}`,
          formula: cell
        });
      }
    });
  });

  return { formulas, maxCols };
}

async function dumpSpreadsheet(division, spreadsheetId, sheetsApi, outputDir) {
  console.log(`\n=== ${division.toUpperCase()} ===`);
  const meta = await fetchSpreadsheetMetaWithRetry(sheetsApi, spreadsheetId);

  const sheets = meta.data.sheets || [];
  const outputPath = path.join(outputDir, `${division}-sheets.json`);
  let dump = null;

  if (fs.existsSync(outputPath)) {
    try {
      dump = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    } catch {
      dump = null;
    }
  }

  if (!dump || !Array.isArray(dump.sheets)) {
    dump = {
      division,
      spreadsheetId,
      title: meta.data.properties?.title || null,
      fetchedAt: new Date().toISOString(),
      sheets: []
    };
  }

  const existingTitles = new Set(dump.sheets.map((s) => s.title));

  for (const sheet of sheets) {
    const title = sheet.properties?.title;
    if (!title) continue;

    if (existingTitles.has(title)) {
      console.log(`Skipping cached sheet: ${title}`);
      continue;
    }

    console.log(`Fetching values: ${title}`);
    const values = await fetchSheetValuesWithRetry(sheetsApi, spreadsheetId, title);
    const { formulas, maxCols } = extractFormulas(values);

    dump.sheets.push({
      title,
      grid: {
        rowCount: sheet.properties?.gridProperties?.rowCount || null,
        columnCount: sheet.properties?.gridProperties?.columnCount || null
      },
      usedRange: {
        rowCount: values.length,
        columnCount: maxCols
      },
      headers: getHeaders(values, 3),
      formulas
    });

    dump.fetchedAt = new Date().toISOString();
    fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2), 'utf8');
    await sleep(REQUEST_DELAY_MS);
  }

  return dump;
}

async function main() {
  const credentials = getCredentials();
  const { client_email, private_key } = credentials;

  if (!client_email || !private_key) {
    throw new Error('Invalid credentials: missing client_email or private_key');
  }

  const auth = new google.auth.JWT(
    client_email,
    null,
    private_key.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );

  const sheetsApi = google.sheets({ version: 'v4', auth });

  const targets = config.sheets.spreadsheetIds;
  const args = process.argv.slice(2);
  const divisionArg = args.find((arg) => arg.startsWith('--division='));
  const divisionFilter = divisionArg
    ? divisionArg
        .split('=')[1]
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    : null;

  const entries = Object.entries(targets)
    .filter(([, id]) => Boolean(id))
    .filter(([division]) => !divisionFilter || divisionFilter.includes(division));

  if (entries.length === 0) {
    throw new Error('No spreadsheet IDs found in config.sheets.spreadsheetIds');
  }

  const outputDir = path.join(__dirname, '..', 'sheet-dumps');
  fs.mkdirSync(outputDir, { recursive: true });

  for (const [division, spreadsheetId] of entries) {
    const dump = await dumpSpreadsheet(division, spreadsheetId, sheetsApi, outputDir);
    const outputPath = path.join(outputDir, `${division}-sheets.json`);
    fs.writeFileSync(outputPath, JSON.stringify(dump, null, 2), 'utf8');
    console.log(`Saved: ${outputPath}`);
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Sheet dump failed:', error.message);
  process.exit(1);
});
