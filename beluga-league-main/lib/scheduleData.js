// Centralized schedule data for all divisions
// This file is the single source of truth for all team schedules

// Field salary caps for each division
export const FIELD_CAPS = {
  majors: 53,
  aaa: 43.5,
  aa: 35
};

// Salary ranges per division (min / max player salary)
export const SALARY_RANGES = {
  majors: { min: 16, max: 21 },
  aaa:    { min: 13.25, max: 15.75 },
  aa:     { min: 10, max: 13 }
};

// List of all teams
export const teams = [
  "6 Speed",
  "Archangels",
  "Aviators",
  "Clovis Esports",
  "Griffins",
  "Immortals",
  "InTraCate",
  "Kingdom",
  "Lotus",
  "Malfeasance",
  "MNML",
  "Panthers",
  "Sublunary",
  "Surge"
];

// Majors Division Schedule (10 teams - 10 matches per week)
export const majorsSchedule = {
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

// AAA/AA Division Schedule (14 teams - shared schedule)
export const aaaSchedule = {
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

// AA uses the same schedule as AAA
export const aaSchedule = aaaSchedule;

// Helper function to get schedule by division
export function getScheduleByDivision(division) {
  switch (division.toLowerCase()) {
    case 'majors':
    case 'major':
      return majorsSchedule;
    case 'aaa':
      return aaaSchedule;
    case 'aa':
      return aaSchedule;
    default:
      return aaaSchedule;
  }
}

// Helper function to get team matches for a specific team
export function getTeamSchedule(teamName, division = null) {
  const schedules = division 
    ? { [division]: getScheduleByDivision(division) }
    : { majors: majorsSchedule, aaa: aaaSchedule, aa: aaSchedule };
  
  const result = {};
  
  Object.entries(schedules).forEach(([div, schedule]) => {
    const teamSchedule = {};
    Object.entries(schedule).forEach(([week, matches]) => {
      const teamMatches = matches.filter(match => 
        match[0] === teamName || match[1] === teamName
      );
      if (teamMatches.length > 0) {
        teamSchedule[week] = teamMatches;
      }
    });
    if (Object.keys(teamSchedule).length > 0) {
      result[div] = teamSchedule;
    }
  });
  
  return result;
}

// Helper function to get team initials
export function getTeamInitials(teamName) {
  return teamName.split(' ').map(word => word[0]).join('');
}
