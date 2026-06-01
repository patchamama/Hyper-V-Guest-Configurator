#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$ScriptRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $ScriptRoot "web\server.js"
$PORT         = 3000

function Step($msg)  { Write-Host "  >> $msg" -ForegroundColor Cyan }
function OK($msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red }

function Refresh-EnvPath {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")
}

Write-Host ""
Write-Host "  =====================================" -ForegroundColor Cyan
Write-Host "  Hyper-V Web Configurator -- Launcher" -ForegroundColor Cyan
Write-Host "  =====================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Node.js ────────────────────────────────────────────────────────────────
Step "Checking Node.js..."
$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $node) {
    Warn "Node.js not found -- attempting install via winget..."

    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Fail "winget not available."
        throw "Install Node.js LTS manually from https://nodejs.org and re-run."
    }

    winget install OpenJS.NodeJS.LTS --source winget --exact --silent `
        --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -notin @(0, -1978335189)) {
        throw "winget failed to install Node.js (exit $LASTEXITCODE)."
    }

    Refresh-EnvPath

    # If still not found, search common install paths
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        @(
            "$env:ProgramFiles\nodejs",
            "${env:ProgramFiles(x86)}\nodejs",
            "$env:LOCALAPPDATA\Programs\nodejs"
        ) | Where-Object { Test-Path "$_\node.exe" } | Select-Object -First 1 | ForEach-Object {
            $env:PATH = "$_;" + $env:PATH
        }
    }

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js installed but 'node' still not in PATH. Open a new terminal and retry."
    }
}

$nodeVer = (node --version 2>&1).ToString().Trim()
OK "Node.js $nodeVer  ($($node.Source))"

# ── 2. npm ────────────────────────────────────────────────────────────────────
Step "Checking npm..."
Refresh-EnvPath
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { throw "'npm' not found. Reinstall Node.js from https://nodejs.org." }
$npmVer = (npm --version 2>&1).ToString().Trim()
OK "npm $npmVer"

# ── 3. npm dependencies ───────────────────────────────────────────────────────
Step "Checking npm dependencies..."
$required = @("express", "ws", "playwright")
$missing  = $required | Where-Object { -not (Test-Path (Join-Path $ScriptRoot "node_modules\$_")) }

if ($missing) {
    Warn "Missing: $($missing -join ', ') -- running npm install..."
    Push-Location $ScriptRoot
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
    } finally { Pop-Location }

    $stillMissing = $required | Where-Object { -not (Test-Path (Join-Path $ScriptRoot "node_modules\$_")) }
    if ($stillMissing) { throw "npm install completed but still missing: $($stillMissing -join ', ')." }
    OK "Dependencies installed"
} else {
    OK "All dependencies present"
}

# ── 4. Playwright Chromium (for ELO token refresh) ────────────────────────────
Step "Checking Playwright Chromium..."
$playwrightExe = Join-Path $ScriptRoot "node_modules\.bin\playwright.cmd"
$chromiumFlag  = Join-Path $ScriptRoot "node_modules\playwright\.local-chromium"
# Also check default playwright browsers path
$pwBrowsers = Join-Path $env:LOCALAPPDATA "ms-playwright"

if (-not (Test-Path $chromiumFlag) -and -not (Test-Path $pwBrowsers)) {
    Warn "Playwright Chromium not installed -- installing now (needed for ELO token refresh)..."
    Push-Location $ScriptRoot
    try {
        npx playwright install chromium
        if ($LASTEXITCODE -ne 0) { Warn "Playwright browser install returned exit $LASTEXITCODE -- continuing anyway." }
        else { OK "Playwright Chromium installed" }
    } finally { Pop-Location }
} else {
    OK "Playwright Chromium present"
}

# ── 5. Free port if already in use ───────────────────────────────────────────
Step "Checking port $PORT..."
$existing = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Warn "Port $PORT in use (PID $($existing.OwningProcess)) -- stopping old instance..."
    try { Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 1
}
OK "Port $PORT available"

# ── 6. Start server ───────────────────────────────────────────────────────────
Step "Starting web server..."

$proc = Start-Process -FilePath "node" -ArgumentList "`"$serverScript`"" `
    -PassThru -NoNewWindow

# Poll HTTP until ready (max 15 s)
$url      = "http://localhost:$PORT"
$ready    = $false
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { throw "Server process exited unexpectedly (check web\server.js)." }
    try {
        $r = Invoke-WebRequest -Uri "$url/api/state" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        if ($r.StatusCode -lt 500) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    $proc.Kill()
    throw "Server did not respond within 15 seconds."
}

OK "Server running at $url  (PID $($proc.Id))"
Write-Host ""

# Open default browser without admin elevation (avoids browser warnings)
Start-Process -FilePath "explorer.exe" -ArgumentList $url
Write-Host "  Browser opened at $url" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

# ── 7. Keep alive ─────────────────────────────────────────────────────────────
try {
    while (-not $proc.HasExited) { Start-Sleep 1 }
    Fail "Server stopped unexpectedly."
} finally {
    if (-not $proc.HasExited) { $proc.Kill() }
    Write-Host "  Server stopped." -ForegroundColor Gray
}
