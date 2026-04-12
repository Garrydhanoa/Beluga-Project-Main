import fs from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')
const DATA_FILE = path.join(DATA_DIR, 'admin-data.json')

const TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'Griffins',
  'Immortals', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance',
  'MNML', 'Panthers', 'Sublunary', 'Surge',
]

const DIVISIONS = ['Majors', 'AAA', 'AA']

function defaultData() {
  return {
    config: {
      notificationBar: {
        enabled: true,
        message: 'Season 9 is now live — Player Directory, Rosters, Standings, and Power Rankings are available for all divisions!',
        href: '/players',
      },
      season: {
        number: 9,
        year: 2026,
        statusLabel: 'SEASON 9 · NOW LIVE',
        recruitingOpen: true,
        description: 'Season in progress',
      },
    },
    champions: [
      { id: 1, season: 1, team: 'Aviators', gm: 'JSTN', year: 2022 },
      { id: 2, season: 2, team: 'Griffins', gm: 'Turbopolsa', year: 2022 },
      { id: 3, season: 3, team: 'Aviators', gm: 'JSTN', year: 2023 },
      { id: 4, season: 4, team: 'Sublunary', gm: 'Kaydop', year: 2023 },
      { id: 5, season: 5, team: 'Immortals', gm: 'Fairy Peak', year: 2024 },
      { id: 6, season: 6, team: 'Archangels', gm: 'ViolentPanda', year: 2024 },
      { id: 7, season: 7, team: 'Surge', gm: 'Scrub Killa', year: 2025 },
      { id: 8, season: 8, team: 'Malfeasance', gm: 'Firstkiller', year: 2025 },
    ],
    matches: [
      { id: 1, division: 'Majors', week: 1, homeTeam: 'Aviators', awayTeam: 'Griffins', homeScore: 3, awayScore: 2, status: 'completed', date: '2026-04-03' },
      { id: 2, division: 'Majors', week: 1, homeTeam: 'Panthers', awayTeam: 'Lotus', homeScore: 4, awayScore: 1, status: 'completed', date: '2026-04-03' },
      { id: 3, division: 'AAA', week: 1, homeTeam: '6 Speed', awayTeam: 'Kingdom', homeScore: 2, awayScore: 3, status: 'completed', date: '2026-04-04' },
      { id: 4, division: 'Majors', week: 2, homeTeam: 'Immortals', awayTeam: 'Archangels', homeScore: null, awayScore: null, status: 'scheduled', date: '2026-04-10' },
      { id: 5, division: 'AA', week: 2, homeTeam: 'Clovis Esports', awayTeam: 'InTraCate', homeScore: null, awayScore: null, status: 'scheduled', date: '2026-04-11' },
    ],
    rankings: {
      Majors: [
        { rank: 1, team: 'Aviators', delta: 2, note: 'Strong 4-0 week, clear frontrunner' },
        { rank: 2, team: 'Griffins', delta: 0, note: 'Holding steady after narrow losses' },
        { rank: 3, team: 'Panthers', delta: 1, note: 'Rising fast off Malfeasance upset' },
        { rank: 4, team: 'Lotus', delta: -2, note: 'Slipped after roster shakeup' },
      ],
      AAA: [
        { rank: 1, team: '6 Speed', delta: 0, note: 'Undefeated through two weeks' },
        { rank: 2, team: 'Kingdom', delta: 1, note: 'Looking sharp in 1v1 drills' },
        { rank: 3, team: 'Sublunary', delta: -1, note: 'Needs wins this weekend' },
      ],
      AA: [
        { rank: 1, team: 'MNML', delta: 3, note: 'Breakout team of the season' },
        { rank: 2, team: 'Clovis Esports', delta: 0, note: 'Veteran core paying off' },
      ],
    },
    rosters: {
      Aviators: [
        { username: 'JSTN', role: 'Captain', rank: 'SSL' },
        { username: 'AstroVibe', role: 'Player', rank: 'GC3' },
        { username: 'ZenRL', role: 'Player', rank: 'GC2' },
      ],
      Griffins: [
        { username: 'Turbopolsa', role: 'Captain', rank: 'SSL' },
        { username: 'BlueStreak', role: 'Player', rank: 'GC3' },
        { username: 'MirageX', role: 'Player', rank: 'GC2' },
      ],
      Aviators_sub: [],
    },
    schedule: [
      { id: 1, division: 'Majors', week: 1, homeTeam: 'Aviators', awayTeam: 'Panthers' },
      { id: 2, division: 'Majors', week: 1, homeTeam: 'Sublunary', awayTeam: 'Lotus' },
      { id: 3, division: 'AAA', week: 1, homeTeam: 'Griffins', awayTeam: 'MNML' },
      { id: 4, division: 'AA', week: 1, homeTeam: 'Immortals', awayTeam: 'Kingdom' },
    ],
    scheduleDraft: null,
    players: [
      { id: 1, username: 'JSTN', team: 'Aviators', division: 'Majors', rank: 'SSL', freeAgent: false, salary: 850 },
      { id: 2, username: 'Turbopolsa', team: 'Griffins', division: 'Majors', rank: 'SSL', freeAgent: false, salary: 840 },
      { id: 3, username: 'AstroVibe', team: 'Aviators', division: 'Majors', rank: 'GC3', freeAgent: false, salary: 520 },
      { id: 4, username: 'NovaDrift', team: null, division: 'Majors', rank: 'GC3', freeAgent: true, salary: 500 },
      { id: 5, username: 'RocketKid', team: 'MNML', division: 'AA', rank: 'C3', freeAgent: false, salary: 220 },
      { id: 6, username: 'ZenRL', team: 'Aviators', division: 'Majors', rank: 'GC2', freeAgent: false, salary: 480 },
    ],
    reports: [
      { id: 1, reporter: 'AstroVibe', reported: 'RageQuit99', reason: 'Toxic behavior in match chat', status: 'open', priority: 'high', date: '2026-04-08' },
      { id: 2, reporter: 'JSTN', reported: 'LagMaster', reason: 'Suspected intentional disconnect', status: 'investigating', priority: 'medium', date: '2026-04-07' },
      { id: 3, reporter: 'MirageX', reported: 'TrashTalk3r', reason: 'Harassment in DMs', status: 'resolved', priority: 'low', date: '2026-04-05' },
    ],
  }
}

async function ensureDataFile() {
  try {
    await fs.access(DATA_FILE)
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.writeFile(DATA_FILE, JSON.stringify(defaultData(), null, 2), 'utf-8')
  }
}

export async function readData() {
  await ensureDataFile()
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    // Merge with defaults so new fields don't break existing files
    return { ...defaultData(), ...parsed }
  } catch {
    return defaultData()
  }
}

export async function writeData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

export async function getSection(type) {
  const data = await readData()
  return data[type] ?? null
}

export async function updateSection(type, value) {
  const data = await readData()
  data[type] = value
  await writeData(data)
  return data[type]
}

export { TEAMS, DIVISIONS }
