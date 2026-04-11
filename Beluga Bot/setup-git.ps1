#!/usr/bin/env powershell
# Git repository initialization script

Write-Host "🔧 Beluga League Bot - Git Repository Setup" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

# Check if git is installed
if (!(Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Git is not installed. Please install Git first." -ForegroundColor Red
    exit 1
}

# Initialize git repository if not already initialized
if (!(Test-Path ".git")) {
    Write-Host "📁 Initializing Git repository..." -ForegroundColor Yellow
    git init
    Write-Host "✅ Git repository initialized" -ForegroundColor Green
} else {
    Write-Host "✅ Git repository already exists" -ForegroundColor Green
}

# Check .gitignore exists and has correct entries
Write-Host "`n🔒 Checking .gitignore for security..." -ForegroundColor Yellow

$gitignoreContent = Get-Content .gitignore -ErrorAction SilentlyContinue
$requiredEntries = @('.env', 'credentials.json', 'node_modules/', '*.log')
$missing = @()

foreach ($entry in $requiredEntries) {
    if ($gitignoreContent -notcontains $entry) {
        $missing += $entry
    }
}

if ($missing.Count -eq 0) {
    Write-Host "✅ .gitignore is properly configured" -ForegroundColor Green
} else {
    Write-Host "⚠️  Missing entries in .gitignore: $($missing -join ', ')" -ForegroundColor Yellow
}

# Add all files
Write-Host "`n📋 Adding files to git..." -ForegroundColor Yellow
git add .

# Check for sensitive files that might be staged
Write-Host "`n🔍 Checking for accidentally staged sensitive files..." -ForegroundColor Yellow
$stagedFiles = git diff --cached --name-only

$sensitiveFiles = $stagedFiles | Where-Object { $_ -match '\.(env|key|json)$|credentials|secrets' }

if ($sensitiveFiles) {
    Write-Host "⚠️  WARNING: Sensitive files detected in staging area:" -ForegroundColor Red
    $sensitiveFiles | ForEach-Object { Write-Host "   - $_" -ForegroundColor Red }
    
    $response = Read-Host "`nDo you want to unstage these files? (Y/n)"
    if ($response -ne 'n' -and $response -ne 'N') {
        foreach ($file in $sensitiveFiles) {
            git reset HEAD $file
            Write-Host "Unstaged: $file" -ForegroundColor Yellow
        }
    }
}

# Commit
Write-Host "`n💾 Creating initial commit..." -ForegroundColor Yellow
git commit -m "Initial commit - Beluga League Discord Bot

Discord bot with registration and standings commands
Cloudflare Workers deployment configuration  
Auto-restart and health monitoring
Secure environment variable handling
Private repository setup"

Write-Host "✅ Initial commit created" -ForegroundColor Green

# Instructions for remote repository
Write-Host "`n🌐 Next Steps - Set up remote repository:" -ForegroundColor Yellow
Write-Host "1. Create a PRIVATE repository on GitHub/GitLab" -ForegroundColor White
Write-Host "2. Copy the repository URL" -ForegroundColor White
Write-Host "3. Run one of these commands:" -ForegroundColor White
Write-Host "`n   For GitHub:" -ForegroundColor Cyan
Write-Host "   git remote add origin https://github.com/yourusername/beluga-league-bot.git" -ForegroundColor Gray
Write-Host "   git branch -M main" -ForegroundColor Gray
Write-Host "   git push -u origin main" -ForegroundColor Gray
Write-Host "`n   For GitLab:" -ForegroundColor Cyan  
Write-Host "   git remote add origin https://gitlab.com/yourusername/beluga-league-bot.git" -ForegroundColor Gray
Write-Host "   git push -u origin main" -ForegroundColor Gray

Write-Host "`n🔐 Security Reminders:" -ForegroundColor Red
Write-Host "✅ Repository MUST be set to PRIVATE" -ForegroundColor White
Write-Host "✅ Never commit .env or credentials.json files" -ForegroundColor White
Write-Host "✅ Use Cloudflare Workers secrets for sensitive data" -ForegroundColor White

Write-Host "`n📚 See DEPLOYMENT.md for complete deployment instructions" -ForegroundColor Cyan
