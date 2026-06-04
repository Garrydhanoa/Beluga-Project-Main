import DiscordProvider from 'next-auth/providers/discord'

const SEVEN_DAYS_SECONDS = 60 * 60 * 24 * 7
const ROLE_CACHE_TTL_MS = 60 * 60 * 1000 // re-check Discord role every hour
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000 // after a 429, don't retry for 5 minutes

function getAdminDiscordIds() {
  const raw = process.env.ADMIN_DISCORD_IDS || process.env.ADMIN_DISCORD_ID || ''
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
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

  // If we recently got rate-limited, don't try again until backoff expires.
  if (token.rolesRateLimitedUntil && Date.now() < token.rolesRateLimitedUntil) {
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
      token.rolesRateLimitedUntil = Date.now() + backoff
      console.warn(`[auth] Discord rate-limited role check; backing off ${Math.round(backoff / 1000)}s`)
      // Keep using cached role data; bypass kicks in for master admin if no cache.
      applyBypass(token)
      return
    }

    if (res.status === 401) {
      // Access token expired or revoked. Force re-auth on next sign-in.
      console.warn('[auth] Discord access token unauthorized; clearing cached role data')
      token.roles = []
      token.isDirector = false
      token.rolesCheckedAt = Date.now()
      applyBypass(token)
      return
    }

    if (!res.ok) {
      console.warn(`[auth] Discord role check returned ${res.status}; keeping cached values`)
      applyBypass(token)
      return
    }

    const member = await res.json()
    token.roles = Array.isArray(member.roles) ? member.roles : []
    token.isDirector = token.roles.includes(directorRoleId)
    token.discordUsername = member.user?.username || member.nick || token.discordUsername || 'Unknown'
    token.rolesCheckedAt = Date.now()
    delete token.rolesRateLimitedUntil
    delete token.bypassReason

    applyBypass(token)
  } catch (err) {
    console.warn('[auth] Discord role check threw:', err.message)
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
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV !== 'production',
}
