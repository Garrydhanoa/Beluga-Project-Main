/**
 * Schedule generator — round-robin per division, with 2 games per team per week.
 *
 * Hard rules:
 *  - Every team plays exactly 2 games each week (one BYE per week if team count is odd).
 *  - Within a single week, a team's two opponents are DIFFERENT until the full
 *    round-robin cycle is exhausted (forced repeats only once all pairings are used).
 *  - Across the season we cycle through the round-robin rounds. Even cycles use
 *    home/away as-is; odd cycles swap home/away to balance the schedule.
 *
 * Algorithm: classic circle method generates N-1 unique rounds for N teams (one
 * BYE column added if N is odd). For 2 games per week we stack two consecutive
 * rounds into each week. After all N-1 rounds are consumed the cycle restarts
 * with home/away swapped, etc. Two different rounds NEVER share a pairing, so
 * within-week duplicate opponents are impossible during the first cycle.
 */

function rotateRoundRobin(teams) {
  const arr = [...teams]
  const isOdd = arr.length % 2 === 1
  if (isOdd) arr.push(null) // bye column
  const n = arr.length
  const rounds = []
  const fixed = arr[0]
  let rotating = arr.slice(1)

  for (let r = 0; r < n - 1; r += 1) {
    const matchups = []
    const order = [fixed, ...rotating]
    for (let i = 0; i < n / 2; i += 1) {
      const home = order[i]
      const away = order[n - 1 - i]
      if (home && away) {
        // Alternate which side starts as "home" across rounds for fairness.
        if (r % 2 === 0) matchups.push([home, away])
        else matchups.push([away, home])
      }
    }
    rounds.push(matchups)
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)]
  }

  return rounds
}

/**
 * Generate matchups for a list of teams across N weeks at 2 games per team per week.
 *
 * @param {Array<{id: number, name?: string}>} teams
 * @param {number} weeks   number of regular-season weeks
 * @returns {Array<{week: number, matchups: Array<[home, away]>}>}
 */
export function generateRoundRobin(teams, weeks) {
  if (!teams || teams.length < 2) return []
  const baseRounds = rotateRoundRobin(teams)
  if (baseRounds.length === 0) return []

  const totalRoundsAvailable = baseRounds.length // N-1
  const out = []

  for (let w = 0; w < weeks; w += 1) {
    // Two rounds per week; pick consecutive rounds out of the cycle.
    const baseOffset = w * 2
    const cycle = Math.floor(baseOffset / totalRoundsAvailable)
    const a = baseOffset % totalRoundsAvailable
    const b = (baseOffset + 1) % totalRoundsAvailable

    // Combine the two rounds into one week, applying home/away swap per cycle.
    const round1 = baseRounds[a].map(([home, away]) =>
      cycle % 2 === 0 ? [home, away] : [away, home]
    )
    const round2 = baseRounds[b].map(([home, away]) => {
      // If the second round wrapped (b < a means we crossed cycle boundary),
      // use the NEXT cycle's parity for that half.
      const c = b < a ? cycle + 1 : cycle
      return c % 2 === 0 ? [home, away] : [away, home]
    })

    out.push({ week: w + 1, matchups: [...round1, ...round2] })
  }

  return out
}

/**
 * Generate a full-season schedule for all divisions.
 *
 * @param {Object} teamsByDivision  { Majors: [...], AAA: [...], AA: [...] }
 * @param {number} weeks            regular-season weeks
 * @returns {Array<{ division, week, homeTeamId, awayTeamId, matchOrder }>}
 */
export function generateSeasonSchedule(teamsByDivision, weeks) {
  const out = []
  for (const [division, teams] of Object.entries(teamsByDivision || {})) {
    const active = (teams || []).filter((t) => t.isActive !== false)
    if (active.length < 2) continue

    const rounds = generateRoundRobin(active, weeks)
    for (const { week, matchups } of rounds) {
      let order = 0
      for (const [home, away] of matchups) {
        if (!home || !away) continue
        out.push({
          division,
          week,
          homeTeamId: home.id,
          awayTeamId: away.id,
          matchOrder: order,
        })
        order += 1
      }
    }
  }
  return out
}
