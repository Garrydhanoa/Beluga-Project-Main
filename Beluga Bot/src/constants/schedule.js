/**
 * League Schedule Constants
 *
 * This file contains all match schedules for each division.
 * Each week contains matchups as [Team1, Team2] pairs.
 *
 * MAJORS: 10 teams, 10 matches per week, every team plays every other team at least once.
 * AAA/AA: 14 teams, 14 matches per week, every team plays every other team at least once.
 */

// AAA/AA Division Schedule (14 teams - 14 matches per week)
const AAA_AA_SCHEDULE = {
    "Week 1": [
        ["Sublunary", "MNML"],
        ["Malfeasance", "Immortals"],
        ["InTraCate", "Griffins"],
        ["Archangels", "Kingdom"],
        ["Lotus", "6 Speed"],
        ["Surge", "Clovis Esports"],
        ["Aviators", "Panthers"],
        ["Aviators", "MNML"],
        ["Panthers", "Surge"],
        ["Clovis Esports", "Lotus"],
        ["6 Speed", "Archangels"],
        ["Kingdom", "InTraCate"],
        ["Griffins", "Malfeasance"],
        ["Immortals", "Sublunary"]
    ],
    "Week 2": [
        ["Immortals", "MNML"],
        ["Sublunary", "Griffins"],
        ["Malfeasance", "Kingdom"],
        ["InTraCate", "6 Speed"],
        ["Archangels", "Clovis Esports"],
        ["Lotus", "Panthers"],
        ["Surge", "Aviators"],
        ["Surge", "MNML"],
        ["Aviators", "Lotus"],
        ["Panthers", "Archangels"],
        ["Clovis Esports", "InTraCate"],
        ["6 Speed", "Malfeasance"],
        ["Kingdom", "Sublunary"],
        ["Griffins", "Immortals"]
    ],
    "Week 3": [
        ["Griffins", "MNML"],
        ["Immortals", "Kingdom"],
        ["Sublunary", "6 Speed"],
        ["Malfeasance", "Clovis Esports"],
        ["InTraCate", "Panthers"],
        ["Archangels", "Aviators"],
        ["Lotus", "Surge"],
        ["Lotus", "MNML"],
        ["Surge", "Archangels"],
        ["Aviators", "InTraCate"],
        ["Panthers", "Malfeasance"],
        ["Clovis Esports", "Sublunary"],
        ["6 Speed", "Immortals"],
        ["Kingdom", "Griffins"]
    ],
    "Week 4": [
        ["Kingdom", "MNML"],
        ["Griffins", "6 Speed"],
        ["Immortals", "Clovis Esports"],
        ["Sublunary", "Panthers"],
        ["Malfeasance", "Aviators"],
        ["InTraCate", "Surge"],
        ["Archangels", "Lotus"],
        ["Archangels", "MNML"],
        ["Lotus", "InTraCate"],
        ["Surge", "Malfeasance"],
        ["Aviators", "Sublunary"],
        ["Panthers", "Immortals"],
        ["Clovis Esports", "Griffins"],
        ["6 Speed", "Kingdom"]
    ],
    "Week 5": [
        ["6 Speed", "MNML"],
        ["Kingdom", "Clovis Esports"],
        ["Griffins", "Panthers"],
        ["Immortals", "Aviators"],
        ["Sublunary", "Surge"],
        ["Malfeasance", "Lotus"],
        ["InTraCate", "Archangels"],
        ["InTraCate", "MNML"],
        ["Archangels", "Malfeasance"],
        ["Lotus", "Sublunary"],
        ["Surge", "Immortals"],
        ["Aviators", "Griffins"],
        ["Panthers", "Kingdom"],
        ["Clovis Esports", "6 Speed"]
    ],
    "Week 6": [
        ["Clovis Esports", "MNML"],
        ["6 Speed", "Panthers"],
        ["Kingdom", "Aviators"],
        ["Griffins", "Surge"],
        ["Immortals", "Lotus"],
        ["Sublunary", "Archangels"],
        ["Malfeasance", "InTraCate"],
        ["Malfeasance", "MNML"],
        ["InTraCate", "Sublunary"],
        ["Archangels", "Immortals"],
        ["Lotus", "Griffins"],
        ["Surge", "Kingdom"],
        ["Aviators", "6 Speed"],
        ["Panthers", "Clovis Esports"]
    ],
    "Week 7": [
        ["Panthers", "MNML"],
        ["Clovis Esports", "Aviators"],
        ["6 Speed", "Surge"],
        ["Kingdom", "Lotus"],
        ["Griffins", "Archangels"],
        ["Immortals", "InTraCate"],
        ["Sublunary", "Malfeasance"],
        ["MNML", "Sublunary"],
        ["Immortals", "Malfeasance"],
        ["Griffins", "InTraCate"],
        ["Kingdom", "Archangels"],
        ["6 Speed", "Lotus"],
        ["Clovis Esports", "Surge"],
        ["Panthers", "Aviators"]
    ],
    "Week 8": [
        ["MNML", "Immortals"],
        ["Griffins", "Sublunary"],
        ["Kingdom", "Malfeasance"],
        ["6 Speed", "InTraCate"],
        ["Clovis Esports", "Archangels"],
        ["Panthers", "Lotus"],
        ["Aviators", "Surge"],
        ["MNML", "Griffins"],
        ["Kingdom", "Immortals"],
        ["6 Speed", "Sublunary"],
        ["Clovis Esports", "Malfeasance"],
        ["Panthers", "InTraCate"],
        ["Aviators", "Archangels"],
        ["Surge", "Lotus"]
    ]
};

// MAJORS Division Schedule (10 teams - 10 matches per week)
const MAJORS_SCHEDULE = {
    "Week 1": [
        ["Sublunary", "6 Speed"],
        ["Malfeasance", "Clovis Esports"],
        ["InTraCate", "Panthers"],
        ["Archangels", "Aviators"],
        ["Lotus", "Surge"],
        ["Clovis Esports", "6 Speed"],
        ["Sublunary", "Panthers"],
        ["Malfeasance", "Aviators"],
        ["InTraCate", "Surge"],
        ["Archangels", "Lotus"]
    ],
    "Week 2": [
        ["Panthers", "6 Speed"],
        ["Clovis Esports", "Aviators"],
        ["Sublunary", "Surge"],
        ["Malfeasance", "Lotus"],
        ["InTraCate", "Archangels"],
        ["Aviators", "6 Speed"],
        ["Panthers", "Surge"],
        ["Clovis Esports", "Lotus"],
        ["Sublunary", "Archangels"],
        ["Malfeasance", "InTraCate"]
    ],
    "Week 3": [
        ["Surge", "6 Speed"],
        ["Aviators", "Lotus"],
        ["Panthers", "Archangels"],
        ["Clovis Esports", "InTraCate"],
        ["Sublunary", "Malfeasance"],
        ["Lotus", "6 Speed"],
        ["Surge", "Archangels"],
        ["Aviators", "InTraCate"],
        ["Panthers", "Malfeasance"],
        ["Clovis Esports", "Sublunary"]
    ],
    "Week 4": [
        ["Archangels", "6 Speed"],
        ["Lotus", "InTraCate"],
        ["Surge", "Malfeasance"],
        ["Aviators", "Sublunary"],
        ["Panthers", "Clovis Esports"],
        ["InTraCate", "6 Speed"],
        ["Archangels", "Malfeasance"],
        ["Lotus", "Sublunary"],
        ["Surge", "Clovis Esports"],
        ["Aviators", "Panthers"]
    ],
    "Week 5": [
        ["Malfeasance", "6 Speed"],
        ["InTraCate", "Sublunary"],
        ["Archangels", "Clovis Esports"],
        ["Lotus", "Panthers"],
        ["Surge", "Aviators"],
        ["6 Speed", "Sublunary"],
        ["Clovis Esports", "Malfeasance"],
        ["Panthers", "InTraCate"],
        ["Aviators", "Archangels"],
        ["Surge", "Lotus"]
    ],
    "Week 6": [
        ["6 Speed", "Clovis Esports"],
        ["Panthers", "Sublunary"],
        ["Aviators", "Malfeasance"],
        ["Surge", "InTraCate"],
        ["Lotus", "Archangels"],
        ["6 Speed", "Panthers"],
        ["Aviators", "Clovis Esports"],
        ["Surge", "Sublunary"],
        ["Lotus", "Malfeasance"],
        ["Archangels", "InTraCate"]
    ],
    "Week 7": [
        ["6 Speed", "Aviators"],
        ["Surge", "Panthers"],
        ["Lotus", "Clovis Esports"],
        ["Archangels", "Sublunary"],
        ["InTraCate", "Malfeasance"],
        ["6 Speed", "Surge"],
        ["Lotus", "Aviators"],
        ["Archangels", "Panthers"],
        ["InTraCate", "Clovis Esports"],
        ["Malfeasance", "Sublunary"]
    ],
    "Week 8": [
        ["6 Speed", "Lotus"],
        ["Archangels", "Surge"],
        ["InTraCate", "Aviators"],
        ["Malfeasance", "Panthers"],
        ["Sublunary", "Clovis Esports"],
        ["6 Speed", "Archangels"],
        ["InTraCate", "Lotus"],
        ["Malfeasance", "Surge"],
        ["Sublunary", "Aviators"],
        ["Clovis Esports", "Panthers"]
    ]
};

/**
 * Get schedule for a specific team and division
 * @param {string} teamName - The team name
 * @param {string} division - The division (MAJORS, AAA, or AA)
 * @returns {Object} Object containing all weeks with matches for that team
 */
function getTeamSchedule(teamName, division) {
    const schedule = division === 'MAJORS' ? MAJORS_SCHEDULE : AAA_AA_SCHEDULE;
    const teamSchedule = {};

    for (const [week, matches] of Object.entries(schedule)) {
        const teamMatches = matches.filter(match =>
            match[0] === teamName || match[1] === teamName
        );

        if (teamMatches.length > 0) {
            teamSchedule[week] = teamMatches.map(match => {
                const opponent = match[0] === teamName ? match[1] : match[0];
                const isHome = match[0] === teamName;
                return {
                    opponent,
                    isHome,
                    matchup: `${match[0]} vs ${match[1]}`
                };
            });
        }
    }

    return teamSchedule;
}

/**
 * Get all matches for a specific week and division
 * @param {number} weekNumber - The week number (1-8)
 * @param {string} division - The division (MAJORS, AAA, or AA)
 * @returns {Array} Array of match arrays [Team1, Team2]
 */
function getWeekMatches(weekNumber, division) {
    const weekKey = `Week ${weekNumber}`;
    const schedule = division === 'MAJORS' ? MAJORS_SCHEDULE : AAA_AA_SCHEDULE;
    return schedule[weekKey] || [];
}

/**
 * Get all unique matchups for a week (combining all divisions)
 * @param {number} weekNumber - The week number (1-8)
 * @returns {Object} Object with MAJORS, AAA_AA arrays of matches
 */
function getAllWeekMatches(weekNumber) {
    return {
        MAJORS: getWeekMatches(weekNumber, 'MAJORS'),
        AAA_AA: getWeekMatches(weekNumber, 'AAA')
    };
}

// Teams that only exist in AAA/AA (not in MAJORS)
const AAA_AA_ONLY_TEAMS = ['Kingdom', 'Griffins', 'Immortals', 'MNML'];

// Teams that exist in all divisions
const ALL_DIVISION_TEAMS = [
    'Sublunary', 'Malfeasance', 'InTraCate', 'Archangels', 'Lotus',
    'Surge', 'Aviators', 'Panthers', 'Clovis Esports', '6 Speed'
];

module.exports = {
    AAA_AA_SCHEDULE,
    MAJORS_SCHEDULE,
    getTeamSchedule,
    getWeekMatches,
    getAllWeekMatches,
    AAA_AA_ONLY_TEAMS,
    ALL_DIVISION_TEAMS
};
