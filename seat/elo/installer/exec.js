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

// Remote target over SSH (Hyper-V VM, VirtualBox VM, any Ubuntu/Debian server): { host, port, user, key }.
// Key-based login (BatchMode) with passwordless sudo on the target; ELO files are copied to REMOTE_DIR.
const TARGET_FILE = path.join(RUN_DIR, 'elo-target.json');
const REMOTE_DIR = '/opt/elo-docker';
let target = null;
try { target = JSON.parse(fs.readFileSync(TARGET_FILE, 'utf8')); } catch {}
const sshArgs = t => ['-i', t.key, '-p', String(t.port || 22), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=10', `${t.user}@${t.host}`];
function setTarget(t) {
  target = t && t.host ? { host: t.host, port: Number(t.port) || 22, user: t.user, key: t.key } : null;
  if (target) fs.writeFileSync(TARGET_FILE, JSON.stringify(target, null, 2)); else { try { fs.unlinkSync(TARGET_FILE); } catch {} }
  mode = null;   // re-detect
}
const getTarget = () => target;
// Directory of the ELO files as seen by the shell that runs elo.sh.
const eloDir = () => mode === 'ssh' ? REMOTE_DIR : toLinux(ELO_DIR);

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
  if (mode) return { mode, distro, target };
  if (target) { mode = 'ssh'; return { mode, distro: null, target }; }
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
  if (mode === 'ssh') {
    const r = await run('ssh', [...sshArgs(target), 'sudo -n bash -s'], { input: script.replace(/\r/g, ''), timeoutMs: timeoutSec * 1000 });
    if (r.code === 255) throw new Error(`SSH to ${target.user}@${target.host} failed: ${r.err.trim().split('\n').pop()}`);
    return r.out + r.err;
  }
  throw new Error('No Linux environment: install WSL2 with Ubuntu (Windows) or run on Linux');
}

// SSH target: copy the ELO project files (compose, elo.sh, uploaded license) to REMOTE_DIR.
async function deployRemote() {
  if (mode !== 'ssh') return { ok: true, skipped: true };
  await sh(`mkdir -p ${REMOTE_DIR} && chown ${shq(target.user)} ${REMOTE_DIR}`, 60);
  const files = ['docker-compose.yml', 'elo.sh', 'elo-license.lic', 'uploaded-license.pk']
    .map(f => path.join(ELO_DIR, f)).filter(f => fs.existsSync(f));
  const r = await run('scp', ['-i', target.key, '-P', String(target.port || 22), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new',
    ...files, `${target.user}@${target.host}:${REMOTE_DIR}/`], { timeoutMs: 120000 });
  if (r.code !== 0) throw new Error('scp failed: ' + r.err.trim());
  return { ok: true, files: files.map(f => path.basename(f)) };
}

// Read new output of a job log from position pos (local file, or remote over SSH).
async function readLog(job, pos) {
  if (mode === 'ssh') {
    const out = await sh(`tail -c +${pos + 1} ${shq(`/tmp/${job}.log`)} 2>/dev/null`, 30);
    return { chunk: out, pos: pos + Buffer.byteLength(out) };
  }
  const log = path.join(RUN_DIR, `${job}.log`);
  try {
    const fd = fs.openSync(log, 'r'); const st = fs.fstatSync(fd);
    if (st.size <= pos) { fs.closeSync(fd); return { chunk: '', pos }; }
    const b = Buffer.alloc(st.size - pos); fs.readSync(fd, b, 0, b.length, pos); fs.closeSync(fd);
    return { chunk: b.toString('utf8'), pos: st.size };
  } catch { return { chunk: '', pos }; }
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
  await detect();
  const id = `elo-${name}-${Date.now().toString(36)}`;
  if (mode === 'ssh') {   // script and log live on the target in /tmp
    await sh(`cat > /tmp/${id}.sh <<'__ELO_JOB__'\n#!/bin/bash\n${script.replace(/\r/g, '')}\n__ELO_JOB__\n: > /tmp/${id}.log; ` +
      `setsid nohup bash -c ${shq(`bash /tmp/${id}.sh; echo "__EXIT__:$?"`)} >> /tmp/${id}.log 2>&1 < /dev/null & echo started`, 60);
    return { id };
  }
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

module.exports = { detect, sh, startJob, readLog, ps, run, toLinux, shq, setTarget, getTarget, deployRemote, eloDir,
  IS_WIN, RUN_DIR, ELO_DIR, REMOTE_DIR, getMode: () => mode, getDistro: () => distro, getSeatLib: () => seatLib };
