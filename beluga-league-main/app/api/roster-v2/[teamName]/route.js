import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';

// Season 8 Stats Sheet (for Member Pull, IR INFO, Logos)
const SEASON8_SHEET_ID = '1UXUBNlz8k9QyfL_MrGrFofKnlOZX_oksjTL4rKMLfn4';

// Main data sheet (for SalSheet with peaks/accounts)
const MAIN_SHEET_ID = '1cnrCOiAX5PfcxqpTX16YvbPVYnBxZiCk_zSCDqoeDGs';

export async function GET(request, { params }) {
  try {
    const { teamName } = params;
    
    if (!teamName) {
      return NextResponse.json(
        { error: 'Team name is required' },
        { status: 400 }
      );
    }

    // Setup authentication
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
    const auth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    // Load both documents
    const season8Doc = new GoogleSpreadsheet(SEASON8_SHEET_ID, auth);
    const mainDoc = new GoogleSpreadsheet(MAIN_SHEET_ID, auth);
    
    await season8Doc.loadInfo();
    await mainDoc.loadInfo();

    // Get all necessary sheets
    const playerDirSheet = mainDoc.sheetsByTitle['Player Directory'];
    const salSheet = mainDoc.sheetsByTitle['SalSheet'];
    const irInfoSheet = season8Doc.sheetsByTitle['IR INFO'];
    const logosSheet = season8Doc.sheetsByTitle['Logos'];

    if (!playerDirSheet || !salSheet) {
      return NextResponse.json(
        { error: 'Required sheets not found' },
        { status: 500 }
      );
    }

    // Load Player Directory data
    const playerDirRows = await playerDirSheet.getRows();
    
    // Find team members (match team name flexibly)
    const teamNameLower = teamName.toLowerCase().trim();
    const teamMembers = playerDirRows.filter(row => {
      const team = row.get('Team')?.toLowerCase().trim() || '';
      // Match exact team name or team name with division suffix
      return team === teamNameLower || team.startsWith(teamNameLower + ' ');
    });

    console.log(`Found ${teamMembers.length} team members for "${teamName}"`);

    // Build SalSheet map by Discord ID for peaks and accounts
    const salRows = await salSheet.getRows();
    const salDataMap = new Map();
    
    salRows.forEach(row => {
      const discordId = row.get('Discord ID')?.trim();
      if (discordId) {
        salDataMap.set(discordId, {
          league: row.get('League'),
          sal2sPeak: row.get('2s PEAK'),
          sal3sPeak: row.get('3s PEAK'),
          sal2sCurrent: row.get('2s Current'),
          sal3sCurrent: row.get('3s Current'),
          mainAccount: row.get('Main Account'),
          altAccount: row.get('Alt Account'),
          salary: row.get('SALARY'),
          nickname: row.get('Nickname')
        });
      }
    });

    console.log(`Loaded ${salDataMap.size} players from SalSheet`);

    // Get IR INFO data
    let irDataMap = new Map();
    if (irInfoSheet) {
      await irInfoSheet.loadHeaderRow();
      const irRows = await irInfoSheet.getRows();
      irRows.forEach(row => {
        const discordId = row.get('Discord ID')?.trim();
        const isIR = row.get('IR?');
        if (discordId && (isIR === 'YES' || isIR === 'TRUE' || isIR === true)) {
          irDataMap.set(discordId, {
            nickname: row.get('Nickname'),
            salName: row.get('SAL Name'),
            info: row.get('INFO About the Person'),
            lastIRDate: row.get('< Last IR date')
          });
        }
      });
    }

    console.log(`Found ${irDataMap.size} IR players`);

    // Get team logo
    let teamLogo = null;
    if (logosSheet) {
      await logosSheet.loadHeaderRow();
      const logoRows = await logosSheet.getRows();
      const logoRow = logoRows.find(row => {
        const logoTeamName = row.get('Team Name')?.toLowerCase().trim();
        return logoTeamName === teamNameLower || teamNameLower.startsWith(logoTeamName);
      });
      if (logoRow) {
        teamLogo = logoRow.get('Logo URL') || logoRow.get('Logo') || logoRow.get('URL');
      }
    }

    // Process team members and organize by division
    const rosterByDivision = {
      major: { gm: null, captains: [], players: [], ir: [] },
      aaa: { gm: null, captains: [], players: [], ir: [] },
      aa: { gm: null, captains: [], players: [], ir: [] }
    };

    teamMembers.forEach(member => {
      const playerName = member.get('Player Name') || member.get('Username');
      const userId = member.get('User ID')?.trim();
      const displayName = member.get('Display Name') || playerName;
      const salary = parseFloat(member.get('Salary')) || 0;
      const league = member.get('League')?.toLowerCase().trim();
      const team = member.get('Team');
      
      // Get role information from Player Directory
      const isGM = member.get('GM?') === 'TRUE' || member.get('GM?') === 'YES' || member.get('GM?') === true;
      
      // Get SAL data by matching User ID to Discord ID
      const salData = salDataMap.get(userId);

      // Determine division (normalize)
      let division = 'unknown';
      if (league) {
        if (league === 'majors' || league === 'major') {
          division = 'major';
        } else if (league === 'aaa') {
          division = 'aaa';
        } else if (league === 'aa') {
          division = 'aa';
        }
      }
      
      // Check captain status per division
      let isCaptain = false;
      if (division === 'major') {
        isCaptain = member.get('Majors Captain?') === 'TRUE' || member.get('Majors Captain?') === 'YES' || member.get('Majors Captain?') === true;
      } else if (division === 'aaa') {
        isCaptain = member.get('AAA Captain?') === 'TRUE' || member.get('AAA Captain?') === 'YES' || member.get('AAA Captain?') === true;
      } else if (division === 'aa') {
        isCaptain = member.get('AA Captain?') === 'TRUE' || member.get('AA Captain?') === 'YES' || member.get('AA Captain?') === true;
      }

      const playerData = {
        username: playerName,
        userId,
        displayName,
        salary,
        sal2sPeak: salData?.sal2sPeak || null,
        sal3sPeak: salData?.sal3sPeak || null,
        sal2sCurrent: salData?.sal2sCurrent || null,
        sal3sCurrent: salData?.sal3sCurrent || null,
        mainAccount: salData?.mainAccount || member.get('Main Account') || playerName,
        altAccount: salData?.altAccount || member.get('Alt Account') || null,
        league: division,
        team,
        teamLogo
      };

      // Check if player is on IR
      const isIR = irDataMap.has(userId);

      if (division !== 'unknown' && rosterByDivision[division]) {
        if (isIR) {
          rosterByDivision[division].ir.push({
            ...playerData,
            irInfo: irDataMap.get(userId)
          });
        } else if (isGM) {
          // Store GM (only one per division)
          if (!rosterByDivision[division].gm) {
            rosterByDivision[division].gm = playerData;
          }
        } else if (isCaptain) {
          rosterByDivision[division].captains.push(playerData);
        } else {
          rosterByDivision[division].players.push(playerData);
        }
      }
    });

    // Sort players by salary (descending)
    Object.keys(rosterByDivision).forEach(div => {
      rosterByDivision[div].players.sort((a, b) => b.salary - a.salary);
      rosterByDivision[div].captains.sort((a, b) => b.salary - a.salary);
      rosterByDivision[div].ir.sort((a, b) => b.salary - a.salary);
    });

    // Filter out empty divisions
    const activeRoster = {};
    Object.keys(rosterByDivision).forEach(div => {
      const divData = rosterByDivision[div];
      const totalPlayers = (divData.gm ? 1 : 0) + divData.captains.length + divData.players.length + divData.ir.length;
      if (totalPlayers > 0) {
        activeRoster[div] = divData;
      }
    });

    return NextResponse.json({
      teamName,
      teamLogo,
      roster: activeRoster,
      totalPlayers: teamMembers.length,
      totalIR: irDataMap.size
    });

  } catch (error) {
    console.error('Error fetching roster:', error);
    return NextResponse.json(
      { error: 'Failed to fetch roster data' },
      { status: 500 }
    );
  }
}
