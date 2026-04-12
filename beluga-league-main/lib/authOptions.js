import DiscordProvider from 'next-auth/providers/discord'

export const authOptions = {
  trustHost: true,
  session: {
    strategy: 'jwt',
  },
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: {
        params: {
          scope: 'identify guilds guilds.members.read',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Only fetch Discord guild member info ONCE at sign-in.
      // Subsequent session refreshes read from the token — no more API calls.
      if (account) {
        token.accessToken = account.access_token

        try {
          const res = await fetch(
            `https://discord.com/api/v10/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,
            {
              headers: {
                Authorization: `Bearer ${account.access_token}`,
              },
            }
          )

          if (res.ok) {
            const member = await res.json()
            token.roles = member.roles || []
            token.isDirector = (member.roles || []).includes(
              process.env.DISCORD_DIRECTOR_ROLE_ID
            )
            token.discordUsername = member.user?.username || member.nick || 'Unknown'
          } else {
            token.roles = []
            token.isDirector = false
            token.discordUsername = 'Unknown'
          }
        } catch {
          token.roles = []
          token.isDirector = false
          token.discordUsername = 'Unknown'
        }
      }
      return token
    },
    async session({ session, token }) {
      // Read cached values from the token — no Discord API call here.
      session.accessToken = token.accessToken
      session.roles = token.roles || []
      session.isDirector = token.isDirector || false
      session.discordUsername = token.discordUsername || 'Unknown'
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
