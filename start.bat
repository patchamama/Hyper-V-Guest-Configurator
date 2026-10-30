@echo off
setlocal
title Hyper-V Web Configurator

:: The PowerShell app requires administrator privileges.
net session >nul 2>&1
if errorlevel 1 (
    echo Requesting administrator privileges...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    if errorlevel 1 (
        echo Could not request administrator privileges.
        pause
        exit /b 1
    )
    exit /b 0
)

set "APP_SCRIPT=%~dp0hyperv-web-configurator.ps1"
if not exist "%APP_SCRIPT%" (
    echo ERROR: PowerShell application not found:
    echo   "%APP_SCRIPT%"
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "%APP_SCRIPT%"
endlocal
