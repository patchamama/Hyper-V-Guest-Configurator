'use strict';
// Dedicated input seat ("multi-seat" for Windows) — Windows side.
// A chosen USB mouse/keyboard is detached from Windows with usbipd-win and attached to the signed-in
// user's WSL distro, where seat.sh runs an Xorg server fed only by those devices (RDP to a VM or a
// browser in kiosk mode), shown on the Windows desktop through a view-only VNC viewer.
//
// This process runs elevated, often as another account than the signed-in user, while WSL distros are
// registered per Windows user: WSL commands therefore run through a one-shot scheduled task as the
// interactive user (runAsUser). Used by the main configurator (/api/seat) and by the standalone app.js.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');

const USBIPD = 'C:\\Program Files\\usbipd-win\\usbipd.exe';
const RUN_DIR = 'C:\\ProgramData\\hvc-run';
const STATE_FILE = path.join(RUN_DIR, 'seat-state.json');
const SEAT_DIR = __dirname;
const WSL_SEAT_DIR = '/mnt/' + SEAT_DIR[0].toLowerCase() + SEAT_DIR.slice(2).replace(/\\/g, '/');

const psq = s => String(s).replace(/'/g, "''");                 // PowerShell single-quoted
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";  // bash single-quoted

function runPS(script, timeoutMs = 600000) {
  return new Promise(resolve => {
    let out = '', err = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script]);
    const t = setTimeout(() => ps.kill(), timeoutMs);
    ps.stdout.on('data', d => out += d.toString('utf8'));
    ps.stderr.on('data', d => err += d.toString('utf8'));
    ps.on('close', () => { clearTimeout(t); resolve({ out: out.trim(), err: err.trim() }); });
    ps.on('error', e => { clearTimeout(t); resolve({ out: '', err: e.message }); });
  });
}

// Run a PowerShell script as the signed-in interactive user (limited token) and return its output.
async function runAsUser(script, timeoutSec = 600) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const file = path.join(RUN_DIR, `${id}.ps1`), outFile = path.join(RUN_DIR, `${id}.out`);
  fs.writeFileSync(file, `$ErrorActionPreference='Continue'\r\n& {\r\n${script}\r\n} *>&1 | Out-File -FilePath '${psq(outFile)}' -Encoding utf8\r\n`, 'utf8');
  const r = await runPS(
    `$user=(Get-CimInstance Win32_ComputerSystem).UserName; if(-not $user){ 'ERROR:No interactive user is signed in'; exit }; ` +
    `$name='HVC-Seat-${id}'; ` +
    `$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${psq(file)}"'; ` +
    `$p=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited; ` +
    `Register-ScheduledTask -TaskName $name -Action $a -Principal $p -Force | Out-Null; ` +
    `try { Start-ScheduledTask -TaskName $name; $dl=(Get-Date).AddSeconds(${timeoutSec}); ` +
    // 267011 = not run yet, 267009 = running
    `do { Start-Sleep -Milliseconds 400; $c=(Get-ScheduledTaskInfo -TaskName $name).LastTaskResult } while(($c -eq 267011 -or $c -eq 267009) -and (Get-Date) -lt $dl) } ` +
    `finally { Unregister-ScheduledTask -TaskName $name -Confirm:$false -EA SilentlyContinue }`, (timeoutSec + 30) * 1000);
  let out = '';
  for (let i = 0; i < 10; i++) {   // the file can still be held briefly by the finishing task
    try { out = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, ''); fs.unlinkSync(outFile); break; }
    catch { await new Promise(res => setTimeout(res, 300)); }
  }
  try { fs.unlinkSync(file); } catch {}
  if (/^ERROR:/m.test(r.out)) throw new Error(r.out.match(/ERROR:(.*)/)[1]);
  return out.replace(/\r/g, '');
}

// Run a bash script as root in the user's WSL distro (kept running with a hidden "sleep infinity").
async function runWsl(distro, bash, timeoutSec = 600) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const file = path.join(RUN_DIR, `${id}.sh`);
  fs.writeFileSync(file, `#!/bin/bash\n${bash}\n`.replace(/\r/g, ''), 'utf8');
  try {
    return await runAsUser(
      `if(-not (Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -match 'sleep infinity' -and $_.CommandLine -match '${psq(distro)}' })) { ` +
      `Start-Process wsl.exe -ArgumentList '-d','${psq(distro)}','-u','root','--','sleep','infinity' -WindowStyle Hidden; Start-Sleep 4 }\r\n` +
      `wsl.exe -d '${psq(distro)}' -u root -- bash '/mnt/c/ProgramData/hvc-run/${id}.sh' 2>&1`, timeoutSec);
  } finally { try { fs.unlinkSync(file); } catch {} }
}

const seatCmd = 'tr -d "\\r" < ' + shq(`${WSL_SEAT_DIR}/seat.sh`) + ' > /usr/local/bin/hvc-seat && chmod +x /usr/local/bin/hvc-seat';

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } }
function saveState(s) { fs.mkdirSync(RUN_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// USB devices from usbipd, labelled keyboard/mouse from Windows' PnP classes (or remembered from the last
// time they were seen, because a device attached to WSL disappears from Windows' device list).
async function listDevices() {
  if (!fs.existsSync(USBIPD)) return { usbipd: false, devices: [] };
  const r = await runPS(
    `$cls=@{}; Get-PnpDevice -PresentOnly -Class Keyboard,Mouse -EA SilentlyContinue | ForEach-Object { ` +
    `if($_.InstanceId -match 'VID_([0-9A-F]{4})&PID_([0-9A-F]{4})'){ $k=("$($Matches[1]):$($Matches[2])").ToLower(); $cls[$k]=@($cls[$k])+$_.Class } }; ` +
    `$list=& '${USBIPD}' list 2>$null; $rows=@(); $sec=''; foreach($l in $list){ if($l -match '^(Connected|Persisted)'){ $sec=$Matches[1]; continue }; ` +
    `if($sec -eq 'Connected' -and $l -match '^(\\S+)\\s+([0-9a-f]{4}:[0-9a-f]{4})\\s+(.+?)\\s{2,}(\\S.*)$'){ ` +
    `$rows+=[ordered]@{busid=$Matches[1];vidpid=$Matches[2];name=$Matches[3].Trim();state=$Matches[4].Trim();classes=@($cls[$Matches[2]] | Where-Object {$_} | Sort-Object -Unique)} } }; ` +
    `ConvertTo-Json -InputObject @($rows) -Depth 4 -Compress`);
  let rows = [];
  try { rows = JSON.parse(r.out || '[]'); } catch {}
  const st = loadState(); st.known = st.known || {};
  for (const d of rows) {
    const cls = (d.classes || []).map(c => c.toLowerCase());
    if (cls.length) st.known[d.vidpid] = { mouse: cls.includes('mouse'), keyboard: cls.includes('keyboard') };
    const k = st.known[d.vidpid];
    d.attached = /attached/i.test(d.state);
    // Attached to WSL before we ever saw its type: offer it as either.
    d.mouse = k ? !!k.mouse : d.attached; d.keyboard = k ? !!k.keyboard : d.attached;
  }
  saveState(st);
  return { usbipd: true, devices: rows.filter(d => d.mouse || d.keyboard) };
}

// The signed-in user's WSL distros (WSL_UTF8 avoids wsl.exe's default UTF-16 output).
async function listDistros() {
  const out = await runAsUser(`$env:WSL_UTF8='1'; (wsl.exe -l -q) -replace "\`0","" | Where-Object { $_.Trim() }`, 60);
  return out.split('\n').map(s => s.trim()).filter(s => s && !/^docker-desktop/i.test(s));
}

async function status() {
  const devs = await listDevices();
  const st = loadState();   // after listDevices, which updates the remembered device types
  // One scheduled-task round trip: list the user's distros, pick one, run the checks in it.
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const shFile = path.join(RUN_DIR, `check-${Date.now().toString(36)}.sh`);
  fs.writeFileSync(shFile, `#!/bin/bash\n${seatCmd}; hvc-seat check; for d in 2 3 4 5; do pgrep -f "Xorg :$d " >/dev/null && echo "running:$d"; done\n`);
  let out = '';
  try {
    out = await runAsUser(`$env:WSL_UTF8='1'; $all=@((wsl.exe -l -q) -replace "\`0","" | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -notmatch '^docker-desktop' }); ` +
      `"distros:" + ($all -join ','); $pick='${psq(st.distro || '')}'; if($pick -notin $all){ $pick=@($all | Where-Object { $_ -match 'ubuntu' })[0]; if(-not $pick){ $pick=$all[0] } }; ` +
      `if($pick){ "distro:$pick"; if(-not (Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -match 'sleep infinity' })) { ` +
      `Start-Process wsl.exe -ArgumentList '-d',$pick,'-u','root','--','sleep','infinity' -WindowStyle Hidden; Start-Sleep 4 }; ` +
      `wsl.exe -d $pick -u root -- bash '/mnt/c/ProgramData/hvc-run/${path.basename(shFile)}' 2>&1 }`, 120);
  } catch (e) { return { ...devs, error: e.message, distros: [] }; }
  finally { try { fs.unlinkSync(shFile); } catch {} }
  const check = out.split('\n').map(s => s.trim()).filter(Boolean);
  const distros = ((check.find(l => l.startsWith('distros:')) || '').slice(8)).split(',').filter(Boolean);
  const distro = (check.find(l => l.startsWith('distro:')) || '').slice(7) || null;
  if (distro && distro !== st.distro) { st.distro = distro; saveState(st); }
  const missing = check.filter(l => l.startsWith('missing:')).map(l => l.slice(8));
  return { ...devs, distros, distro, ready: !!distro && devs.usbipd && !missing.length, missing,
    browsers: check.filter(l => l.startsWith('browser:')).map(l => l.slice(8)),
    gateway: (check.find(l => l.startsWith('gateway:')) || '').slice(8),
    running: check.filter(l => l.startsWith('running:')).map(l => +l.slice(8)), seats: st.seats || {} };
}

// Install usbipd-win (signed MSI) if missing, keep WSL off "mirrored" networking (usbipd cannot reach the
// host from it here), allow usbipd through the firewall and install the Linux packages in the distro.
async function prepare({ distro, chrome, edge } = {}) {
  const log = [];
  if (!fs.existsSync(USBIPD)) {
    const r = await runPS(`[Net.ServicePointManager]::SecurityProtocol='Tls12'; ` +
      `$rel=Invoke-RestMethod https://api.github.com/repos/dorssel/usbipd-win/releases/latest -Headers @{'User-Agent'='hvc'}; ` +
      `$a=$rel.assets | Where-Object name -match 'x64\\.msi$' | Select-Object -First 1; $msi=Join-Path $env:TEMP $a.name; ` +
      `Invoke-WebRequest $a.browser_download_url -OutFile $msi -UseBasicParsing; ` +
      `if((Get-AuthenticodeSignature $msi).Status -ne 'Valid'){ 'ERROR:usbipd-win installer signature is not valid'; exit }; ` +
      `Start-Process msiexec.exe -ArgumentList "/i \`"$msi\`" /qn /norestart" -Wait; "usbipd-win $($rel.tag_name) installed"`);
    log.push(r.out);
    if (!fs.existsSync(USBIPD)) throw new Error('usbipd-win installation failed: ' + (r.err || r.out));
  }
  const wc = await runAsUser(`$p=Join-Path $env:USERPROFILE '.wslconfig'; if((Test-Path $p) -and ((Get-Content $p -Raw) -match '(?m)^\\s*networkingMode\\s*=\\s*mirrored')){ ` +
    `Copy-Item $p "$p.bak-hvc" -Force; [IO.File]::WriteAllText($p, ((Get-Content $p -Raw) -replace '(?m)^(\\s*networkingMode\\s*=\\s*)mirrored','$1nat')); wsl.exe --shutdown; 'WSL networking switched from mirrored to nat (backup .wslconfig.bak-hvc)' }`, 120);
  if (wc.trim()) log.push(wc.trim());
  await runPS(`if(-not (Get-NetFirewallRule -DisplayName 'usbipd' -EA SilentlyContinue)){ New-NetFirewallRule -DisplayName 'usbipd' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3240 -Program '${USBIPD}' -RemoteAddress LocalSubnet | Out-Null }`);
  const distros = await listDistros();
  if (!distro) distro = distros.find(d => /ubuntu/i.test(d)) || distros[0];
  if (!distro) throw new Error('No WSL distro for the signed-in user. Install one, e.g. "wsl --install -d Ubuntu", and create its user.');
  const opts = [chrome && 'chrome', edge && 'edge'].filter(Boolean).join(' ');
  const out = await runWsl(distro, `tr -d "\\r" < ${shq(WSL_SEAT_DIR + '/setup.sh')} | bash -s ${opts} 2>&1 | tail -5; ${seatCmd}`, 1800);
  log.push(out.trim());
  if (!/SETUP_OK/.test(out)) throw new Error('Linux package setup failed:\n' + out.trim());
  const st = loadState(); st.distro = distro; saveState(st);
  return { ok: true, distro, log };
}

// Attach the chosen devices to WSL and start seat <display>.
async function start({ display = 2, mouse, keyboard, mode, target, user, pass, browser, url }) {
  display = Number(display) || 2;
  const st = loadState();
  const { devices } = await listDevices();
  const busids = [...new Set([mouse, keyboard].filter(Boolean))];
  if (!busids.length) throw new Error('Choose a mouse and/or a keyboard');
  for (const b of busids) if (!devices.find(d => d.busid === b)) throw new Error(`USB device ${b} not found`);
  const distro = st.distro || (await listDistros()).find(d => /ubuntu/i.test(d));
  if (!distro) throw new Error('Prepare the seat first (no WSL distro)');
  // Bind needs admin (this process); attach must run as the user that owns the WSL VM.
  for (const b of busids) {
    const d = devices.find(x => x.busid === b);
    if (!d.attached) await runPS(`& '${USBIPD}' bind --busid ${b} --force 2>&1`);
  }
  const attach = busids.filter(b => !devices.find(x => x.busid === b).attached)
    .map(b => `$j=Start-Job { & '${USBIPD}' attach --wsl --busid ${b} 2>&1 }; if(-not (Wait-Job $j -Timeout 45)){ 'ATTACH_TIMEOUT:${b}'; Stop-Job $j }; Receive-Job $j 2>&1 | ForEach-Object { "$_" }`).join('\r\n');
  if (attach) {
    const out = await runAsUser(`wsl.exe -d '${psq(distro)}' -u root -- true\r\n` +
      `if(-not (Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -match 'sleep infinity' })) { Start-Process wsl.exe -ArgumentList '-d','${psq(distro)}','-u','root','--','sleep','infinity' -WindowStyle Hidden; Start-Sleep 4 }\r\n` + attach, 180);
    if (/ATTACH_TIMEOUT|error:/i.test(out)) throw new Error('usbipd attach failed: ' + out.trim());
  }
  // Map the USB devices to their evdev nodes inside WSL.
  const devOut = await runWsl(distro, `${seatCmd}; sleep 2; udevadm settle 2>/dev/null; hvc-seat devices`, 90);
  const nodes = devOut.split('\n').filter(l => l.includes('|')).map(l => { const [ev, vidpid, type, name] = l.split('|'); return { ev, vidpid, type, name }; });
  const vidOf = b => devices.find(d => d.busid === b).vidpid;
  const pick = (b, type) => b ? (nodes.find(n => n.vidpid === vidOf(b) && n.type === type) || {}).ev : null;
  const mouseEv = pick(mouse, 'mouse'), kbdEv = pick(keyboard, 'keyboard');
  if (mouse && !mouseEv) throw new Error('Mouse not found in WSL after attach:\n' + devOut);
  if (keyboard && !kbdEv) throw new Error('Keyboard not found in WSL after attach:\n' + devOut);
  const args = mode === 'rdp' ? ['rdp', target || 'host:13389', user, pass] : ['browser', browser || 'firefox', url];
  const out = await runWsl(distro, `${seatCmd}; hvc-seat start ${display} ${mouseEv || 'none'} ${kbdEv || 'none'} ${args.map(shq).join(' ')} 2>/dev/null`, 120);
  if (!/Xorg :\d/.test(out)) throw new Error('Seat did not start:\n' + out.trim());
  st.seats = st.seats || {};
  st.seats[display] = { busids, mouse, keyboard, mouseEv, kbdEv, mode, target: mode === 'rdp' ? target : url, browser, started: new Date().toISOString() };
  saveState(st);
  return { ok: true, display, mouseEv, kbdEv, processes: out.trim().split('\n') };
}

// Stop seat <display> and give its USB devices back to Windows.
async function stop({ display = 2 } = {}) {
  display = Number(display) || 2;
  const st = loadState(); const seat = (st.seats || {})[display] || {};
  if (st.distro) await runWsl(st.distro, `hvc-seat stop ${display} 2>/dev/null`, 60).catch(() => {});
  const busids = seat.busids || [];
  if (busids.length) {
    await runAsUser(busids.map(b => `& '${USBIPD}' detach --busid ${b} 2>&1`).join('\r\n'), 60).catch(() => {});
    for (const b of busids) await runPS(`& '${USBIPD}' unbind --busid ${b} 2>&1`);
  }
  if (st.seats) delete st.seats[display];
  saveState(st);
  return { ok: true, released: busids };
}

// Express routes; mounted at /api/seat by the configurator and by the standalone app.
function router() {
  const r = express.Router();
  r.use(express.json());
  const wrap = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { res.json({ ok: false, error: e.message }); } };
  r.get('/status', wrap(() => status()));
  r.get('/devices', wrap(() => listDevices()));
  r.post('/prepare', wrap(req => prepare(req.body || {})));
  r.post('/start', wrap(req => start(req.body || {})));
  r.post('/stop', wrap(req => stop(req.body || {})));
  return r;
}

module.exports = { router, status, prepare, start, stop, listDevices, runAsUser, runWsl };
