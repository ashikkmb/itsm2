@echo off
echo ============================================
echo   IT Help Desk - Setup (Windows)
echo ============================================
echo.

REM ── Check Node.js ────────────────────────────────────────────────────────────
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please download and install Node.js LTS from:
    echo   https://nodejs.org
    echo Then restart this script.
    pause
    exit /b 1
)

echo Node.js version:
node --version
echo npm version:
npm --version
echo.

REM ── Create data directory ────────────────────────────────────────────────────
if not exist "data" mkdir data
echo Data directory ready.
echo.

REM ── Install server dependencies ──────────────────────────────────────────────
echo [1/3] Installing server dependencies...
cd server
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Server npm install failed.
    pause
    exit /b 1
)
cd ..
echo Server dependencies installed.
echo.

REM ── Install client dependencies ──────────────────────────────────────────────
echo [2/3] Installing client dependencies...
cd client
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Client npm install failed.
    pause
    exit /b 1
)

REM ── Build React frontend ─────────────────────────────────────────────────────
echo.
echo [3/3] Building React frontend...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: React build failed.
    pause
    exit /b 1
)
cd ..

echo.
echo ============================================
echo   Setup complete!
echo   Run START.bat to launch the server.
echo ============================================
pause
