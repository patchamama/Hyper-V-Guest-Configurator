#Requires -Version 5.1
<#
.SYNOPSIS
    Build the Docker image, optionally test it locally, and push it to
    GitHub Container Registry (ghcr.io).

.DESCRIPTION
    Run this script from the project root (where the Dockerfile is).
    Steps:
      1. Build the Docker image
      2. Offer to run it locally for testing on port 3100
      3. Tag it for ghcr.io
      4. Log in to ghcr.io using a GitHub Personal Access Token
      5. Push the image (latest + optional version tag)

.NOTES
    Requirements:
      - Docker Desktop running
      - A GitHub PAT with scope: write:packages, read:packages
        Create one at: https://github.com/settings/tokens
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---- Configuration -----------------------------------------------------------
$GitHubUser = "patchamama"
$RepoName   = "hyper-v-guest-configurator"   # ghcr.io requires lowercase
$ImageName  = "ghcr.io/$GitHubUser/$RepoName"
$LocalTag   = "local/$RepoName"              # tag used while testing locally
$DefaultTag = "latest"
$TestPort   = 3100    # local test port (avoids conflict with port 3000)
$ProdPort   = 3000
# ------------------------------------------------------------------------------

function Write-Header($text) {
    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor Cyan
    Write-Host "  $text" -ForegroundColor Cyan
    Write-Host "  ================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step($n, $text) { Write-Host "  [$n] $text" -ForegroundColor Yellow }
function Write-OK($text)        { Write-Host "      OK  $text" -ForegroundColor Green }
function Write-Info($text)      { Write-Host "      $text" -ForegroundColor Gray }
function Write-Err($text)       { Write-Host "  [!] $text" -ForegroundColor Red }

# ---- Verify working directory ------------------------------------------------
if (-not (Test-Path "Dockerfile")) {
    Write-Err "Dockerfile not found. Run this script from the project root."
    exit 1
}

Write-Header "Docker Deploy -- $ImageName"

# ---- Check Docker ------------------------------------------------------------
Write-Step "1/5" "Checking Docker..."
$dockerInfo = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Err "Docker daemon is not running. Start Docker Desktop and retry."
    exit 1
}
Write-OK "Docker is running."

# ---- Build image -------------------------------------------------------------
Write-Step "2/5" "Building Docker image..."
docker build -t "${LocalTag}:${DefaultTag}" .
if ($LASTEXITCODE -ne 0) { Write-Err "docker build failed."; exit 1 }
Write-OK "Image built: ${LocalTag}:${DefaultTag}"

# ---- Local test --------------------------------------------------------------
Write-Step "3/5" "Local test"
Write-Host ""
$testAnswer = Read-Host "      Run the image locally on port $TestPort for testing? [Y/N]"
if ($testAnswer -imatch '^y') {
    # Stop any existing test container
    $existing = docker ps -aq --filter "name=hvgc-test" 2>$null
    if ($existing) {
        Write-Info "Stopping previous test container..."
        docker rm -f hvgc-test | Out-Null
    }

    Write-Info "Starting container on http://localhost:$TestPort ..."

    $volArgs = @(
        "-p", "${TestPort}:3000",
        "-v", "${PWD}\community:/app/community",
        "-v", "${PWD}\softwares:/app/softwares",
        "-v", "${PWD}\llm-config.json:/app/llm-config.json",
        "-v", "${PWD}\community-config.json:/app/community-config.json",
        "-v", "${PWD}\winget.json:/app/winget.json",
        "-v", "${PWD}\tools.json:/app/tools.json",
        "-v", "${PWD}\port-services.json:/app/port-services.json",
        "-v", "${PWD}\ollama-models.json:/app/ollama-models.json",
        "-v", "${PWD}\downloads.txt:/app/downloads.txt"
    )

    docker run -d --name hvgc-test @volArgs "${LocalTag}:${DefaultTag}" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Err "docker run failed."; exit 1 }

    Write-OK "Container started. Opening browser..."
    Start-Sleep -Seconds 2
    Start-Process "http://localhost:$TestPort"

    Write-Host ""
    Write-Host "  ----------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host "  Test the app at : http://localhost:$TestPort" -ForegroundColor Yellow
    Write-Host "  Port $TestPort avoids conflict with non-Docker server on port $ProdPort" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Useful commands:" -ForegroundColor Yellow
    Write-Host "    docker logs -f hvgc-test    (live logs)" -ForegroundColor Yellow
    Write-Host "    docker stop hvgc-test       (stop)" -ForegroundColor Yellow
    Write-Host "    docker rm   hvgc-test       (remove)" -ForegroundColor Yellow
    Write-Host "  ----------------------------------------------------------------" -ForegroundColor Yellow
    Write-Host ""

    $pushAnswer = Read-Host "      Continue with push to ghcr.io? [Y/N]"
    if ($pushAnswer -notmatch '^y') {
        Write-Host ""
        Write-Info "Push cancelled. Test container still running on port $TestPort."
        Write-Info "To stop it: docker rm -f hvgc-test"
        Write-Host ""
        exit 0
    }

    $stopAnswer = Read-Host "      Stop and remove test container before push? [Y/N]"
    if ($stopAnswer -imatch '^y') {
        docker rm -f hvgc-test | Out-Null
        Write-OK "Test container stopped and removed."
    }
} else {
    Write-Info "Skipped local test."
}

# ---- Version tag -------------------------------------------------------------
Write-Step "4/5" "Tagging for ghcr.io"
$versionTag = (Read-Host "      Enter a version tag (e.g. 1.0.0) or press Enter to skip").Trim()

$fullTag = "${ImageName}:${DefaultTag}"
docker tag "${LocalTag}:${DefaultTag}" $fullTag
Write-OK "Tagged: $fullTag"

if ($versionTag) {
    $versionedTag = "${ImageName}:${versionTag}"
    docker tag "${LocalTag}:${DefaultTag}" $versionedTag
    Write-OK "Tagged: $versionedTag"
}

# ---- Authenticate with ghcr.io -----------------------------------------------
Write-Step "5/5" "Pushing to ghcr.io"
Write-Host ""
Write-Info "You need a GitHub PAT with 'write:packages' scope."
Write-Info "Create one at: https://github.com/settings/tokens"
Write-Host ""

$pat = Read-Host "      GitHub PAT (input hidden)" -AsSecureString
$patPlain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($pat)
)

$patPlain | docker login ghcr.io -u $GitHubUser --password-stdin
if ($LASTEXITCODE -ne 0) { Write-Err "Login to ghcr.io failed. Check your PAT and username."; exit 1 }
Write-OK "Logged in as $GitHubUser"

docker push $fullTag
if ($LASTEXITCODE -ne 0) { Write-Err "Push failed."; exit 1 }
Write-OK "Pushed: $fullTag"

if ($versionTag) {
    docker push $versionedTag
    if ($LASTEXITCODE -ne 0) { Write-Err "Push of versioned tag failed."; exit 1 }
    Write-OK "Pushed: $versionedTag"
}

# ---- Done --------------------------------------------------------------------
Write-Host ""
Write-Host "  ================================================================" -ForegroundColor Green
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Image pushed: $fullTag" -ForegroundColor Green
if ($versionTag) {
    Write-Host "  Also pushed : $versionedTag" -ForegroundColor Green
}
Write-Host ""
Write-Host "  IMPORTANT: make the package public so install_local.bat can" -ForegroundColor Green
Write-Host "  pull it without authentication:" -ForegroundColor Green
Write-Host "  github.com/$GitHubUser/$RepoName/pkgs/container/$RepoName" -ForegroundColor Green
Write-Host "  ================================================================" -ForegroundColor Green
Write-Host ""
