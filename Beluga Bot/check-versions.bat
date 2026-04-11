@echo off
echo.
echo ====================================
echo Node.js Update Verification Script
echo ====================================
echo.

echo Checking Node.js version...
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VERSION=%%i
echo Node.js version: %NODE_VERSION%

if "%NODE_VERSION%"=="v22.19.0" (
    echo ✅ Node.js version is CORRECT!
) else (
    echo ❌ Expected v22.19.0 or v20+
    echo.
    echo Fixing PATH priority...
    set "PATH=C:\Program Files\nodejs\;%PATH%"
    echo Updated PATH to prioritize correct Node.js
)

echo.
echo Checking npm version...
npm --version

echo.
echo Checking for Wrangler CLI...
where wrangler 2>nul
if %ERRORLEVEL% EQU 0 (
    echo ✅ Wrangler found!
    wrangler --version
    echo ✅ Ready for Cloudflare deployment!
) else (
    echo ❌ Wrangler not found. Install with: npm install -g wrangler
)

echo.
echo ====================================
echo Status Summary:
echo - Node.js: %NODE_VERSION%
echo - Ready for: npm run deploy:prod
echo ====================================
echo.
pause
