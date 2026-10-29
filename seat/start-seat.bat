@echo off
setlocal
title Dedicated Seat
:: usbipd bind needs administrator privileges.
net session >nul 2>&1
if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)
start "" http://localhost:3100
node "%~dp0app.js"
endlocal
