#Requires -Version 5.1
<#
.SYNOPSIS
  Minimal HTTP probe server — deploy to a VM and use to verify port forwarding.
.DESCRIPTION
  Starts a lightweight HTTP listener on $Port. Returns a simple HTML status page
  for every GET request so the caller can confirm reachability end-to-end.
  Can be deployed via PSSession from the host and started remotely.
.PARAMETER Port
  TCP port to listen on (default 19876).
.PARAMETER MaxRequests
  Stop after this many requests (default 0 = unlimited, run until Ctrl+C).
.EXAMPLE
  # Run locally on VM:
  .\probe\server.ps1 -Port 19876

  # Deploy + start from the HOST via PSSession (no file copy needed):
  $s = New-PSSession -VMName "MyVM" -Credential $cred
  Invoke-Command -Session $s -FilePath "C:\ollama-ssl\installator\probe\server.ps1" `
      -ArgumentList 19876, 20
#>
param(
    [int]$Port        = 19876,
    [int]$MaxRequests = 0
)

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Probe OK - Port $Port</title>
  <style>
    body { font-family: sans-serif; background: #0d1117; color: #e6edf3;
           padding: 48px; margin: 0; }
    h1   { color: #3fb950; margin-bottom: 8px; }
    .box { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
           padding: 20px 24px; max-width: 520px; margin-top: 20px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0;
           border-bottom: 1px solid #21262d; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .lbl { color: #8b949e; }
    .val { color: #58a6ff; font-family: monospace; }
    .ok  { color: #3fb950; font-weight: bold; font-size: 18px; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>&#x2714; Probe Server</h1>
  <div class="box">
    <div class="row"><span class="lbl">Host</span>      <span class="val">$env:COMPUTERNAME</span></div>
    <div class="row"><span class="lbl">Port</span>      <span class="val">$Port</span></div>
    <div class="row"><span class="lbl">Time</span>      <span class="val">$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')</span></div>
    <div class="row"><span class="lbl">OS</span>        <span class="val">$([System.Environment]::OSVersion.VersionString)</span></div>
  </div>
  <p class="ok">Port $Port is reachable &#x2714;</p>
</body>
</html>
"@

$bytes = [System.Text.Encoding]::UTF8.GetBytes($html)

# Open Windows Firewall for this port (silently, needs admin)
$fwRule = "ProbeServer-$Port"
New-NetFirewallRule -DisplayName $fwRule -Direction Inbound -Protocol TCP `
    -LocalPort $Port -Action Allow -Profile Any `
    -ErrorAction SilentlyContinue | Out-Null

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://+:$Port/")

try {
    $listener.Start()
    $served = 0
    Write-Host "  [PROBE] Listening on http://+:$Port/  --  Ctrl+C to stop" -ForegroundColor Cyan
    while ($listener.IsListening) {
        if ($MaxRequests -gt 0 -and $served -ge $MaxRequests) { break }
        if ($listener.Pending()) {
            $ctx  = $listener.GetContext()
            $resp = $ctx.Response
            $resp.ContentType     = "text/html; charset=utf-8"
            $resp.ContentLength64 = $bytes.Length
            $resp.StatusCode      = 200
            try   { $resp.OutputStream.Write($bytes, 0, $bytes.Length) }
            finally { $resp.Close() }
            $served++
            Write-Host "  [PROBE] Request #$served from $($ctx.Request.RemoteEndPoint)" -ForegroundColor DarkGray
        } else {
            Start-Sleep -Milliseconds 100
        }
    }
} finally {
    $listener.Stop()
    Remove-NetFirewallRule -DisplayName $fwRule -ErrorAction SilentlyContinue
    Write-Host "  [PROBE] Stopped after $served request(s)." -ForegroundColor Gray
}
