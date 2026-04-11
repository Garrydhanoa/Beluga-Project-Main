const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { config } = require('../config/config');
const Logger = require('./logger');

const sheets = google.sheets('v4');

class GoogleSheetsService {
  constructor() {
    this.auth = null;
  }

  async authorize() {
    if (this.auth) return this.auth;

    try {
      let credentials;
      
      // Try to get credentials from environment variable first (Railway/cloud deployment)
      if (config.sheets.credentialsJson) {
        credentials = config.sheets.credentialsJson;
        Logger.info('Using Google credentials from environment variable');
      } else {
        // Fallback to file-based credentials (local development)
        const credentialsPath = path.join(__dirname, '../../', config.sheets.credentials);
        
        if (!fs.existsSync(credentialsPath)) {
          throw new Error(`Credentials file not found at: ${credentialsPath}. Please set GOOGLE_CREDENTIALS environment variable for cloud deployment.`);
        }

        credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        Logger.info('Using Google credentials from file');
      }

      const { client_email, private_key } = credentials;

      if (!client_email || !private_key) {
        throw new Error('Invalid credentials: missing client_email or private_key');
      }

      this.auth = new google.auth.JWT(
        client_email,
        null,
        private_key.replace(/\\n/g, '\n'), // Handle escaped newlines
        ['https://www.googleapis.com/auth/spreadsheets.readonly']
      );

      Logger.success('Google Sheets authentication successful');
      return this.auth;
    } catch (error) {
      Logger.error('Failed to authorize Google Sheets', error);
      throw error;
    }
  }

  async fetchStandingsData(division) {
    try {
      // Add timeout wrapper to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Google Sheets API timeout')), 10000); // 10 second timeout
      });

      const fetchPromise = this._fetchStandingsDataInternal(division);
      
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      Logger.error(`Failed to fetch standings data for division: ${division}`, error);
      throw new Error(`Unable to fetch standings: ${error.message}`);
    }
  }

  async _fetchStandingsDataInternal(division) {
    try {
      const auth = await this.authorize();
      const spreadsheetId = config.sheets.spreadsheetIds[division];

      if (!spreadsheetId) {
        throw new Error(`No spreadsheet ID configured for division: ${division}`);
      }

      Logger.info(`Fetching standings data for division: ${division}`);

      const request = {
        spreadsheetId: spreadsheetId,
        range: config.sheets.ranges[division] || config.sheets.defaultRange,
        auth: auth,
      };

      const response = await sheets.spreadsheets.values.get(request);
      const rows = response.data.values;

      if (!rows || rows.length === 0) {
        Logger.warning(`No data found for division: ${division}`);
        return [];
      }

      const standingsData = rows
        .filter(row => row[0]) // Filter out empty rows
        .map((row, index) => ({
          rank: index + 1,
          teamName: row[0] || '',
          wins: parseInt(row[1]) || 0,
          losses: parseInt(row[2]) || 0,
          gameDifferential: parseInt(row[3]) || 0,
        }));

      Logger.success(`Successfully fetched ${standingsData.length} teams for ${division}`);
      return standingsData;

    } catch (error) {
      Logger.error(`Failed to fetch standings data internally for division: ${division}`, error);
      throw error;
    }
  }

  async testConnection(division = 'aa') {
    try {
      await this.fetchStandingsData(division);
      return true;
    } catch (error) {
      return false;
    }
  }
}

// Create singleton instance
const googleSheetsService = new GoogleSheetsService();

async function fetchStandingsData(division) {
  return googleSheetsService.fetchStandingsData(division);
}

module.exports = {
    fetchStandingsData,
    googleSheetsService,
};