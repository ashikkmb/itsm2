@echo off
echo ============================================
echo   IT Help Desk - Install as Windows Service
echo ============================================
echo.
echo This requires NSSM (Non-Sucking Service Manager).
echo If you don't have it yet:
echo   1. Download from https://nssm.cc/download
echo   2. Extract nssm.exe to this folder (next to this .bat file)
echo.

if not exist "nssm.exe" (
    echo ERROR: nssm.exe not found in this folder.
    echo Please download it from https://nssm.cc/download
    echo and place nssm.exe in this same directory, then re-run this script.
    pause
    exit /b 1
)

set SERVICE_NAME=ITHelpDesk
set INSTALL_DIR=%~dp0
set NODE_PATH=node.exe
set SCRIPT_PATH=%INSTALL_DIR%server\index.js

echo Installing service "%SERVICE_NAME%"...
nssm.exe install %SERVICE_NAME% "%NODE_PATH%" "%SCRIPT_PATH%"
nssm.exe set %SERVICE_NAME% AppDirectory "%INSTALL_DIR%"
nssm.exe set %SERVICE_NAME% DisplayName "IT Help Desk Complaint Management System"
nssm.exe set %SERVICE_NAME% Description "Intranet IT complaints management system"
nssm.exe set %SERVICE_NAME% Start SERVICE_AUTO_START
nssm.exe set %SERVICE_NAME% AppStdout "%INSTALL_DIR%logs\service-output.log"
nssm.exe set %SERVICE_NAME% AppStderr "%INSTALL_DIR%logs\service-error.log"
nssm.exe set %SERVICE_NAME% AppRotateFiles 1
nssm.exe set %SERVICE_NAME% AppRotateBytes 1048576

if not exist "logs" mkdir logs

echo.
echo Starting service...
nssm.exe start %SERVICE_NAME%

echo.
echo ============================================
echo   Service installed and started!
echo   It will now auto-start on every boot.
echo.
echo   Useful commands:
echo   nssm start %SERVICE_NAME%      - start
echo   nssm stop %SERVICE_NAME%       - stop
echo   nssm restart %SERVICE_NAME%    - restart
echo   nssm remove %SERVICE_NAME%     - uninstall
echo ============================================
pause
