import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

// Cache for roster data
const cache = new Map();
const CACHE_EXPIRY = 30 * 60 * 1000; // 30 minutes

// Get credentials
function getConfig() {
  try {
    if (process.env.NODE_ENV === 'production') {
      return {
        auth: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        },
        sheetId: process.env.SHEET_ID_PLAYERS
      };
    }
    
    if (process.env.GOOGLE_CLIENT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
      return {
        auth: {
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
        },
        sheetId: process.env.SHEET_ID_PLAYERS || '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs'
      };
    }
    
    const credPath = path.join(process.cwd(), 'credentials.json');
    if (fs.existsSync(credPath)) {
      const credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      return {
        auth: {
          client_email: credentials.client_email,
          private_key: credentials.private_key
        },
        sheetId: '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs'
      };
    }
    
    throw new Error('Missing Google Sheets API credentials');
  } catch (error) {
    console.error('Error getting configuration:', error);
    throw error;
  }
}

// Fetch roster data from sheets
async function fetchRosterData(teamName) {
  try {
    const config = getConfig();
    
    const serviceAccountAuth = new JWT({
      email: config.auth.client_email,
      key: config.auth.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(config.sheetId, serviceAccountAuth);
    await doc.loadInfo();
    
    const playerDirSheet = doc.sheetsByTitle['Player Directory'];
    const salSheet = doc.sheetsByTitle['SalSheet'];
    
    if (!playerDirSheet || !salSheet) {
      throw new Error('Required sheets not found');
    }
    
    const playerDirRows = await playerDirSheet.getRows();
    const salSheetRows = await salSheet.getRows();
    
    // Create a map of registered players from SalSheet for additional data (match by Discord ID)
    const salDataMap = new Map();
    salSheetRows.forEach(row => {
      const discordId = row.get('Discord ID'); // Column P in SalSheet
      if (discordId) {
        salDataMap.set(discordId.trim(), {
          sal2sPeak: row.get('2s PEAK') || null,
          sal3sPeak: row.get('3s PEAK') || null,
          sal2sCurrent: row.get('2s Current') || null,
          sal3sCurrent: row.get('3s Current') || null,
          mainAccount: row.get('Main Account') || null,
          altAccount: row.get('Alt Account') || null,
          league: row.get('League') || null, // Add league from SalSheet
        });
      }
    });
    
    // Filter players by team and organize roster
    const roster = {
      teamName: teamName,
      gm: null,
      captains: {
        major: [],
        aaa: [],
        aa: []
      },
      players: {
        major: [],
        aaa: [],
        aa: []
      }
    };
    
    playerDirRows.forEach(row => {
      const username = row.get('Username');
      const userId = row.get('User ID'); // Get User ID to match with Discord ID
      const team = row.get('Team');
      const displayName = row.get('Display Name') || username;
      const salary = row.get('Salary');
      const league = row.get('League');
      const gmRole = row.get('GM?');
      const aaCaptainRole = row.get('AA Captain?');
      const aaaCaptainRole = row.get('AAA Captain?');
      const majorsCaptainRole = row.get('Majors Captain?');
      const mainAccount = row.get('Main Account');
      const altAccount = row.get('Alt Account');
      
      // Check if player belongs to this team
      // Match if team starts with teamName (to handle "Fallen Angels" matching "Fallen Angels AA")
      const teamLower = team?.trim().toLowerCase() || '';
      const teamNameLower = teamName.toLowerCase();
      if (teamLower && (teamLower === teamNameLower || teamLower.startsWith(teamNameLower + ' '))) {
        // Get SalSheet data by matching User ID (from Player Directory) with Discord ID (from SalSheet)
        const salData = salDataMap.get(userId?.trim()) || {};
        
        // Use SalSheet league if available, otherwise fall back to Player Directory league
        const playerLeague = salData.league || league || 'Unknown';
        
        const player = {
          username: username || '',
          displayName: displayName || username || '',
          salary: salary ? parseFloat(salary) : 0,
          league: playerLeague,
          mainAccount: mainAccount || salData.mainAccount || '',
          altAccount: altAccount || salData.altAccount || '',
          sal2sPeak: salData.sal2sPeak || null,
          sal3sPeak: salData.sal3sPeak || null,
          sal2sCurrent: salData.sal2sCurrent || null,
          sal3sCurrent: salData.sal3sCurrent || null,
        };
        
        // Check if player is GM
        if (gmRole && gmRole.includes('GM')) {
          roster.gm = {
            ...player,
            gmRole: gmRole
          };
        }
        
        // Check if player is captain and add to appropriate division
        if (majorsCaptainRole) {
          roster.captains.major.push({
            ...player,
            captainRole: majorsCaptainRole
          });
        }
        if (aaaCaptainRole) {
          roster.captains.aaa.push({
            ...player,
            captainRole: aaaCaptainRole
          });
        }
        if (aaCaptainRole) {
          roster.captains.aa.push({
            ...player,
            captainRole: aaCaptainRole
          });
        }
        
        // Add player to appropriate league/division using the correct league from SalSheet
        // Normalize the league name to match roster keys (major, aaa, aa)
        let leagueKey = 'aa'; // default
        if (playerLeague) {
          const normalizedLeague = playerLeague.toLowerCase().replace(' league', '').trim();
          if (normalizedLeague === 'majors' || normalizedLeague === 'major') {
            leagueKey = 'major';
          } else if (normalizedLeague === 'aaa') {
            leagueKey = 'aaa';
          } else if (normalizedLeague === 'aa') {
            leagueKey = 'aa';
          }
        }
        
        if (roster.players[leagueKey]) {
          roster.players[leagueKey].push(player);
        } else {
          // If league doesn't match known divisions, add to AA as default
          roster.players.aa.push(player);
        }
      }
    });
    
    // Sort players by salary (descending) within each division
    Object.keys(roster.players).forEach(division => {
      roster.players[division].sort((a, b) => b.salary - a.salary);
    });
    
    return roster;
  } catch (error) {
    console.error('Error fetching roster data:', error);
    throw error;
  }
}

export async function GET(request, { params }) {
  try {
    const { teamName } = await params;
    const decodedTeamName = decodeURIComponent(teamName);
    const now = Date.now();
    
    // Check cache
    const cacheKey = decodedTeamName.toLowerCase();
    const cached = cache.get(cacheKey);
    
    if (cached && (now - cached.timestamp) < CACHE_EXPIRY) {
      return NextResponse.json({
        roster: cached.data,
        fromCache: true,
        cachedAt: new Date(cached.timestamp).toISOString()
      });
    }
    
    // Fetch fresh data
    const roster = await fetchRosterData(decodedTeamName);
    
    // Update cache
    cache.set(cacheKey, {
      data: roster,
      timestamp: now
    });
    
    return NextResponse.json({
      roster: roster,
      fromCache: false,
      cachedAt: new Date(now).toISOString()
    });
  } catch (error) {
    console.error('Error in roster API:', error);
    
    // Return cached data if available
    const cacheKey = decodeURIComponent(params.teamName).toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) {
      return NextResponse.json({
        roster: cached.data,
        fromCache: true,
        cachedAt: new Date(cached.timestamp).toISOString(),
        error: 'Failed to fetch fresh data, using cache'
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch roster data' },
      { status: 500 }
    );
  }
}
