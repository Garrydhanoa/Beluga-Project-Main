// Load environment variables - works in both Node.js and cloud environments
if (typeof process !== 'undefined' && process.env) {
  require('dotenv').config();
}

// Function to get environment variable that works in multiple environments
function getEnvVar(name) {
  // Node.js environment (local and Railway)
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  // Cloudflare Workers environment
  if (typeof globalThis !== 'undefined' && globalThis.env) {
    return globalThis.env[name];
  }
  return undefined;
}

// Function to parse Google credentials JSON
function getGoogleCredentials() {
  const credentialsJson = getEnvVar('GOOGLE_CREDENTIALS');
  if (credentialsJson) {
    try {
      return JSON.parse(credentialsJson);
    } catch (error) {
      console.error('Failed to parse GOOGLE_CREDENTIALS JSON:', error);
      return null;
    }
  }
  return null;
}

const config = {
  // Discord configuration
  discord: {
    token: getEnvVar('DISCORD_TOKEN'),
    applicationId: getEnvVar('APPLICATION_ID'),
    guildId: getEnvVar('GUILD_ID'),
  },

  // Google Sheets configuration
  sheets: {
    credentials: './credentials.json', // For local development
    credentialsJson: getGoogleCredentials(), // For cloud deployment
    spreadsheetIds: {
      aa: getEnvVar('SHEET_ID_AA'),
      aaa: getEnvVar('SHEET_ID_AAA'),
      majors: getEnvVar('SHEET_ID_MAJORS'),
    },
    ranges: {
      aa: 'STANDINGS!J4:M17',    // 14 teams (rows 4-17)
      aaa: 'STANDINGS!J4:M17',   // 14 teams (rows 4-17)
      majors: 'STANDINGS!J4:M13', // 10 teams (rows 4-13)
    },
    defaultRange: 'STANDINGS!J4:M17', // Fallback for unknown divisions
  },

  // Image configuration
  images: {
    dir: './IMAGES',
    logosDir: './IMAGES/logos',
    teamSpacing: 52.5,
    columnSpacing: 50,
    startX: 96,
    startY: 155,
    groupOffset: 427,
    logoWidth: 60,
    fontSize: 15,
    fontFamily: 'Anton, Impact, "Arial Black", "Franklin Gothic Heavy", "Helvetica Bold", Arial, sans-serif',
    fontWeight: '600',
    textColor: 'white',
    textStroke: true,
    strokeColor: '#000000',
    strokeWidth: 1.5,
    columnPadding: 20,
    
    // Fixed column positions (relative to group base x)
    columns: {
      teamName: 67,    // After logo (logoWidth + space)
      separator: 206,  // Separator column (single "-")
      wins: 190,       // Fixed position for wins
      losses: 220,     // Fixed position for losses
      gameDifferential: 270  // Fixed position for GD
    },

    // Per-division overrides for start positions (optional)
    // You can change these values to adjust the starting X/Y for a specific division
    overrides: {
      majors: {
        startX: 97,
        startY: 196
      }
    },
    
    // Team name styling
    teamName: {
      fontSize: 14,
      color: '#FFFFFF',
      fontWeight: '600',
      strokeColor: '#000000',
      strokeWidth: 1.5,
    },
    
    // Wins column styling
    wins: {
      fontSize: 20,
      color: '#00FF00', // Green
      fontWeight: '600',
      strokeColor: '#000000',
      strokeWidth: 1.5,
    },
    
    // Losses column styling
    losses: {
      fontSize: 20,
      color: '#FF0000', // Red
      fontWeight: '600',
      strokeColor: '#000000',
      strokeWidth: 1.5,
    },

    // Separator column styling (single hyphen)
    separator: {
      fontSize: 20,
      color: '#FFFFFF',
      fontWeight: '600',
      strokeColor: '#000000',
      strokeWidth: 1.5,
    },
    
    // Game differential styling
    gameDifferential: {
      fontSize: 20,
      positiveColor: '#00FF00', // Green for positive
      negativeColor: '#FF0000', // Red for negative
      fontWeight: '600',
      strokeColor: '#000000',
      strokeWidth: 1.5,
    },
  },

  // Divisions configuration
  divisions: [
    { name: 'AA', value: 'aa', displayName: 'AA Division', teamCount: 14 },
    { name: 'AAA', value: 'aaa', displayName: 'AAA Division', teamCount: 14 },
    { name: 'Majors', value: 'majors', displayName: 'Majors Division', teamCount: 10 },
  ],

  // Bot configuration
  bot: {
    name: 'Beluga League Bot',
    description: 'A Discord bot for Beluga League standings and information',
    version: '2.0.0',
    registrationChannelId: '1243388387281473547', // Updated channel for registration submissions
  },
};

// Validation function
function validateConfig() {
  const required = [
    { path: 'discord.token', envVar: 'DISCORD_TOKEN' },
    { path: 'discord.applicationId', envVar: 'APPLICATION_ID' },
  ];

  const missing = [];
  
  for (const { path, envVar } of required) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], config);
    if (!value) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

module.exports = { config, validateConfig };
