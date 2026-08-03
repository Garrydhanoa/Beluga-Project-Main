/**
 * Centralized Role IDs and Team Constants
 *
 * This file contains all Discord role IDs, team names, and related constants
 * used across the bot. Update this file when roles change instead of updating
 * multiple command files.
 */

// Core Role IDs
const ROLES = {
    SALARY_CREW: '1195275384120418354',
    NO_SALARY: '1178820065072775178',
    NEED_RANK: '1156814621366292481',
    SUSPENDED: '1156814621366292483',
    INELIGIBLE: '1156814621366292482',

    // Verification roles (managed by the Double Counter verification bot).
    // The role sync only reads these to decide behavior; it never adds VERIFIED
    // and only adds UNVERIFIED to members who have neither role (see roleSync.js).
    UNVERIFIED: '1510025184403390534',
    VERIFIED: '1509998587009044683',

    // GM Roles (one per team)
    GM_ROLES: {
        'Sublunary': '1209290241081606174',
        'Malfeasance': '1203395625933086820',
        'InTraCate': '1308657439507222568',
        'Archangels': '1391272354583417003',
        'Lotus': '1353120762235584664',
        'Surge': '1391272957627596850',
        'Aviators': '1156814621412429872',
        'Panthers': '1258567672610820196',
        'Clovis Esports': '1391271346033659975',
        '6 Speed': '1308649132860379136',
        'Kingdom': '1273040716771229790',
        'Griffins': '1353200124863447134',
        'Immortals': '1353082025107652678',
        'MNML': '1191140483859234837'
    },

    // Captain Roles (one per division)
    CAPTAINS: {
        MAJORS: '1241953484144771163',
        AAA: '1215050611632902154',
        AA: '1214400884218404875'
    },

    // Division Roles
    DIVISIONS: {
        MAJORS: '1351082850933407814',
        AAA: '1351082987097292822',
        AA: '1351083074343141389'
    },

    // Free Agent Roles (one per division)
    FREE_AGENTS: {
        MAJORS: '1156814621378883662',
        AAA: '1233287362922942576',
        AA: '1156814621378883661'
    }
};

// Team Role IDs (organized by division)
const TEAM_ROLES = {
    MAJORS: {
        'Sublunary': '1209285047929016350',
        'Malfeasance': '1203395072444334131',
        'InTraCate': '1308657057225900112',
        'Archangels': '1391287527079678064',
        'Lotus': '1353120945157570665',
        'Surge': '1391277735279722628',
        'Aviators': '1156814621412429871',
        'Panthers': '1283195620068294658',
        'Clovis Esports': '1353149674839609464',
        '6 Speed': '1308648949740998696'
    },
    AAA: {
        'Sublunary': '1242317373659418715',
        'Malfeasance': '1242329657920065597',
        'InTraCate': '1308657515491229736',
        'Archangels': '1391287523371909244',
        'Lotus': '1353121018402832495',
        'Surge': '1391277059992715345',
        'Aviators': '1242311573712928850',
        'Panthers': '1258569145704906757',
        'Clovis Esports': '1353149734453252197',
        '6 Speed': '1308649059552198737',
        'Kingdom': '1242286493171712081',
        'Griffins': '1353200435418234940',
        'Immortals': '1353082117440929842',
        'MNML': '1242313570234925108'
    },
    AA: {
        'Sublunary': '1209287010678874143',
        'Malfeasance': '1211778920081391627',
        'InTraCate': '1308657674899947541',
        'Archangels': '1391287517269201016',
        'Lotus': '1396382133064564778',
        'Surge': '1391277919283843125',
        'Aviators': '1191089937303474227',
        'Panthers': '1283195270129127518',
        'Clovis Esports': '1353149770692165743',
        '6 Speed': '1308649274359152711',
        'Kingdom': '1191136058507792404',
        'Griffins': '1353200552594505760',
        'Immortals': '1353082156447957166',
        'MNML': '1191510093703942264'
    }
};

// Non-Playing (NP) Role IDs
const NP_ROLES = {
    'Sublunary': '1424849974738550974',
    'Malfeasance': '1424849004826591394',
    'InTraCate': '1424846731681468501',
    'Archangels': '1424846026308849767',
    'Lotus': '1424846886631772291',
    'Surge': '1424850111774589029',
    'Aviators': '1424846256915742730',
    'Panthers': '1424849808924872885',
    'Clovis Esports': '1424850693696651376',
    '6 Speed': '1424846430287167558',
    'Kingdom': '1424850398124183552',
    'Griffins': '1424845637601726484',
    'Immortals': '1424846578207952909',
    'MNML': '1424849651781210238'
};

// Team Names (all 14 teams)
const TEAM_NAMES = [
    'Sublunary',
    'Malfeasance',
    'InTraCate',
    'Archangels',
    'Lotus',
    'Surge',
    'Aviators',
    'Panthers',
    'Clovis Esports',
    '6 Speed',
    'Kingdom',
    'Griffins',
    'Immortals',
    'MNML'
];

// Team Colors (for embeds)
const TEAM_COLORS = {
    'Sublunary': 0x3498DB,
    'Malfeasance': 0xE74C3C,
    'InTraCate': 0x1ABC9C,
    'Archangels': 0xF1C40F,
    'Lotus': 0xE91E63,
    'Surge': 0x00FFFF,
    'Aviators': 0x3498DB,
    'Panthers': 0x95A5A6,
    'Clovis Esports': 0x00A651,
    '6 Speed': 0xFF6600,
    'Kingdom': 0x8B4513,
    'Griffins': 0xD4AF37,
    'Immortals': 0xFFD700,
    'MNML': 0xE67E22
};

// Channel IDs
const CHANNELS = {
    // Transaction channels
    TRANSACTION_REQUEST: '1178913188750823544',      // Where requests are posted
    TRANSACTION_CONFIRMATION: '1156814623371169801', // Where confirmations are posted

    // Division channels (for roster updates)
    MAJORS: '1209370015560769637',  // Majors channel for roster messages

    // Onboarding channels (welcome message + the links inside it)
    WELCOME: '1156814622070935632',   // Where the join message + welcome card is posted
    VERIFY: '1509998372227125428',    // Verification instructions
    REGISTER: '1243372169908588554',  // League registration
    SUPPORT: '1304231187547684864'    // Ticket / help channel
};

// Helper function to get team choices for slash commands
function getTeamChoices() {
    return TEAM_NAMES.map(team => ({ name: team, value: team }));
}

// Helper function to get division choices for slash commands
function getDivisionChoices() {
    return [
        { name: 'Majors', value: 'MAJORS' },
        { name: 'AAA', value: 'AAA' },
        { name: 'AA', value: 'AA' }
    ];
}

module.exports = {
    ROLES,
    TEAM_ROLES,
    NP_ROLES,
    TEAM_NAMES,
    TEAM_COLORS,
    CHANNELS,
    getTeamChoices,
    getDivisionChoices
};
