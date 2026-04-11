import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

// Cache for player data
const cache = {
  data: null,
  timestamp: null,
  expiryTime: 30 * 60 * 1000 // 30 minutes
};

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

// Fetch player data from sheets
async function fetchPlayerData() {
  try {
    const config = getConfig();
    
    const serviceAccountAuth = new JWT({
      email: config.auth.client_email,
      key: config.auth.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(config.sheetId, serviceAccountAuth);
    await doc.loadInfo();
    
    // Get both sheets
    const playerDirSheet = doc.sheetsByTitle['Player Directory'];
    const salSheet = doc.sheetsByTitle['SalSheet'];
    
    if (!playerDirSheet || !salSheet) {
      throw new Error('Required sheets not found');
    }
    
    // Load rows from both sheets
    const playerDirRows = await playerDirSheet.getRows();
    const salSheetRows = await salSheet.getRows();
    
    // Create a map of registered players from SalSheet (match by Discord ID)
    const registeredPlayers = new Map();
    salSheetRows.forEach(row => {
      const discordId = row.get('Discord ID'); // Column P in SalSheet
      const nickname = row.get('Nickname');
      const salary = row.get('SAL lock'); // Column O
      const sal2sPeak = row.get('2s PEAK');
      const sal3sPeak = row.get('3s PEAK');
      const sal2sCurrent = row.get('2s Current');
      const sal3sCurrent = row.get('3s Current');
      const fa = row.get('FA?');
      const eligible = row.get('Eligible?');
      const ir = row.get('IR?');
      const suspended = row.get('Suspended?');
      const playing = row.get('Playing?');
      const league = row.get('League');
      const ballchasingLink = row.get('Ballchasing Replay Or Profile LINK!');
      const rlTracker = row.get('RL Tracker based on BC');
      const mainAccount = row.get('Main Account');
      const altAccount = row.get('Alt Account');
      const rfa = row.get('RFA');
      const releaseDate = row.get('< RELEASE DATE');
      const lastIRDate = row.get('< Last IR date');
      
      // Match by Discord ID (User ID) - this ensures correct matching even with duplicate names
      if (discordId) {
        registeredPlayers.set(discordId.trim(), {
          salary: salary ? parseFloat(salary) : null,
          sal2sPeak: sal2sPeak || null,
          sal3sPeak: sal3sPeak || null,
          sal2sCurrent: sal2sCurrent || null,
          sal3sCurrent: sal3sCurrent || null,
          isFreeAgent: fa === 'YES',
          eligible: eligible === 'YES',
          ir: ir === 'YES',
          suspended: suspended === 'YES',
          playing: playing === 'YES',
          league: league || null,
          ballchasingLink: ballchasingLink || null,
          rlTracker: rlTracker || null,
          mainAccount: mainAccount || null,
          altAccount: altAccount || null,
          isRFA: rfa === 'YES',
          releaseDate: releaseDate || null,
          lastIRDate: lastIRDate || null
        });
      }
    });
    
    // Process player directory data
    const players = [];
    playerDirRows.forEach(row => {
      const username = row.get('Username');
      const userId = row.get('User ID');
      const displayName = row.get('Display Name');
      const salary = row.get('Salary');
      const league = row.get('League');
      const team = row.get('Team');
      const fa = row.get('FA');
      const ineligible = row.get('INELIGIBLE');
      // suspended from Player Directory sheet (not used, we get it from SalSheet)
      const mainAccount = row.get('Main Account');
      const altAccount = row.get('Alt Account');
      const gmRole = row.get('GM?');
      const aaCaptainRole = row.get('AA Captain?');
      const aaaCaptainRole = row.get('AAA Captain?');
      const majorsCaptainRole = row.get('Majors Captain?');
      
      if (!username) return;
      
      // Check if player is registered in SalSheet - match by User ID (from Player Directory) with Discord ID (from SalSheet)
      const salData = registeredPlayers.get(userId?.trim());
      
      const isRegistered = salData !== undefined && salData.salary !== null;
      
      // For eligibility: If registered (in SalSheet), use SalSheet data. If not registered, they are NOT eligible
      const isEligibleValue = isRegistered ? salData.eligible : false;
      const isSuspendedValue = isRegistered ? salData.suspended : false;
      const isFreeAgentValue = isRegistered ? salData.isFreeAgent : (fa === 'TRUE' || fa === 'Yes' || fa === '1' || team === 'Free Agent' || !team);
      
      players.push({
        username: username || '',
        userId: userId || '',
        displayName: displayName || username || '',
        salary: isRegistered ? (salData.salary || parseFloat(salary) || 0) : (parseFloat(salary) || 0),
        league: isRegistered ? (salData?.league || league || 'Unknown') : (league || 'Unknown'),
        team: team || 'Free Agent',
        isFreeAgent: isFreeAgentValue,
        isIneligible: ineligible === 'TRUE' || ineligible === 'Yes' || ineligible === '1',
        isSuspended: isSuspendedValue,
        isRegistered: isRegistered,
        mainAccount: mainAccount || salData?.mainAccount || '',
        altAccount: altAccount || salData?.altAccount || '',
        gmRole: gmRole || null,
        aaCaptainRole: aaCaptainRole || null,
        aaaCaptainRole: aaaCaptainRole || null,
        majorsCaptainRole: majorsCaptainRole || null,
        // Additional SAL data
        sal2sPeak: salData?.sal2sPeak || null,
        sal3sPeak: salData?.sal3sPeak || null,
        sal2sCurrent: salData?.sal2sCurrent || null,
        sal3sCurrent: salData?.sal3sCurrent || null,
        isEligible: isEligibleValue,
        isPlaying: salData?.playing || false,
        isIR: salData?.ir || false,
        isRFA: salData?.isRFA || false,
        releaseDate: salData?.releaseDate || null,
        lastIRDate: salData?.lastIRDate || null,
        ballchasingLink: salData?.ballchasingLink || null,
        rlTracker: salData?.rlTracker || null
      });
    });
    
    return players;
  } catch (error) {
    console.error('Error fetching player data:', error);
    throw error;
  }
}

export async function GET() {
  try {
    const now = Date.now();
    
    // Check cache
    if (cache.data && cache.timestamp && (now - cache.timestamp) < cache.expiryTime) {
      return NextResponse.json({
        players: cache.data,
        fromCache: true,
        cachedAt: new Date(cache.timestamp).toISOString()
      });
    }
    
    // Fetch fresh data
    const players = await fetchPlayerData();
    
    // Update cache
    cache.data = players;
    cache.timestamp = now;
    
    return NextResponse.json({
      players: players,
      fromCache: false,
      cachedAt: new Date(now).toISOString()
    });
  } catch (error) {
    console.error('Error in players API:', error);
    
    // Return cached data if available
    if (cache.data) {
      return NextResponse.json({
        players: cache.data,
        fromCache: true,
        cachedAt: new Date(cache.timestamp).toISOString(),
        error: 'Failed to fetch fresh data, using cache'
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to fetch player data', message: error.message },
      { status: 500 }
    );
  }
}
