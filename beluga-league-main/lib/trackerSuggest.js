// Tracker Linking — pure suggestion + ordering logic (no I/O, easy to unit-test).
//
// Given a player's SalSheet trackers (with last-run status), their linked Ballchasing
// accounts (stats_player_accounts) and their name history (stats_name_history), decide:
//   - which CURRENT in-game names have no matching tracker → suggest adding one
//   - for each old tracker on that platform, whether DELETING it is confirmed-safe
//     (its name is a *past name* of that exact account → same person renamed) or only
//     offered unchecked (can't prove ownership / it's just the broken 404 one)
//   - a tier for board ordering: 0 = has a suggestion, 1 = invalid tracker but no
//     suggestion yet, 2 = nothing to do.
//
// Platform note: epic/psn/xbl/switch embed the NAME in the TRN URL (break on rename);
// steam embeds the stable steam ID — so steam is matched by id and never name-stale.

const NAME_PLATFORMS = new Set(['epic', 'psn', 'xbl', 'switch'])
const VALID_PLATFORMS = new Set(['steam', 'epic', 'psn', 'xbl', 'switch'])

// Ballchasing's platform spelling differs from TRN's (xbox→xbl, ps*→psn). Both the
// account side (stats_player_accounts, bot-written) and the tracker side (TRN URL)
// must be canonicalized to the TRN spelling before they can be matched/built.
const PLATFORM_ALIASES = {
  steam: 'steam',
  epic: 'epic', epicgames: 'epic',
  psn: 'psn', ps: 'psn', ps4: 'psn', ps5: 'psn', playstation: 'psn',
  xbl: 'xbl', xbox: 'xbl', xboxlive: 'xbl', xboxone: 'xbl',
  switch: 'switch', nintendo: 'switch', nintendoswitch: 'switch',
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()

export function canonicalPlatform(p) {
  const k = norm(p)
  return PLATFORM_ALIASES[k] || k
}

export function buildUrl(platform, identifier) {
  const p = canonicalPlatform(platform)
  const id = String(identifier == null ? '' : identifier).trim()
  if (!VALID_PLATFORMS.has(p) || id.length < 2) return null
  return `https://rocketleague.tracker.network/rocket-league/profile/${p}/${encodeURIComponent(id)}/overview`
}

const isInvalid = (t) => String(t && t.status ? t.status : '').toUpperCase() === 'NO_DATA'

/**
 * @param {Object} input
 * @param {Array}  input.trackers     [{ label, platform, identifier, url, status, rowIndex }]
 * @param {Array}  input.accounts     [{ platform, platformId, currentName }]
 * @param {Array}  input.nameHistory  [{ platform, platformId, name }]
 * @returns {{ suggestions, invalidTrackers, hasSuggestion, hasInvalid, tier }}
 */
export function computeSuggestions({ trackers = [], accounts = [], nameHistory = [] } = {}) {
  // Past names indexed per ACCOUNT (platform + platformId) so a tracker's old name
  // is tied to the specific account it belonged to — not any same-platform account.
  const histByAcct = new Map()
  for (const h of nameHistory) {
    // Canonicalize the platform so xbox-history matches an xbl-canonical account.
    const key = `${canonicalPlatform(h.platform)}/${norm(h.platformId)}`
    if (!histByAcct.has(key)) histByAcct.set(key, new Set())
    if (h.name) histByAcct.get(key).add(norm(h.name))
  }

  const suggestions = []
  for (const acct of accounts) {
    const platform = canonicalPlatform(acct.platform)
    const cur = String(acct.currentName == null ? '' : acct.currentName).trim()
    const pastNames = histByAcct.get(`${platform}/${norm(acct.platformId)}`) || new Set()

    if (platform === 'steam') {
      // id-based: the tracker identifier should equal the steam id; suggest only if
      // no tracker carries that id. Never a "delete old" (nothing renames-stale).
      const idWanted = norm(acct.platformId)
      if (!idWanted) continue
      const hasIt = trackers.some(
        (t) => canonicalPlatform(t.platform) === 'steam' && norm(t.identifier) === idWanted
      )
      if (hasIt) continue
      const newUrl = buildUrl('steam', acct.platformId)
      if (!newUrl) continue
      suggestions.push({
        platform: 'steam', accountName: cur || acct.platformId,
        newIdentifier: String(acct.platformId), newUrl, oldTrackers: [],
      })
      continue
    }

    if (!NAME_PLATFORMS.has(platform) || !cur) continue

    // Already represented by a tracker on this platform? → up to date.
    const hasCurrent = trackers.some(
      (t) => canonicalPlatform(t.platform) === platform && norm(t.identifier) === norm(cur)
    )
    if (hasCurrent) continue

    const newUrl = buildUrl(platform, cur)
    if (!newUrl) continue

    // Old trackers worth offering for deletion: either a CONFIRMED past name of this
    // exact account (→ auto-checked replace) or an actually-broken 404 on this platform
    // (→ shown unchecked). A valid second account's tracker is left out of this card.
    const oldTrackers = trackers
      .filter((t) => canonicalPlatform(t.platform) === platform && norm(t.identifier) !== norm(cur))
      .filter((t) => pastNames.has(norm(t.identifier)) || isInvalid(t))
      .map((t) => ({
        platform: t.platform, identifier: t.identifier, url: t.url,
        rowIndex: t.rowIndex, label: t.label, status: t.status || '',
        deleteSuggested: pastNames.has(norm(t.identifier)),
      }))

    suggestions.push({
      platform, accountName: cur, newIdentifier: cur, newUrl, oldTrackers,
    })
  }

  const invalidTrackers = trackers.filter(isInvalid)
  const hasSuggestion = suggestions.length > 0
  const hasInvalid = invalidTrackers.length > 0
  const tier = hasSuggestion ? 0 : hasInvalid ? 1 : 2
  return { suggestions, invalidTrackers, hasSuggestion, hasInvalid, tier }
}
