import DiscordProvider from 'next-auth/providers/discord'

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7

// The entire admin panel authorizes on a JWT session cookie encrypted with
// NEXTAUTH_SECRET. If that secret is missing, the shipped placeholder, or too short,
// anyone who knows/guesses it can forge an `isDirector:true` admin cookie offline.
// FAIL CLOSED: refuse to boot in production with a weak secret rather than silently
// signing admin sessions with a guessable key. Local dev only warns.
const WEAK_SECRETS = new Set([
  'beluga-league-admin-secret-key-change-me-in-production',
  'change-me',
  'secret',
])
function resolveAuthSecret() {
  const secret = (process.env.NEXTAUTH_SECRET || '').trim()
  const isWeak = !secret || WEAK_SECRETS.has(secret) || secret.length < 32
  if (isWeak) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[auth] NEXTAUTH_SECRET is missing or a known-weak/placeholder value in production. ' +
          'Set a strong random secret (openssl rand -base64 32) before deploying.'
      )
    }
    console.warn(
      '[auth] NEXTAUTH_SECRET is weak/placeholder — acceptable for LOCAL DEV ONLY. ' +
        'Set a strong random secret before deploying.'
    )
  }
  return secret || undefined
}
const ROLE_CACHE_TTL_MS = 60 * 60 * 1000 // re-check Discord role every hour
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000 // after a 429, don't retry for 5 minutes

// Per-process role cache keyed by Discord user id. CRITICAL: with the JWT session
// strategy, token mutations made inside the `jwt` callback during a server-side
// getServerSession() (every requireAdmin() call) are NOT written back to the cookie
// — so the cookie's rolesCheckedAt / rate-limit backoff never advance between
// requests. Admin pages that poll (the MMR tab hits requireAdmin every ~1s) then
// re-fetch Discord on EVERY request once the cookie cache goes stale, which storms
// Discord into 429s. This in-memory cache makes the "checked recently" and "backing
// off after a 429" decisions durable across requests in the running process, so we
// fetch Discord at most once per TTL per user (and not at all during a backoff).
const roleCache = new Map() // discordUserId -> { roles, isDirector, username, checkedAt, rateLimitedUntil }

export function getAdminDiscordIds() {
  const raw = process.env.ADMIN_DISCORD_IDS || process.env.ADMIN_DISCORD_ID || ''
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * "Super admin" = an ID explicitly listed in ADMIN_DISCORD_IDS. That list is the
 * league's privileged-access allowlist (it already bypasses the director check),
 * so it is also what gates the hidden audit log at /admin/dashboard/higgenlogs.
 *
 * Being a director is NOT enough — the whole point of the audit log is that the
 * people it might incriminate cannot read or curate it. Fails CLOSED: if the env
 * var is unset, nobody is a super admin.
 */
export function isSuperAdminId(discordUserId) {
  if (!discordUserId) return false
  return getAdminDiscordIds().includes(String(discordUserId))
}

function applyBypass(token) {
  const ids = getAdminDiscordIds()
  if (ids.length && token.discordUserId && ids.includes(String(token.discordUserId))) {
    token.isDirector = true
    token.bypassReason = token.bypassReason || 'admin_discord_id'
  }
}

async function refreshDiscordRoles(token) {
  if (!token.accessToken) {
    applyBypass(token)
    return
  }

  const guildId = process.env.DISCORD_GUILD_ID
  const directorRoleId = process.env.DISCORD_DIRECTOR_ROLE_ID
  if (!guildId || !directorRoleId) {
    console.warn('[auth] DISCORD_GUILD_ID or DISCORD_DIRECTOR_ROLE_ID not set; skipping role check')
    applyBypass(token)
    return
  }

  const now = Date.now()
  const uid = String(token.discordUserId || '')
  const cached = uid ? roleCache.get(uid) : null

  // Hydrate the token from any cached roles up front so a backoff/short-circuit still
  // yields the last-known role data (not an empty set).
  const hydrateFromCache = () => {
    if (!cached) return
    if (Array.isArray(cached.roles)) {
      token.roles = cached.roles
      token.isDirector = cached.isDirector
    }
    if (cached.username) token.discordUsername = cached.username
    if (cached.checkedAt) token.rolesCheckedAt = cached.checkedAt
  }

  // In-memory backoff after a recent 429 — sticks across requests (the cookie's
  // backoff timestamp does not), so a polling page can't re-storm Discord.
  if (cached && cached.rateLimitedUntil && now < cached.rateLimitedUntil) {
    hydrateFromCache()
    token.rolesRateLimitedUntil = cached.rateLimitedUntil
    applyBypass(token)
    return
  }

  // In-memory fresh cache — skip the Discord fetch entirely within the TTL.
  if (cached && cached.checkedAt && now - cached.checkedAt < ROLE_CACHE_TTL_MS && Array.isArray(cached.roles)) {
    hydrateFromCache()
    applyBypass(token)
    return
  }

  // Legacy cookie-side backoff guard (kept for the client /api/auth/session path).
  if (token.rolesRateLimitedUntil && now < token.rolesRateLimitedUntil) {
    hydrateFromCache()
    applyBypass(token)
    return
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/users/@me/guilds/${guildId}/member`,
      { headers: { Authorization: `Bearer ${token.accessToken}` } }
    )

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 60
      const backoff = Math.min(Math.max(retryAfter * 1000, RATE_LIMIT_BACKOFF_MS), 60 * 60 * 1000)
      token.rolesRateLimitedUntil = now + backoff
      // Persist the backoff in-process so subsequent requests don't re-fetch (and
      // don't re-log) until it expires — keep any previously cached roles.
      roleCache.set(uid, { ...(cached || {}), rateLimitedUntil: now + backoff })
      console.warn(`[auth] Discord rate-limited role check; backing off ${Math.round(backoff / 1000)}s`)
      hydrateFromCache()
      applyBypass(token)
      return
    }

    if (res.status === 401) {
      // Access token expired or revoked. Force re-auth on next sign-in.
      console.warn('[auth] Discord access token unauthorized; clearing cached role data')
      token.roles = []
      token.isDirector = false
      token.rolesCheckedAt = now
      roleCache.delete(uid)
      applyBypass(token)
      return
    }

    if (!res.ok) {
      console.warn(`[auth] Discord role check returned ${res.status}; keeping cached values`)
      hydrateFromCache()
      applyBypass(token)
      return
    }

    const member = await res.json()
    token.roles = Array.isArray(member.roles) ? member.roles : []
    token.isDirector = token.roles.includes(directorRoleId)
    token.discordUsername = member.user?.username || member.nick || token.discordUsername || 'Unknown'
    token.rolesCheckedAt = now
    delete token.rolesRateLimitedUntil
    delete token.bypassReason
    if (uid) {
      roleCache.set(uid, {
        roles: token.roles, isDirector: token.isDirector,
        username: token.discordUsername, checkedAt: now,
      })
    }

    applyBypass(token)
  } catch (err) {
    console.warn('[auth] Discord role check threw:', err.message)
    hydrateFromCache()
    applyBypass(token)
  }
}

export const authOptions = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: SEVEN_DAYS_SECONDS,
    updateAge: 60 * 60, // touch the cookie at most once per hour
  },
  jwt: {
    maxAge: SEVEN_DAYS_SECONDS,
  },
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: {
        // Discord remembers prior consent automatically — returning users
        // skip the authorize screen. We don't pass `prompt=none` because
        // first-time users would error instead of seeing the consent screen.
        params: { scope: 'identify guilds guilds.members.read' },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // First sign-in: hydrate fresh data from Discord.
      if (account) {
        token.discordUserId = account.providerAccountId || token.discordUserId
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token || token.refreshToken
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : null
        await refreshDiscordRoles(token)
        return token
      }

      // Subsequent requests: re-check role hourly, otherwise keep cache.
      const now = Date.now()
      const checkedAt = Number(token.rolesCheckedAt || 0)
      const stale = !checkedAt || now - checkedAt > ROLE_CACHE_TTL_MS

      if (stale) {
        await refreshDiscordRoles(token)
      } else {
        // Even when not refreshing, ensure the bypass flag is consistent with current env.
        applyBypass(token)
      }

      return token
    },

    async session({ session, token }) {
      session.discordUserId = token.discordUserId || null
      session.accessToken = token.accessToken
      session.roles = token.roles || []
      session.isDirector = !!token.isDirector
      // Gate for the hidden audit log — operator/owner only, never "any director".
      session.isSuperAdmin = isSuperAdminId(token.discordUserId)
      session.discordUsername = token.discordUsername || 'Unknown'
      session.rolesCheckedAt = token.rolesCheckedAt || null
      session.viaBypass = token.bypassReason || null
      return session
    },
  },
  pages: {
    signIn: '/admin',
    error: '/admin/denied',
  },
  secret: resolveAuthSecret(),
  debug: process.env.NODE_ENV !== 'production',
}
