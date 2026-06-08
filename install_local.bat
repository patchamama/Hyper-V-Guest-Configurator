@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: ╔══════════════════════════════════════════════════════════════════════════════╗
:: ║             CONFIGURATION — edit these before distributing                 ║
:: ╚══════════════════════════════════════════════════════════════════════════════╝
set GHCR_IMAGE=ghcr.io/patchamama/hyper-v-guest-configurator:latest
set GITHUB_REPO=https://github.com/patchamama/Hyper-V-Guest-Configurator.git
set GITHUB_RAW=https://raw.githubusercontent.com/patchamama/hyper-v-guest-configurator/main
set INSTALL_DIR=C:\ollama-configurator
set APP_PORT=3000
set COMPOSE_SERVICE=app
:: ════════════════════════════════════════════════════════════════════════════════

title Hyper-V Guest Configurator — Local Install
color 0A

echo.
echo  ┌──────────────────────────────────────────────────────────────┐
echo  │   Hyper-V Guest Configurator — Local Machine Install         │
echo  └──────────────────────────────────────────────────────────────┘
echo.

:: ── Require Admin ────────────────────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] This script requires Administrator privileges.
    echo      Right-click and select "Run as administrator".
    pause
    exit /b 1
)

:: ── Step 1: Check / Install Docker ───────────────────────────────────────────
echo  [1/5] Checking Docker Desktop...
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Docker Desktop was not found on this machine.
    set /p ASK_DOCKER=  Install Docker Desktop now? [Y/N]:
    if /i "!ASK_DOCKER!" neq "Y" (
        echo.
        echo  Docker Desktop is required. Download it from:
        echo    https://www.docker.com/products/docker-desktop
        pause
        exit /b 1
    )
    echo.
    echo  Installing Docker Desktop via winget...
    winget install -e --id Docker.DockerDesktop --silent --accept-package-agreements --accept-source-agreements
    if !errorlevel! neq 0 (
        echo  [!] winget install failed. Please install Docker Desktop manually from:
        echo      https://www.docker.com/products/docker-desktop
        pause
        exit /b 1
    )
    echo.
    echo  ┌──────────────────────────────────────────────────────────────┐
    echo  │  Docker Desktop was installed.                               │
    echo  │  Please RESTART your machine and run this script again.      │
    echo  └──────────────────────────────────────────────────────────────┘
    echo.
    pause
    exit /b 0
)
echo   OK — Docker found.

:: ── Step 2: Ensure Docker daemon is running ───────────────────────────────────
echo  [2/5] Checking Docker daemon...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo   Docker Desktop is not running. Starting it now...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" >nul 2>&1
    echo   Waiting for Docker to start (up to 90 seconds)...
    set /a RETRIES=0
    :WaitDocker
    timeout /t 6 /nobreak >nul
    docker info >nul 2>&1
    if %errorlevel% equ 0 goto :DockerReady
    set /a RETRIES+=1
    if !RETRIES! lss 15 (
        set /a SECS=!RETRIES!*6
        echo   Still waiting... (!SECS!s elapsed)
        goto :WaitDocker
    )
    echo  [!] Docker did not start within 90 seconds.
    echo      Please start Docker Desktop manually and run this script again.
    pause
    exit /b 1
    :DockerReady
)
echo   OK — Docker daemon is running.

:: ── Step 3: Prepare install directory ────────────────────────────────────────
echo  [3/5] Preparing install directory: %INSTALL_DIR%
if not exist "%INSTALL_DIR%"          mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\community" mkdir "%INSTALL_DIR%\community"
if not exist "%INSTALL_DIR%\softwares" mkdir "%INSTALL_DIR%\softwares"
cd /d "%INSTALL_DIR%"

:: ── Step 4: Pull image or build from source ───────────────────────────────────
echo  [4/5] Fetching the application...
echo.
echo   Trying pre-built image from %GHCR_IMAGE%...
docker pull %GHCR_IMAGE% >nul 2>&1
if %errorlevel% equ 0 (
    echo   Pre-built image pulled successfully.
    set USE_PREBUILT=1
    goto :WriteCompose
)

echo   Pre-built image not available. Falling back to build from source.
echo.
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Git is not installed and the pre-built image is unavailable.
    echo      Options:
    echo        A) Install Git from https://git-scm.com and re-run this script.
    echo        B) Ask the developer to publish the image by running docker_deploy.ps1.
    pause
    exit /b 1
)
echo   Cloning repository...
if exist "%INSTALL_DIR%\.git" (
    echo   Repository already cloned. Pulling latest changes...
    git pull
) else (
    git clone %GITHUB_REPO% "%INSTALL_DIR%"
    if !errorlevel! neq 0 (
        echo  [!] Git clone failed. Check the repository URL in this script.
        pause
        exit /b 1
    )
)
echo   Building Docker image (this may take several minutes)...
docker build -t local/configurator:latest "%INSTALL_DIR%"
if %errorlevel% neq 0 (
    echo  [!] Docker build failed.
    pause
    exit /b 1
)
set USE_PREBUILT=0
set LOCAL_IMAGE=local/configurator:latest

:: ── Write docker-compose.yml ──────────────────────────────────────────────────
:WriteCompose
if "!USE_PREBUILT!"=="1" (
    set IMG_LINE=    image: %GHCR_IMAGE%
) else (
    set IMG_LINE=    image: !LOCAL_IMAGE!
)

powershell -NoProfile -Command ^
  "$img = '%GHCR_IMAGE%'; $port = '%APP_PORT%';" ^
  "$use = '%USE_PREBUILT%';" ^
  "$imgLine = if ($use -eq '1') { \"    image: $img\" } else { '    image: local/configurator:latest' };" ^
  "@(" ^
  "'services:'," ^
  "'  app:'," ^
  "$imgLine," ^
  "'    ports:'," ^
  "'      - \"%APP_PORT%:3000\"'," ^
  "'    volumes:'," ^
  "'      - ./community:/app/community'," ^
  "'      - ./softwares:/app/softwares'," ^
  "'      - ./llm-config.json:/app/llm-config.json'," ^
  "'      - ./community-config.json:/app/community-config.json'," ^
  "'      - ./winget.json:/app/winget.json'," ^
  "'      - ./tools.json:/app/tools.json'," ^
  "'      - ./port-services.json:/app/port-services.json'," ^
  "'      - ./ollama-models.json:/app/ollama-models.json'," ^
  "'      - ./downloads.txt:/app/downloads.txt'," ^
  "'    restart: unless-stopped'," ^
  "'    environment:'," ^
  "'      - NODE_ENV=production'" ^
  ") | Out-File -FilePath 'docker-compose.yml' -Encoding utf8 -Force"

:: ── Create default config files if missing ───────────────────────────────────
if not exist "llm-config.json" (
    powershell -NoProfile -Command ^
      "@{provider='ollama';ollama=@{host='http://localhost:11434';model='deepseek-r1:1.5b'};systemPrompt='You are a helpful assistant.';elasticsearch=@{enabled=$false;host='http://localhost:9200'}} | ConvertTo-Json -Depth 4 | Out-File 'llm-config.json' -Encoding utf8"
)
if not exist "community-config.json" (
    echo {"enabled":false,"elasticsearch":{"enabled":false}} > "community-config.json"
)
if not exist "winget.json"       ( echo [] > "winget.json" )
if not exist "tools.json"        ( echo [] > "tools.json" )
if not exist "port-services.json" ( echo {} > "port-services.json" )
if not exist "ollama-models.json" (
    powershell -NoProfile -Command ^
      "@(@{tag='deepseek-r1:1.5b';desc='DeepSeek R1 1.5B — fast, lightweight'},@{tag='llama3.2:3b';desc='Meta LLaMA 3.2 3B — balanced'}) | ConvertTo-Json | Out-File 'ollama-models.json' -Encoding utf8"
)
if not exist "downloads.txt" (
    (echo # Format: Display Name ^| URL) > "downloads.txt"
    (echo # Bare URLs also work) >> "downloads.txt"
)

:: ── Step 5: Start container ───────────────────────────────────────────────────
echo  [5/5] Starting the application...
docker compose up -d
if %errorlevel% neq 0 (
    echo  [!] docker compose up failed.
    pause
    exit /b 1
)

:: ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo  ┌──────────────────────────────────────────────────────────────┐
echo  │   Installation complete!                                     │
echo  │                                                              │
echo  │   Open in your browser:                                      │
echo  │     http://localhost:%APP_PORT%                                     │
echo  │                                                              │
echo  │   Install directory: %INSTALL_DIR%
echo  │                                                              │
echo  │   To stop:       docker compose -f "%INSTALL_DIR%\docker-compose.yml" stop
echo  │   To restart:    docker compose -f "%INSTALL_DIR%\docker-compose.yml" start
echo  │   To uninstall:  run uninstall.bat                          │
echo  └──────────────────────────────────────────────────────────────┘
echo.

:: Open browser
timeout /t 3 /nobreak >nul
start "" "http://localhost:%APP_PORT%"

pause
exit /b 0
