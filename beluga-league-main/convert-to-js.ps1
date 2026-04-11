# Conversion script to switch from TypeScript to JavaScript
# This script needs to be run from PowerShell with admin privileges

# Create backup directory for original TypeScript files
$backupDir = "typescript_backup"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir
}

# Function to back up TS files
function BackupTsFile($file) {
    $relativePath = $file | Resolve-Path -Relative
    $backupPath = Join-Path $backupDir $relativePath
    $backupFolder = Split-Path -Path $backupPath -Parent
    
    if (-not (Test-Path $backupFolder)) {
        New-Item -ItemType Directory -Path $backupFolder -Force
    }
    
    Copy-Item -Path $file -Destination $backupPath -Force
    Write-Host "Backed up: $relativePath"
}

# Find all TypeScript files and back them up
$tsFiles = Get-ChildItem -Path "." -Recurse -Filter "*.ts" | Where-Object { -not $_.FullName.Contains("node_modules") }
$tsxFiles = Get-ChildItem -Path "." -Recurse -Filter "*.tsx" | Where-Object { -not $_.FullName.Contains("node_modules") }

foreach ($file in $tsFiles) {
    BackupTsFile $file.FullName
}

foreach ($file in $tsxFiles) {
    BackupTsFile $file.FullName
}

# Replace TypeScript files with JavaScript counterparts
Write-Host "`nReplacing TypeScript files with JavaScript versions..."

# Replace .tsx files with .jsx
foreach ($file in $tsxFiles) {
    $jsxFilePath = $file.FullName -replace "\.tsx$", ".jsx"
    if (Test-Path $jsxFilePath) {
        Remove-Item $file.FullName -Force
        Write-Host "Replaced: $($file.Name) with $(Split-Path $jsxFilePath -Leaf)"
    } else {
        Write-Host "Warning: No JavaScript equivalent found for $($file.Name)" -ForegroundColor Yellow
    }
}

# Replace .ts files with .js
foreach ($file in $tsFiles) {
    $jsFilePath = $file.FullName -replace "\.ts$", ".js"
    if (Test-Path $jsFilePath) {
        Remove-Item $file.FullName -Force
        Write-Host "Replaced: $($file.Name) with $(Split-Path $jsFilePath -Leaf)"
    } else {
        Write-Host "Warning: No JavaScript equivalent found for $($file.Name)" -ForegroundColor Yellow
    }
}

# Replace package.json
if (Test-Path "package.json.bak") {
    Copy-Item -Path "package.json" -Destination "package.json.original" -Force
    Copy-Item -Path "package.json.bak" -Destination "package.json" -Force
    Write-Host "Replaced package.json with JavaScript version"
}

# Replace next.config.js if needed
if (Test-Path "next.config.js.bak") {
    Copy-Item -Path "next.config.js" -Destination "next.config.js.original" -Force
    Copy-Item -Path "next.config.js.bak" -Destination "next.config.js" -Force
    Write-Host "Replaced next.config.js with JavaScript version"
}

# Remove TypeScript config files
if (Test-Path "tsconfig.json") {
    Move-Item -Path "tsconfig.json" -Destination "tsconfig.json.bak" -Force
    Write-Host "Moved tsconfig.json to tsconfig.json.bak"
}

Write-Host "`nConversion completed!"
Write-Host "TypeScript files have been backed up to the '$backupDir' directory"
Write-Host "Original configuration files have been renamed with .original extension"
Write-Host "`nNext steps:"
Write-Host "1. Run 'npm install' to update dependencies"
Write-Host "2. Test your application with 'npm run dev'"
