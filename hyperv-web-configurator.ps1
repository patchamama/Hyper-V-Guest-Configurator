#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$ScriptRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $ScriptRoot "web\server.js"
$PORT         = 3000

# ── Node.js ───────────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Node.js not found -- installing via winget..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --source winget --exact --silent `
        --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH","User")
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw "Node.js installed but not found in PATH -- open a new terminal and retry." }
}

# ── npm install ───────────────────────────────────────────────────────────────
$express = Join-Path $ScriptRoot "node_modules\express"
if (-not (Test-Path $express)) {
    Write-Host "Installing npm dependencies..." -ForegroundColor Gray
    Push-Location $ScriptRoot
    try { npm install } finally { Pop-Location }
}

# ── Start server ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Starting Hyper-V Web Configurator..." -ForegroundColor Cyan

$proc = Start-Process -FilePath "node" -ArgumentList "`"$serverScript`"" `
    -PassThru -NoNewWindow

Start-Sleep -Seconds 2

if ($proc.HasExited) {
    throw "Server failed to start (exit code $($proc.ExitCode))."
}

$url = "http://localhost:$PORT"
Write-Host "  Open: $url" -ForegroundColor Green
Write-Host "  Server PID: $($proc.Id)" -ForegroundColor Gray
Write-Host "  Press Ctrl+C or close this window to stop." -ForegroundColor Gray
Write-Host ""

Start-Process $url

# ── Wait ──────────────────────────────────────────────────────────────────────
try {
    while (-not $proc.HasExited) { Start-Sleep 1 }
} finally {
    if (-not $proc.HasExited) { $proc.Kill() }
    Write-Host "Server stopped." -ForegroundColor Gray
}
