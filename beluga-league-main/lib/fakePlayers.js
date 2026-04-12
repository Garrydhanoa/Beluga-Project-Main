// Deterministic fake player data generator.
// Shared between /players (directory) and /players/[username] (profile).
// Same inputs always produce the same outputs — no real database needed.

import { majorsSchedule, aaaSchedule } from './scheduleData'

const NAME_POOL = [
  'AstroVibe', 'NovaDrift', 'ZenRL', 'MirageX', 'BluStrk', 'VoltCore',
  'Cipher7', 'EchoStorm', 'PulseWave', 'NyxRL', 'Zephyr', 'Fractal',
  'SableRL', 'Kairo', 'VexStrike', 'Quasar', 'RiftBreaker', 'Halcyon',
  'Stratos', 'OrionFlux', 'Vanta', 'Luxo', 'Caelum', 'Drift9',
  'Phase7', 'Apex', 'VortexRL', 'Specter', 'Glyph', 'Torque',
  'Halo9', 'Kryo', 'NovaX', 'Trex', 'RaptorRL', 'Jinx', 'Havoc',
  'Wraith', 'Nyxa', 'SyncRL', 'Blaze', 'Razor', 'Ghost9', 'VoltX',
  'Arcane', 'EchoX', 'Rogue', 'ZenX', 'Neon7', 'Fury', 'PrismRL',
  'Koya', 'King', 'Joker', 'Clutch', 'Pulse', 'Surge', 'Warden', 'Flux',
  'Cinder', 'Rift', 'Onyx', 'Tempo', 'Nova', 'Shade', 'Quill', 'Zeph',
  'Arcus', 'Blip', 'Cosm', 'Drex', 'Ember', 'Frost', 'Gale', 'Helix',
]

const RANKS = ['GC', 'GC2', 'GC3', 'SSL']

const TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'Griffins',
  'Immortals', 'InTraCate', 'Kingdom', 'Lotus', 'Malfeasance',
  'MNML', 'Panthers', 'Sublunary', 'Surge',
]

// Only these 10 teams are in Majors (mirrors lib/scheduleData.js)
const MAJORS_TEAMS = [
  '6 Speed', 'Archangels', 'Aviators', 'Clovis Esports', 'InTraCate',
  'Lotus', 'Malfeasance', 'Panthers', 'Sublunary', 'Surge',
]

// Championship history — any current player on these teams in their current
// division gets the matching "S{N} Champion {Division}" achievement.
const CHAMPIONSHIP_HISTORY = [
  { season: 8, division: 'major', team: 'Aviators' },
  { season: 8, division: 'aaa', team: 'Griffins' },
  { season: 8, division: 'aa', team: 'Sublunary' },
  { season: 7, division: 'major', team: 'Panthers' },
  { season: 7, division: 'aaa', team: 'Immortals' },
  { season: 7, division: 'aa', team: 'Lotus' },
]

function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

function seededRand(seed, min, max) {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  return Math.floor(r * (max - min + 1)) + min
}

function seededFloat(seed, min, max) {
  const x = Math.sin(seed) * 10000
  const r = x - Math.floor(x)
  return r * (max - min) + min
}

// Division salary caps (mirrors lib/scheduleData.js)
const DIVISION_SALARY = {
  major: { min: 16, max: 21 },
  aaa: { min: 13, max: 16 },
  aa: { min: 10, max: 13 },
}

const DIVISION_LABEL = {
  major: 'Majors',
  aaa: 'AAA',
  aa: 'AA',
}

// ----- Cached master list -----
let _allPlayers = null
let _byUsername = null

function buildAllPlayers() {
  const players = []
  const usedUsernames = new Set()
  let playerId = 0

  for (const team of TEAMS) {
    for (const division of ['aa', 'aaa', 'major']) {
      if (division === 'major' && !MAJORS_TEAMS.includes(team)) continue

      const playerCount = 5
      for (let slot = 0; slot < playerCount; slot++) {
        const seed = hashString(`${team}|${division}|${slot}`)
        let nameIdx = seed % NAME_POOL.length

        // Find an unused display name to avoid collisions
        let name = NAME_POOL[nameIdx]
        let username = name.toLowerCase()
        let suffix = 0
        while (usedUsernames.has(username)) {
          suffix++
          username = `${name.toLowerCase()}${suffix}`
        }
        usedUsernames.add(username)
        const displayName = suffix === 0 ? name : `${name}${suffix}`

        const { min: salMin, max: salMax } = DIVISION_SALARY[division]
        const salary = +seededFloat(seed + 1, salMin, salMax).toFixed(2)
        const rank = RANKS[seededRand(seed + 2, 0, 3)]
        const role = slot === 0 ? 'Captain' : slot < 4 ? 'Player' : 'Sub'

        const games = seededRand(seed + 5, 10, 16)
        const goals = seededRand(seed + 6, 8, 32)
        const assists = seededRand(seed + 7, 4, 22)
        const saves = seededRand(seed + 8, 12, 55)
        const shots = seededRand(seed + 9, 30, 80)
        const mvps = seededRand(seed + 10, 0, 9)
        const shootingPct = Math.min(80, Math.round((goals / shots) * 100))
        const seasons = seededRand(seed + 11, 1, 8)
        const isRegistered = seededRand(seed + 12, 0, 10) > 1 // ~90%
        const isFreeAgent = false

        players.push({
          id: ++playerId,
          username,
          displayName,
          team,
          division,
          divisionLabel: DIVISION_LABEL[division],
          role,
          rank,
          salary,
          games,
          goals,
          assists,
          saves,
          shots,
          mvps,
          shootingPct,
          seasons,
          isRegistered,
          isFreeAgent,
          isCaptain: slot === 0,
        })
      }
    }
  }

  // Handful of free agents
  const freeAgentCount = 8
  for (let i = 0; i < freeAgentCount; i++) {
    const seed = hashString(`FA|${i}`)
    let nameIdx = (seed + 31) % NAME_POOL.length
    let name = NAME_POOL[nameIdx]
    let username = name.toLowerCase()
    let suffix = 0
    while (usedUsernames.has(username)) {
      suffix++
      username = `${name.toLowerCase()}${suffix}`
    }
    usedUsernames.add(username)
    const displayName = suffix === 0 ? name : `${name}${suffix}`

    const division = ['aa', 'aaa', 'major'][seededRand(seed + 1, 0, 2)]
    const { min: salMin, max: salMax } = DIVISION_SALARY[division]
    const salary = +seededFloat(seed + 2, salMin, salMax).toFixed(2)

    players.push({
      id: ++playerId,
      username,
      displayName,
      team: null,
      division,
      divisionLabel: DIVISION_LABEL[division],
      role: 'Free Agent',
      rank: RANKS[seededRand(seed + 3, 0, 3)],
      salary,
      games: seededRand(seed + 4, 0, 10),
      goals: seededRand(seed + 5, 0, 18),
      assists: seededRand(seed + 6, 0, 12),
      saves: seededRand(seed + 7, 0, 30),
      shots: seededRand(seed + 8, 10, 50),
      mvps: seededRand(seed + 9, 0, 3),
      shootingPct: seededRand(seed + 10, 15, 45),
      seasons: seededRand(seed + 11, 1, 4),
      isRegistered: true,
      isFreeAgent: true,
      isCaptain: false,
    })
  }

  // Compute rank (position) in each stat across all players
  const rankBy = (key) => {
    const sorted = [...players].sort((a, b) => b[key] - a[key])
    const ranks = {}
    sorted.forEach((p, i) => {
      ranks[p.id] = i + 1
    })
    return ranks
  }
  const goalRanks = rankBy('goals')
  const assistRanks = rankBy('assists')
  const saveRanks = rankBy('saves')
  const shotRanks = rankBy('shots')
  const mvpRanks = rankBy('mvps')

  players.forEach((p) => {
    p.ranks = {
      goals: goalRanks[p.id],
      assists: assistRanks[p.id],
      saves: saveRanks[p.id],
      shots: shotRanks[p.id],
      mvps: mvpRanks[p.id],
    }
  })

  // Division-scoped leaders (#1 in each stat within their division)
  const divisionLeaders = {}
  for (const div of ['major', 'aaa', 'aa']) {
    const divPlayers = players.filter((p) => p.division === div)
    if (divPlayers.length === 0) continue
    const byGoals = [...divPlayers].sort((a, b) => b.goals - a.goals)
    const byAssists = [...divPlayers].sort((a, b) => b.assists - a.assists)
    const byMvps = [...divPlayers].sort((a, b) => b.mvps - a.mvps)
    const bySaves = [...divPlayers].sort((a, b) => b.saves - a.saves)
    divisionLeaders[div] = {
      goals: byGoals[0].id,
      assists: byAssists[0].id,
      mvps: byMvps[0].id,
      saves: bySaves[0].id,
    }
  }

  // Derive achievements
  players.forEach((p) => {
    const achievements = []
    const divLeaders = divisionLeaders[p.division] || {}

    // Always-visible status
    if (p.isRegistered) achievements.push({ key: 'registered', label: 'Registered', icon: 'check' })
    if (!p.isFreeAgent && p.games >= 8) achievements.push({ key: 'active', label: 'Active Player', icon: 'pulse' })

    // Championship history (one badge per championship team+division match)
    CHAMPIONSHIP_HISTORY.forEach((h) => {
      if (p.team === h.team && p.division === h.division) {
        achievements.push({
          key: `s${h.season}-champ-${h.division}`,
          label: `S${h.season} Champion ${DIVISION_LABEL[h.division]}`,
          icon: 'crown',
        })
      }
    })

    // Division leaders (#1 in their division)
    if (divLeaders.goals === p.id) {
      achievements.push({
        key: 'div-goals',
        label: `${DIVISION_LABEL[p.division]} Goal Leader`,
        icon: 'target',
      })
    }
    if (divLeaders.assists === p.id) {
      achievements.push({
        key: 'div-assists',
        label: `${DIVISION_LABEL[p.division]} Assist Leader`,
        icon: 'globe',
      })
    }
    if (divLeaders.mvps === p.id) {
      achievements.push({
        key: 'div-mvps',
        label: `${DIVISION_LABEL[p.division]} MVP Leader`,
        icon: 'star',
      })
    }
    if (divLeaders.saves === p.id) {
      achievements.push({
        key: 'div-saves',
        label: `${DIVISION_LABEL[p.division]} Save Leader`,
        icon: 'shield',
      })
    }

    // Stat club thresholds
    if (p.goals >= 20) achievements.push({ key: 'goals-20', label: '20+ Goals Club', icon: 'fire' })
    if (p.assists >= 15) achievements.push({ key: 'assists-15', label: '15+ Assists Club', icon: 'medal' })
    if (p.saves >= 40) achievements.push({ key: 'wall', label: 'The Wall', icon: 'shield' })
    if (p.mvps >= 3) achievements.push({ key: 'mvp', label: 'MVP Machine', icon: 'star' })
    if (p.shootingPct >= 45) achievements.push({ key: 'sharp', label: 'Sharpshooter', icon: 'target' })

    // Role / career
    if (p.isCaptain) achievements.push({ key: 'captain', label: 'Team Captain', icon: 'crown' })
    if (p.seasons >= 5) achievements.push({ key: 'vet', label: 'Veteran', icon: 'medal' })
    if (p.seasons === 1) achievements.push({ key: 'rookie', label: 'Rookie', icon: 'sparkle' })
    if (p.isFreeAgent) achievements.push({ key: 'fa', label: 'Free Agent', icon: 'globe' })

    p.achievements = achievements
  })

  return players
}

export function getAllPlayers() {
  if (!_allPlayers) {
    _allPlayers = buildAllPlayers()
    _byUsername = {}
    _allPlayers.forEach((p) => {
      _byUsername[p.username] = p
    })
  }
  return _allPlayers
}

export function getPlayerByUsername(username) {
  getAllPlayers() // ensure cache built
  const lower = (username || '').toLowerCase()
  return _byUsername[lower] || null
}

// Fake match history for a player — reads their team's real schedule,
// generates deterministic W/L results and scores per match.
export function getMatchHistoryFor(player) {
  if (!player || !player.team) return []

  const source = player.division === 'major' ? majorsSchedule : aaaSchedule
  const history = []

  Object.entries(source).forEach(([week, matches]) => {
    const weekNum = parseInt(week.split(' ')[1], 10) || 1
    matches.forEach((match, idx) => {
      if (match[0] !== player.team && match[1] !== player.team) return
      const isHome = match[0] === player.team
      const opponent = isHome ? match[1] : match[0]

      const seed = hashString(`${player.username}|${week}|${opponent}|${idx}`)
      const ownScore = seededRand(seed, 0, 6)
      const oppScore = seededRand(seed + 1, 0, 6)
      // Avoid ties — force a winner
      const finalOwn = ownScore === oppScore ? ownScore + 1 : ownScore
      const finalOpp = oppScore

      history.push({
        week: weekNum,
        weekLabel: week,
        opponent,
        isHome,
        ownScore: finalOwn,
        oppScore: finalOpp,
        result: finalOwn > finalOpp ? 'W' : 'L',
      })
    })
  })

  history.sort((a, b) => a.week - b.week)
  return history
}

// Compute the player's recent form (last 5 matches)
export function getRecentForm(player) {
  const history = getMatchHistoryFor(player)
  if (history.length === 0) return []
  return history.slice(-5).map((m) => m.result)
}

// Convenience: list unique teams for the directory filter
export function getDirectoryTeams() {
  return ['All Teams', ...TEAMS]
}

export { TEAMS, DIVISION_LABEL }
