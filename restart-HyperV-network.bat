@echo off
setlocal
title Hyper-V Default Switch network recovery

:: This script must run elevated because HNS is a system service.
net session >nul 2>&1
if not "%errorlevel%"=="0" (
    echo ERROR: Run this file as Administrator.
    echo Right-click it and choose "Run as administrator".
    pause
    exit /b 1
)

echo Restarting the Hyper-V Host Network Service (HNS)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Restart-Service -Name hns -Force; Start-Service -Name SharedAccess -ErrorAction SilentlyContinue; Get-Service hns,SharedAccess | Format-Table -AutoSize"

if errorlevel 1 (
    echo.
    echo ERROR: The Hyper-V network recovery did not complete.
    pause
    exit /b 1
)

echo.
echo Done. The Default Switch network has been rebuilt.
echo Connected VMs may need a few seconds to regain Internet access.
pause
endlocal
