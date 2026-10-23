import DiscordProvider from 'next-auth/providers/discord'
import { getAdminDiscordIds, isSuperAdminId } from './adminIds'
import { pushAuthError } from './authRequestContext'
import { onSignIn } from './loginSecurity'
import { IDLE_LIMIT_MS, getSessionState, restoreSessionRow, revokeSession } from './security'

export { getAdminDiscordIds, isSuperAdminId }

// The cookie itself may live up to a year; lib/security.js's session registry is what
// actually ends a session — 7 days idle for everyone except ADMIN_DISCORD_IDS, who
// are never logged out (operator rule). Revocation ("log out") is enforced there too.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

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

function applyBypass(token) {
  const ids = getAdminDiscordIds()
  if (ids.length && token.discordUserId && ids.includes(String(token.discordUserId))) {
    token.isDirector = true
    token.bypassReason = token.bypassReason || 'admin_discord_id'
  }
}

// Returns the fresh guild-member object when Discord was actually asked (null when a
// cache/backoff short-circuited or the user isn't in the league server). `force`
// skips the fresh-cache shortcut — used at sign-in so the login record is current.
async function refreshDiscordRoles(token, { force = false } = {}) {
  if (!token.accessToken) {
    applyBypass(token)
    return null
  }

  const guildId = process.env.DISCORD_GUILD_ID
  const directorRoleId = process.env.DISCORD_DIRECTOR_ROLE_ID
  if (!guildId || !directorRoleId) {
    console.warn('[auth] DISCORD_GUILD_ID or DISCORD_DIRECTOR_ROLE_ID not set; skipping role check')
    applyBypass(token)
    return null
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
    return null
  }

  // In-memory fresh cache — skip the Discord fetch entirely within the TTL.
  if (!force && cached && cached.checkedAt && now - cached.checkedAt < ROLE_CACHE_TTL_MS && Array.isArray(cached.roles)) {
    hydrateFromCache()
    applyBypass(token)
    return null
  }

  // Legacy cookie-side backoff guard (kept for the client /api/auth/session path).
  if (token.rolesRateLimitedUntil && now < token.rolesRateLimitedUntil) {
    hydrateFromCache()
    applyBypass(token)
    return null
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
      return null
    }

    if (res.status === 401) {
      // Access token expired or revoked. Force re-auth on next sign-in.
      console.warn('[auth] Discord access token unauthorized; clearing cached role data')
      token.roles = []
      token.isDirector = false
      token.rolesCheckedAt = now
      roleCache.delete(uid)
      applyBypass(token)
      return null
    }

    if (res.status === 404) {
      // Not a member of the league server (common for applicants). Not an error.
      token.roles = []
      token.isDirector = false
      token.rolesCheckedAt = now
      if (uid) roleCache.set(uid, { roles: [], isDirector: false, username: token.discordUsername, checkedAt: now })
      applyBypass(token)
      return null
    }

    if (!res.ok) {
      console.warn(`[auth] Discord role check returned ${res.status}; keeping cached values`)
      hydrateFromCache()
      applyBypass(token)
      return null
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
    return member
  } catch (err) {
    console.warn('[auth] Discord role check threw:', err.message)
    hydrateFromCache()
    applyBypass(token)
    return null
  }
}

export const authOptions = {
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    updateAge: 60 * 60, // touch the cookie at most once per hour
  },
  jwt: {
    maxAge: COOKIE_MAX_AGE_SECONDS,
  },
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      // Discord now returns `iss` on the OAuth redirect (RFC 9207). openid-client
      // throws "issuer must be configured on the issuer" unless the provider
      // declares one — that broke every login in Oct 2026. The value is Discord's
      // own (https://discord.com/.well-known/openid-configuration). The route
      // wrapper also normalises harmless spelling variants of it.
      issuer: 'https://discord.com',
      // PKCE on top of state: a stolen authorization code is useless without the
      // verifier cookie that only this browser holds.
      checks: ['pkce', 'state'],
      authorization: {
        // Discord remembers prior consent automatically — returning users
        // skip the authorize screen. We don't pass `prompt=none` because
        // first-time users would error instead of seeing the consent screen.
        // `email` + `guilds` are recorded in higgenlogs to identify who logged in.
        params: { scope: 'identify email guilds guilds.members.read' },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      // First sign-in: hydrate fresh data from Discord, then decide access and record
      // the login (lib/loginSecurity.js).
      if (account) {
        token.discordUserId = account.providerAccountId || token.discordUserId
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token || token.refreshToken
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : null
        if (profile?.username) token.discordUsername = profile.username
        const member = await refreshDiscordRoles(token, { force: true })
        try {
          await onSignIn(token, { account, profile, member })
        } catch (err) {
          console.warn('[auth] login security hook failed:', err.message)
        }
        return token
      }

      // Sessions from before the session registry existed carry no sid — they can't
      // be revoked or tracked, so they end and the person signs in once more.
      if (!token.sid) {
        token.revoked = true
        return token
      }
      let state = await getSessionState(token.sid)
      // undefined = the registry couldn't be read (DB blip) → don't punish the user.
      // null = no row: the sign-in's registry write failed — re-create it rather than
      // logging someone out because the database hiccuped during their login.
      if (state === null) {
        state = await restoreSessionRow(token)
      }
      if (state) {
        if (state.revoked_at) token.revoked = true
        else if (!state.is_super_admin && Date.now() - new Date(state.last_seen_at).getTime() > IDLE_LIMIT_MS) {
          await revokeSession(token.sid, 'automatic', 'Idle for 7 days').catch(() => {})
          token.revoked = true
        }
      }
      if (token.revoked) return token

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
      // A logged-out (revoked / expired / pre-registry) session reads as signed out
      // everywhere: no identity, no access. The admin layout signs the browser out.
      if (token.revoked) {
        return { expires: session.expires, revoked: true }
      }
      session.discordUserId = token.discordUserId || null
      // NOTE: the Discord OAuth access token is deliberately NOT sent to the browser.
      session.roles = token.roles || []
      session.isDirector = !!token.isDirector
      // Gate for the hidden audit log — operator/owner only, never "any director".
      session.isSuperAdmin = isSuperAdminId(token.discordUserId)
      session.discordUsername = token.discordUsername || 'Unknown'
      session.rolesCheckedAt = token.rolesCheckedAt || null
      session.viaBypass = token.bypassReason || null
      // Admin access needs BOTH the director role AND a correct admin password on
      // this login (the gate used to be checked only in the browser, so a director
      // could skip it). loginIntent says which door they came in through.
      session.gatePassed = !!token.gatePassed
      session.adminAccess = !!(token.isDirector && token.gatePassed)
      session.loginIntent = token.loginIntent || null
      return session
    },
  },
  // Neutral routers: they send the visitor back to whichever door they came in
  // through (applicants → /applications, staff → /admin). Pointing these at /admin
  // is what dumped failed applicants on the admin login page.
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  logger: {
    error(code, metadata) {
      pushAuthError(code, metadata)
      console.error(`[next-auth][error][${code}]`, metadata?.message || metadata?.error?.message || metadata)
    },
    warn(code) {
      if (code !== 'DEBUG_ENABLED') console.warn(`[next-auth][warn][${code}]`)
    },
    debug() {},
  },
  secret: resolveAuthSecret(),
}
