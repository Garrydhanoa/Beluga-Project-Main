# Local-only launcher for the admin audit dev server.
# Reads NEXTAUTH_SECRET from beluga-league-main/.env and DATABASE_PUBLIC_URL from
# the bot's .env, wires localhost auth + public DB + TLS bypass, runs next dev on 3100.
$ErrorActionPreference = 'Stop'
$siteRoot = Split-Path -Parent $PSScriptRoot
$botEnv   = Join-Path (Split-Path -Parent $siteRoot) 'Beluga Bot/.env'
$siteEnv  = Join-Path $siteRoot '.env'

function Get-EnvVal($file, $key) {
    foreach ($line in Get-Content $file) {
        if ($line -match "^\s*$key\s*=\s*(.+)$") {
            return ($matches[1].Trim().Trim('"'))
        }
    }
    return $null
}

$env:NEXTAUTH_SECRET = Get-EnvVal $siteEnv 'NEXTAUTH_SECRET'
$env:DATABASE_URL    = Get-EnvVal $botEnv 'DATABASE_PUBLIC_URL'
$env:NEXTAUTH_URL    = 'http://localhost:3100'
$env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
$env:NODE_ENV        = 'development'

Set-Location $siteRoot
& npx next dev -p 3100
