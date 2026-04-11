import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Tell Next.js this is a dynamic route that shouldn't be prerendered
export const dynamic = 'force-dynamic';

export const revalidate = 3600; // Revalidate every hour

// Function to connect to Google Sheet
async function connectToSheet() {
  try {
    // Get Sheet ID from environment variables or use the hardcoded one if not available
    const sheetId = process.env.POWER_RANKINGS_SHEET_ID || '1wU4Za1xjl_VZwIlaJPeFgP0JRlrOxscJZb0MADxX5CE';
    
    // First attempt: Try using environment variable credentials first - most secure method
    try {
      // Check if we have the required environment variables
      if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        const serviceAccountAuth = new JWT({
          email: process.env.GOOGLE_CLIENT_EMAIL,
          key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
        await doc.loadInfo();
        return doc;
      } else {
        // Skip this method if env vars aren't available
        throw new Error("Environment variables not configured");
      }
    } catch (envAuthError) {
      console.warn('Error using environment variable auth:', envAuthError.message);
      // Continue to next auth method if this fails
    }
    
    // Second attempt: Try using credentials.json file
    try {
      const credentialsPath = path.join(process.cwd(), 'credentials.json');
      const credentialsFile = fs.readFileSync(credentialsPath, 'utf8');
      const credentials = JSON.parse(credentialsFile);
      
      const serviceAccountAuth = new JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
      await doc.loadInfo();
      return doc;
    } catch (fileAuthError) {
      console.warn('Error using credentials file:', fileAuthError.message);
      // Continue to next auth method if this fails
    }
    
    // Third attempt: Try using environment variables
    try {
      const serviceAccountAuth = new JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      
      const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
      await doc.loadInfo();
      return doc;
    } catch (envAuthError) {
      console.warn('Error using environment variables:', envAuthError.message);
      throw new Error(`All authentication methods failed`);
    }
  } catch (error) {
    console.error('Error connecting to Google Sheet:', error);
    throw new Error(`Failed to connect to Google Sheet: ${error.message}`);
  }
}

// Helper function to normalize team names
function normalizeTeamName(name) {
  if (!name) return '';
  // Convert to string in case it's an object
  const nameStr = typeof name === 'string' ? name : String(name);
  return nameStr.trim();
}

// Format division name for sheet lookup
function formatDivisionForSheet(division, week) {
  // Map division to proper format
  const divMap = {
    'aa': 'AA',
    'aaa': 'AAA',
    'majors': 'Majors'
  };
  
  const formattedDiv = divMap[division.toLowerCase()] || 'Majors';
  return `${formattedDiv} W${week}`;
}

export async function GET(request) {
  try {
    // Extract query parameters
    const url = new URL(request.url);
    const division = url.searchParams.get('division') || 'majors';
    const week = parseInt(url.searchParams.get('week') || '1', 10);
    
    // Validate parameters
    if (week < 1 || week > 8) {
      return NextResponse.json({ 
        error: `Invalid week: ${week}. Must be between 1 and 8.`
      }, { status: 400 });
    }
    
    // Connect to sheet
    const doc = await connectToSheet();
    
    // Find the appropriate sheet based on division and week
    const sheetTitle = formatDivisionForSheet(division, week);
    
    let sheet;
    
    // Try to find the exact sheet
    try {
      sheet = doc.sheetsByTitle[sheetTitle];
      if (!sheet) {
        // Use a quieter log level for expected missing sheets
        if (week > 4) { // Only log for weeks that should exist
          console.debug(`Sheet "${sheetTitle}" not found, returning empty data`);
        }
        return NextResponse.json({
          division: division.toUpperCase(),
          week: week,
          data: {
            teams: [],
            players: []
          },
          message: `No data available for ${division.toUpperCase()} Division Week ${week}`
        });
      }
      
      await sheet.loadCells();
    } catch (err) {
      // Only log full error for development
      if (process.env.NODE_ENV === 'development') {
        console.error(`Error loading sheet ${sheetTitle}:`, err);
      } else {
        console.warn(`Error loading sheet ${sheetTitle}`);
      }
      
      // Return empty data instead of an error
      return NextResponse.json({
        division: division.toUpperCase(),
        week: week,
        data: {
          teams: [],
          players: []
        },
        message: `Unable to load data for ${division.toUpperCase()} Division Week ${week}`
      });
    }
    
    // Extract data from specified columns starting from row 21
    // Teams are in columns G, H (starting at index 6, 7)
    // Players are in columns I, J (starting at index 8, 9)
    const startRow = 20; // 0-indexed, so row 21
    
    // Get sheet dimensions
    const rowCount = sheet.rowCount;
    
    let teamData = [];
    let playerData = [];
    
    // Extract team rankings
    for (let rowIndex = startRow; rowIndex < rowCount; rowIndex++) {
      // Check if we have a team name in column G (index 6)
      const teamName = sheet.getCell(rowIndex, 6).value;
      const teamPoints = sheet.getCell(rowIndex, 7).value;
      
      if (!teamName) {
        break; // End of teams data
      }
      
      teamData.push({
        team: normalizeTeamName(teamName),
        points: parseFloat(teamPoints) || 0
      });
    }
    
    // Extract player rankings
    for (let rowIndex = startRow; rowIndex < rowCount; rowIndex++) {
      // Check if we have a player name in column I (index 8)
      const playerName = sheet.getCell(rowIndex, 8).value;
      const playerPoints = sheet.getCell(rowIndex, 9).value;
      
      if (!playerName) {
        break; // End of players data
      }
      
      playerData.push({
        player: playerName,
        points: parseFloat(playerPoints) || 0
      });
    }
    
    // Return the formatted data
    return NextResponse.json({
      division: division.toUpperCase(),
      week: week,
      data: {
        teams: teamData,
        players: playerData
      }
    });
    
  } catch (error) {
    console.error('Error in power rankings API:', error);
    // Return empty data arrays instead of error
    return NextResponse.json({
      division: division?.toUpperCase() || 'UNKNOWN',
      week: week || 1,
      data: {
        teams: [],
        players: []
      },
      message: `An error occurred while fetching power rankings data`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
