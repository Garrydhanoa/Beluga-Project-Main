#!/usr/bin/env powershell
# Quick setup script for Cloudflare Workers deployment

Write-Host "🚀 Beluga League Bot - Cloudflare Workers Setup" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green

# Check if wrangler is installed
if (!(Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Wrangler CLI not found. Installing..." -ForegroundColor Red
    npm install -g wrangler
} else {
    Write-Host "✅ Wrangler CLI found" -ForegroundColor Green
}

# Check if logged in to Cloudflare
Write-Host "`n🔐 Checking Cloudflare authentication..." -ForegroundColor Yellow
try {
    wrangler whoami | Out-Null
    Write-Host "✅ Already logged in to Cloudflare" -ForegroundColor Green
} catch {
    Write-Host "❌ Not logged in. Please authenticate:" -ForegroundColor Red
    wrangler login
}

# Install dependencies
Write-Host "`n📦 Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "`n🔑 Time to set up your secrets!" -ForegroundColor Yellow
Write-Host "Please have your .env file ready. You'll need to enter each value manually." -ForegroundColor White

$secrets = @(
    "DISCORD_TOKEN",
    "APPLICATION_ID", 
    "GUILD_ID",
    "SHEET_ID_MAJORS",
    "SHEET_ID_AAA",
    "SHEET_ID_AA"
)

foreach ($secret in $secrets) {
    Write-Host "`nSetting secret: $secret" -ForegroundColor Cyan
    wrangler secret put $secret
}

Write-Host "`n🔑 Setting Google credentials..." -ForegroundColor Cyan
Write-Host "Paste the ENTIRE contents of your credentials.json file:" -ForegroundColor White
wrangler secret put GOOGLE_CREDENTIALS

Write-Host "`n✅ Setup complete!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. npm run deploy:dev    (Deploy to development)" -ForegroundColor White
Write-Host "2. npm run deploy:prod   (Deploy to production)" -ForegroundColor White
Write-Host "3. npm run cf:logs       (View logs)" -ForegroundColor White

Write-Host "`n📚 See DEPLOYMENT.md for detailed instructions" -ForegroundColor Cyan
