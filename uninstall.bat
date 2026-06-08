@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ╔══════════════════════════════════════════════════════════════════════════════╗
:: ║  CONFIGURATION — must match the values in install_local.bat               ║
:: ╚══════════════════════════════════════════════════════════════════════════════╝
set GHCR_IMAGE=ghcr.io/patchamama/hyper-v-guest-configurator:latest
set LOCAL_IMAGE=local/configurator:latest
set INSTALL_DIR=C:\ollama-configurator
:: ════════════════════════════════════════════════════════════════════════════════

title Hyper-V Guest Configurator — Uninstall
color 0C

echo.
echo  ┌──────────────────────────────────────────────────────────────┐
echo  │   Hyper-V Guest Configurator — Uninstall                     │
echo  └──────────────────────────────────────────────────────────────┘
echo.
echo  This will stop and remove the application container and image.
echo  Your data in %INSTALL_DIR% will be handled separately.
echo.
set /p CONFIRM=  Proceed with uninstall? [Y/N]:
if /i "!CONFIRM!" neq "Y" (
    echo  Cancelled.
    pause
    exit /b 0
)

:: ── Require Admin ────────────────────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] This script requires Administrator privileges.
    pause
    exit /b 1
)

:: ── Check Docker is available ────────────────────────────────────────────────
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Docker not found — nothing to remove.
    goto :RemoveData
)
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Docker daemon is not running. Start Docker Desktop first.
    pause
    exit /b 1
)

:: ── Stop and remove containers ────────────────────────────────────────────────
echo.
echo  [1/4] Stopping and removing containers...
if exist "%INSTALL_DIR%\docker-compose.yml" (
    docker compose -f "%INSTALL_DIR%\docker-compose.yml" down --remove-orphans 2>nul
    echo   Container stopped and removed.
) else (
    docker ps -aq --filter "ancestor=%GHCR_IMAGE%" > "%TEMP%\_ids.txt" 2>nul
    docker ps -aq --filter "ancestor=%LOCAL_IMAGE%" >> "%TEMP%\_ids.txt" 2>nul
    set /p IDS=<"%TEMP%\_ids.txt"
    if not "!IDS!"=="" (
        for /f "tokens=*" %%i in ("%TEMP%\_ids.txt") do docker rm -f %%i >nul 2>&1
        echo   Containers removed.
    ) else (
        echo   No running containers found.
    )
    del "%TEMP%\_ids.txt" 2>nul
)

:: ── Remove Docker images ──────────────────────────────────────────────────────
echo.
echo  [2/4] Removing Docker images...
docker image rm %GHCR_IMAGE%   >nul 2>&1 && echo   Removed: %GHCR_IMAGE%
docker image rm %LOCAL_IMAGE%  >nul 2>&1 && echo   Removed: %LOCAL_IMAGE%
echo   Images removed (if they existed).

:: ── Remove data directory ─────────────────────────────────────────────────────
:RemoveData
echo.
echo  [3/4] Data directory: %INSTALL_DIR%
set /p RMDATA=  Remove data directory and all configuration/data? [Y/N]:
if /i "!RMDATA!"=="Y" (
    if exist "%INSTALL_DIR%" (
        rd /s /q "%INSTALL_DIR%"
        echo   Data directory removed.
    ) else (
        echo   Directory not found, skipping.
    )
) else (
    echo   Data kept at %INSTALL_DIR%
)

:: ── Optionally uninstall Docker ───────────────────────────────────────────────
echo.
echo  [4/4] Docker Desktop
set /p RMDOCKER=  Uninstall Docker Desktop from this machine? [Y/N]:
if /i "!RMDOCKER!"=="Y" (
    echo   Uninstalling Docker Desktop via winget...
    winget uninstall -e --id Docker.DockerDesktop --silent >nul 2>&1
    if !errorlevel! equ 0 (
        echo   Docker Desktop uninstalled.
    ) else (
        echo   winget uninstall failed. Uninstall Docker Desktop manually from:
        echo   Control Panel → Programs → Uninstall a program → Docker Desktop
    )
) else (
    echo   Docker Desktop kept.
)

echo.
echo  ┌──────────────────────────────────────────────────────────────┐
echo  │   Uninstall complete. No dependencies were left behind.      │
echo  └──────────────────────────────────────────────────────────────┘
echo.
pause
exit /b 0
