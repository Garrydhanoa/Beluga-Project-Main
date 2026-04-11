import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import path from 'path';
import fs from 'fs';

// Cache to minimize API calls - set to 30 minutes
const cache = {
  data: {},
  timestamp: {},
  expiryTime: 30 * 60 * 1000 // 30 minutes
};

// Define the canonical team names for name matching
const CANONICAL_TEAM_NAMES = [
  "6 Speed", "Archangels", "Aviators", "Clovis Esports",
  "Griffins", "Immortals", "InTraCate", "Kingdom",
  "Lotus", "Malfeasance", "MNML", "Panthers",
  "Sublunary", "Surge"
];

// Get credentials and configuration
function getConfig() {
  try {
    // In production (Vercel), ALWAYS use environment variables for security
    if (process.env.NODE_ENV === 'production') {
      console.log('Production environment detected, using environment variables for credentials');
      return {
        auth: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        },
        sheetIds: {
          'majors': process.env.SHEET_ID_MAJORS,
          'aaa': process.env.SHEET_ID_AAA,
          'aa': process.env.SHEET_ID_AA
        }
      };
    }
    
    // For development, try environment variables first, then fallback to credentials file
    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      console.log('Using credentials from environment variables');
      return {
        auth: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        },
        sheetIds: {
          'majors': process.env.SHEET_ID_MAJORS || '1WD3j_wAELO0yDvQWZo6wK6v8ClW-VCx2qxH2CdyHAYw',
          'aaa': process.env.SHEET_ID_AAA || '10l6mfJOcKGuhp3_LYVC1Y9MigdaeQTULEdTdGNELTOc',
          'aa': process.env.SHEET_ID_AA || '1GFziMfAJK8GblQoL7-qvxu1mI40uV2hhBQkX7TpTdlc'
        }
      };
    }
    
    // Fallback to local credentials file (development only)
    const credPath = path.join(process.cwd(), 'credentials.json');
    
    if (fs.existsSync(credPath)) {
      console.log(`Found local credentials file at: ${credPath} (for development only)`);
      const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      
      // Return both auth credentials and sheet IDs from one source
      return {
        auth: {
          client_email: credentials.client_email,
          private_key: credentials.private_key
        },
        sheetIds: {
          'majors': credentials.sheet_id_majors || '1WD3j_wAELO0yDvQWZo6wK6v8ClW-VCx2qxH2CdyHAYw',
          'aaa': credentials.sheet_id_aaa || '10l6mfJOcKGuhp3_LYVC1Y9MigdaeQTULEdTdGNELTOc',
          'aa': credentials.sheet_id_aa || '1GFziMfAJK8GblQoL7-qvxu1mI40uV2hhBQkX7TpTdlc'
        }
      };
    }
    
    console.error('No credentials found! Please set up environment variables or a credentials.json file.');
    throw new Error('Missing Google Sheets API credentials');
  } catch (error) {
    console.error('Error getting configuration:', error);
    throw error;
  }
}

/**
 * Fetch fresh standings data from Google Sheets and update the cache
 * This is used for background refreshes without returning data
 */
async function fetchFreshStandingsData(division) {
  try {
    console.log(`Background fetch: Getting fresh data for ${division} division`);
    
    // Get configuration (auth credentials and sheet IDs)
    const config = getConfig();
    
    // Get sheet ID from configuration
    const sheetId = config.sheetIds[division];
    if (!sheetId) {
      throw new Error(`No sheet ID configured for division: ${division}`);
    }

    // Create JWT client using service account
    const serviceAccountAuth = new JWT({
      email: config.auth.client_email,
      key: config.auth.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    // Initialize the spreadsheet
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();
    
    // Find the STANDINGS sheet
    const standingsSheet = doc.sheetsByTitle['STANDINGS'];
    if (!standingsSheet) {
      throw new Error(`No "STANDINGS" sheet found in the ${division} spreadsheet`);
    }
    
    // Load all cells from the sheet
    await standingsSheet.loadCells();
    
    // Process data starting from row 4 (index 3 if 0-based)
    const startRow = 3; 
    const rows = [];
    const teamTracker = new Set(); // Keep track of teams we've already processed
    const maxRows = Math.min(50, standingsSheet.rowCount - startRow); // Maximum number of rows to process
    
    // Get the expected team count based on division
    const expectedTeamCount = division === 'majors' ? 12 : 16;
    
    for (let rowIndex = startRow; rowIndex < startRow + maxRows && rows.length < expectedTeamCount; rowIndex++) {
      // Extract data from specific columns based on sheet structure
      const placeCell = standingsSheet.getCell(rowIndex, 7); // Place (e.g., "1st")
      const teamNameCell = standingsSheet.getCell(rowIndex, 9); // Team name in column 9
      
      // Stats columns
      const winsCell = standingsSheet.getCell(rowIndex, 10); // Wins 
      const lossesCell = standingsSheet.getCell(rowIndex, 11); // Losses 
      const gameDiffCell = standingsSheet.getCell(rowIndex, 12); // Game diff 
      const goalDiffCell = standingsSheet.getCell(rowIndex, 13); // Goal diff 
      
      // Get the raw values from the cells
      const teamName = teamNameCell.value;
      const wins = parseInt(winsCell.value || '0', 10);
      const losses = parseInt(lossesCell.value || '0', 10);
      const gameDiff = parseInt(gameDiffCell.value || '0', 10);
      const goalDiff = parseInt(goalDiffCell.value || '0', 10);
      
      // Extract position number from place string (e.g. "1st" -> 1)
      let position = null;
      if (placeCell.value) {
        const placeMatch = String(placeCell.value).match(/^(\d+)/);
        if (placeMatch) {
          position = parseInt(placeMatch[1], 10);
        }
      }
      
      // Top 8 teams qualify for playoffs
      const inPlayoffs = position && position <= 8 ? 1 : 0;
      
      // Skip empty rows, header rows, or duplicate teams
      if (!teamName || teamName === '' || teamName === 'TEAM') {
        continue;
      }
      
      // Find the canonical team name
      const canonicalTeam = findCanonicalTeamName(teamName) || teamName;
      
      // Skip if we've already processed this team (avoid duplicates)
      if (teamTracker.has(canonicalTeam.toLowerCase())) {
        continue;
      }
      
      // Add to tracker
      teamTracker.add(canonicalTeam.toLowerCase());
      
      // Store processed data
      rows.push({
        team: canonicalTeam,
        wins: isNaN(wins) ? 0 : wins,
        losses: isNaN(losses) ? 0 : losses, 
        gameDiff: isNaN(gameDiff) ? (wins - losses) : gameDiff,
        goalDiff: isNaN(goalDiff) ? 0 : goalDiff,
        inPlayoffs: isNaN(inPlayoffs) ? 0 : inPlayoffs
      });
    }
    
    // Process the data and update cache
    const now = Date.now();
    const processedData = processStandingsData(rows, division, now);
    
    console.log(`Background refresh complete for ${division}: ${processedData.length} teams`);
    
    return true;
  } catch (error) {
    console.error(`Background refresh error for ${division}:`, error);
    return false;
  }
}

/**
 * Get standings data from Google Sheets
 */
export async function getStandings(division) {
  console.log(`Fetching standings for ${division} division`);
  
  // Check cache first - ALWAYS use cache if available
  const now = Date.now();
  // Always return cached data if it exists
  if (cache.data[division] && cache.timestamp[division]) {
    const cacheAge = now - cache.timestamp[division];
    const isFresh = cacheAge < cache.expiryTime;
    const ageMinutes = Math.round(cacheAge/1000/60);
    
    // Log cache status - either fresh or stale
    console.log(`Using cached ${division} standings data (cached ${ageMinutes} minutes ago, ${isFresh ? 'fresh' : 'stale'})`);
    
    // If cache is fresh (< 30 min), return it immediately
    if (isFresh) {
      return {
        data: cache.data[division],
        fromCache: true,
        cachedAt: new Date(cache.timestamp[division]).toISOString(),
        fetchError: null
      };
    }
    
    // If cache is stale (> 30 min), we'll fetch new data behind the scenes
    // but still return the cached data for now to avoid slowing down the request
    
    // Start an async fetch in the background that won't block this request
    (async () => {
      try {
        console.log(`Background refresh of ${division} data initiated (${ageMinutes} minutes old)`);
        // This will update the cache but won't affect the current request
        await fetchFreshStandingsData(division);
      } catch (error) {
        console.error(`Background refresh failed for ${division}:`, error);
      }
    })();
    
    // Return the existing cached data while the refresh happens in background
    return {
      data: cache.data[division],
      fromCache: true,
      cachedAt: new Date(cache.timestamp[division]).toISOString(),
      refreshing: true, // Indicate a background refresh is happening
      fetchError: null
    };
  }

  try {
    // Get configuration (auth credentials and sheet IDs)
    const config = getConfig();
    
    // Get sheet ID from configuration
    const sheetId = config.sheetIds[division];
    if (!sheetId) {
      throw new Error(`No sheet ID configured for division: ${division}`);
    }

    console.log(`Using sheet ID for ${division}: ${sheetId}`);
    
    // Create JWT client using service account
    const serviceAccountAuth = new JWT({
      email: config.auth.client_email,
      key: config.auth.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    // Initialize the spreadsheet
    console.log(`Connecting to Google Sheet for ${division}: ${sheetId}`);
    const doc = new GoogleSpreadsheet(sheetId, serviceAccountAuth);
    await doc.loadInfo();
    
    // Find the STANDINGS sheet
    const standingsSheet = doc.sheetsByTitle['STANDINGS'];
    if (!standingsSheet) {
      throw new Error(`No "STANDINGS" sheet found in the ${division} spreadsheet`);
    }
    
    // Load all cells from the sheet
    await standingsSheet.loadCells();
    
    // Log sheet dimensions in development mode
    if (process.env.NODE_ENV === 'development') {
      console.log(`Sheet dimensions: ${standingsSheet.rowCount} rows x ${standingsSheet.columnCount} columns`);
    }
    
    // Optional debugging for sheet structure inspection
    // Enable by setting DEBUG_SHEETS=true in environment variables
    if (process.env.NODE_ENV === 'development' && process.env.DEBUG_SHEETS === 'true') {
      console.log("DEBUG: Scanning sheet structure...");
      for (let r = 0; r < Math.min(10, standingsSheet.rowCount); r++) {
        let rowValues = [];
        for (let c = 0; c < Math.min(20, standingsSheet.columnCount); c++) {
          const cell = standingsSheet.getCell(r, c);
          rowValues.push(cell.value);
        }
        console.log(`Row ${r}: ${JSON.stringify(rowValues)}`);
      }
    }
    
    // Process data starting from row 4 (index 3 if 0-based)
    const startRow = 3; 
    const rows = [];
    const teamTracker = new Set(); // Keep track of teams we've already processed
    const maxRows = Math.min(50, standingsSheet.rowCount - startRow); // Maximum number of rows to process
    
    // Get the expected team count based on division
    const expectedTeamCount = division === 'majors' ? 12 : 16;
    
    for (let rowIndex = startRow; rowIndex < startRow + maxRows && rows.length < expectedTeamCount; rowIndex++) {
      // Extract data from specific columns based on sheet structure
      // Column indices have been verified to map to the right data
      const placeCell = standingsSheet.getCell(rowIndex, 7); // Place (e.g., "1st")
      const teamNameCell = standingsSheet.getCell(rowIndex, 9); // Team name in column 9
      
      // Stats columns
      const winsCell = standingsSheet.getCell(rowIndex, 10); // Wins 
      const lossesCell = standingsSheet.getCell(rowIndex, 11); // Losses 
      const gameDiffCell = standingsSheet.getCell(rowIndex, 12); // Game diff 
      const goalDiffCell = standingsSheet.getCell(rowIndex, 13); // Goal diff 
      
      // Get the raw values from the cells
      const teamName = teamNameCell.value;
      const wins = parseInt(winsCell.value || '0', 10);
      const losses = parseInt(lossesCell.value || '0', 10);
      const gameDiff = parseInt(gameDiffCell.value || '0', 10);
      const goalDiff = parseInt(goalDiffCell.value || '0', 10);
      
      // Extract position number from place string (e.g. "1st" -> 1)
      let position = null;
      if (placeCell.value) {
        const placeMatch = String(placeCell.value).match(/^(\d+)/);
        if (placeMatch) {
          position = parseInt(placeMatch[1], 10);
        }
      }
      
      // Top 8 teams qualify for playoffs
      const inPlayoffs = position && position <= 8 ? 1 : 0;
      
      // Optional debugging for development environments
      if (process.env.NODE_ENV === 'development' && process.env.DEBUG_SHEETS === 'true' && rowIndex < startRow + 5) {
        console.log(`Row ${rowIndex}: Team=${teamName}, W=${wins}, L=${losses}, GD=${gameDiff}, GoalD=${goalDiff}, Place=${placeCell.value || 'N/A'} (Position=${position}), Playoffs=${inPlayoffs}`);
      }
      
      // Skip empty rows, header rows, or duplicate teams
      if (!teamName || teamName === '' || teamName === 'TEAM') {
        continue;
      }
      
      // Find the canonical team name
      const canonicalTeam = findCanonicalTeamName(teamName) || teamName;
      
      // Skip if we've already processed this team (avoid duplicates)
      if (teamTracker.has(canonicalTeam.toLowerCase())) {
        console.log(`Skipping duplicate team: ${canonicalTeam}`);
        continue;
      }
      
      // Add to tracker
      teamTracker.add(canonicalTeam.toLowerCase());
      
      // Store processed data
      rows.push({
        team: canonicalTeam,
        wins: isNaN(wins) ? 0 : wins,
        losses: isNaN(losses) ? 0 : losses, 
        gameDiff: isNaN(gameDiff) ? (wins - losses) : gameDiff,
        goalDiff: isNaN(goalDiff) ? 0 : goalDiff,
        inPlayoffs: isNaN(inPlayoffs) ? 0 : inPlayoffs
      });
    }
    
    // Process the data and update cache
    const processedData = processStandingsData(rows, division, now);
    
    // Return fresh data with no error
    return {
      data: processedData,
      fromCache: false,
      cachedAt: new Date(now).toISOString(),
      fetchError: null
    };
    
  } catch (error) {
    console.error(`Error fetching ${division} standings:`, error);
    
    // If there's previously cached data, return it with the error message
    if (cache.data[division]) {
      console.log(`Fetch failed but returning previously cached ${division} data from ${new Date(cache.timestamp[division]).toLocaleTimeString()}`);
      return {
        data: cache.data[division],
        fromCache: true,
        cachedAt: new Date(cache.timestamp[division]).toISOString(),
        fetchError: error.message || "Failed to fetch fresh data"
      };
    }
    
    // If no cached data exists, use empty data instead of mock data
    console.log(`No cached data available for ${division} - returning empty array with error`);
    return {
      data: [],
      fromCache: false,
      cachedAt: null,
      fetchError: error.message || "Failed to fetch data and no cache available"
    };
  }
}

// No longer using mock data as we're using cached data instead

/**
 * Find canonical team name based on input string
 */
function findCanonicalTeamName(inputTeam) {
  if (!inputTeam) return null;
  
  // Convert to string if not already
  const teamName = String(inputTeam).trim();
  
  // First, try an exact match
  const exactMatch = CANONICAL_TEAM_NAMES.find(
    name => name.toLowerCase() === teamName.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Next, try partial matches
  const partialMatch = CANONICAL_TEAM_NAMES.find(
    name => teamName.toLowerCase().includes(name.toLowerCase()) ||
           name.toLowerCase().includes(teamName.toLowerCase())
  );
  if (partialMatch) return partialMatch;

  // Special cases and abbreviations
  if (teamName.toLowerCase().includes("6 speed")) return "6 Speed";
  if (teamName.toLowerCase().includes("arch")) return "Archangels";
  if (teamName.toLowerCase().includes("avia")) return "Aviators";
  if (teamName.toLowerCase().includes("clovis")) return "Clovis Esports";
  if (teamName.toLowerCase().includes("griffi")) return "Griffins";
  if (teamName.toLowerCase().includes("immort")) return "Immortals";
  if (teamName.toLowerCase().includes("intra")) return "InTraCate";
  if (teamName.toLowerCase().includes("king")) return "Kingdom";
  if (teamName.toLowerCase().includes("lot")) return "Lotus";
  if (teamName.toLowerCase().includes("malf")) return "Malfeasance";
  if (teamName.toLowerCase().includes("mnml")) return "MNML";
  if (teamName.toLowerCase().includes("panth")) return "Panthers";
  if (teamName.toLowerCase().includes("sub")) return "Sublunary";
  if (teamName.toLowerCase().includes("surg")) return "Surge";

  return null; // No match found
}

/**
 * Process raw standings data into the final format
 */
/**
 * Process raw standings data into the final format with sorting and playoff status
 * @param {Array} rows - Raw team data rows
 * @param {string} division - League division (majors, aaa, aa)
 * @param {number} timestamp - Current timestamp for caching
 * @returns {Array} - Processed standings data
 */
function processStandingsData(rows, division, timestamp) {
  // Calculate win percentage and prepare the standings data
  const standings = rows.map(team => ({
    team: team.team,
    wins: team.wins,
    losses: team.losses,
    winPercentage: calculateWinPercentage(team.wins, team.losses),
    gameDiff: team.gameDiff,
    goalDiff: team.goalDiff,
    position: 0, // Will be updated after sorting
    inPlayoffs: team.inPlayoffs || 0 // Using playoffs flag from sheet/calculation
  }));
  
  // Sort by wins (descending), then by goal difference if wins are equal
  const sortedStandings = standings.sort((a, b) => {
    // First sort by wins
    if (b.wins !== a.wins) {
      return b.wins - a.wins;
    }
    // If wins are equal, sort by goal difference
    return b.goalDiff - a.goalDiff;
  });
  
  // Update positions and playoff status after sorting
  sortedStandings.forEach((team, index) => {
    const position = index + 1;
    team.position = position;
    
    // Use inPlayoffs flag to determine playoff status
    team.playoffStatus = team.inPlayoffs === 1 ? 'qualified' : 'eliminated';
    team.positionStyle = team.inPlayoffs === 1
      ? 'bg-gradient-to-br from-green-500/80 to-green-700/80' // Green for qualified
      : 'bg-gradient-to-br from-red-500/70 to-red-700/70'; // Red for eliminated
  });
  
  // Update cache
  cache.data[division] = sortedStandings;
  cache.timestamp[division] = timestamp;
  
  // Log the number of teams in each playoff status (development only)
  if (process.env.NODE_ENV === 'development') {
    const qualifiedCount = sortedStandings.filter(team => team.playoffStatus === 'qualified').length;
    const eliminatedCount = sortedStandings.filter(team => team.playoffStatus === 'eliminated').length;
    console.log(`${division}: ${qualifiedCount} qualified teams, ${eliminatedCount} eliminated teams`);
  }
  
  return sortedStandings;
}

/**
 * Calculate win percentage
 */
function calculateWinPercentage(wins, losses) {
  if (isNaN(wins) || isNaN(losses) || (wins + losses === 0)) return '0.000';
  const percentage = wins / (wins + losses);
  return percentage.toFixed(3);
}
