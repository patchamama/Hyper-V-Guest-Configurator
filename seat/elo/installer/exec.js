'use strict';
// Where and how the installer runs shell work.
//  - Linux (Ubuntu/Debian…): bash directly, Docker Engine on the host.
//  - Windows: inside a WSL2 distro. If the distro belongs to the current Windows user, wsl.exe is called
//    directly; if this process runs elevated as another account (distros are per user), commands go through a
//    scheduled task as the signed-in user (seat-lib runWsl), which is slower.
// Long jobs run detached with their log in a shared file the backend streams to the browser.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const RUN_DIR = IS_WIN ? 'C:\\ProgramData\\hvc-run' : path.join(os.tmpdir(), 'elo-installer');
const ELO_DIR = path.join(__dirname, '..');
fs.mkdirSync(RUN_DIR, { recursive: true });

// C:\x\y -> /mnt/c/x/y (WSL view of a Windows path).
const toLinux = p => IS_WIN ? '/mnt/' + p[0].toLowerCase() + p.slice(2).replace(/\\/g, '/') : p;
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";

let mode = null, distro = process.env.ELO_WSL_DISTRO || null, seatLib = null;

function run(cmd, args, { input, timeoutMs = 600000, env } = {}) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => { clearTimeout(t); resolve({ code, out: out.replace(/\0/g, ''), err: err.replace(/\0/g, '') }); });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out: '', err: e.message }); });
    if (input != null) { p.stdin.write(input); p.stdin.end(); }
  });
}

// Detect the execution mode once: linux | wsl (own distro) | wsl-user (another user's distro via scheduled task).
async function detect() {
  if (mode) return { mode, distro };
  if (!IS_WIN) { mode = 'linux'; return { mode, distro: null }; }
  const own = (await run('wsl.exe', ['-l', '-q'], { env: { WSL_UTF8: '1' }, timeoutMs: 30000 })).out
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^docker-desktop/i.test(s));
  if (!distro) distro = own.find(d => /ubuntu|debian/i.test(d)) || own[0] || null;
  if (distro && own.includes(distro)) { mode = 'wsl'; return { mode, distro }; }
  try { seatLib = require('../../seat-lib'); } catch {}
  if (seatLib) {
    if (!distro) {
      try { distro = JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'seat-state.json'), 'utf8')).distro || null; } catch {}
      distro = distro || 'Ubuntu';
    }
    mode = 'wsl-user'; return { mode, distro };
  }
  mode = 'none'; return { mode, distro: null };
}

// Run a bash script as root and return its output.
async function sh(script, timeoutSec = 300) {
  await detect();
  if (mode === 'linux') {
    const asRoot = process.getuid && process.getuid() !== 0 ? ['sudo', '-n', 'bash', '-s'] : ['bash', '-s'];
    const r = await run(asRoot[0], asRoot.slice(1), { input: script, timeoutMs: timeoutSec * 1000 });
    return r.out + r.err;
  }
  if (mode === 'wsl') {
    await keepAlive();
    const r = await run('wsl.exe', ['-d', distro, '-u', 'root', '--', 'bash', '-s'], { input: script.replace(/\r/g, ''), timeoutMs: timeoutSec * 1000 });
    return r.out + r.err;
  }
  if (mode === 'wsl-user') return seatLib.runWsl(distro, script, timeoutSec);
  throw new Error('No Linux environment: install WSL2 with Ubuntu (Windows) or run on Linux');
}

// Keep the WSL distro running between calls (it stops when no process is left).
let kept = false;
async function keepAlive() {
  if (kept || mode !== 'wsl') return;
  const p = spawn('wsl.exe', ['-d', distro, '-u', 'root', '--', 'sleep', 'infinity'], { detached: true, stdio: 'ignore', windowsHide: true });
  p.unref(); kept = true;
}

// Start a detached job; its output goes to RUN_DIR/<id>.log and ends with "__EXIT__:<code>".
async function startJob(name, script) {
  const id = `elo-${name}-${Date.now().toString(36)}`;
  const shFile = path.join(RUN_DIR, `${id}.sh`), log = path.join(RUN_DIR, `${id}.log`);
  fs.writeFileSync(shFile, `#!/bin/bash\n${script}\n`.replace(/\r/g, ''));
  fs.writeFileSync(log, '');
  await sh(`setsid nohup bash -c ${shq(`bash ${shq(toLinux(shFile))}; echo "__EXIT__:$?"`)} >> ${shq(toLinux(log))} 2>&1 < /dev/null & echo started`, 60);
  return { id, log };
}

// Windows-side PowerShell (memory, portproxy, firewall). Elevation is needed for portproxy/firewall.
function ps(script, timeoutMs = 120000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script], { timeoutMs });
}

module.exports = { detect, sh, startJob, ps, toLinux, shq, IS_WIN, RUN_DIR, ELO_DIR };
