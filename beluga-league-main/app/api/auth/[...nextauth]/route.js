import NextAuth from 'next-auth'
import DiscordProvider from 'next-auth/providers/discord'

const handler = NextAuth({
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
      if (account) {
        token.accessToken = account.access_token
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken

      // Check if user has Director role in the guild
      try {
        const res = await fetch(
          `https://discord.com/api/v10/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,
          {
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
            },
          }
        )

        if (res.ok) {
          const member = await res.json()
          session.roles = member.roles || []
          session.isDirector = member.roles.includes(process.env.DISCORD_DIRECTOR_ROLE_ID)
          session.discordUsername = member.user?.username || member.nick || 'Unknown'
        } else {
          session.roles = []
          session.isDirector = false
        }
      } catch {
        session.roles = []
        session.isDirector = false
      }

      return session
    },
  },
  pages: {
    signIn: '/admin',
    error: '/admin',
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV !== 'production',
})

export { handler as GET, handler as POST }
