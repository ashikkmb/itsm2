@echo off
echo ============================================
echo   ITCMS NAD (A) - Starting Server
echo ============================================
echo.

REM ── Show local IP for network access ─────────────────────────────────────────
echo   Local:   http://localhost:3000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    echo   Network: http://%%a:3000
)
echo.
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================
echo.

node server\index.js
pause
