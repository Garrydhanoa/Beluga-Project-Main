/**
 * Local-only: mint a NextAuth v4 session cookie for admin testing of the dev site.
 * Uses next-auth's own encode() so getServerSession() decodes it identically.
 * The session callback derives isDirector from the token; a fresh rolesCheckedAt
 * stops the jwt callback from trying to re-check Discord roles. No accessToken, so
 * even a later refresh leaves isDirector untouched (applyBypass never sets it false).
 *
 * Usage (secret passed via env so it's never printed):
 *   $env:NEXTAUTH_SECRET=<secret>; node scripts/mint-admin-cookie.js
 * Prints just the cookie value (the JWE). Cookie name for http localhost is
 * `next-auth.session-token`.
 */
const { encode } = require('next-auth/jwt');

const SECRET = process.env.NEXTAUTH_SECRET;
const DISCORD_ID = process.env.MINT_DISCORD_ID || '000000000000000000';
const DIRECTOR_ROLE = process.env.DISCORD_DIRECTOR_ROLE_ID || '1156814621429215240';

if (!SECRET) { console.error('NEXTAUTH_SECRET not set'); process.exit(1); }

(async () => {
    const now = Date.now();
    const token = {
        discordUserId: DISCORD_ID,
        isDirector: true,
        roles: [DIRECTOR_ROLE],
        discordUsername: 'LocalAdmin (minted)',
        rolesCheckedAt: now,
    };
    const jwe = await encode({ token, secret: SECRET, maxAge: 60 * 60 * 24 * 7 });
    process.stdout.write(jwe);
})().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
