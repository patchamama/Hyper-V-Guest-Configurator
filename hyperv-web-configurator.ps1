#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$ScriptRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $ScriptRoot "web\server.js"
$PORT         = 3000

function Step($msg)  { Write-Host "  >> $msg" -ForegroundColor Cyan }
function OK($msg)    { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red }

# ── Hyper-V helpers (optional -- gracefully skipped if module unavailable) ────

$script:HyperVAvailable = $false
try {
    Import-Module Hyper-V -ErrorAction Stop
    $script:HyperVAvailable = $true
} catch { }

function Get-VMIp([string]$VMNameParam) {
    try {
        return (Get-VMNetworkAdapter -VMName $VMNameParam).IPAddresses |
               Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '169.254.*' } |
               Select-Object -First 1
    } catch { return $null }
}

# Tracks portproxy rules and firewall rules added in this session for cleanup on exit.
$script:_portproxyPorts    = @()
$script:_hostFirewallRules = @()

function Get-HostExternalIp {
    return (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike '127.*'     -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.IPAddress -notlike '172.31.*'
        } |
        Sort-Object @{E={
            $a = $_.InterfaceAlias
            if     ($a -match 'WLAN|Wi-Fi|Wireless') { 1 }
            elseif ($a -match 'Ethernet')             { 2 }
            else                                      { 3 }
        }} |
        Select-Object -First 1).IPAddress
}

function Expose-VMWebService {
    param(
        [string]$VM,
        [System.Management.Automation.PSCredential]$Credential,
        [string]$VmIp,
        [int]$VmPort,
        [int]$HostPort,
        [string]$Method   # "firewall" | "ssh" | "portproxy"
    )

    switch ($Method) {
        "firewall" {
            Write-Host "  Opening port $VmPort in VM firewall (Profile: Any)..." -NoNewline
            Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
                $name = "VM-WebApp-$using:VmPort"
                Remove-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
                New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP `
                    -LocalPort $using:VmPort -Action Allow -Profile Any | Out-Null
            }
            Write-Host " done." -ForegroundColor Green
            Write-Host "  Access URL : http://$VmIp`:$VmPort/" -ForegroundColor Cyan
        }
        "ssh" {
            Write-Host "  Starting sshd in VM and ensuring firewall allows it on all profiles..." -NoNewline
            Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
                Set-Service sshd -StartupType Automatic -ErrorAction SilentlyContinue
                Start-Service sshd -ErrorAction SilentlyContinue
                Set-NetFirewallRule -DisplayName "OpenSSH SSH Server (sshd)" -Profile Any -ErrorAction SilentlyContinue
            }
            Write-Host " done." -ForegroundColor Green
            Write-Host ""
            Write-Host "  Run this command on the HOST to create the tunnel:" -ForegroundColor Yellow
            Write-Host "    ssh -L $HostPort`:localhost:$VmPort $($Credential.UserName)@$VmIp" -ForegroundColor Cyan
            Write-Host "  Then browse : http://localhost:$HostPort/" -ForegroundColor Cyan
            Write-Host "  (Keep the SSH session open while you browse)" -ForegroundColor DarkGray
        }
        "portproxy" {
            Write-Host "  Adding netsh portproxy: localhost:$HostPort -> $VmIp`:$VmPort ..." -NoNewline
            netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$HostPort 2>&1 | Out-Null
            netsh interface portproxy add v4tov4 `
                listenaddress=127.0.0.1 listenport=$HostPort `
                connectaddress=$VmIp connectport=$VmPort | Out-Null
            $script:_portproxyPorts += $HostPort
            Write-Host " done." -ForegroundColor Green
            Write-Host "  Access URL : http://localhost:$HostPort/" -ForegroundColor Cyan
        }
    }
}

function Enable-VMFullExposure {
    param(
        [string]$VM,
        [System.Management.Automation.PSCredential]$Credential,
        [string]$VmIp,
        [bool]$EnableRDP    = $true,
        [bool]$DisableNLA   = $false,
        [string]$ListenAddr = "0.0.0.0"
    )

    if ($EnableRDP) {
        Write-Host "  Enabling RDP in VM (port 3389)..." -NoNewline
        $disNla = $DisableNLA
        Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
            Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" `
                fDenyTSConnections -Value 0 -Type DWord
            Set-Service TermService -StartupType Automatic -ErrorAction SilentlyContinue
            Start-Service TermService -ErrorAction SilentlyContinue
            Get-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue |
                Set-NetFirewallRule -Profile Any -Enabled True -ErrorAction SilentlyContinue
            if (-not (Get-NetFirewallRule -DisplayName "Remote Desktop (TCP-In)" -ErrorAction SilentlyContinue)) {
                New-NetFirewallRule -DisplayName "Remote Desktop (TCP-In)" -Direction Inbound `
                    -Protocol TCP -LocalPort 3389 -Action Allow -Profile Any | Out-Null
            }
            if ($using:disNla) {
                Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" `
                    UserAuthentication -Value 0 -Type DWord
            }
        }
        Write-Host " done." -ForegroundColor Green
    }

    $excludedPorts = @(135, 139, 445, 2179, 5985, 47001)
    Write-Host "  Scanning VM listening ports..." -NoNewline
    $vmPorts = @(Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
        Get-NetTCPConnection -State Listen |
            Where-Object {
                $_.LocalAddress -ne '127.0.0.1' -and
                $_.LocalPort -notin $using:excludedPorts -and
                $_.LocalPort -lt 49000
            } |
            Select-Object -ExpandProperty LocalPort |
            Sort-Object -Unique
    })
    if ($EnableRDP -and 3389 -notin $vmPorts) { $vmPorts = @(3389) + $vmPorts }
    Write-Host " $($vmPorts.Count) port(s) found." -ForegroundColor Green

    Write-Host "  Opening detected ports in VM firewall..." -NoNewline
    Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
        Remove-NetFirewallRule -DisplayName "VM-FullExposure-Auto" -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName "VM-FullExposure-Auto" -Direction Inbound -Protocol TCP `
            -LocalPort $using:vmPorts -Action Allow -Profile Any | Out-Null
    }
    Write-Host " done." -ForegroundColor Green

    $hostExtIp = Get-HostExternalIp
    Write-Host "  Configuring host portproxy ($ListenAddr -> $VmIp)..." -NoNewline
    foreach ($port in $vmPorts) {
        netsh interface portproxy delete v4tov4 listenaddress=$ListenAddr listenport=$port 2>&1 | Out-Null
        netsh interface portproxy add v4tov4 `
            listenaddress=$ListenAddr listenport=$port `
            connectaddress=$VmIp connectport=$port | Out-Null
        $rn = "VMProxy-$port"
        Remove-NetFirewallRule -DisplayName $rn -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $rn -Direction Inbound -Protocol TCP `
            -LocalPort $port -Action Allow -Profile Any | Out-Null
        $script:_portproxyPorts    += $port
        $script:_hostFirewallRules += $rn
    }
    Write-Host " done." -ForegroundColor Green

    $displayIp = if ($ListenAddr -eq '0.0.0.0' -and $hostExtIp) { $hostExtIp } else { $ListenAddr }
    Write-Host ""
    Write-Host "  +--------------------------------------------------+" -ForegroundColor Green
    Write-Host "  |  VM FULLY EXPOSED VIA HOST                       |" -ForegroundColor Green
    Write-Host "  |--------------------------------------------------|" -ForegroundColor Green
    if ($EnableRDP) {
        Write-Host ("  |  RDP   : mstsc /v:{0,-31}|" -f "$displayIp`:3389") -ForegroundColor Green
    }
    foreach ($p in ($vmPorts | Where-Object { $_ -ne 3389 } | Select-Object -First 7)) {
        Write-Host ("  |  http  : http://{0,-33}|" -f "$displayIp`:$p/") -ForegroundColor Cyan
    }
    Write-Host ("  |  VM IP : {0,-40}|" -f $VmIp) -ForegroundColor DarkGray
    Write-Host "  +--------------------------------------------------+" -ForegroundColor Green

    # Persist exposure state so the web UI can display connection info
    $expState = [PSCustomObject]@{
        vmName    = $VM
        vmIp      = $VmIp
        hostIp    = if ($hostExtIp) { $hostExtIp } else { $displayIp }
        rdp       = $EnableRDP
        ports     = @($vmPorts)
        timestamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    } | ConvertTo-Json -Compress
    try { $expState | Out-File "C:\ollama-ssl\vm-exposure.json" -Encoding utf8 } catch {}
}

function Test-VMConnectivity {
    param(
        [string]$VM,
        [System.Management.Automation.PSCredential]$Credential,
        [string]$VmIp,
        [int]$TestPort = 19876
    )

    $probeJob = $null
    $hostExtIp = Get-HostExternalIp

    try {
        Write-Host "  Starting probe server in VM on port $TestPort..." -NoNewline
        $probeJob = Invoke-Command -VMName $VM -Credential $Credential -AsJob -ScriptBlock {
            $port = $using:TestPort
            New-NetFirewallRule -DisplayName "Probe-$port" -Direction Inbound -Protocol TCP `
                -LocalPort $port -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
            $l = [Net.HttpListener]::new()
            $l.Prefixes.Add("http://+:$port/")
            $l.Start()
            $bytes = [Text.Encoding]::UTF8.GetBytes("PROBE_OK:$port")
            $deadline = (Get-Date).AddSeconds(90)
            while ((Get-Date) -lt $deadline) {
                if ($l.Pending()) {
                    $ctx = $l.GetContext()
                    $ctx.Response.ContentLength64 = $bytes.Length
                    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                    $ctx.Response.Close()
                }
                Start-Sleep -Milliseconds 100
            }
            $l.Stop()
            Remove-NetFirewallRule -DisplayName "Probe-$port" -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2

        netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$TestPort 2>&1 | Out-Null
        netsh interface portproxy add v4tov4 `
            listenaddress=0.0.0.0 listenport=$TestPort `
            connectaddress=$VmIp connectport=$TestPort | Out-Null
        New-NetFirewallRule -DisplayName "ProbeHost-$TestPort" -Direction Inbound -Protocol TCP `
            -LocalPort $TestPort -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
        Write-Host " ready." -ForegroundColor Green

        Write-Host ""
        Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan
        Write-Host "  |  Connectivity test - probe port $TestPort             |" -ForegroundColor Cyan
        Write-Host "  |--------------------------------------------------|" -ForegroundColor Cyan

        $tests = [ordered]@{
            "VM direct IP  " = "http://$VmIp`:$TestPort/"
            "localhost proxy" = "http://localhost:$TestPort/"
        }
        if ($hostExtIp -and $hostExtIp -ne $VmIp) {
            $tests["host ext IP   "] = "http://$hostExtIp`:$TestPort/"
        }
        foreach ($label in $tests.Keys) {
            $url = $tests[$label]
            try {
                $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
                Write-Host ("  |  {0}: {1,-33}|" -f $label, "PASS (HTTP $($r.StatusCode))") -ForegroundColor Green
            } catch {
                Write-Host ("  |  {0}: {1,-33}|" -f $label, "FAIL") -ForegroundColor Red
            }
        }
        Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan
        Write-Host ""

    } finally {
        if ($null -ne $probeJob) {
            Stop-Job  $probeJob -ErrorAction SilentlyContinue
            Remove-Job $probeJob -Force -ErrorAction SilentlyContinue
        }
        netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$TestPort 2>&1 | Out-Null
        Remove-NetFirewallRule -DisplayName "ProbeHost-$TestPort" -ErrorAction SilentlyContinue
        Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
            Remove-NetFirewallRule -DisplayName "Probe-$using:TestPort" -ErrorAction SilentlyContinue
        } -ErrorAction SilentlyContinue
    }
}

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

# ── 5. Ollama models catalogue ───────────────────────────────────────────────
Step "Checking ollama-models.json..."
$modelsFile = Join-Path $ScriptRoot "ollama-models.json"
if (Test-Path $modelsFile) {
    $modelCount = (Get-Content $modelsFile -Raw | ConvertFrom-Json).Count
    OK "$modelCount model(s) in catalogue  ($modelsFile)"
} else {
    Warn "ollama-models.json not found -- server will use built-in defaults."
}

# ── 7. Free port if already in use ───────────────────────────────────────────
Step "Checking port $PORT..."
$existing = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Warn "Port $PORT in use (PID $($existing.OwningProcess)) -- stopping old instance..."
    try { Stop-Process -Id $existing.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 1
}
OK "Port $PORT available"

# ── 8. Start server ───────────────────────────────────────────────────────────
Step "Starting web server..."

$proc = Start-Process -FilePath "node" -ArgumentList "`"$serverScript`"" `
    -PassThru -NoNewWindow

# Poll TCP port directly -- avoids proxy/firewall issues with Invoke-WebRequest
$url      = "http://127.0.0.1:$PORT"
$ready    = $false
$deadline = (Get-Date).AddSeconds(20)
Write-Host "  Waiting for server on port $PORT" -NoNewline -ForegroundColor Gray
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
        Write-Host ""
        throw "Server process exited unexpectedly. Check web\server.js for errors."
    }
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $tcp.Connect('127.0.0.1', $PORT)
        $ready = $true
        $tcp.Close()
        break
    } catch {
        $tcp.Close()
    }
    Write-Host "." -NoNewline -ForegroundColor Gray
    Start-Sleep -Milliseconds 500
}
Write-Host ""

if (-not $ready) {
    $proc.Kill()
    throw "Server did not respond on port $PORT within 20 seconds."
}

OK "Server running at $url  (PID $($proc.Id))"
Write-Host ""

# Fetch VM-accessible URL from server
$vmUrl   = $null
$filesUrl = $null
try {
    $info = Invoke-RestMethod -Uri "http://127.0.0.1:$PORT/api/host-info" -ErrorAction Stop
    if ($info.ip -and $info.ip -ne '127.0.0.1') {
        $vmUrl    = $info.webUrl
        $filesUrl = $info.filesUrl
    }
} catch {}

Write-Host "  +---------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ("  |  Local (host browser)  : {0,-30}|" -f $url) -ForegroundColor Cyan
if ($vmUrl) {
    Write-Host ("  |  VM browser (Web UI)   : {0,-30}|" -f $vmUrl)    -ForegroundColor Green
    Write-Host ("  |  VM browser (Files)    : {0,-30}|" -f $filesUrl) -ForegroundColor Green
} else {
    Write-Host "  |  VM URL    : not detected (no vEthernet adapter found)   |" -ForegroundColor Yellow
}
Write-Host "  +---------------------------------------------------------+" -ForegroundColor Cyan
Write-Host ""
if ($vmUrl) {
    Write-Host "  TIP: Open the VM and navigate to the Files URL above to browse shared files." -ForegroundColor Gray
}
Write-Host ""

# Open default browser without admin elevation (avoids browser warnings)
Start-Process -FilePath "explorer.exe" -ArgumentList $url
Write-Host "  Browser opened at $url" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

# ── 6. Optional: VM access configuration (expose port / full expose / test) ───
if ($script:HyperVAvailable) {
    Step "VM access configuration (optional)..."
    $runningVMs = @(Get-VM | Where-Object { $_.State -eq 'Running' } | Sort-Object Name)
    if ($runningVMs.Count -gt 0) {
        Write-Host "  Running Hyper-V VMs detected. What would you like to do?" -ForegroundColor Cyan
        Write-Host ""

        $hint = "  UP/DOWN navigate  |  ENTER select"
        $w    = [Math]::Max(60, [Console]::WindowWidth - 1)

        $actionOpts = @(
            [PSCustomObject]@{ Label = "Expose single VM port    -- firewall / SSH tunnel / port proxy";  Value = "single"   }
            [PSCustomObject]@{ Label = "Full VM exposure via host -- RDP + ALL service ports (external)"; Value = "full"     }
            [PSCustomObject]@{ Label = "Test connectivity         -- probe server + verify all paths";    Value = "test"     }
            [PSCustomObject]@{ Label = "Skip                      -- do nothing";                         Value = "skip"     }
        )
        $aCursor = 0; $aDone = $false
        $aTopRow = [Console]::CursorTop
        $drawActions = {
            [Console]::CursorVisible = $false
            [Console]::SetCursorPosition(0, $aTopRow)
            Write-Host $hint.PadRight($w) -ForegroundColor DarkGray
            Write-Host " ".PadRight($w)
            for ($i = 0; $i -lt $actionOpts.Count; $i++) {
                $line = if ($i -eq $aCursor) { "  >  $($actionOpts[$i].Label)" } else { "     $($actionOpts[$i].Label)" }
                if ($i -eq $aCursor) { Write-Host $line.PadRight($w) -ForegroundColor Black -BackgroundColor Cyan -NoNewline }
                else                 { Write-Host $line.PadRight($w) -ForegroundColor White -NoNewline }
                Write-Host ""
            }
            Write-Host " ".PadRight($w)
        }
        & $drawActions
        while (-not $aDone) {
            $k = [Console]::ReadKey($true)
            if     ($k.Key -eq [ConsoleKey]::UpArrow)   { $aCursor = if ($aCursor -gt 0) { $aCursor - 1 } else { $actionOpts.Count - 1 } }
            elseif ($k.Key -eq [ConsoleKey]::DownArrow)  { $aCursor = if ($aCursor -lt ($actionOpts.Count - 1)) { $aCursor + 1 } else { 0 } }
            elseif ($k.Key -eq [ConsoleKey]::Enter)      { $aDone = $true }
            if (-not $aDone) { & $drawActions }
        }
        [Console]::CursorVisible = $true
        [Console]::SetCursorPosition(0, $aTopRow + $actionOpts.Count + 3)
        Write-Host ""
        $exposeAction = $actionOpts[$aCursor].Value

        # ── helper: pick a running VM ─────────────────────────────────────────
        $pickVM = {
            Write-Host "  Select VM:" -ForegroundColor Cyan
            Write-Host ""
            $vCursor = 0; $vDone = $false
            $vTopRow = [Console]::CursorTop
            $drawVMs = {
                [Console]::CursorVisible = $false
                [Console]::SetCursorPosition(0, $vTopRow)
                Write-Host $hint.PadRight($w) -ForegroundColor DarkGray
                Write-Host " ".PadRight($w)
                for ($i = 0; $i -lt $runningVMs.Count; $i++) {
                    $vmIpDisp = Get-VMIp $runningVMs[$i].Name
                    $lbl  = "{0,-28} IP: {1}" -f $runningVMs[$i].Name, $vmIpDisp
                    $line = if ($i -eq $vCursor) { "  >  $lbl" } else { "     $lbl" }
                    if ($i -eq $vCursor) { Write-Host $line.PadRight($w) -ForegroundColor Black -BackgroundColor Cyan -NoNewline }
                    else                  { Write-Host $line.PadRight($w) -ForegroundColor White -NoNewline }
                    Write-Host ""
                }
                Write-Host " ".PadRight($w)
            }
            & $drawVMs
            while (-not $vDone) {
                $k = [Console]::ReadKey($true)
                if     ($k.Key -eq [ConsoleKey]::UpArrow)   { $vCursor = if ($vCursor -gt 0) { $vCursor - 1 } else { $runningVMs.Count - 1 } }
                elseif ($k.Key -eq [ConsoleKey]::DownArrow)  { $vCursor = if ($vCursor -lt ($runningVMs.Count - 1)) { $vCursor + 1 } else { 0 } }
                elseif ($k.Key -eq [ConsoleKey]::Enter)      { $vDone = $true }
                if (-not $vDone) { & $drawVMs }
            }
            [Console]::CursorVisible = $true
            [Console]::SetCursorPosition(0, $vTopRow + $runningVMs.Count + 3)
            Write-Host ""
            return $runningVMs[$vCursor]
        }

        # ── "full" exposure ───────────────────────────────────────────────────
        if ($exposeAction -eq "full") {
            Write-Host ""
            $selectedVM  = & $pickVM
            $detectedIp  = Get-VMIp $selectedVM.Name
            if (-not $detectedIp) {
                Warn "Could not detect IP for '$($selectedVM.Name)'."
            } else {
                Write-Host "  VM: $($selectedVM.Name)  IP: $detectedIp" -ForegroundColor Gray
                Write-Host ""

                # RDP option
                $enableRdp = $false
                $disNla    = $false
                Write-Host "  Enable RDP on the VM?" -ForegroundColor Cyan
                Write-Host ""
                $rdpOpts = @(
                    [PSCustomObject]@{ Label = "Yes -- enable Remote Desktop (port 3389)"; Val = $true  }
                    [PSCustomObject]@{ Label = "No  -- skip RDP";                          Val = $false }
                )
                $rCursor = 0; $rDone = $false; $rRow = [Console]::CursorTop
                $drawRdp = { [Console]::CursorVisible=$false;[Console]::SetCursorPosition(0,$rRow)
                    Write-Host $hint.PadRight($w) -ForegroundColor DarkGray; Write-Host " ".PadRight($w)
                    for ($i=0;$i -lt $rdpOpts.Count;$i++) {
                        $line=if($i -eq $rCursor){"  >  $($rdpOpts[$i].Label)"}else{"     $($rdpOpts[$i].Label)"}
                        if($i -eq $rCursor){Write-Host $line.PadRight($w) -ForegroundColor Black -BackgroundColor Cyan -NoNewline}
                        else{Write-Host $line.PadRight($w) -ForegroundColor White -NoNewline}; Write-Host "" }
                    Write-Host " ".PadRight($w) }
                & $drawRdp
                while (-not $rDone) { $k=[Console]::ReadKey($true)
                    if($k.Key -eq [ConsoleKey]::UpArrow){$rCursor=if($rCursor -gt 0){$rCursor-1}else{$rdpOpts.Count-1}}
                    elseif($k.Key -eq [ConsoleKey]::DownArrow){$rCursor=if($rCursor -lt($rdpOpts.Count-1)){$rCursor+1}else{0}}
                    elseif($k.Key -eq [ConsoleKey]::Enter){$rDone=$true}
                    if(-not $rDone){& $drawRdp} }
                [Console]::CursorVisible=$true;[Console]::SetCursorPosition(0,$rRow+$rdpOpts.Count+3);Write-Host ""
                $enableRdp = $rdpOpts[$rCursor].Val

                $expCred = Get-Credential -Message "Credentials for VM '$($selectedVM.Name)'"
                Write-Host ""
                Enable-VMFullExposure `
                    -VM         $selectedVM.Name `
                    -Credential $expCred `
                    -VmIp       $detectedIp `
                    -EnableRDP  $enableRdp `
                    -ListenAddr "0.0.0.0"
            }
        }

        # ── "test" connectivity ───────────────────────────────────────────────
        elseif ($exposeAction -eq "test") {
            Write-Host ""
            $selectedVM = & $pickVM
            $detectedIp = Get-VMIp $selectedVM.Name
            if (-not $detectedIp) {
                Warn "Could not detect IP for '$($selectedVM.Name)'."
            } else {
                $expCred = Get-Credential -Message "Credentials for VM '$($selectedVM.Name)'"
                Write-Host ""
                Test-VMConnectivity `
                    -VM         $selectedVM.Name `
                    -Credential $expCred `
                    -VmIp       $detectedIp `
                    -TestPort   19876
            }
        }

        # ── "single" port exposure (original logic) ───────────────────────────
        elseif ($exposeAction -eq "single") {
            Write-Host ""
            $selectedVM = & $pickVM
            $detectedIp = Get-VMIp $selectedVM.Name

        if (-not $detectedIp) {
                Warn "Could not detect an IP for VM '$($selectedVM.Name)'. Make sure the VM has a network adapter with an assigned IP."
            } else {
            Write-Host ""
            # Select VM
            Write-Host "  Select VM:" -ForegroundColor Cyan
            Write-Host ""
            $vmCursor = 0; $vmDone = $false
            $vmTopRow = [Console]::CursorTop
            $drawVMs = {
                [Console]::CursorVisible = $false
                [Console]::SetCursorPosition(0, $vmTopRow)
                Write-Host $hint.PadRight($w) -ForegroundColor DarkGray
                Write-Host " ".PadRight($w)
                for ($i = 0; $i -lt $runningVMs.Count; $i++) {
                    $label = "  {0,-30} IP: {1}" -f $runningVMs[$i].Name, (Get-VMIp $runningVMs[$i].Name)
                    $line  = if ($i -eq $vmCursor) { "  >  $label" } else { "     $label" }
                    if ($i -eq $vmCursor) { Write-Host $line.PadRight($w) -ForegroundColor Black -BackgroundColor Cyan -NoNewline }
                    else                  { Write-Host $line.PadRight($w) -ForegroundColor White -NoNewline }
                    Write-Host ""
                }
                Write-Host " ".PadRight($w)
            }
            & $drawVMs
            while (-not $vmDone) {
                $k = [Console]::ReadKey($true)
                if     ($k.Key -eq [ConsoleKey]::UpArrow)   { $vmCursor = if ($vmCursor -gt 0) { $vmCursor - 1 } else { $runningVMs.Count - 1 } }
                elseif ($k.Key -eq [ConsoleKey]::DownArrow)  { $vmCursor = if ($vmCursor -lt ($runningVMs.Count - 1)) { $vmCursor + 1 } else { 0 } }
                elseif ($k.Key -eq [ConsoleKey]::Enter)      { $vmDone = $true }
                if (-not $vmDone) { & $drawVMs }
            }
            [Console]::CursorVisible = $true
            [Console]::SetCursorPosition(0, $vmTopRow + $runningVMs.Count + 3)
            Write-Host ""
            $selectedVM = $runningVMs[$vmCursor]
            $detectedIp = Get-VMIp $selectedVM.Name

            if (-not $detectedIp) {
                Warn "Could not detect an IP for VM '$($selectedVM.Name)'. Make sure the VM has a network adapter with an assigned IP."
            } else {
                Write-Host "  VM: $($selectedVM.Name)  IP: $detectedIp" -ForegroundColor Gray
                Write-Host ""

                # Ports
                Write-Host "  VM port to expose" -ForegroundColor Yellow -NoNewline
                Write-Host " (default 5000): " -NoNewline
                $vpInput = (Read-Host).Trim()
                $expVmPort = if ($vpInput -match '^\d+$') { [int]$vpInput } else { 5000 }

                Write-Host "  Host port to listen on" -ForegroundColor Yellow -NoNewline
                Write-Host " (default $expVmPort): " -NoNewline
                $hpInput = (Read-Host).Trim()
                $expHostPort = if ($hpInput -match '^\d+$') { [int]$hpInput } else { $expVmPort }

                # Method
                Write-Host ""
                Write-Host "  Access method:" -ForegroundColor Cyan
                Write-Host ""
                $methodOpts = @(
                    [PSCustomObject]@{ Label = "Firewall rule in VM   -- opens the port directly (simplest)";              Mode = "firewall"  }
                    [PSCustomObject]@{ Label = "SSH tunnel            -- ssh -L forward (secure, requires SSH)";            Mode = "ssh"       }
                    [PSCustomObject]@{ Label = "Port proxy (netsh)    -- host localhost -> VM, no VM changes";              Mode = "portproxy" }
                )
                $mCursor = 0; $mDone = $false
                $mTopRow = [Console]::CursorTop
                $drawMethods = {
                    [Console]::CursorVisible = $false
                    [Console]::SetCursorPosition(0, $mTopRow)
                    Write-Host $hint.PadRight($w) -ForegroundColor DarkGray
                    Write-Host " ".PadRight($w)
                    for ($i = 0; $i -lt $methodOpts.Count; $i++) {
                        $line = if ($i -eq $mCursor) { "  >  $($methodOpts[$i].Label)" } else { "     $($methodOpts[$i].Label)" }
                        if ($i -eq $mCursor) { Write-Host $line.PadRight($w) -ForegroundColor Black -BackgroundColor Cyan -NoNewline }
                        else                 { Write-Host $line.PadRight($w) -ForegroundColor White -NoNewline }
                        Write-Host ""
                    }
                    Write-Host " ".PadRight($w)
                }
                & $drawMethods
                while (-not $mDone) {
                    $k = [Console]::ReadKey($true)
                    if     ($k.Key -eq [ConsoleKey]::UpArrow)   { $mCursor = if ($mCursor -gt 0) { $mCursor - 1 } else { $methodOpts.Count - 1 } }
                    elseif ($k.Key -eq [ConsoleKey]::DownArrow)  { $mCursor = if ($mCursor -lt ($methodOpts.Count - 1)) { $mCursor + 1 } else { 0 } }
                    elseif ($k.Key -eq [ConsoleKey]::Enter)      { $mDone = $true }
                    if (-not $mDone) { & $drawMethods }
                }
                [Console]::CursorVisible = $true
                [Console]::SetCursorPosition(0, $mTopRow + $methodOpts.Count + 3)
                Write-Host ""
                $chosenMethod = $methodOpts[$mCursor].Mode

                # Ask for credentials (needed for firewall and ssh methods)
                $expCred = $null
                if ($chosenMethod -in @("firewall", "ssh")) {
                    $expCred = Get-Credential -Message "Credentials for VM '$($selectedVM.Name)'"
                }

                Write-Host ""
                Expose-VMWebService `
                    -VM         $selectedVM.Name `
                    -Credential $expCred `
                    -VmIp       $detectedIp `
                    -VmPort     $expVmPort `
                    -HostPort   $expHostPort `
                    -Method     $chosenMethod
            }
        }
        }
        # "skip" falls through with no action
    } else {
        OK "No running Hyper-V VMs found -- skipping VM access configuration."
    }
} else {
    OK "Hyper-V module not available -- VM access configuration step skipped."
}

# ── 9. Keep alive ─────────────────────────────────────────────────────────────
try {
    while (-not $proc.HasExited) { Start-Sleep 1 }
    Fail "Server stopped unexpectedly."
} finally {
    if (-not $proc.HasExited) { $proc.Kill() }
    foreach ($pp in ($script:_portproxyPorts | Sort-Object -Unique)) {
        netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0    listenport=$pp 2>&1 | Out-Null
        netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1  listenport=$pp 2>&1 | Out-Null
        Write-Host "  Portproxy rule port $pp removed." -ForegroundColor Gray
    }
    foreach ($rn in ($script:_hostFirewallRules | Sort-Object -Unique)) {
        Remove-NetFirewallRule -DisplayName $rn -ErrorAction SilentlyContinue
    }
    if ($script:_hostFirewallRules.Count -gt 0) {
        Write-Host "  $($script:_hostFirewallRules.Count) host firewall rule(s) removed." -ForegroundColor Gray
    }
    Write-Host "  Server stopped." -ForegroundColor Gray
}
