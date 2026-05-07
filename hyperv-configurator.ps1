#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$StateFile     = "C:\ollama-ssl\deploy-state.json"
$ScriptRoot    = Split-Path -Parent $MyInvocation.MyCommand.Path
$SoftwaresPath = Join-Path $ScriptRoot "softwares"

# ── Ollama model catalogue ────────────────────────────────────────────────────

$ModelCatalogue = @(
    [PSCustomObject]@{ Tag = "deepseek-r1:1.5b"; Desc = "DeepSeek R1 1.5B   -- fast, lightweight" }
    [PSCustomObject]@{ Tag = "llama3.1:8b";      Desc = "Meta LLaMA 3.1 8B  -- balanced quality" }
    [PSCustomObject]@{ Tag = "gemma4:latest";    Desc = "Google Gemma 4      -- latest release" }
    [PSCustomObject]@{ Tag = "phi4:latest";      Desc = "Microsoft Phi-4     -- efficient reasoning" }
    [PSCustomObject]@{ Tag = "mistral:latest";   Desc = "Mistral 7B          -- strong multilingual" }
    [PSCustomObject]@{ Tag = "qwen2.5:7b";       Desc = "Alibaba Qwen 2.5 7B -- coding & reasoning" }
)

# ── Winget package catalogue ──────────────────────────────────────────────────
# winget is the Windows Package Manager (built-in on Win10 1809+ / Win11).
# Works like apt-get / brew — installs directly from the Microsoft Store catalogue.

$WingetCatalogue = @(
    [PSCustomObject]@{ Name = "Mozilla Firefox";              Id = "Mozilla.Firefox" }
    [PSCustomObject]@{ Name = "Notepad++";                    Id = "Notepad++.Notepad++" }
    [PSCustomObject]@{ Name = "Docker Desktop";               Id = "Docker.DockerDesktop" }
    [PSCustomObject]@{ Name = "PostgreSQL 18";                Id = "PostgreSQL.PostgreSQL.18" }
    [PSCustomObject]@{ Name = "SQL Server 2022 Developer";    Id = "Microsoft.SQLServer.2022.Developer" }
    [PSCustomObject]@{ Name = "SQL Server Mgmt Studio";       Id = "Microsoft.SQLServerManagementStudio" }
    [PSCustomObject]@{ Name = "Git";                          Id = "Git.Git" }
    [PSCustomObject]@{ Name = "Visual Studio Code";           Id = "Microsoft.VisualStudioCode" }
    [PSCustomObject]@{ Name = "7-Zip";                        Id = "7zip.7zip" }
    [PSCustomObject]@{ Name = "Google Chrome";                Id = "Google.Chrome" }
    [PSCustomObject]@{ Name = "VLC Media Player";             Id = "VideoLAN.VLC" }
    [PSCustomObject]@{ Name = "Chocolatey";                   Id = "Chocolatey.Chocolatey" }
)

# ── Known silent install arguments for local installers ──────────────────────
# Keys must match filenames exactly as they appear in the softwares\ folder.
# Change PostgreSQL password before running in production.

$SilentArgs = @{
    "Firefox Installer.exe"                     = "/S"
    "npp.8.9.3.Installer.x64.exe"              = "/S"
    "postgresql-18.3-2-windows-x64.exe"        = "--mode unattended --unattendedmodeui minimal --superpassword `"Postgres1234!`""
    "SQL Server Management Studio_vs_SSMS.exe" = "/install /quiet /norestart"
    "SQL2025-SSEI-EntDev.exe"                  = "/Q /IACCEPTSQLSERVERLICENSETERMS /ACTION=Install /FEATURES=SQL /INSTANCENAME=MSSQLSERVER /SQLSVCACCOUNT=`"NT AUTHORITY\SYSTEM`""
}

# =============================================================================
# Checkpoint / resume
# =============================================================================

function Get-DeployState {
    if (Test-Path $StateFile) {
        $s = Get-Content $StateFile -Raw | ConvertFrom-Json
        if ($null -eq $s.Completed  -or $s.Completed  -isnot [array]) { $s | Add-Member -NotePropertyName Completed      -NotePropertyValue @()   -Force }
        if ($null -eq $s.Models     -or $s.Models     -isnot [array]) { $s | Add-Member -NotePropertyName Models         -NotePropertyValue @()   -Force }
        if ($null -eq $s.Features   -or $s.Features   -isnot [array]) { $s | Add-Member -NotePropertyName Features       -NotePropertyValue @()   -Force }
        if ($null -eq $s.LocalFiles -or $s.LocalFiles -isnot [array]) { $s | Add-Member -NotePropertyName LocalFiles     -NotePropertyValue @()   -Force }
        if ($null -eq $s.WingetPkgs -or $s.WingetPkgs-isnot [array]) { $s | Add-Member -NotePropertyName WingetPkgs     -NotePropertyValue @()   -Force }
        if ($null -eq $s.InstallMode)                                  { $s | Add-Member -NotePropertyName InstallMode    -NotePropertyValue ""    -Force }
        return $s
    }
    return [PSCustomObject]@{
        VMName      = ""
        Completed   = [string[]]@()
        Models      = [string[]]@()
        Features    = [string[]]@()
        LocalFiles  = [string[]]@()
        WingetPkgs  = [string[]]@()
        InstallMode = ""
    }
}

function Save-State($state) {
    $state | ConvertTo-Json | Set-Content $StateFile -Encoding utf8
}

function Is-Done($state, $step)   { $state.Completed -contains $step }

function Mark-Done($state, $step) {
    if (-not (Is-Done $state $step)) { $state.Completed = @($state.Completed) + $step }
    Save-State $state
    Write-Host "  [DONE] $step" -ForegroundColor Green
}

function Read-PlainSecret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Has-PendingInstallation($state) {
    return (
        $state.Completed.Count -gt 0 -or
        -not [string]::IsNullOrWhiteSpace($state.VMName) -or
        $state.Features.Count -gt 0 -or
        $state.Models.Count -gt 0 -or
        $state.LocalFiles.Count -gt 0 -or
        $state.WingetPkgs.Count -gt 0 -or
        -not [string]::IsNullOrWhiteSpace($state.InstallMode)
    )
}

# =============================================================================
# VM connectivity
# =============================================================================

function Wait-VMReady {
    param($VMName, $Credential, [int]$TimeoutSec = 300)
    Write-Host "  Waiting for VM to respond" -NoNewline
    $until = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $until) {
        try {
            Invoke-Command -VMName $VMName -Credential $Credential `
                -ScriptBlock { 1 } -ErrorAction Stop | Out-Null
            Write-Host " ready." -ForegroundColor Green
            return
        } catch {
            Write-Host "." -NoNewline
            Start-Sleep -Seconds 5
        }
    }
    throw "VM '$VMName' did not respond within ${TimeoutSec}s"
}

function Start-VMWithMemoryFallback([string]$VMName) {
    try {
        Start-VM $VMName -ErrorAction Stop | Out-Null
        return
    } catch {
        $msg = $_.Exception.Message
        $isMemoryError = $msg -match "0x800705AA|Nicht genügend Systemressourcen|not enough system resources|cannot allocate|cannot reserve RAM|cannot reserve memory"
        if (-not $isMemoryError) { throw }
        Write-Host "  Low host memory detected while starting '$VMName'. Applying fallback VM memory settings..." -ForegroundColor Yellow
    }

    $mem = Get-VMMemory -VMName $VMName
    $targetStartup = if ($mem.Startup -gt 4GB) { 4GB } else { $mem.Startup }
    if ($targetStartup -lt 2GB) { $targetStartup = 2GB }

    $targetMinimum = if ($mem.Minimum -gt $targetStartup) { $targetStartup } else { $mem.Minimum }
    if ($targetMinimum -lt 1GB) { $targetMinimum = 1GB }

    $targetMaximum = if ($mem.Maximum -lt $targetStartup) { $targetStartup } else { $mem.Maximum }

    Set-VMMemory -VMName $VMName `
        -DynamicMemoryEnabled $true `
        -StartupBytes $targetStartup `
        -MinimumBytes $targetMinimum `
        -MaximumBytes $targetMaximum

    Write-Host ("  Memory fallback applied: Startup={0} MB, Min={1} MB, Max={2} MB" -f `
        [int]($targetStartup / 1MB), [int]($targetMinimum / 1MB), [int]($targetMaximum / 1MB)) -ForegroundColor Yellow

    Start-VM $VMName -ErrorAction Stop | Out-Null
}

function Invoke-InVM([scriptblock]$Script) {
    Invoke-Command -VMName $VMName -Credential $cred -ScriptBlock $Script
}

function Copy-ToVM([string]$SourcePath, [string]$DestinationPath) {
    $session = New-PSSession -VMName $VMName -Credential $cred
    try {
        Copy-Item -Path $SourcePath -Destination $DestinationPath -ToSession $session -Force
    } finally {
        Remove-PSSession $session -ErrorAction SilentlyContinue
    }
}

# =============================================================================
# Step validators
# =============================================================================

function Assert-WSL2 {
    $out = Invoke-InVM { wsl --list --verbose 2>&1 | Out-String }
    if ($out -notmatch "VERSION\s+2" -and $out -notmatch "\*.*2") {
        Write-Host "  Warning: could not confirm WSL2 (output: $out) -- continuing." -ForegroundColor Yellow
        return
    }
    Write-Host "  WSL2 confirmed." -ForegroundColor Green
}

function Assert-DockerReady {
    Write-Host "  Waiting for Docker daemon" -NoNewline
    Invoke-InVM {
        $until = (Get-Date).AddSeconds(180)
        while ((Get-Date) -lt $until) {
            docker info 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { return }
            Write-Host "." -NoNewline
            Start-Sleep -Seconds 5
        }
        throw "Docker daemon not ready after 180s"
    }
    Write-Host " ready." -ForegroundColor Green
}

# =============================================================================
# UI helpers
# =============================================================================

function Write-Banner($text) {
    $line = "=" * ($text.Length + 6)
    Write-Host ""
    Write-Host "  $line" -ForegroundColor Cyan
    Write-Host "  =  $text  =" -ForegroundColor Cyan
    Write-Host "  $line" -ForegroundColor Cyan
    Write-Host ""
}

function Select-FromList {
    param(
        [array]$Items,
        [string]$Prompt,
        [scriptblock]$DisplayItem,
        [switch]$AllowEmpty
    )
    Write-Host ""
    for ($i = 0; $i -lt $Items.Count; $i++) {
        $label = & $DisplayItem $Items[$i]
        Write-Host ("  [{0,2}] {1}" -f $i, $label)
    }
    Write-Host "  [ A] Select all"
    if ($AllowEmpty) { Write-Host "  [ -] Skip / none" }
    Write-Host ""
    Write-Host "  $Prompt " -NoNewline -ForegroundColor Yellow
    $raw = (Read-Host).Trim().ToUpper()

    if ($raw -eq "A") { return $Items }
    if ($raw -eq "" -or $raw -eq "-") { return @() }

    $selected = @()
    foreach ($token in ($raw -split '\s+')) {
        if ($token -match '^\d+$') {
            $n = [int]$token
            if ($n -ge 0 -and $n -lt $Items.Count) { $selected += $Items[$n] }
        }
    }
    return $selected
}

function Select-Models {
    $picked = Select-FromList `
        -Items $ModelCatalogue `
        -Prompt "Numbers separated by spaces (or A for all):" `
        -DisplayItem { param($m) ("{0,-22} {1}" -f $m.Tag, $m.Desc) }

    Write-Host "  Custom model tag (leave blank to skip): " -NoNewline -ForegroundColor Yellow
    $custom = (Read-Host).Trim()
    if ($custom) { $picked += [PSCustomObject]@{ Tag = $custom; Desc = "Custom" } }

    if ($picked.Count -eq 0) {
        Write-Host "  No models selected -- defaulting to deepseek-r1:1.5b" -ForegroundColor Yellow
        return @("deepseek-r1:1.5b")
    }
    Write-Host ""
    Write-Host "  Models queued:" -ForegroundColor Green
    $picked | ForEach-Object { Write-Host "    - $($_.Tag)" }
    return @($picked | ForEach-Object { $_.Tag })
}

function Select-LocalSoftwares {
    if (-not (Test-Path $SoftwaresPath)) {
        Write-Host "  'softwares' folder not found at: $SoftwaresPath" -ForegroundColor Yellow
        return @()
    }

    $folders = @(Get-ChildItem -Path $SoftwaresPath -Directory | Sort-Object Name | ForEach-Object {
        [PSCustomObject]@{
            Name     = $_.Name
            Path     = $_.FullName
            Relative = $_.Name
        }
    })

    if ($folders.Count -eq 0) {
        Write-Host "  No subfolders found in softwares\. Create folders and put installers there." -ForegroundColor Yellow
        return @()
    }

    Write-Host ""
    Write-Host "  Select one or more folders inside softwares\." -ForegroundColor Cyan
    $pickedFolders = Select-FromList `
        -Items $folders `
        -Prompt "Folder numbers separated by spaces (or A for all, - to skip):" `
        -DisplayItem { param($f) ("{0,-25} path: {1}" -f $f.Name, $f.Relative) } `
        -AllowEmpty

    if ($pickedFolders.Count -eq 0) {
        Write-Host "  No folders selected." -ForegroundColor Yellow
        return @()
    }

    $files = @()
    foreach ($folder in $pickedFolders) {
        $files += Get-ChildItem -Path $folder.Path -File -Recurse
    }

    if ($files.Count -eq 0) {
        Write-Host "  No files found in selected folders." -ForegroundColor Yellow
        return @()
    }

    $files = @($files | Sort-Object FullName -Unique)

    $picked = Select-FromList `
        -Items $files `
        -Prompt "File numbers separated by spaces (or A for all, - to skip):" `
        -DisplayItem { param($f)
            $ext = $f.Extension.ToLower()
            $note = if ($ext -eq ".zip") { " [ZIP -- manual extraction needed]" } else { "" }
            $relativePath = $f.FullName.Substring($SoftwaresPath.Length).TrimStart('\','/')
            "$relativePath$note"
        } `
        -AllowEmpty

    return @($picked | ForEach-Object { $_.FullName.Substring($SoftwaresPath.Length).TrimStart('\','/') })
}

function Select-WingetPackages {
    $picked = Select-FromList `
        -Items $WingetCatalogue `
        -Prompt "Numbers separated by spaces (or A for all, - to skip):" `
        -DisplayItem { param($p) ("{0,-35} winget id: {1}" -f $p.Name, $p.Id) } `
        -AllowEmpty

    if ($picked.Count -gt 0) {
        Write-Host ""
        Write-Host "  Winget packages queued:" -ForegroundColor Green
        $picked | ForEach-Object { Write-Host "    - $($_.Name)" }
    }
    return @($picked | ForEach-Object { $_.Id })
}

# =============================================================================
# STARTUP -- detect interrupted installation
# =============================================================================

Write-Banner "Hyper-V Guest Configurator"

$state        = Get-DeployState
$resumeVMName = $null

if (Has-PendingInstallation $state) {
    $lastStep = $state.Completed[-1]
    $vmLabel  = if ($state.VMName) { $state.VMName } else { "(not set)" }

    Write-Host "  +----------------------------------------------------+" -ForegroundColor Yellow
    Write-Host "  |   INTERRUPTED INSTALLATION DETECTED                |" -ForegroundColor Yellow
    Write-Host "  |----------------------------------------------------|" -ForegroundColor Yellow
    Write-Host ("  |  VM       : {0,-37}|" -f $vmLabel)                              -ForegroundColor Yellow
    Write-Host ("  |  Completed: {0,-37}|" -f "$($state.Completed.Count) step(s)")   -ForegroundColor Yellow
    Write-Host ("  |  Last step: {0,-37}|" -f $(if ($lastStep) { $lastStep } else { "(none yet)" })) -ForegroundColor Yellow
    Write-Host "  +----------------------------------------------------+" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  There is a pending installation from a previous run." -ForegroundColor Yellow
    Write-Host "  Do you want to continue with the installation? [Y/N] (default: Y): " -NoNewline -ForegroundColor Yellow
    $continueInstall = (Read-Host).Trim()
    if ($continueInstall -match "^[Nn]") {
        Write-Host ""
        Write-Host "  Installation cancelled by user." -ForegroundColor Magenta
        exit 0
    }
    Write-Host ""
    Write-Host "  [R] Resume from checkpoint" -ForegroundColor Cyan
    Write-Host "  [S] Start over from the beginning" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Choice [R/S] (default: R): " -NoNewline -ForegroundColor Yellow
    $answer = (Read-Host).Trim()

    if ($answer -match "^[Ss]") {
        Write-Host ""
        Write-Host "  Starting over -- previous state cleared." -ForegroundColor Magenta
        $state = [PSCustomObject]@{
            VMName      = ""
            Completed   = [string[]]@()
            Models      = [string[]]@()
            Features    = [string[]]@()
            LocalFiles  = [string[]]@()
            WingetPkgs  = [string[]]@()
            InstallMode = ""
        }
        Save-State $state
    } else {
        Write-Host "  Resuming -- restarting VM first..." -ForegroundColor Green
        $resumeVMName = $state.VMName
        if ($resumeVMName) {
            Stop-VM $resumeVMName -Force -ErrorAction SilentlyContinue
            Start-VMWithMemoryFallback $resumeVMName
        }
    }
}

# =============================================================================
# FEATURE SELECTION
# =============================================================================

if ($state.Features.Count -eq 0) {
    Write-Banner "Feature Selection"
    Write-Host "  What do you want to configure on the guest VM?" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  [1] Full WSL2 + AI stack (WSL + Docker + Ollama)" -ForegroundColor White
    Write-Host "  [2] Install software packages on the guest VM" -ForegroundColor White
    Write-Host "  [3] Minimal WSL preparation only (no WSL install)" -ForegroundColor White
    Write-Host "  [4] Minimal WSL preparation + software copy/install options" -ForegroundColor White
    Write-Host "  [A] Full WSL2 + AI stack + software packages" -ForegroundColor White
    Write-Host ""
    Write-Host "  Choice [1/2/3/4/A]: " -NoNewline -ForegroundColor Yellow
    $fc = (Read-Host).Trim().ToUpper()

    $state.Features = [string[]] $(switch ($fc) {
        "1"     { @("wsl-ai") }
        "2"     { @("software") }
        "3"     { @("wsl-prep") }
        "4"     { @("wsl-prep", "software") }
        default { @("wsl-ai", "software") }
    })
    Save-State $state
}

$enableWSLFull  = $state.Features -contains "wsl-ai"
$enableWSLPrep  = $state.Features -contains "wsl-prep"
$enableWSL      = $enableWSLFull -or $enableWSLPrep
$enableSoftware = $state.Features -contains "software"
$deferSoftwareSelection = $enableWSLPrep -and $enableSoftware

# ── VM selection ──────────────────────────────────────────────────────────────

if (-not $state.VMName) {
    $vms = Get-VM
    if ($vms.Count -eq 0) { throw "No Hyper-V VMs found on this host." }

    Write-Host ""
    Write-Host "  Available Hyper-V VMs:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $vms.Count; $i++) {
        Write-Host ("  [{0}] {1}  --  {2}" -f $i, $vms[$i].Name, $vms[$i].State)
    }
    Write-Host ""
    Write-Host "  Select VM number: " -NoNewline -ForegroundColor Yellow
    $state.VMName = $vms[[int](Read-Host)].Name
    Save-State $state
}

$VMName = $state.VMName

# ── Ollama model selection (WSL pipeline only) ────────────────────────────────

if ($enableWSLFull -and $state.Models.Count -eq 0) {
    Write-Host ""
    Write-Banner "Ollama Model Selection"
    Write-Host "  Select all models now -- no further prompts during deploy." -ForegroundColor Gray
    $state.Models = [string[]]$(Select-Models)
    Save-State $state
} elseif ($enableWSLFull) {
    Write-Host "  Models from checkpoint: $($state.Models -join ', ')" -ForegroundColor Gray
}

# ── Software selection ────────────────────────────────────────────────────────

if ($enableSoftware -and -not $deferSoftwareSelection -and -not (Is-Done $state "software-selected")) {
    Write-Host ""
    Write-Banner "Software Selection"

    Write-Host "  LOCAL INSTALLERS (from softwares\ folder)" -ForegroundColor Cyan
    Write-Host "  ------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  These files will be copied to C:\Install on the guest VM." -ForegroundColor Gray
    $localFiles = Select-LocalSoftwares
    if ($localFiles.Count -gt 0) {
        $state.LocalFiles = [string[]]$localFiles
    }

    Write-Host ""
    Write-Host "  WINGET PACKAGES (Windows Package Manager -- like apt-get / brew)" -ForegroundColor Cyan
    Write-Host "  ------------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  Installed automatically on the guest. No files to copy." -ForegroundColor Gray
    $wingetIds = Select-WingetPackages
    Write-Host ""
    Write-Host "  Install Docker Desktop on the guest VM via winget? [Y/N] (default: N): " -NoNewline -ForegroundColor Yellow
    $dockerViaWinget = (Read-Host).Trim()
    if ($dockerViaWinget -match "^[Yy]") {
        if ($wingetIds -notcontains "Docker.DockerDesktop") {
            $wingetIds += "Docker.DockerDesktop"
        }
    }
    if ($wingetIds.Count -gt 0) {
        $state.WingetPkgs = [string[]]$wingetIds
    }

    if ($state.LocalFiles.Count -gt 0) {
        Write-Host ""
        Write-Host "  Installation mode for LOCAL installers:" -ForegroundColor Cyan
        Write-Host "  [S] Silent     -- fully automated, no interaction needed" -ForegroundColor White
        Write-Host "  [I] Interactive -- copy files, then launch each installer with UI" -ForegroundColor White
        Write-Host "  [C] Copy only  -- copy files to C:\Install, do not run (default)" -ForegroundColor White
        Write-Host ""
        Write-Host "  Choice [S/I/C] (default: C): " -NoNewline -ForegroundColor Yellow
        $modeRaw = (Read-Host).Trim().ToUpper()
        $state.InstallMode = switch ($modeRaw) {
            "S" { "silent" }
            "I" { "interactive" }
            "C" { "copy-only" }
            default { "copy-only" }
        }
    }

    Save-State $state
    Mark-Done $state "software-selected"
} elseif ($enableSoftware) {
    Write-Host "  Software from checkpoint: $($state.LocalFiles.Count) local file(s), $($state.WingetPkgs.Count) winget package(s)" -ForegroundColor Gray
}

$postgresPassword = ""
$mssqlSaPassword  = ""
if ($enableSoftware -and -not $deferSoftwareSelection) {
    $hasPostgres = (($state.WingetPkgs | Where-Object { $_ -match "(?i)^PostgreSQL\.PostgreSQL(\.|$)" } | Measure-Object).Count -gt 0) -or (($state.LocalFiles | Where-Object { $_ -match "(?i)postgresql" } | Measure-Object).Count -gt 0)
    $hasMssql    = (($state.WingetPkgs | Where-Object { $_ -match "(?i)^Microsoft\.SQLServer(\.|$)" } | Measure-Object).Count -gt 0) -or (($state.LocalFiles | Where-Object { $_ -match "(?i)sql.*server|ssei" } | Measure-Object).Count -gt 0)

    if ($hasPostgres) {
        Write-Host ""
        Write-Host "  PostgreSQL installer detected." -ForegroundColor Cyan
        Write-Host "  Define PostgreSQL superuser password now? [Y/N] (default: Y): " -NoNewline -ForegroundColor Yellow
        $setPgPwd = (Read-Host).Trim()
        if ($setPgPwd -notmatch "^[Nn]") {
            $postgresPassword = Read-PlainSecret "  PostgreSQL password (hidden input)"
        }
    }

    if ($hasMssql) {
        Write-Host ""
        Write-Host "  SQL Server installer detected." -ForegroundColor Cyan
        Write-Host "  Define SQL Server 'sa' password now? [Y/N] (default: Y): " -NoNewline -ForegroundColor Yellow
        $setSqlPwd = (Read-Host).Trim()
        if ($setSqlPwd -notmatch "^[Nn]") {
            $mssqlSaPassword = Read-PlainSecret "  SQL Server sa password (hidden input)"
        }
    }
}

# ── Credentials (always prompted -- not stored in state file) ────────────────

$cred = Get-Credential -Message "Credentials for VM '$VMName'"
Write-Host ""
Write-Host "  Target VM    : $VMName" -ForegroundColor Cyan
if ($enableWSLFull)  { Write-Host "  Ollama models: $($state.Models -join ', ')" -ForegroundColor Cyan }
if ($enableSoftware) {
    Write-Host "  Local files  : $($state.LocalFiles.Count)" -ForegroundColor Cyan
    Write-Host "  Winget pkgs  : $($state.WingetPkgs.Count)" -ForegroundColor Cyan
    if ($state.LocalFiles.Count -gt 0) {
        Write-Host "  Install mode : $($state.InstallMode)" -ForegroundColor Cyan
    }
}
Write-Host ""

$vmState = (Get-VM -Name $VMName).State
if ($vmState -ne 'Running') {
    Write-Host "  VM is not running (state: $vmState) -- starting..." -ForegroundColor Yellow
    Start-VMWithMemoryFallback $VMName
    Wait-VMReady $VMName $cred -TimeoutSec 300
} elseif ($resumeVMName) {
    Wait-VMReady $VMName $cred -TimeoutSec 300
}

# =============================================================================
# WSL + AI PIPELINE
# =============================================================================

if ($enableWSL) {

    # ── STEP 1: Nested Virtualization ─────────────────────────────────────────

    if (-not (Is-Done $state "nested-virt")) {
        Write-Banner "STEP 1 -- Nested Virtualization"
        Stop-VM $VMName -Force -ErrorAction SilentlyContinue
        Set-VMProcessor -VMName $VMName -ExposeVirtualizationExtensions $true
        Start-VMWithMemoryFallback $VMName
        Wait-VMReady $VMName $cred
        Mark-Done $state "nested-virt"
    }

    # ── STEP 2: Enable WSL Windows Features ───────────────────────────────────

    if (-not (Is-Done $state "wsl-features")) {
        Write-Banner "STEP 2 -- Enabling WSL Windows Features"
        Invoke-InVM {
            dism /online /enable-feature /featurename:VirtualMachinePlatform          /all /norestart | Out-Null
            dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Null
        }
        Mark-Done $state "wsl-features"
    }

    if (-not (Is-Done $state "wsl-reboot")) {
        Write-Host "  Rebooting VM to apply WSL features..."
        Restart-VM $VMName -Force
        Wait-VMReady $VMName $cred -TimeoutSec 300
        Mark-Done $state "wsl-reboot"
    }

    if ($enableWSLPrep -and -not (Is-Done $state "wsl-prep-updates")) {
        Write-Banner "STEP 3 -- Prepare Windows Update and package support (WSL prep mode)"
        Invoke-InVM {
            Write-Host "  Enabling Microsoft Update for other products..."
            $svcMgr = New-Object -ComObject Microsoft.Update.ServiceManager
            $svcMgr.ClientApplicationID = "WSL2 Prep"
            $svcMgr.AddService2("7971f918-a847-4430-9279-4a52d1efe18d", 7, "") | Out-Null
            Write-Host "  Microsoft Update enabled." -ForegroundColor Green

            Write-Host "  Ensuring Windows Update services are available..."
            foreach ($svcName in @("wuauserv","bits")) {
                Set-Service -Name $svcName -StartupType Manual -ErrorAction SilentlyContinue
                Start-Service -Name $svcName -ErrorAction SilentlyContinue
            }

            Write-Host "  Running package source update (winget) when available..."
            if (Get-Command winget -ErrorAction SilentlyContinue) {
                winget source update | Out-Null
            }
        }
        Mark-Done $state "wsl-prep-updates"
    }

    if ($enableWSLFull) {
        # ── STEP 3a: Install WSL2 kernel package ──────────────────────────────

        if (-not (Is-Done $state "wsl-install")) {
            Write-Banner "STEP 3a -- Install WSL2 Kernel Package"

            Invoke-InVM {
                Write-Host "  Enabling Microsoft Update for other products..."
                $svcMgr = New-Object -ComObject Microsoft.Update.ServiceManager
                $svcMgr.ClientApplicationID = "WSL2 Setup"
                $svcMgr.AddService2("7971f918-a847-4430-9279-4a52d1efe18d", 7, "") | Out-Null
                Write-Host "  Microsoft Update enabled." -ForegroundColor Green

                Write-Host "  Downloading WSL2 Linux kernel update package..."
                $msi = "$env:TEMP\wsl_kernel.msi"
                Invoke-WebRequest `
                    -Uri "https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi" `
                    -OutFile $msi -UseBasicParsing
                Write-Host "  Installing WSL2 kernel update package..."
                Start-Process msiexec -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait
                Remove-Item $msi -Force -ErrorAction SilentlyContinue
                Write-Host "  WSL2 kernel installed." -ForegroundColor Green
            }

            Write-Host ""
            Write-Host "  +-------------------------------------------------------+" -ForegroundColor Yellow
            Write-Host "  |  ACTION REQUIRED -- Manual WSL Install                |" -ForegroundColor Yellow
            Write-Host "  |                                                       |" -ForegroundColor Yellow
            Write-Host "  |  1. Switch to the VM window.                          |" -ForegroundColor Yellow
            Write-Host "  |  2. Open PowerShell as Administrator.                 |" -ForegroundColor Yellow
            Write-Host "  |  3. Run: wsl --install --no-distribution              |" -ForegroundColor Blue
            Write-Host "  |  4. Return here and press ENTER to continue.          |" -ForegroundColor Yellow
            Write-Host "  +-------------------------------------------------------+" -ForegroundColor Yellow
            Write-Host ""
            Read-Host "  Press ENTER when done..." | Out-Null

            Write-Host "  Rebooting VM to finalise WSL installation..."
            Restart-VM $VMName -Force
            Wait-VMReady $VMName $cred -TimeoutSec 300
            Mark-Done $state "wsl-install"
        }

        # ── STEP 3b: Set WSL2 as default ──────────────────────────────────────

        if (-not (Is-Done $state "wsl2-default")) {
            Write-Banner "STEP 3b -- Set WSL2 as Default Version"
            Invoke-InVM {
                Write-Host "  Updating WSL..."
                wsl --update
                Write-Host "  Setting WSL2 as default version..."
                wsl --set-default-version 2
                Write-Host "  WSL2 set as default." -ForegroundColor Green
            }
            Assert-WSL2
            Mark-Done $state "wsl2-default"
        }

        # ── STEP 4: Chocolatey + Docker Desktop ───────────────────────────────

        if (-not (Is-Done $state "docker-install")) {
        Write-Banner "STEP 4 -- Install Docker Desktop"
        Invoke-InVM {
            if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
                Write-Host "  Installing Chocolatey..."
                Set-ExecutionPolicy Bypass -Scope Process -Force
                [Net.ServicePointManager]::SecurityProtocol = 3072
                iex ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
            }
            choco install docker-desktop -y
        }
        Mark-Done $state "docker-install"
    }

        if (-not (Is-Done $state "docker-reboot")) {
        Write-Host "  Rebooting VM after Docker Desktop install..."
        Stop-VM $VMName -Force -ErrorAction SilentlyContinue
        Start-VMWithMemoryFallback $VMName
        Wait-VMReady $VMName $cred -TimeoutSec 300
        Mark-Done $state "docker-reboot"
    }

    # ── STEP 5: Start Docker Desktop ──────────────────────────────────────────

        if (-not (Is-Done $state "docker-ready")) {
        Write-Banner "STEP 5 -- Start Docker Desktop"

        Invoke-InVM {
            Write-Host "  Updating WSL before starting Docker..."
            wsl --update
            Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"
        }

        Write-Host ""
        Write-Host "  +-------------------------------------------------------+" -ForegroundColor Yellow
        Write-Host "  |  ACTION REQUIRED -- Manual step in the VM             |" -ForegroundColor Yellow
        Write-Host "  |                                                       |" -ForegroundColor Yellow
        Write-Host "  |  1. Switch to the VM window.                          |" -ForegroundColor Yellow
        Write-Host "  |  2. Open Docker Desktop if it did not open.           |" -ForegroundColor Yellow
        Write-Host "  |  3. Accept the Docker Desktop Terms of Service.       |" -ForegroundColor Yellow
        Write-Host "  |  4. Wait until the Docker Desktop dashboard loads.    |" -ForegroundColor Yellow
        Write-Host "  |  5. Return here and press ENTER to continue.          |" -ForegroundColor Yellow
        Write-Host "  +-------------------------------------------------------+" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "  Press ENTER when Docker Desktop is running..." | Out-Null

        Assert-DockerReady
        Mark-Done $state "docker-ready"
    }

    # ── STEP 6: Deploy Ollama + Caddy ─────────────────────────────────────────

        if (-not (Is-Done $state "compose-up")) {
        Write-Banner "STEP 6 -- Deploy Ollama + Caddy via Docker Compose"

        Write-Host "  Proceed with docker compose deployment? [Y/N]: " -NoNewline -ForegroundColor Yellow
        $confirm = (Read-Host).Trim()
        if ($confirm -notmatch "^[Yy]") {
            Write-Host "  Deployment cancelled by user." -ForegroundColor Red
        } else {
            $modelsList = $state.Models
            Invoke-InVM {
                New-Item -ItemType Directory -Path C:\ollama-ssl -Force | Out-Null
                Set-Location C:\ollama-ssl

                @"
services:
  ollama:
    image: ollama/ollama
    container_name: ollama
    restart: always
    volumes:
      - ollama_data:/root/.ollama

  caddy:
    image: caddy:latest
    container_name: caddy
    restart: always
    ports:
      - "11443:11434"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - .:/usr/share/caddy
      - caddy_data:/data
    depends_on:
      - ollama

volumes:
  ollama_data:
  caddy_data:
"@ | Set-Content docker-compose.yml -Encoding utf8

                @"
{
    admin off
}

https://127.0.0.1:11434, https://localhost:11434 {
    root * /usr/share/caddy
    file_server

    reverse_proxy /api/* ollama:11434

    header Access-Control-Allow-Origin "*"
}
"@ | Set-Content Caddyfile -Encoding utf8

                Write-Host "  Starting containers..."
                docker compose up -d --force-recreate

                Write-Host "  Waiting for Caddy SSL certificate..."
                $until = (Get-Date).AddSeconds(40)
                while ((Get-Date) -lt $until) {
                    $cert = docker exec caddy cat /data/caddy/pki/authorities/local/root.crt 2>&1
                    if ($LASTEXITCODE -eq 0) { break }
                    Start-Sleep -Seconds 3
                }
                $cert | Set-Content "root.crt" -Encoding utf8
                certutil -addstore -f "ROOT" root.crt | Out-Null
                Write-Host "  SSL certificate installed." -ForegroundColor Green

                Write-Host "  Pulling Ollama models..."
                foreach ($model in $using:modelsList) {
                    Write-Host "    Pulling $model ..."
                    docker exec ollama ollama pull $model
                }
                Write-Host "  All models pulled." -ForegroundColor Green
            }
            Mark-Done $state "compose-up"
        }
        }
    }

} # end $enableWSL

# =============================================================================
# SOFTWARE PIPELINE
# =============================================================================

if ($deferSoftwareSelection -and -not (Is-Done $state "software-selected")) {
    Write-Host ""
    Write-Banner "Software Selection (Final Step)"

    Write-Host "  LOCAL INSTALLERS (from selected folders under softwares\)" -ForegroundColor Cyan
    Write-Host "  ----------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  These files will be copied to C:\Install on the guest VM." -ForegroundColor Gray
    $localFiles = Select-LocalSoftwares
    if ($localFiles.Count -gt 0) {
        $state.LocalFiles = [string[]]$localFiles
        $state.InstallMode = "copy-only"
        Write-Host "  Local installers will be copied only (no auto-install)." -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "  WINGET PACKAGES (optional)" -ForegroundColor Cyan
    Write-Host "  --------------------------" -ForegroundColor DarkGray
    Write-Host "  Winget packages are installed on the VM (not copied)." -ForegroundColor Gray
    $wingetIds = Select-WingetPackages
    Write-Host ""
    Write-Host "  Install Docker Desktop on the guest VM via winget? [Y/N] (default: N): " -NoNewline -ForegroundColor Yellow
    $dockerViaWinget = (Read-Host).Trim()
    if ($dockerViaWinget -match "^[Yy]") {
        if ($wingetIds -notcontains "Docker.DockerDesktop") {
            $wingetIds += "Docker.DockerDesktop"
        }
    }
    if ($wingetIds.Count -gt 0) {
        $state.WingetPkgs = [string[]]$wingetIds
    }

    Save-State $state
    Mark-Done $state "software-selected"
}

if ($enableSoftware -and $deferSoftwareSelection) {
    $hasPostgres = (($state.WingetPkgs | Where-Object { $_ -match "(?i)^PostgreSQL\.PostgreSQL(\.|$)" } | Measure-Object).Count -gt 0) -or (($state.LocalFiles | Where-Object { $_ -match "(?i)postgresql" } | Measure-Object).Count -gt 0)
    $hasMssql    = (($state.WingetPkgs | Where-Object { $_ -match "(?i)^Microsoft\.SQLServer(\.|$)" } | Measure-Object).Count -gt 0) -or (($state.LocalFiles | Where-Object { $_ -match "(?i)sql.*server|ssei" } | Measure-Object).Count -gt 0)

    if ($hasPostgres) {
        Write-Host ""
        Write-Host "  PostgreSQL installer detected." -ForegroundColor Cyan
        Write-Host "  Define PostgreSQL superuser password now? [Y/N] (default: Y): " -NoNewline -ForegroundColor Yellow
        $setPgPwd = (Read-Host).Trim()
        if ($setPgPwd -notmatch "^[Nn]") {
            $postgresPassword = Read-PlainSecret "  PostgreSQL password (hidden input)"
        }
    }

    if ($hasMssql) {
        Write-Host ""
        Write-Host "  SQL Server installer detected." -ForegroundColor Cyan
        Write-Host "  Define SQL Server 'sa' password now? [Y/N] (default: Y): " -NoNewline -ForegroundColor Yellow
        $setSqlPwd = (Read-Host).Trim()
        if ($setSqlPwd -notmatch "^[Nn]") {
            $mssqlSaPassword = Read-PlainSecret "  SQL Server sa password (hidden input)"
        }
    }
}

if ($enableSoftware) {

    # ── STEP S1: Enable Guest Services (required for Copy-VMFile) ─────────────

    if (-not (Is-Done $state "guest-services")) {
        Write-Banner "STEP S1 -- Enable Guest Services"
        $svc = (Get-VM -Name $VMName).VMIntegrationService | Where-Object { $_.Name -eq "Guest Service Interface" }
        if ($null -ne $svc -and -not $svc.Enabled) {
            Enable-VMIntegrationService -VMName $VMName -Name "Guest Service Interface"
            Write-Host "  Guest Service Interface enabled -- rebooting VM to activate it..." -ForegroundColor Green
            Restart-VM $VMName -Force
            Wait-VMReady $VMName $cred -TimeoutSec 300
        } else {
            Write-Host "  Guest Service Interface already active." -ForegroundColor Gray
        }
        Mark-Done $state "guest-services"
    }

    # ── STEP S2: Copy local files to VM ───────────────────────────────────────

    if ($state.LocalFiles.Count -gt 0 -and -not (Is-Done $state "software-copy")) {
        Write-Banner "STEP S2 -- Copy Installers to VM (C:\Install)"

        Invoke-InVM { New-Item -ItemType Directory -Path "C:\Install" -Force | Out-Null }

        foreach ($relativePath in $state.LocalFiles) {
            $srcPath = Join-Path $SoftwaresPath $relativePath
            if (-not (Test-Path $srcPath)) {
                Write-Host "  [SKIP] File not found: $relativePath" -ForegroundColor Yellow
                continue
            }
            $relativeWinPath = $relativePath -replace '/', '\'
            $destPath = "C:\Install\$relativeWinPath"
            $destDir = Split-Path -Path $destPath -Parent
            Invoke-InVM { New-Item -ItemType Directory -Path $using:destDir -Force | Out-Null }
            Write-Host "  Copying $relativePath ..." -NoNewline
            Copy-ToVM -SourcePath $srcPath -DestinationPath $destPath
            Write-Host " done." -ForegroundColor Green
        }
        Mark-Done $state "software-copy"
    }

    # ── STEP S3: Install local files ──────────────────────────────────────────

    if ($state.LocalFiles.Count -gt 0 -and $state.InstallMode -ne "copy-only" -and -not (Is-Done $state "software-install-local")) {
        Write-Banner "STEP S3 -- Install Local Software ($($state.InstallMode))"

        foreach ($relativePath in $state.LocalFiles) {
            $relativeWinPath = $relativePath -replace '/', '\'
            $fileName      = [System.IO.Path]::GetFileName($relativePath)
            $installerPath = "C:\Install\$relativeWinPath"
            $ext           = [System.IO.Path]::GetExtension($fileName).ToLower()

            if ($ext -eq ".zip") {
                Write-Host "  [SKIP] ZIP archive -- extract manually on the VM: $fileName" -ForegroundColor Yellow
                continue
            }

            if ($ext -eq ".pk") {
                Write-Host "  [SKIP] License file -- apply manually: $fileName" -ForegroundColor Yellow
                continue
            }

            if ($state.InstallMode -eq "silent") {
                $silentArg = if ($SilentArgs.ContainsKey($relativePath)) { $SilentArgs[$relativePath] } elseif ($SilentArgs.ContainsKey($fileName)) { $SilentArgs[$fileName] } else { "/S" }
                if ($fileName -match "(?i)^postgresql-.*-windows-.*\.exe$" -and $postgresPassword) {
                    $silentArg = "--mode unattended --unattendedmodeui minimal --superpassword `"$postgresPassword`""
                }
                if ($fileName -match "(?i)^SQL\d+-SSEI-.*\.exe$" -and $mssqlSaPassword) {
                    $silentArg = "/Q /IACCEPTSQLSERVERLICENSETERMS /ACTION=Install /FEATURES=SQL /INSTANCENAME=MSSQLSERVER /SECURITYMODE=SQL /SAPWD=`"$mssqlSaPassword`" /SQLSVCACCOUNT=`"NT AUTHORITY\SYSTEM`""
                }
                Write-Host "  Installing (silent): $relativePath ..."
                Invoke-InVM {
                    $proc = Start-Process -FilePath $using:installerPath -ArgumentList $using:silentArg -Wait -PassThru
                    if ($proc.ExitCode -notin @(0, 3010)) {
                        Write-Host "  [WARN] $using:relativePath exited with code $($proc.ExitCode)" -ForegroundColor Yellow
                    } else {
                        Write-Host "  Installed: $using:relativePath" -ForegroundColor Green
                    }
                }
            } else {
                Write-Host "  Launching (interactive): $relativePath"
                Invoke-InVM { Start-Process -FilePath $using:installerPath }
                Write-Host "  Installer opened in the VM. Press ENTER here when done..." -ForegroundColor Yellow
                Read-Host | Out-Null
            }
        }
        Mark-Done $state "software-install-local"
    }

    # ── STEP S4: Install winget packages ──────────────────────────────────────

    if ($state.WingetPkgs.Count -gt 0 -and -not (Is-Done $state "software-install-winget")) {
        Write-Banner "STEP S4 -- Install Winget Packages"

        $pkgIds = $state.WingetPkgs
        $wingetOverrides = @{}
        if ($postgresPassword) {
            $wingetOverrides["PostgreSQL.PostgreSQL.18"] = "--mode unattended --unattendedmodeui minimal --superpassword `"$postgresPassword`""
        }
        if ($mssqlSaPassword) {
            $wingetOverrides["Microsoft.SQLServer.2022.Developer"] = "/Q /IACCEPTSQLSERVERLICENSETERMS /ACTION=Install /FEATURES=SQL /INSTANCENAME=MSSQLSERVER /SECURITYMODE=SQL /SAPWD=`"$mssqlSaPassword`" /SQLSVCACCOUNT=`"NT AUTHORITY\SYSTEM`""
        }
        Invoke-InVM {
            $wingetOverridesLocal = $using:wingetOverrides
            if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
                Write-Host "  winget not found -- installing Microsoft.DesktopAppInstaller..." -ForegroundColor Yellow
                $wgBundle = "$env:TEMP\winget.msixbundle"
                Invoke-WebRequest -Uri "https://aka.ms/getwinget" -OutFile $wgBundle -UseBasicParsing
                Add-AppxPackage -Path $wgBundle
                Remove-Item $wgBundle -Force -ErrorAction SilentlyContinue
                Write-Host "  winget installed." -ForegroundColor Green
            }
            try {
                winget source update --name winget --accept-source-agreements | Out-Null
            } catch {
                Write-Host "  [WARN] Could not refresh winget source. Continuing..." -ForegroundColor Yellow
            }

            foreach ($pkgId in $using:pkgIds) {
                Write-Host "  Installing: $pkgId ..."
                if ($wingetOverridesLocal.ContainsKey($pkgId)) {
                    $overrideArgs = $wingetOverridesLocal[$pkgId]
                    winget install --id $pkgId --source winget --exact --silent --disable-interactivity --accept-package-agreements --accept-source-agreements --override $overrideArgs 2>&1 | Out-Null
                } else {
                    winget install --id $pkgId --source winget --exact --silent --disable-interactivity --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
                }
                if ($LASTEXITCODE -eq 0) {
                    Write-Host "  Installed: $pkgId" -ForegroundColor Green
                } else {
                    Write-Host "  [WARN] winget failed for $pkgId (exit code $LASTEXITCODE)." -ForegroundColor Yellow
                }
            }
        }
        Mark-Done $state "software-install-winget"
    }

} # end $enableSoftware

# =============================================================================
# WSL PREP NEXT STEPS
# =============================================================================

if ($enableWSLPrep) {
    Write-Host ""
    Write-Host "  +-------------------------------------------------------+" -ForegroundColor Yellow
    Write-Host "  |  WSL PREPARATION COMPLETE (NO WSL INSTALLED YET)      |" -ForegroundColor Yellow
    Write-Host "  |                                                       |" -ForegroundColor Yellow
    Write-Host "  |  Run these commands inside the VM (Admin PowerShell): |" -ForegroundColor Yellow
    Write-Host "  |   1) wsl --install --no-distribution                  |" -ForegroundColor Blue
    Write-Host "  |   2) wsl --update                                      |" -ForegroundColor Blue
    Write-Host "  |   3) wsl --set-default-version 2                      |" -ForegroundColor Blue
    Write-Host "  |   4) Restart VM if requested                          |" -ForegroundColor Yellow
    Write-Host "  +-------------------------------------------------------+" -ForegroundColor Yellow
    Write-Host ""
}

# =============================================================================
# COMPLETE
# =============================================================================

Write-Host ""
Write-Host "  +=========================================+" -ForegroundColor Green
Write-Host "  |        CONFIGURATION COMPLETE           |" -ForegroundColor Green
Write-Host ("  |  VM      : {0,-30}|" -f $VMName) -ForegroundColor Green
if ($enableWSLFull) {
    Write-Host ("  |  Models  : {0,-30}|" -f "$($state.Models.Count) Ollama model(s)") -ForegroundColor Green
} elseif ($enableWSLPrep) {
    Write-Host ("  |  WSL mode: {0,-30}|" -f "Preparation only") -ForegroundColor Green
}
if ($enableSoftware) {
    $totalPkgs = $state.LocalFiles.Count + $state.WingetPkgs.Count
    Write-Host ("  |  Software: {0,-30}|" -f "$totalPkgs package(s) processed") -ForegroundColor Green
}
Write-Host "  +=========================================+" -ForegroundColor Green
Write-Host ""

Remove-Item $StateFile -ErrorAction SilentlyContinue
