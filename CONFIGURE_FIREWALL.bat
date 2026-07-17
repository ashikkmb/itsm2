@echo off
echo ============================================
echo   IT Help Desk - Configure Firewall
echo ============================================
echo.
echo This must be run as Administrator.
echo Right-click this file and choose "Run as administrator"
echo if you have not already done so.
echo.

netsh advfirewall firewall show rule name="IT Help Desk" >nul 2>nul
if %errorlevel%==0 (
    echo Firewall rule already exists. Removing old rule first...
    netsh advfirewall firewall delete rule name="IT Help Desk"
)

echo Adding firewall rule for port 3000...
netsh advfirewall firewall add rule name="IT Help Desk" dir=in action=allow protocol=TCP localport=3000

if %errorlevel%==0 (
    echo.
    echo ============================================
    echo   Firewall rule added successfully!
    echo   Other PCs on the network can now connect.
    echo ============================================
) else (
    echo.
    echo ERROR: Failed to add firewall rule.
    echo Make sure you ran this script as Administrator.
)

pause
