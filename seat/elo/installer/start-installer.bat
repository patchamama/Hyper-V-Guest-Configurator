@echo off
setlocal
title ELO Docker installer
:: Administrator rights are needed for "Expose to the network" (portproxy/firewall).
net session >nul 2>&1
if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)
start "" http://localhost:3200
node "%~dp0server.js"
endlocal
