# Beluga League Website

This is the official website for the Beluga League, built with Next.js. The project has been converted from TypeScript to JavaScript for simplicity.

## Project Structure

The project follows a standard Next.js App Router structure:

- `app/`: Contains all page components and layouts
  - `components/`: Shared UI components
  - `[route]/`: Route-specific pages
- `lib/`: Utility functions and services
- `public/`: Static assets
- `typescript_backup/`: Original TypeScript files (kept for reference)

## Key Features

- Team pages with schedules and rosters
- Player directory with SAL (Skill Assessment Level) ratings
- League standings
- Match schedules
- League rulebook

## Getting Started

### Environment Setup

1. Copy `.env.local.example` to `.env.local` and add your credentials:

```
GOOGLE_CLIENT_EMAIL="your-service-account-email@project.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour key here\n-----END PRIVATE KEY-----"
POWER_RANKINGS_SHEET_ID="your-sheet-id"
```

2. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.jsx`. The page auto-updates as you edit the file.

## JavaScript Conversion

This project was originally created with TypeScript but has been converted to JavaScript for simplicity. Type annotations have been removed, and `.tsx` files have been converted to `.jsx`.

The original TypeScript files are kept in the `typescript_backup/` directory for reference.

## Configuration Files

- `jsconfig.json`: Provides JavaScript language support in the editor
- `tsconfig.json`: Maintained for compatibility with Next.js types
- `next.config.js`: Next.js configuration
- `postcss.config.mjs`: PostCSS configuration for TailwindCSS
- `wrangler.toml`: Cloudflare Workers configuration

## Deployment

The site is configured for Railway deployment.

### Environment Variables for Deployment

Make sure to set the following environment variables in your deployment platform:

- `GOOGLE_CLIENT_EMAIL` - Your Google service account email
- `GOOGLE_PRIVATE_KEY` - Your Google service account private key
- `SHEET_ID_PLAYERS` - Your Google Sheet ID for players/rosters
- `POWER_RANKINGS_SHEET_ID` - Your Google Sheet ID for power rankings
- `DISCORD_CLIENT_ID` - Discord OAuth app client ID (for admin login)
- `DISCORD_CLIENT_SECRET` - Discord OAuth app client secret (for admin login)
- `DISCORD_GUILD_ID` - Discord server ID used for access checks
- `DISCORD_DIRECTOR_ROLE_ID` - Discord role ID allowed into admin pages
- `NEXTAUTH_SECRET` - Random secret used by NextAuth session encryption
- `NEXTAUTH_URL` - Public website URL (for example, your Railway domain)

### Railway Deployment (Separate Service)

If your bot already runs on Railway, deploy this website as a second Railway service from the same repo:

1. Create a new service in the same Railway project.
2. Select this repo and set Root Directory to `beluga-league-main`.
3. Railway will automatically use `railway.toml` in this folder.
4. Add the environment variables listed above.
5. Deploy. Railway will build with Nixpacks and run `next start`.
