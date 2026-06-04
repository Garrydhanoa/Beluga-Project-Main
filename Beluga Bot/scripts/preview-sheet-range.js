const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { config } = require('../src/config/config');

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

function parseArgs() {
  const args = process.argv.slice(2);
  const getValue = (key, fallback) => {
    const entry = args.find((arg) => arg.startsWith(`${key}=`));
    if (!entry) return fallback;
    return entry.split('=')[1];
  };

  return {
    division: getValue('--division', null),
    sheet: getValue('--sheet', null),
    range: getValue('--range', 'A1:Z50')
  };
}

async function main() {
  const { division, sheet, range } = parseArgs();
  if (!division || !sheet) {
    throw new Error('Usage: node preview-sheet-range.js --division=aa --sheet=Template [--range=A1:Z50]');
  }

  const spreadsheetId = config.sheets.spreadsheetIds[division];
  if (!spreadsheetId) {
    throw new Error(`No spreadsheet ID configured for division: ${division}`);
  }

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
  const requestRange = `'${sheet}'!${range}`;

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range: requestRange,
    valueRenderOption: 'FORMULA',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });

  const outputDir = path.join(__dirname, '..', 'sheet-dumps', 'previews');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${division}-${sheet}-A1-${range.replace(/[:!]/g, '-')}.json`);
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        division,
        sheet,
        range: requestRange,
        fetchedAt: new Date().toISOString(),
        values: response.data.values || []
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`Saved preview: ${outputPath}`);
}

main().catch((error) => {
  console.error('Preview failed:', error.message);
  process.exit(1);
});
