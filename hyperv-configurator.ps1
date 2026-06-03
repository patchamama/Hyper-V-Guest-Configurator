#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$StateFile     = "C:\ollama-ssl\deploy-state.json"
$ScriptRoot    = Split-Path -Parent $MyInvocation.MyCommand.Path
$SoftwaresPath = Join-Path $ScriptRoot "softwares"

# ── Ollama model catalogue (loaded from ollama-models.json) ──────────────────

$_modelsFile = Join-Path $ScriptRoot "ollama-models.json"
if (Test-Path $_modelsFile) {
    $ModelCatalogue = @(Get-Content $_modelsFile -Raw | ConvertFrom-Json | ForEach-Object {
        [PSCustomObject]@{ Tag = $_.tag; Desc = $_.desc }
    })
} else {
    Write-Host "  [WARN] ollama-models.json not found at '$_modelsFile' -- using built-in defaults." -ForegroundColor Yellow
    $ModelCatalogue = @(
        [PSCustomObject]@{ Tag = "deepseek-r1:1.5b"; Desc = "DeepSeek R1 1.5B   -- fast, lightweight" }
        [PSCustomObject]@{ Tag = "llama3.1:8b";      Desc = "Meta LLaMA 3.1 8B  -- balanced quality" }
        [PSCustomObject]@{ Tag = "gemma4:latest";    Desc = "Google Gemma 4      -- latest release" }
        [PSCustomObject]@{ Tag = "phi4:latest";      Desc = "Microsoft Phi-4     -- efficient reasoning" }
        [PSCustomObject]@{ Tag = "mistral:latest";   Desc = "Mistral 7B          -- strong multilingual" }
        [PSCustomObject]@{ Tag = "qwen2.5:7b";       Desc = "Alibaba Qwen 2.5 7B -- coding & reasoning" }
    )
}

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
        if ($null -eq $s.WingetPkgs    -or $s.WingetPkgs   -isnot [array]) { $s | Add-Member -NotePropertyName WingetPkgs     -NotePropertyValue @()   -Force }
        if ($null -eq $s.DownloadUrls  -or $s.DownloadUrls -isnot [array]) { $s | Add-Member -NotePropertyName DownloadUrls   -NotePropertyValue @()   -Force }
        if ($null -eq $s.InstallMode)                                        { $s | Add-Member -NotePropertyName InstallMode    -NotePropertyValue ""    -Force }
        if ($null -eq $s.ExposePort)                                         { $s | Add-Member -NotePropertyName ExposePort       -NotePropertyValue 0     -Force }
        if ($null -eq $s.ExposeHostPort)                                     { $s | Add-Member -NotePropertyName ExposeHostPort  -NotePropertyValue 0     -Force }
        if ($null -eq $s.ExposeMethod)                                       { $s | Add-Member -NotePropertyName ExposeMethod    -NotePropertyValue ""    -Force }
        if ($null -eq $s.FullExposeRDP)                                      { $s | Add-Member -NotePropertyName FullExposeRDP   -NotePropertyValue $false -Force }
        if ($null -eq $s.FullExposeNLA)                                      { $s | Add-Member -NotePropertyName FullExposeNLA   -NotePropertyValue $false -Force }
        if ($null -eq $s.FullExposeExternal)                                 { $s | Add-Member -NotePropertyName FullExposeExternal -NotePropertyValue $true -Force }
        return $s
    }
    return [PSCustomObject]@{
        VMName        = ""
        Completed     = [string[]]@()
        Models        = [string[]]@()
        Features      = [string[]]@()
        LocalFiles    = [string[]]@()
        WingetPkgs    = [string[]]@()
        DownloadUrls  = [string[]]@()
        InstallMode   = ""
        ExposePort       = 0
        ExposeHostPort   = 0
        ExposeMethod     = ""
        FullExposeRDP    = $false
        FullExposeNLA    = $false
        FullExposeExternal = $true
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

function Copy-ToVM([string]$SourcePath, [string]$DestinationPath,
                   [System.Management.Automation.Runspaces.PSSession]$Session = $null) {
    $ownsSession = $null -eq $Session
    if ($ownsSession) { $Session = New-PSSession -VMName $VMName -Credential $cred }
    try {
        $destDir  = Split-Path -Path $DestinationPath -Parent
        $fileName = [System.IO.Path]::GetFileName($SourcePath)
        $fileSize = (Get-Item $SourcePath).Length
        Invoke-Command -Session $Session -ScriptBlock {
            New-Item -ItemType Directory -Path $using:destDir -Force | Out-Null
        }

        $chunkSize = 8MB
        $fs        = [System.IO.File]::OpenRead($SourcePath)
        $copied    = [long]0
        try {
            $buffer = New-Object byte[] $chunkSize
            $first  = $true
            while (($read = $fs.Read($buffer, 0, $chunkSize)) -gt 0) {
                $chunk   = $buffer[0..($read - 1)]
                $dest    = $DestinationPath
                $isFirst = $first
                Invoke-Command -Session $Session -ScriptBlock {
                    $mode  = if ($using:isFirst) { [System.IO.FileMode]::Create } else { [System.IO.FileMode]::Append }
                    $rfs   = [System.IO.File]::Open($using:dest, $mode)
                    $bytes = [byte[]]$using:chunk
                    try   { $rfs.Write($bytes, 0, $bytes.Length) }
                    finally { $rfs.Close() }
                }
                $copied += $read
                $first   = $false
                $pct      = if ($fileSize -gt 0) { [int]($copied * 100 / $fileSize) } else { 100 }
                $copiedMB = [math]::Round($copied / 1MB, 1)
                $totalMB  = [math]::Round($fileSize / 1MB, 1)
                Write-Progress -Id 1 -Activity "Copying to VM" `
                    -Status "$fileName  --  $copiedMB MB / $totalMB MB" `
                    -PercentComplete $pct
            }
        } finally {
            $fs.Close()
            Write-Progress -Id 1 -Activity "Copying to VM" -Completed
        }
    } finally {
        if ($ownsSession) { Remove-PSSession $Session -ErrorAction SilentlyContinue }
    }
}

# ── HTTP file server (fast host-to-VM transfer) ───────────────────────────────
# Serves the softwares\ directory over HTTP so the VM can download directly,
# bypassing slow PSSession serialisation. Falls back to Copy-ToVM on failure.

$script:_srvListener = $null
$script:_srvRunspace = $null
$script:_srvPsCmd    = $null
$script:_srvRuleName = $null
$script:_srvPort     = 0
$script:_srvHostIp   = $null

function Get-HyperVHostIp([string]$VMNameParam) {
    try {
        $sw = (Get-VMNetworkAdapter -VMName $VMNameParam | Select-Object -First 1).SwitchName
        $ip = (Get-VMNetworkAdapter -ManagementOS |
            Where-Object { $_.SwitchName -eq $sw } |
            Select-Object -ExpandProperty IPAddresses |
            Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '169.254.*' } |
            Select-Object -First 1)
        if (-not $ip) {
            $ip = (Get-NetIPAddress -AddressFamily IPv4 |
                Where-Object { ($_.InterfaceAlias -like '*Hyper-V*' -or $_.InterfaceAlias -like '*vEthernet*') `
                               -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
                Select-Object -First 1).IPAddress
        }
        return $ip
    } catch { return $null }
}

function Get-VMIp([string]$VMNameParam) {
    try {
        return (Get-VMNetworkAdapter -VMName $VMNameParam).IPAddresses |
               Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' -and $_ -notlike '169.254.*' } |
               Select-Object -First 1
    } catch { return $null }
}

function Get-HostExternalIp {
    return (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike '127.*'     -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.IPAddress -notlike '172.31.*'        # Hyper-V Default Switch
        } |
        Sort-Object @{E={
            $a = $_.InterfaceAlias
            if     ($a -match 'WLAN|Wi-Fi|Wireless') { 1 }
            elseif ($a -match 'Ethernet')             { 2 }
            else                                      { 3 }
        }} |
        Select-Object -First 1).IPAddress
}

# ── VM web port exposure (3 methods) ─────────────────────────────────────────

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
            Write-Host " done." -ForegroundColor Green
            Write-Host "  Access URL : http://localhost:$HostPort/" -ForegroundColor Cyan
            Write-Host "  To remove  : netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$HostPort" -ForegroundColor DarkGray
        }
    }
}

# ── Full VM exposure via host (RDP + all ports) ───────────────────────────────

function Enable-VMFullExposure {
    param(
        [string]$VM,
        [System.Management.Automation.PSCredential]$Credential,
        [string]$VmIp,
        [bool]$EnableRDP    = $true,
        [bool]$DisableNLA   = $false,
        [string]$ListenAddr = "0.0.0.0"   # 0.0.0.0 = all interfaces (external); 127.0.0.1 = host-only
    )

    # --- Enable RDP in VM ---
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

    # --- Scan all non-internal listening ports in VM ---
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

    # --- Single VM firewall rule allowing all detected ports ---
    Write-Host "  Opening all detected ports in VM firewall..." -NoNewline
    Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
        Remove-NetFirewallRule -DisplayName "VM-FullExposure-Auto" -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName "VM-FullExposure-Auto" -Direction Inbound -Protocol TCP `
            -LocalPort $using:vmPorts -Action Allow -Profile Any | Out-Null
    }
    Write-Host " done." -ForegroundColor Green

    # --- Host portproxy + firewall rule per port ---
    $hostExtIp = Get-HostExternalIp
    Write-Host "  Adding host portproxy and firewall rules ($ListenAddr -> $VmIp)..." -NoNewline
    foreach ($port in $vmPorts) {
        netsh interface portproxy delete v4tov4 listenaddress=$ListenAddr listenport=$port 2>&1 | Out-Null
        netsh interface portproxy add v4tov4 `
            listenaddress=$ListenAddr listenport=$port `
            connectaddress=$VmIp connectport=$port | Out-Null
        $rn = "VMProxy-$port"
        Remove-NetFirewallRule -DisplayName $rn -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName $rn -Direction Inbound -Protocol TCP `
            -LocalPort $port -Action Allow -Profile Any | Out-Null
    }
    Write-Host " done." -ForegroundColor Green

    # --- Summary ---
    $displayIp = if ($ListenAddr -eq '0.0.0.0' -and $hostExtIp) { $hostExtIp } else { $ListenAddr }
    Write-Host ""
    Write-Host "  +--------------------------------------------------+" -ForegroundColor Green
    Write-Host "  |  VM FULLY EXPOSED VIA HOST                       |" -ForegroundColor Green
    Write-Host "  |--------------------------------------------------|" -ForegroundColor Green
    if ($EnableRDP) {
        Write-Host ("  |  RDP   : mstsc /v:{0,-31}|" -f "$displayIp`:3389") -ForegroundColor Green
    }
    $webPorts = @($vmPorts | Where-Object { $_ -ne 3389 })
    foreach ($p in ($webPorts | Select-Object -First 7)) {
        Write-Host ("  |  http  : http://{0,-33}|" -f "$displayIp`:$p/") -ForegroundColor Cyan
    }
    if ($webPorts.Count -gt 7) {
        Write-Host ("  |  ... and {0,-40}|" -f "$($webPorts.Count - 7) more port(s) forwarded") -ForegroundColor DarkGray
    }
    Write-Host "  |--------------------------------------------------|" -ForegroundColor Green
    Write-Host ("  |  VM IP       : {0,-33}|" -f $VmIp) -ForegroundColor DarkGray
    if ($hostExtIp -and $ListenAddr -eq '0.0.0.0') {
        Write-Host ("  |  Host ext IP : {0,-33}|" -f $hostExtIp) -ForegroundColor DarkGray
    }
    Write-Host "  |  Remove all  : netsh interface portproxy reset   |" -ForegroundColor DarkGray
    Write-Host "  +--------------------------------------------------+" -ForegroundColor Green

    # Persist exposure state for the web configurator UI
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

# ── Connectivity probe test ───────────────────────────────────────────────────

function Test-VMConnectivity {
    param(
        [string]$VM,
        [System.Management.Automation.PSCredential]$Credential,
        [string]$VmIp,
        [int]$TestPort     = 19876,
        [int[]]$ExtraPorts = @()
    )

    $probeJob  = $null
    $fwAdded   = $false
    $ppAdded   = $false
    $hostExtIp = Get-HostExternalIp

    try {
        # Start inline probe server on VM via job
        Write-Host "  Starting probe server in VM on port $TestPort (30s timeout)..." -NoNewline
        $probeJob = Invoke-Command -VMName $VM -Credential $Credential -AsJob -ScriptBlock {
            $port = $using:TestPort
            New-NetFirewallRule -DisplayName "Probe-$port" -Direction Inbound -Protocol TCP `
                -LocalPort $port -Action Allow -Profile Any -ErrorAction SilentlyContinue | Out-Null
            $l = [Net.HttpListener]::new()
            $l.Prefixes.Add("http://+:$port/")
            $l.Start()
            $bytes = [Text.Encoding]::UTF8.GetBytes("PROBE_OK:$($port):$($env:COMPUTERNAME)")
            $deadline = (Get-Date).AddSeconds(60)
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

        # Add host portproxy for test port (external access)
        netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$TestPort 2>&1 | Out-Null
        netsh interface portproxy add v4tov4 `
            listenaddress=0.0.0.0 listenport=$TestPort `
            connectaddress=$VmIp connectport=$TestPort | Out-Null
        Remove-NetFirewallRule -DisplayName "ProbeHost-$TestPort" -ErrorAction SilentlyContinue
        New-NetFirewallRule -DisplayName "ProbeHost-$TestPort" -Direction Inbound -Protocol TCP `
            -LocalPort $TestPort -Action Allow -Profile Any | Out-Null
        $ppAdded = $true
        Write-Host " ready." -ForegroundColor Green

        Write-Host ""
        Write-Host "  Test results (probe on port $TestPort):" -ForegroundColor Cyan
        Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan

        $tests = [ordered]@{
            "VM direct (VM IP)"   = "http://$VmIp`:$TestPort/"
            "Host portproxy"      = "http://localhost:$TestPort/"
        }
        if ($hostExtIp -and $hostExtIp -ne $VmIp) {
            $tests["External (host IP)"] = "http://$hostExtIp`:$TestPort/"
        }
        foreach ($label in $tests.Keys) {
            $url = $tests[$label]
            try {
                $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
                $icon = if ($r.StatusCode -eq 200) { "[PASS]" } else { "[HTTP $($r.StatusCode)]" }
                Write-Host ("  |  {0,-20}: {1,-27}|" -f $label, $icon) -ForegroundColor Green
            } catch {
                Write-Host ("  |  {0,-20}: {1,-27}|" -f $label, "[FAIL]") -ForegroundColor Red
            }
        }

        # Also test any extra ports (existing services)
        foreach ($p in $ExtraPorts) {
            $url = "http://$VmIp`:$p/"
            try {
                $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
                Write-Host ("  |  Port %-6d via VM IP: HTTP %-16s|" -f $p, "$($r.StatusCode) OK") -ForegroundColor Cyan
            } catch { }
        }

        Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan
        Write-Host ""
        if ($hostExtIp) {
            Write-Host "  External (host IP): $hostExtIp" -ForegroundColor Gray
        }

    } finally {
        if ($null -ne $probeJob) {
            Stop-Job  $probeJob -ErrorAction SilentlyContinue
            Remove-Job $probeJob -Force -ErrorAction SilentlyContinue
        }
        if ($ppAdded) {
            netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$TestPort 2>&1 | Out-Null
            Remove-NetFirewallRule -DisplayName "ProbeHost-$TestPort" -ErrorAction SilentlyContinue
        }
        Invoke-Command -VMName $VM -Credential $Credential -ScriptBlock {
            Remove-NetFirewallRule -DisplayName "Probe-$using:TestPort" -ErrorAction SilentlyContinue
        } -ErrorAction SilentlyContinue
    }
}

function Start-HostFileServer([string]$Root) {
    $p = Get-Random -Minimum 52000 -Maximum 53000
    $script:_srvPort     = $p
    $script:_srvRuleName = "HVCopy-$p"

    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://+:$p/")
    $listener.Start()
    New-NetFirewallRule -DisplayName $script:_srvRuleName -Direction Inbound -Protocol TCP `
        -LocalPort $p -Action Allow -ErrorAction SilentlyContinue | Out-Null

    $rs    = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
    $rs.Open()
    $psCmd = [System.Management.Automation.PowerShell]::Create()
    $psCmd.Runspace = $rs
    $null  = $psCmd.AddScript({
        param($lsnr, $root)
        while ($lsnr.IsListening) {
            try {
                $ctx  = $lsnr.GetContext()
                $resp = $ctx.Response
                $rel  = [System.Uri]::UnescapeDataString(
                            $ctx.Request.Url.AbsolutePath.TrimStart('/').Replace('/', '\'))
                $path = Join-Path $root $rel
                if (Test-Path $path -PathType Leaf) {
                    $resp.ContentType     = 'application/octet-stream'
                    $resp.ContentLength64 = (Get-Item $path).Length
                    $fs = [System.IO.File]::OpenRead($path)
                    try   { $fs.CopyTo($resp.OutputStream) }
                    finally { $fs.Close() }
                    $resp.StatusCode = 200
                } elseif (Test-Path $path -PathType Container) {
                    $relDisp  = $rel.TrimStart('\')
                    $parentLi = if ($relDisp) { '<tr><td colspan="2"><a href="../">&uarr; Parent</a></td></tr>' } else { '' }
                    $items    = @(Get-ChildItem $path | Sort-Object @{E={if ($_ -is [System.IO.DirectoryInfo]) {0} else {1}}}, Name)
                    $rows     = @($items | ForEach-Object {
                        $isDir = $_ -is [System.IO.DirectoryInfo]
                        $href  = if ($isDir) { $_.Name + '/' } else { $_.Name }
                        $size  = if ($isDir) { '' } else { ('{0:N1} MB' -f ($_.Length / 1MB)) }
                        '<tr><td><a href="' + $href + '">' + $_.Name + '</a></td>' +
                        '<td style="text-align:right;color:#8b949e;padding-left:20px">' + $size + '</td></tr>'
                    })
                    $t   = if ($relDisp) { $relDisp } else { 'Shared files' }
                    $css = 'body{font-family:sans-serif;background:#0d1117;color:#e6edf3;padding:20px;margin:0}' +
                           'h2{color:#E8820C;margin-bottom:12px}' +
                           'table{border-collapse:collapse;width:100%;max-width:700px}' +
                           'td{padding:7px 12px;border-bottom:1px solid #30363d}' +
                           'tr:hover td{background:#161b22}a{color:#58a6ff;text-decoration:none}a:hover{color:#E8820C}'
                    $html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + $t +
                            '</title><style>' + $css + '</style></head><body><h2>' + $t +
                            '</h2><table>' + $parentLi + ($rows -join '') + '</table></body></html>'
                    $enc  = [System.Text.Encoding]::UTF8.GetBytes($html)
                    $resp.ContentType     = 'text/html; charset=utf-8'
                    $resp.ContentLength64 = $enc.Length
                    $resp.OutputStream.Write($enc, 0, $enc.Length)
                    $resp.StatusCode = 200
                } else { $resp.StatusCode = 404 }
            } catch {}
            finally { try { $ctx.Response.Close() } catch {} }
        }
    }).AddParameter('lsnr', $listener).AddParameter('root', $Root)
    $psCmd.BeginInvoke() | Out-Null

    $script:_srvListener = $listener
    $script:_srvRunspace = $rs
    $script:_srvPsCmd    = $psCmd
}

function Stop-HostFileServer {
    if ($script:_srvListener) {
        try { $script:_srvListener.Stop(); $script:_srvListener.Close() } catch {}
    }
    if ($script:_srvPsCmd)    { try { $script:_srvPsCmd.Stop() } catch {} }
    if ($script:_srvRunspace) {
        try { $script:_srvRunspace.Close(); $script:_srvRunspace.Dispose() } catch {}
    }
    if ($script:_srvRuleName) {
        Remove-NetFirewallRule -DisplayName $script:_srvRuleName -ErrorAction SilentlyContinue
    }
    $script:_srvListener = $null; $script:_srvRunspace = $null
    $script:_srvPsCmd    = $null; $script:_srvRuleName = $null
}

function Show-VMFilesUrl {
    $ip = Get-HyperVHostIp $VMName
    if ($ip) {
        Write-Host "  Files URL (open in VM browser): http://${ip}:3000/files/" -ForegroundColor Green
    }
}

function Copy-ToVM-ViaHttp([string]$SourcePath, [string]$DestinationPath) {
    $fileName  = [System.IO.Path]::GetFileName($SourcePath)
    $relParts  = $SourcePath.Replace($SoftwaresPath, '').TrimStart('\', '/').Replace('\', '/').Split('/') |
                     ForEach-Object { [Uri]::EscapeDataString($_) }
    $fileUrl   = 'http://' + $script:_srvHostIp + ':' + $script:_srvPort + '/' + ($relParts -join '/')
    $totalBytes = (Get-Item $SourcePath).Length

    $dlSession   = New-PSSession -VMName $VMName -Credential $cred
    $pollSession = New-PSSession -VMName $VMName -Credential $cred
    $dlJob       = $null
    try {
        Invoke-Command -Session $pollSession -ScriptBlock {
            New-Item -ItemType Directory -Path (Split-Path $using:DestinationPath -Parent) -Force | Out-Null
        }
        $dlJob = Invoke-Command -Session $dlSession -AsJob -ScriptBlock {
            (New-Object System.Net.WebClient).DownloadFile($using:fileUrl, $using:DestinationPath)
        }
        while ($dlJob.State -eq 'Running') {
            Start-Sleep -Seconds 2
            try {
                $done    = Invoke-Command -Session $pollSession -ScriptBlock {
                    if (Test-Path $using:DestinationPath) { (Get-Item $using:DestinationPath).Length } else { [long]0 }
                }
                $doneMB  = [math]::Round($done / 1MB, 1)
                $totalMB = [math]::Round($totalBytes / 1MB, 1)
                $pct     = if ($totalBytes -gt 0) { [int]([math]::Min(99, $done * 100 / $totalBytes)) } else { 0 }
                Write-Progress -Id 1 -Activity "HTTP -> VM" `
                    -Status "$fileName  $doneMB / $totalMB MB" -PercentComplete $pct
            } catch {}
        }
        Write-Progress -Id 1 -Activity "HTTP -> VM" -Completed
        try { Receive-Job $dlJob -Wait -ErrorAction Stop | Out-Null }
        catch {
            $msg = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
            throw "HTTP copy failed for '${fileName}': $msg"
        }
    } finally {
        if ($null -ne $dlJob) { Remove-Job $dlJob -Force -ErrorAction SilentlyContinue }
        Remove-PSSession $dlSession, $pollSession -ErrorAction SilentlyContinue
    }
}

function Test-UrlExpired([string]$Url) {
    if ($Url -match '[?&]expire=(\d+)') {
        $expireAt = [long]$Matches[1]
        $now      = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        return $expireAt -lt $now
    }
    return $false
}

function Download-ToVM([string]$Url, [string]$DestinationPath) {
    $fileName  = $Url.Split('?')[0].Split('/')[-1]
    $totalBytes = [long]-1
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Method = "HEAD"
        $req.AllowAutoRedirect = $true
        $resp = $req.GetResponse()
        $totalBytes = $resp.ContentLength
        $resp.Close()
    } catch { }

    $totalMB = if ($totalBytes -gt 0) { [math]::Round($totalBytes / 1MB, 1) } else { "?" }

    $downloadSession = New-PSSession -VMName $VMName -Credential $cred
    $pollSession     = New-PSSession -VMName $VMName -Credential $cred
    $downloadJob     = $null
    try {
        $destDir = Split-Path -Path $DestinationPath -Parent
        Invoke-Command -Session $pollSession -ScriptBlock {
            New-Item -ItemType Directory -Path $using:destDir -Force | Out-Null
        }

        $downloadJob = Invoke-Command -Session $downloadSession -AsJob -ScriptBlock {
            $wc = [System.Net.WebClient]::new()
            $wc.DownloadFile($using:Url, $using:DestinationPath)
        }

        while ($downloadJob.State -eq 'Running') {
            Start-Sleep -Seconds 2
            try {
                $currentBytes = Invoke-Command -Session $pollSession -ScriptBlock {
                    if (Test-Path $using:DestinationPath) { (Get-Item $using:DestinationPath).Length } else { [long]0 }
                }
                $doneMB = [math]::Round($currentBytes / 1MB, 1)
                if ($totalBytes -gt 0) {
                    $pct = [int]([math]::Min(99, $currentBytes * 100 / $totalBytes))
                    Write-Progress -Id 2 -Activity "Downloading in VM" `
                        -Status "$fileName  --  $doneMB MB / $totalMB MB" `
                        -PercentComplete $pct
                } else {
                    Write-Progress -Id 2 -Activity "Downloading in VM" `
                        -Status "$fileName  --  $doneMB MB downloaded"
                }
            } catch { }
        }

        try {
            Receive-Job $downloadJob -Wait -ErrorAction Stop | Out-Null
        } catch {
            Write-Progress -Id 2 -Activity "Downloading in VM" -Completed
            $inner = $_.Exception.InnerException
            $msg   = if ($null -ne $inner) { $inner.Message } else { $_.Exception.Message }
            throw "Download failed for '$fileName': $msg"
        }
        Write-Progress -Id 2 -Activity "Downloading in VM" -Completed
    } finally {
        if ($null -ne $downloadJob) { Remove-Job $downloadJob -Force -ErrorAction SilentlyContinue }
        Remove-PSSession $downloadSession -ErrorAction SilentlyContinue
        Remove-PSSession $pollSession     -ErrorAction SilentlyContinue
    }
}

function Expand-ZipInVM([string]$ZipPath) {
    $stem    = [System.IO.Path]::GetFileNameWithoutExtension($ZipPath)
    $destDir = "C:\Install\$stem"
    Write-Host "  Extracting to $destDir ..." -NoNewline
    try {
        Invoke-InVM {
            Expand-Archive -Path $using:ZipPath -DestinationPath $using:destDir -Force
        }
        Write-Host " done." -ForegroundColor Green
    } catch {
        Write-Host " failed: $_" -ForegroundColor Yellow
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
        [string]$Prompt       = "",
        [scriptblock]$DisplayItem  = { param($x) "$x" },
        [switch]$AllowEmpty,
        [switch]$SingleSelect
    )

    if ($Items.Count -eq 0) { return @() }

    $sel    = [bool[]]::new($Items.Count)
    $cursor = 0

    $draw = {
        $w = [Math]::Max(60, [Console]::WindowWidth - 1)
        [Console]::CursorVisible = $false
        [Console]::SetCursorPosition(0, $topRow)

        $hint = if ($SingleSelect) {
            "  UP/DOWN navigate  |  ENTER select"
        } elseif ($AllowEmpty) {
            "  UP/DOWN navigate  |  SPACE toggle  |  A select all  |  N select none  |  ENTER confirm (or skip)"
        } else {
            "  UP/DOWN navigate  |  SPACE toggle  |  A select all  |  N select none  |  ENTER confirm"
        }
        Write-Host $hint.PadRight($w) -ForegroundColor DarkGray
        Write-Host " ".PadRight($w)

        for ($i = 0; $i -lt $Items.Count; $i++) {
            $label = & $DisplayItem $Items[$i]
            if ($i -eq $cursor) {
                $line = if ($SingleSelect) {
                    "  >  $label"
                } else {
                    $mark = if ($sel[$i]) { "X" } else { " " }
                    "  > [$mark]  $label"
                }
                Write-Host $line.PadRight($w) -ForegroundColor Black -BackgroundColor Cyan -NoNewline
            } else {
                $line = if ($SingleSelect) {
                    "     $label"
                } else {
                    $mark = if ($sel[$i]) { "X" } else { " " }
                    "    [$mark]  $label"
                }
                Write-Host $line.PadRight($w) -ForegroundColor White -NoNewline
            }
            Write-Host ""
        }
        Write-Host " ".PadRight($w)
    }

    $topRow = [Console]::CursorTop
    & $draw

    $done = $false
    while (-not $done) {
        $k = [Console]::ReadKey($true)

        if     ($k.Key -eq [ConsoleKey]::UpArrow)   { $cursor = if ($cursor -gt 0) { $cursor - 1 } else { $Items.Count - 1 } }
        elseif ($k.Key -eq [ConsoleKey]::DownArrow)  { $cursor = if ($cursor -lt ($Items.Count - 1)) { $cursor + 1 } else { 0 } }
        elseif ($k.Key -eq [ConsoleKey]::Spacebar -and -not $SingleSelect) { $sel[$cursor] = -not $sel[$cursor] }
        elseif ($k.Key -eq [ConsoleKey]::Enter) {
            if ($SingleSelect -or $AllowEmpty -or ($sel -contains $true)) { $done = $true }
        } else {
            $ch = $k.KeyChar.ToString().ToUpper()
            if (-not $SingleSelect) {
                if ($ch -eq 'A') { 0..($Items.Count - 1) | ForEach-Object { $sel[$_] = $true } }
                if ($ch -eq 'N') { 0..($Items.Count - 1) | ForEach-Object { $sel[$_] = $false } }
            }
        }

        if (-not $done) { & $draw }
    }

    [Console]::CursorVisible = $true
    [Console]::SetCursorPosition(0, $topRow + $Items.Count + 3)
    Write-Host ""

    if ($SingleSelect) { return @($Items[$cursor]) }
    return @(0..($Items.Count - 1) | Where-Object { $sel[$_] } | ForEach-Object { $Items[$_] })
}

function Select-YesNo([string]$Question, [bool]$DefaultYes = $true) {
    Write-Host "  $Question" -ForegroundColor Cyan
    Write-Host ""
    $opts = @(
        [PSCustomObject]@{ Label = "Yes"; Value = $true  }
        [PSCustomObject]@{ Label = "No";  Value = $false }
    )
    if (-not $DefaultYes) { $opts = $opts[1], $opts[0] }
    $chosen = Select-FromList -Items $opts -DisplayItem { param($o) $o.Label } -SingleSelect
    return [bool]$chosen[0].Value
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

function Read-DownloadCatalogue {
    $cataloguePath = Join-Path $ScriptRoot "downloads.txt"
    if (-not (Test-Path $cataloguePath)) { return @() }
    $entries = @()
    foreach ($line in (Get-Content $cataloguePath)) {
        $line = $line.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { continue }
        if ($line -match "^\s*(.+?)\s*\|\s*(https?://.+)$") {
            $entries += [PSCustomObject]@{ Name = $Matches[1].Trim(); Url = $Matches[2].Trim() }
        } elseif ($line -match "^https?://") {
            $fileName = $line.Split('?')[0].Split('/')[-1]
            $entries += [PSCustomObject]@{ Name = $fileName; Url = $line }
        }
    }
    return $entries
}

function Select-DownloadItems([PSCustomObject[]]$Catalogue) {
    $picked = Select-FromList `
        -Items $Catalogue `
        -Prompt "Numbers separated by spaces (or A for all, - to skip):" `
        -DisplayItem { param($d) $d.Name } `
        -AllowEmpty

    if ($picked.Count -gt 0) {
        Write-Host ""
        Write-Host "  Downloads queued:" -ForegroundColor Green
        $picked | ForEach-Object { Write-Host "    - $($_.Name)" }
    }
    return @($picked | ForEach-Object { $_.Url })
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
    Write-Host ""
    if (-not (Select-YesNo "Continue with the installation?")) {
        Write-Host "  Installation cancelled by user." -ForegroundColor Magenta
        exit 0
    }

    Write-Host ""
    $resumeOptions = @(
        [PSCustomObject]@{ Label = "Resume from checkpoint";       Value = "resume" }
        [PSCustomObject]@{ Label = "Start over from the beginning"; Value = "start-over" }
    )
    Write-Host "  How do you want to proceed?" -ForegroundColor Cyan
    Write-Host ""
    $answer = (Select-FromList -Items $resumeOptions -DisplayItem { param($o) $o.Label } -SingleSelect)[0].Value

    if ($answer -eq "start-over") {
        Write-Host ""
        Write-Host "  Starting over -- previous state cleared." -ForegroundColor Magenta
        $state = [PSCustomObject]@{
            VMName        = ""
            Completed     = [string[]]@()
            Models        = [string[]]@()
            Features      = [string[]]@()
            LocalFiles    = [string[]]@()
            WingetPkgs    = [string[]]@()
            DownloadUrls  = [string[]]@()
            InstallMode   = ""
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
    Clear-Host
    Write-Banner "Feature Selection"
    Write-Host "  What do you want to configure on the guest VM?" -ForegroundColor Cyan
    Write-Host ""

    $featureOptions = @(
        [PSCustomObject]@{ Label = "Full WSL2 + AI stack  (WSL + Docker + Ollama)";                    Value = @("wsl-ai") }
        [PSCustomObject]@{ Label = "Install software packages on the guest VM";                         Value = @("software") }
        [PSCustomObject]@{ Label = "Minimal WSL preparation only  (no WSL install)";                   Value = @("wsl-prep") }
        [PSCustomObject]@{ Label = "Minimal WSL prep + software install";                               Value = @("wsl-prep", "software") }
        [PSCustomObject]@{ Label = "Full WSL2 + AI stack + software packages";                          Value = @("wsl-ai", "software") }
        [PSCustomObject]@{ Label = "Expose VM web port to host  (firewall / SSH / portproxy)";          Value = @("expose-port") }
        [PSCustomObject]@{ Label = "Full WSL2 + AI stack + expose VM web port";                         Value = @("wsl-ai", "expose-port") }
        [PSCustomObject]@{ Label = "Install software + expose VM web port";                              Value = @("software", "expose-port") }
        [PSCustomObject]@{ Label = "Full WSL2 + AI stack + software + expose VM web port";               Value = @("wsl-ai", "software", "expose-port") }
        [PSCustomObject]@{ Label = "Full VM exposure via host  (RDP + ALL services, external access)";   Value = @("full-expose") }
        [PSCustomObject]@{ Label = "Full WSL2 + AI stack + full VM exposure via host";                   Value = @("wsl-ai", "full-expose") }
        [PSCustomObject]@{ Label = "Full WSL2 + AI + software + full VM exposure via host";              Value = @("wsl-ai", "software", "full-expose") }
    )

    $chosen = Select-FromList -Items $featureOptions -DisplayItem { param($f) $f.Label } -SingleSelect
    $state.Features = [string[]]$chosen[0].Value
    Save-State $state
}

$enableWSLFull     = $state.Features -contains "wsl-ai"
$enableWSLPrep     = $state.Features -contains "wsl-prep"
$enableWSL         = $enableWSLFull -or $enableWSLPrep
$enableSoftware    = $state.Features -contains "software"
$enableExposePort  = $state.Features -contains "expose-port"
$enableFullExpose  = $state.Features -contains "full-expose"
$deferSoftwareSelection = $enableWSLPrep -and $enableSoftware

# ── VM selection ──────────────────────────────────────────────────────────────

if (-not $state.VMName) {
    $vms = @(Get-VM | Sort-Object { if ($_.State -eq 'Running') { 0 } else { 1 } }, Name)
    if ($vms.Count -eq 0) { throw "No Hyper-V VMs found on this host." }

    Clear-Host
    Write-Banner "VM Selection"
    Write-Host "  Select the Hyper-V guest VM to configure." -ForegroundColor Cyan
    Write-Host ""

    $chosen = Select-FromList `
        -Items $vms `
        -DisplayItem { param($v) ("{0,-30} State: {1}" -f $v.Name, $v.State) } `
        -SingleSelect

    $state.VMName = $chosen[0].Name
    Save-State $state
}

$VMName = $state.VMName

# ── Ollama model selection (WSL pipeline only) ────────────────────────────────

if ($enableWSLFull -and $state.Models.Count -eq 0) {
    Clear-Host
    Write-Banner "Ollama Model Selection"
    Write-Host "  Select all models now -- no further prompts during deploy." -ForegroundColor Gray
    Write-Host ""
    $state.Models = [string[]]$(Select-Models)
    Save-State $state
} elseif ($enableWSLFull) {
    Write-Host "  Models from checkpoint: $($state.Models -join ', ')" -ForegroundColor Gray
}

# ── Software selection ────────────────────────────────────────────────────────

if ($enableSoftware -and -not $deferSoftwareSelection -and -not (Is-Done $state "software-selected")) {

    $dlCatalogue = Read-DownloadCatalogue
    if ($dlCatalogue.Count -gt 0) {
        Clear-Host
        Write-Banner "Direct Downloads"
        Write-Host "  Files downloaded straight into the VM from the internet." -ForegroundColor Cyan
        Write-Host "  ELO tokens auto-refresh when expired. URLs sourced from downloads.txt." -ForegroundColor Gray
        Write-Host ""
        $state.DownloadUrls = [string[]]$(Select-DownloadItems -Catalogue $dlCatalogue)
    }

    Clear-Host
    Write-Banner "Local Installers"
    Write-Host "  Files from softwares\ will be copied to C:\Install on the guest VM." -ForegroundColor Gray
    Write-Host ""
    $localFiles = Select-LocalSoftwares
    $state.LocalFiles = [string[]]$localFiles
    if ($localFiles.Count -eq 0) { $state.InstallMode = "" }

    Clear-Host
    Write-Banner "Winget Packages"
    Write-Host "  Packages installed directly on the guest via Windows Package Manager." -ForegroundColor Gray
    Write-Host ""
    $wingetIds = Select-WingetPackages
    $state.WingetPkgs = [string[]]$wingetIds

    if ($state.LocalFiles.Count -gt 0) {
        Clear-Host
        Write-Banner "Installation Mode"
        Write-Host "  How should local installers be run on the guest VM?" -ForegroundColor Cyan
        Write-Host ""

        $modeOptions = @(
            [PSCustomObject]@{ Label = "Silent       -- fully automated, no interaction needed";  Mode = "silent" }
            [PSCustomObject]@{ Label = "Interactive  -- copy files, then launch each installer";  Mode = "interactive" }
            [PSCustomObject]@{ Label = "Copy only    -- copy to C:\Install, do not run";          Mode = "copy-only" }
        )
        $chosenMode = Select-FromList -Items $modeOptions -DisplayItem { param($m) $m.Label } -SingleSelect
        $state.InstallMode = $chosenMode[0].Mode
    }

    Save-State $state
    Mark-Done $state "software-selected"
} elseif ($enableSoftware) {
    Write-Host "  Software from checkpoint: $($state.LocalFiles.Count) local file(s), $($state.WingetPkgs.Count) winget package(s)" -ForegroundColor Gray
}

$postgresPassword = ""
$mssqlSaPassword  = ""
if ($enableSoftware -and -not $deferSoftwareSelection) {
    $hasPostgres = ($state.WingetPkgs -contains "PostgreSQL.PostgreSQL.18") -or
                   ($state.InstallMode -eq "silent" -and ($state.LocalFiles | Where-Object { $_ -match "(?i)postgresql" }).Count -gt 0)
    $hasMssql    = ($state.WingetPkgs -contains "Microsoft.SQLServer.2022.Developer") -or
                   ($state.InstallMode -eq "silent" -and ($state.LocalFiles | Where-Object { $_ -match "(?i)sql.*server|ssei" }).Count -gt 0)

    if ($hasPostgres) {
        Write-Host ""
        Write-Host "  PostgreSQL installer detected." -ForegroundColor Cyan
        Write-Host ""
        if (Select-YesNo "Set PostgreSQL superuser password now?") {
            $postgresPassword = Read-PlainSecret "  PostgreSQL password (hidden input)"
        }
    }

    if ($hasMssql) {
        Write-Host ""
        Write-Host "  SQL Server installer detected." -ForegroundColor Cyan
        Write-Host ""
        if (Select-YesNo "Set SQL Server 'sa' password now?") {
            $mssqlSaPassword = Read-PlainSecret "  SQL Server sa password (hidden input)"
        }
    }
}

# ── Expose VM web port -- configuration (before credentials prompt) ──────────

if ($enableExposePort -and $state.ExposePort -eq 0) {
    Clear-Host
    Write-Banner "VM Web Port Exposure"
    Write-Host "  Configure which port in the VM you want to access from the host." -ForegroundColor Cyan
    Write-Host ""

    Write-Host "  VM port to expose" -ForegroundColor Yellow -NoNewline
    Write-Host " (default 5000): " -NoNewline
    $portInput = (Read-Host).Trim()
    $state.ExposePort = if ($portInput -match '^\d+$') { [int]$portInput } else { 5000 }

    Write-Host "  Host port to listen on" -ForegroundColor Yellow -NoNewline
    Write-Host " (default $($state.ExposePort)): " -NoNewline
    $hostPortInput = (Read-Host).Trim()
    $state.ExposeHostPort = if ($hostPortInput -match '^\d+$') { [int]$hostPortInput } else { $state.ExposePort }

    Write-Host ""
    Write-Host "  Access method:" -ForegroundColor Cyan
    Write-Host ""
    $methodOptions = @(
        [PSCustomObject]@{ Label = "Firewall rule in VM   -- opens the port directly on the VM (simplest)";                         Mode = "firewall"   }
        [PSCustomObject]@{ Label = "SSH tunnel            -- ssh -L forward, most secure (requires SSH)";                           Mode = "ssh"        }
        [PSCustomObject]@{ Label = "Port proxy (netsh)    -- host localhost:port -> VM:port, no VM firewall needed";                 Mode = "portproxy"  }
    )
    $chosenMethod = Select-FromList -Items $methodOptions -DisplayItem { param($m) $m.Label } -SingleSelect
    $state.ExposeMethod = $chosenMethod[0].Mode
    Save-State $state
} elseif ($enableExposePort) {
    Write-Host "  Expose port from checkpoint: VM port $($state.ExposePort) -> host port $($state.ExposeHostPort) via $($state.ExposeMethod)" -ForegroundColor Gray
}

# ── Full VM exposure -- configuration (before credentials) ───────────────────

if ($enableFullExpose -and -not (Is-Done $state "fullexpose-config")) {
    Clear-Host
    Write-Banner "Full VM Exposure via Host"
    Write-Host "  Exposes ALL service ports to the network via the host IP." -ForegroundColor Cyan
    Write-Host "  Service ports are auto-detected from the running VM." -ForegroundColor Gray
    Write-Host ""

    Write-Host "  Enable RDP on the VM?" -ForegroundColor Cyan
    Write-Host ""
    $state.FullExposeRDP = (Select-YesNo "Enable Remote Desktop (RDP, port 3389)?" $true)

    if ($state.FullExposeRDP) {
        Write-Host ""
        $state.FullExposeNLA = -not (Select-YesNo "Require Network Level Authentication (NLA)? (No = easier login)" $true)
    }

    Write-Host ""
    Write-Host "  Listen scope:" -ForegroundColor Cyan
    Write-Host ""
    $listenOpts = @(
        [PSCustomObject]@{ Label = "External  -- 0.0.0.0  (all interfaces, accessible via host IP from other machines)"; External = $true  }
        [PSCustomObject]@{ Label = "Host-only -- 127.0.0.1  (only accessible from this host machine)";                   External = $false }
    )
    $chosenListen = Select-FromList -Items $listenOpts -DisplayItem { param($o) $o.Label } -SingleSelect
    $state.FullExposeExternal = $chosenListen[0].External
    Save-State $state
    Mark-Done $state "fullexpose-config"
} elseif ($enableFullExpose) {
    $listenStr = if ($state.FullExposeExternal) { "external (0.0.0.0)" } else { "host-only (127.0.0.1)" }
    Write-Host "  Full expose from checkpoint: RDP=$($state.FullExposeRDP), scope=$listenStr" -ForegroundColor Gray
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
if ($postgresPassword) {
    Write-Host "  PG user      : postgres" -ForegroundColor Cyan
    Write-Host "  PG password  : $postgresPassword" -ForegroundColor Cyan
}
if ($mssqlSaPassword) {
    Write-Host "  MSSQL user   : sa" -ForegroundColor Cyan
    Write-Host "  MSSQL password: $mssqlSaPassword" -ForegroundColor Cyan
}
if ($enableExposePort) {
    Write-Host "  Expose port  : VM:$($state.ExposePort) -> host:$($state.ExposeHostPort) via $($state.ExposeMethod)" -ForegroundColor Cyan
}
if ($enableFullExpose) {
    $scopeLabel = if ($state.FullExposeExternal) { "external (0.0.0.0)" } else { "host-only (127.0.0.1)" }
    Write-Host "  Full expose  : RDP=$($state.FullExposeRDP)  scope=$scopeLabel" -ForegroundColor Cyan
}
Write-Host ""

$vmState = (Get-VM -Name $VMName).State
if ($vmState -ne 'Running') {
    Write-Host "  VM is not running (state: $vmState) -- starting..." -ForegroundColor Yellow
    Start-VMWithMemoryFallback $VMName
    Wait-VMReady $VMName $cred -TimeoutSec 300
    Show-VMFilesUrl
} elseif ($resumeVMName) {
    Wait-VMReady $VMName $cred -TimeoutSec 300
    Show-VMFilesUrl
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
        Show-VMFilesUrl
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
        Show-VMFilesUrl
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
            Show-VMFilesUrl
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
        Show-VMFilesUrl
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

        Write-Host ""
        if (-not (Select-YesNo "Proceed with docker compose deployment?")) {
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
    $state.LocalFiles = [string[]]$localFiles
    if ($localFiles.Count -gt 0) {
        $state.InstallMode = "copy-only"
        Write-Host "  Local installers will be copied only (no auto-install)." -ForegroundColor Yellow
    } else {
        $state.InstallMode = ""
    }

    Write-Host ""
    Write-Host "  WINGET PACKAGES (optional)" -ForegroundColor Cyan
    Write-Host "  --------------------------" -ForegroundColor DarkGray
    Write-Host "  Winget packages are installed on the VM (not copied)." -ForegroundColor Gray
    $wingetIds = Select-WingetPackages
    $state.WingetPkgs = [string[]]$wingetIds

    Save-State $state
    Mark-Done $state "software-selected"
}

if ($enableSoftware -and $deferSoftwareSelection) {
    $hasPostgres = ($state.WingetPkgs -contains "PostgreSQL.PostgreSQL.18") -or
                   ($state.InstallMode -eq "silent" -and ($state.LocalFiles | Where-Object { $_ -match "(?i)postgresql" }).Count -gt 0)
    $hasMssql    = ($state.WingetPkgs -contains "Microsoft.SQLServer.2022.Developer") -or
                   ($state.InstallMode -eq "silent" -and ($state.LocalFiles | Where-Object { $_ -match "(?i)sql.*server|ssei" }).Count -gt 0)

    if ($hasPostgres) {
        Write-Host ""
        Write-Host "  PostgreSQL installer detected." -ForegroundColor Cyan
        Write-Host ""
        if (Select-YesNo "Set PostgreSQL superuser password now?") {
            $postgresPassword = Read-PlainSecret "  PostgreSQL password (hidden input)"
        }
    }

    if ($hasMssql) {
        Write-Host ""
        Write-Host "  SQL Server installer detected." -ForegroundColor Cyan
        Write-Host ""
        if (Select-YesNo "Set SQL Server 'sa' password now?") {
            $mssqlSaPassword = Read-PlainSecret "  SQL Server sa password (hidden input)"
        }
    }
}

if ($postgresPassword -or $mssqlSaPassword) {
    Write-Host ""
    Write-Host "  DB credentials for this installation:" -ForegroundColor Cyan
    if ($postgresPassword) {
        Write-Host "    PostgreSQL  --  user: postgres    password: $postgresPassword" -ForegroundColor Cyan
    }
    if ($mssqlSaPassword) {
        Write-Host "    SQL Server  --  user: sa          password: $mssqlSaPassword" -ForegroundColor Cyan
    }
    Write-Host ""
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
            Show-VMFilesUrl
        } else {
            Write-Host "  Guest Service Interface already active." -ForegroundColor Gray
        }
        Mark-Done $state "guest-services"
    }

    # ── STEP S1.5: Download files directly in VM ─────────────────────────────

    if ($state.DownloadUrls.Count -gt 0 -and -not (Is-Done $state "software-download")) {
        Write-Banner "STEP S1.5 -- Download Installers in VM (C:\Install)"

        $expiredUrls = @($state.DownloadUrls | Where-Object { Test-UrlExpired $_ })
        if ($expiredUrls.Count -gt 0) {
            Write-Host "  [!] Expired tokens detected for:" -ForegroundColor Yellow
            $expiredUrls | ForEach-Object {
                Write-Host ("    - " + $_.Split('?')[0].Split('/')[-1]) -ForegroundColor Yellow
            }
            Write-Host ""

            $node = Get-Command node -ErrorAction SilentlyContinue
            if ($null -eq $node) {
                Write-Host "  Node.js not found -- installing via winget..." -ForegroundColor Gray
                & winget install OpenJS.NodeJS.LTS --source winget --exact --silent --accept-package-agreements --accept-source-agreements
                if ($LASTEXITCODE -notin @(0, -1978335189)) { throw "winget failed to install Node.js (exit $LASTEXITCODE)" }
                # Reload PATH so node/npm are available in this session
                $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" +
                            [System.Environment]::GetEnvironmentVariable("PATH","User")
                $node = Get-Command node -ErrorAction SilentlyContinue
                if ($null -eq $node) { throw "Node.js installed but 'node' still not found -- open a new terminal and rerun." }
                Write-Host "  Node.js installed." -ForegroundColor Green
            }

            $nodeModules = Join-Path $ScriptRoot "node_modules\playwright"
            if (-not (Test-Path $nodeModules)) {
                Write-Host "  One-time setup: installing npm dependencies..." -ForegroundColor Gray
                Push-Location $ScriptRoot
                try {
                    & npm install
                    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
                    Write-Host "  One-time setup: installing Playwright Chromium browser..." -ForegroundColor Gray
                    & npx playwright install chromium
                    if ($LASTEXITCODE -ne 0) { throw "Playwright browser install failed" }
                } finally {
                    Pop-Location
                }
            }

            $refreshScript = Join-Path $ScriptRoot "refresh-elo-tokens.js"
            Write-Host "  Launching token refresher..." -ForegroundColor Cyan
            Write-Host "  Log in at partner.elo.com, click each download, then press ENTER in this window." -ForegroundColor Gray
            Write-Host ""
            & node $refreshScript
            if ($LASTEXITCODE -ne 0) { throw "Token refresh exited with code $LASTEXITCODE" }

            # Reload fresh URLs from downloads.txt, matching by CDN product path key
            $freshCatalogue = Read-DownloadCatalogue
            $freshByKey = @{}
            foreach ($entry in $freshCatalogue) {
                $key = ($entry.Url.Split('?')[0] -split '/')[3]  # 4th segment = product folder
                $freshByKey[$key] = $entry.Url
            }
            $state.DownloadUrls = [string[]]@($state.DownloadUrls | ForEach-Object {
                $key = ($_.Split('?')[0] -split '/')[3]
                if ($freshByKey.ContainsKey($key)) { $freshByKey[$key] } else { $_ }
            })
            Save-State $state

            $stillExpired = @($state.DownloadUrls | Where-Object { Test-UrlExpired $_ })
            if ($stillExpired.Count -gt 0) {
                throw "Tokens still expired after refresh -- check downloads.txt"
            }
            Write-Host "  Tokens refreshed successfully." -ForegroundColor Green
            Write-Host ""
        }

        Invoke-InVM { New-Item -ItemType Directory -Path "C:\Install" -Force | Out-Null }

        foreach ($url in $state.DownloadUrls) {
            $fileName = $url.Split('?')[0].Split('/')[-1]
            $destPath = "C:\Install\$fileName"
            Write-Host "  Downloading $fileName ..." -NoNewline
            Download-ToVM -Url $url -DestinationPath $destPath
            Write-Host " done." -ForegroundColor Green
            if ([System.IO.Path]::GetExtension($fileName).ToLower() -eq ".zip") {
                Expand-ZipInVM $destPath
            }
        }
        Mark-Done $state "software-download"
    }

    # ── STEP S2: Copy local files to VM ───────────────────────────────────────

    if ($state.LocalFiles.Count -gt 0 -and -not (Is-Done $state "software-copy")) {
        Write-Banner "STEP S2 -- Copy Installers to VM (C:\Install)"

        Invoke-InVM { New-Item -ItemType Directory -Path "C:\Install" -Force | Out-Null }

        # Prefer HTTP transfer (faster); fall back to PSSession if host IP not detected
        $script:_srvHostIp = Get-HyperVHostIp $VMName
        $useHttp = $null -ne $script:_srvHostIp

        if ($useHttp) {
            Write-Host "  Transfer method: HTTP (host IP: $($script:_srvHostIp))" -ForegroundColor Cyan
            Start-HostFileServer $SoftwaresPath
            $browseUrl = 'http://' + $script:_srvHostIp + ':' + $script:_srvPort + '/'
            Write-Host "  Browse in VM browser: $browseUrl" -ForegroundColor Gray
            try {
                $url = $browseUrl
                Invoke-Command -VMName $VMName -Credential $cred -ScriptBlock { Start-Process $using:url } -ErrorAction SilentlyContinue
            } catch {}
        } else {
            Write-Host "  Transfer method: PSSession (HTTP host IP not detected)" -ForegroundColor Yellow
        }

        $copySession = if (-not $useHttp) { New-PSSession -VMName $VMName -Credential $cred } else { $null }
        try {
            foreach ($relativePath in $state.LocalFiles) {
                $srcPath = Join-Path $SoftwaresPath $relativePath
                if (-not (Test-Path $srcPath)) {
                    Write-Host "  [SKIP] File not found: $relativePath" -ForegroundColor Yellow
                    continue
                }
                $relativeWinPath = $relativePath -replace '/', '\'
                $destPath        = "C:\Install\$relativeWinPath"
                Write-Host "  Copying $relativePath ..." -NoNewline
                if ($useHttp) {
                    Copy-ToVM-ViaHttp -SourcePath $srcPath -DestinationPath $destPath
                } else {
                    Copy-ToVM -SourcePath $srcPath -DestinationPath $destPath -Session $copySession
                }
                Write-Host " done." -ForegroundColor Green
                if ([System.IO.Path]::GetExtension($srcPath).ToLower() -eq ".zip") {
                    Expand-ZipInVM $destPath
                }
            }
            if ($useHttp) {
                Write-Host ""
                Write-Host "  All files copied. Verify in VM browser: $browseUrl" -ForegroundColor Green
                try {
                    $url = $browseUrl
                    Invoke-Command -VMName $VMName -Credential $cred -ScriptBlock { Start-Process $using:url } -ErrorAction SilentlyContinue
                } catch {}
                Write-Host "  Server closes in 15s..." -ForegroundColor Gray
                Start-Sleep -Seconds 15
            }
        } finally {
            if ($null -ne $copySession) { Remove-PSSession $copySession -ErrorAction SilentlyContinue }
            if ($useHttp)               { Stop-HostFileServer }
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
                $stem = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
                Write-Host "  [ZIP]  Already extracted to C:\Install\$stem" -ForegroundColor Gray
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
# EXPOSE VM WEB PORT
# =============================================================================

if ($enableExposePort -and -not (Is-Done $state "expose-port")) {
    Write-Banner "Expose VM Web Port"

    $vmIpDetected = Get-VMIp $VMName
    if (-not $vmIpDetected) {
        Write-Host "  [WARN] Could not detect VM IP address." -ForegroundColor Yellow
        Write-Host "  Ensure the VM is running and the network adapter shows an IP (Get-VMNetworkAdapter)." -ForegroundColor Yellow
    } else {
        Write-Host "  VM IP detected: $vmIpDetected" -ForegroundColor Gray
        Expose-VMWebService `
            -VM       $VMName `
            -Credential $cred `
            -VmIp     $vmIpDetected `
            -VmPort   $state.ExposePort `
            -HostPort $state.ExposeHostPort `
            -Method   $state.ExposeMethod
    }
    Mark-Done $state "expose-port"
}

# =============================================================================
# FULL VM EXPOSURE
# =============================================================================

if ($enableFullExpose -and -not (Is-Done $state "full-expose")) {
    Write-Banner "Full VM Exposure via Host"

    $vmIpDetected = Get-VMIp $VMName
    if (-not $vmIpDetected) {
        Write-Host "  [WARN] Could not detect VM IP address. Skipping." -ForegroundColor Yellow
    } else {
        $listenAddr = if ($state.FullExposeExternal) { "0.0.0.0" } else { "127.0.0.1" }
        Enable-VMFullExposure `
            -VM          $VMName `
            -Credential  $cred `
            -VmIp        $vmIpDetected `
            -EnableRDP   $state.FullExposeRDP `
            -DisableNLA  $state.FullExposeNLA `
            -ListenAddr  $listenAddr
    }
    Mark-Done $state "full-expose"
}

# =============================================================================
# CONNECTIVITY TEST (optional, always offered after full-expose or expose-port)
# =============================================================================

if (($enableExposePort -or $enableFullExpose) -and -not (Is-Done $state "connectivity-test")) {
    $vmIpDetected = Get-VMIp $VMName
    if ($vmIpDetected) {
        Write-Host ""
        Write-Host "  Run connectivity test (probe server on port 19876)?" -ForegroundColor Cyan
        Write-Host ""
        if (Select-YesNo "Test connectivity to VM now?" $true) {
            Write-Banner "Connectivity Test"
            Test-VMConnectivity -VM $VMName -Credential $cred -VmIp $vmIpDetected -TestPort 19876
        }
    }
    Mark-Done $state "connectivity-test"
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
if ($postgresPassword) {
    Write-Host ("  |  PG  user : {0,-30}|" -f "postgres") -ForegroundColor Green
    Write-Host ("  |  PG  pwd  : {0,-30}|" -f $postgresPassword) -ForegroundColor Green
}
if ($mssqlSaPassword) {
    Write-Host ("  |  SQL user : {0,-30}|" -f "sa") -ForegroundColor Green
    Write-Host ("  |  SQL pwd  : {0,-30}|" -f $mssqlSaPassword) -ForegroundColor Green
}
if ($enableExposePort) {
    $exposeLabel = "VM:$($state.ExposePort) -> host:$($state.ExposeHostPort) [$($state.ExposeMethod)]"
    Write-Host ("  |  Exposed  : {0,-30}|" -f $exposeLabel) -ForegroundColor Green
}
if ($enableFullExpose) {
    $scopeStr = if ($state.FullExposeExternal) { "external" } else { "host-only" }
    Write-Host ("  |  Full exp : {0,-30}|" -f "RDP=$($state.FullExposeRDP) [$scopeStr]") -ForegroundColor Green
    $hostExtIp = Get-HostExternalIp
    if ($hostExtIp) {
        Write-Host ("  |  Host IP  : {0,-30}|" -f $hostExtIp) -ForegroundColor Green
    }
}
Write-Host "  +=========================================+" -ForegroundColor Green
Write-Host ""

Remove-Item $StateFile -ErrorAction SilentlyContinue
