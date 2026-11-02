'use strict';
// Browser terminal + access data + X desktop for the machines the installer manages.
//  - /terminal.html (xterm.js) ⇄ WebSocket /ws/terminal ⇄ a pseudo-terminal (ConPTY) running:
//      Linux machines (WSL, Hyper-V/VirtualBox VMs, servers): ssh with the installer key;  Docker containers: ssh + docker exec;
//      Windows VMs: PowerShell Direct (Enter-PSSession -VMName) as Administrator (no network or RDP needed).
//  - /api/access: SSH / PowerShell Direct / RDP data of a machine (user, password, host, port, key).
//  - /api/desktop/*: install Xfce / LXQt / GNOME (+ Firefox) with a VNC server and noVNC in a Linux machine, and open it through
//    an SSH tunnel (-L) in the browser — nothing in the machine is exposed to the network.
// Everything here is limited to requests from this computer (loopback + localhost origin).
const fs = require('fs');
const path = require('path');
const net = require('net');
const cp = require('child_process');
const WebSocket = require('ws');
const pty = require('@lydell/node-pty');
const x = require('./exec');
const machines = require('./machines');

const SSH_EXE = fs.existsSync('C:\\Windows\\System32\\OpenSSH\\ssh.exe') ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh';
const psq = s => String(s).replace(/'/g, "''");
const rnd = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
const okOrigin = req => { const o = req.headers.origin; if (!o) return true; try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(o).hostname); } catch { return false; } };

module.exports = function register({ app, wrap, SSH_KEY, VM_DIR }) {
  const localOnly = (req, res, next) => isLocal(req) && okOrigin(req) ? next() : res.status(403).json({ ok: false, error: 'only from this computer' });

  // ── WSL: SSH server + user "elo" with the installer key (WSL has no SSH by default) ──
  async function wslIp() { return (await x.shLocal('hostname -I | awk \'{print $1}\'', 60)).trim().split(/\s+/)[0]; }
  async function ensureWslSsh() {
    const rec = machines.get('wsl') || {};
    const pw = rec.password || rnd();
    const pub = fs.readFileSync(SSH_KEY + '.pub', 'utf8').trim();
    const out = await x.shLocal(`set -e; export DEBIAN_FRONTEND=noninteractive; apt-get() { command apt-get -o DPkg::Lock::Timeout=600 "$@"; }
command -v sshd >/dev/null || { apt-get update -qq; apt-get install -y -qq openssh-server >/dev/null; }
id elo >/dev/null 2>&1 || useradd -m -s /bin/bash elo
echo 'elo:${pw}' | chpasswd; usermod -aG sudo elo; getent group docker >/dev/null && usermod -aG docker elo || true
echo 'elo ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/elo; chmod 440 /etc/sudoers.d/elo
install -d -m 700 -o elo -g elo /home/elo/.ssh; grep -qF '${pub}' /home/elo/.ssh/authorized_keys 2>/dev/null || echo '${pub}' >> /home/elo/.ssh/authorized_keys
chown elo:elo /home/elo/.ssh/authorized_keys; chmod 600 /home/elo/.ssh/authorized_keys
mkdir -p /run/sshd; (systemctl enable --now ssh >/dev/null 2>&1 || systemctl enable --now sshd >/dev/null 2>&1 || service ssh start >/dev/null 2>&1); sleep 1
echo "SSH_OK $(hostname -I | awk '{print $1}')"`, 300);
    if (!/SSH_OK/.test(out)) throw new Error('could not set up SSH in WSL: ' + out.trim().split('\n').pop());
    machines.save('wsl', { os: 'linux', user: 'elo', password: pw, sshPort: 22, label: `WSL ${x.getDistro() || ''}`.trim() });
    return { host: out.match(/SSH_OK (\S+)/)[1], port: 22, user: 'elo', password: pw };
  }

  // ── what to connect to, by id ──
  // wsl | hyperv:<vm> | vbox:<vm> | target (the current SSH target) | ctr:<scope>:<container> (scope: wsl | target)
  async function resolve(id) {
    id = String(id || '');
    const ctr = /^ctr:(wsl|target):([\w.-]+)$/.exec(id);
    if (ctr) { const m = await resolve(ctr[1]); return { ...m, container: ctr[2], label: `${m.label} › ${ctr[2]}` }; }
    if (id === 'wsl') {
      // SSH is set up once; afterwards the saved IP is reused while its port 22 answers (WSL's IP changes at restarts)
      const rec = machines.get('wsl'), ok = rec?.ip && await new Promise(r => { const s = net.connect({ host: rec.ip, port: 22, timeout: 1500 }).on('connect', () => { s.destroy(); r(true); }).on('error', () => r(false)).on('timeout', () => { s.destroy(); r(false); }); });
      let ip = ok ? rec.ip : null, pw = rec?.password;
      if (!ip) { const s = await ensureWslSsh(); ip = s.host; pw = s.password; machines.save('wsl', { ip }); }
      return { os: 'linux', label: `WSL ${x.getDistro() || ''}`.trim(), ssh: { host: ip, port: 22, user: 'elo', password: pw, key: SSH_KEY } };
    }
    if (id === 'target') {
      const t = x.getTarget(); if (!t) throw new Error('no SSH target is set');
      const rec = machines.get(`${t.kind}:${t.vm}`) || {};
      return { os: 'linux', label: t.vm || `${t.user}@${t.host}`, ssh: { host: t.host, port: t.port || 22, user: t.user, password: rec.password, key: t.key || SSH_KEY } };
    }
    const m = /^(hyperv|vbox):(.+)$/.exec(id); if (!m) throw new Error('unknown machine');
    const [, kind, name] = m;
    let rec = machines.get(id);
    if (!rec && kind === 'hyperv') {   // Windows VMs of this installer created before access data was stored: password from unattend.xml
      const f = path.join(VM_DIR, name, 'unattend.xml');
      if (fs.existsSync(f)) {
        const pw = fs.readFileSync(f, 'utf8').match(/<Value>([^<]*)<\/Value>/)?.[1];
        if (pw) { rec = { os: 'windows', user: 'Administrator', password: pw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') }; machines.save(id, rec); }
      }
    }
    if (!rec) throw new Error('no access data stored for this VM (only VMs created by this installer have it)');
    if (rec.os === 'windows') {
      const ip = (await x.ps(`@((Get-VMNetworkAdapter -VMName '${psq(name)}').IPAddresses | ?{ $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]`)).out.trim();
      return { os: 'windows', label: `${name} (${rec.label || 'Windows'})`, vm: name, user: rec.user, password: rec.password, ip, rdp: ip ? `${ip}:3389` : '',
        ssh: rec.wslUser && ip ? { host: ip, port: 22, user: rec.wslUser, password: rec.password, key: SSH_KEY, note: 'Ubuntu in WSL inside the VM' } : null };
    }
    if (kind === 'hyperv') {
      const ip = (await x.ps(`@((Get-VMNetworkAdapter -VMName '${psq(name)}').IPAddresses | ?{ $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]`)).out.trim();
      if (!ip) throw new Error(`the VM ${name} has no IP yet (is it running?)`);
      return { os: 'linux', label: `${name} (${rec.label || 'Linux'})`, ssh: { host: ip, port: 22, user: rec.user, password: rec.password, key: SSH_KEY } };
    }
    return { os: 'linux', label: `${name} (${rec.label || 'Linux'})`, ssh: { host: '127.0.0.1', port: rec.sshPort || 2222, user: rec.user, password: rec.password, key: SSH_KEY } };
  }

  const sshArgs = (s, extra = []) => ['-i', s.key || SSH_KEY, '-p', String(s.port || 22), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', ...extra, `${s.user}@${s.host}`];
  const sshCommand = s => `ssh -i "${s.key || SSH_KEY}" -p ${s.port || 22} ${s.user}@${s.host}`;

  // Command (file, args, env) of the pseudo-terminal for a machine.
  function termCommand(m) {
    if (m.os === 'windows' && !m.container) {
      const script = `$c=New-Object PSCredential('${psq(m.user)}',(ConvertTo-SecureString $env:HVC_PW -AsPlainText -Force)); Enter-PSSession -VMName '${psq(m.vm)}' -Credential $c`;
      return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit', '-Command', script], env: { HVC_PW: m.password } };
    }
    const remote = m.container ? [`docker exec -it ${m.container} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`] : [];
    return { file: SSH_EXE, args: ['-tt', ...sshArgs(m.ssh), ...remote], env: {} };
  }

  // ── access data for the UI ──
  app.get('/api/access', localOnly, wrap(async req => {
    const id = req.query.id, m = await resolve(id);
    const out = { ok: true, id, label: m.label, os: m.os };
    if (m.ssh) out.ssh = { host: m.ssh.host, port: m.ssh.port, user: m.ssh.user, password: m.ssh.password || null, key: m.ssh.key, command: sshCommand(m.ssh), note: m.ssh.note || '' };
    if (m.os === 'windows') out.windows = { vm: m.vm, user: m.user, password: m.password, ip: m.ip, rdp: m.rdp,
      psDirect: `Enter-PSSession -VMName '${m.vm}' -Credential (Get-Credential ${m.user})`, mstsc: m.ip ? `mstsc /v:${m.ip}` : '' };
    if (m.ssh && !m.container) out.desktop = await desktopState(m).catch(() => ({ installed: false }));
    return out;
  }));

  // ── WebSocket terminal ──
  function attach(server) {
    const wss = new WebSocket.Server({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/ws/terminal')) return;   // other upgrades are not served here
      if (!isLocal(req) || !okOrigin(req)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    });
    wss.on('connection', async (ws, req) => {
      const id = new URL(req.url, 'http://x').searchParams.get('id');
      let term;
      try {
        const m = await resolve(id), c = termCommand(m);
        ws.send(`\x1b[90m${m.os === 'windows' && !m.container ? 'PowerShell Direct' : 'ssh'} → ${m.label}\x1b[0m\r\n`);
        term = pty.spawn(c.file, c.args, { name: 'xterm-256color', cols: 120, rows: 32, env: { ...process.env, ...c.env } });
      } catch (e) { ws.send(`\x1b[31m${e.message}\x1b[0m\r\n`); ws.close(); return; }
      term.onData(d => ws.readyState === 1 && ws.send(d));
      term.onExit(() => { try { ws.send('\r\n\x1b[90m[session closed]\x1b[0m\r\n'); ws.close(); } catch {} });
      ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        if (msg.type === 'input') term.write(msg.data); else if (msg.type === 'resize') try { term.resize(Math.max(2, msg.cols | 0), Math.max(2, msg.rows | 0)); } catch {}
      });
      ws.on('close', () => { try { term.kill(); } catch {} });
    });
  }

  // ── X desktop (Xfce / LXQt / GNOME + Firefox) with VNC + noVNC, reached through an SSH tunnel ──
  // Streams the output of a script run by SSH on the machine (sudo) into a job log.
  function runScript(m, script, log) {
    return new Promise((resolveP, reject) => {
      const p = cp.spawn(SSH_EXE, [...sshArgs(m.ssh), 'sudo -n bash -s'], { windowsHide: true });
      p.stdin.end(script.replace(/\r/g, ''));
      const feed = d => String(d).split('\n').forEach(l => l.trim() && log(l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')));
      p.stdout.on('data', feed); p.stderr.on('data', feed);
      p.on('error', reject); p.on('close', code => code === 0 ? resolveP() : reject(new Error(`exit code ${code}`)));
    });
  }
  const DESKTOPS = {
    xfce: { label: 'Xfce', session: 'startxfce4', apt: 'xfce4 xfce4-terminal xfce4-goodies dbus-x11' },
    lxqt: { label: 'LXQt (light)', session: 'startlxqt', apt: 'lxqt qterminal dbus-x11' },
    gnome: { label: 'GNOME', session: 'gnome-session', apt: 'ubuntu-desktop-minimal dbus-x11', debApt: 'gnome-core dbus-x11' },
  };
  const desktopScript = (key, browser, user) => {
    const d = DESKTOPS[key];
    return `set -e; export DEBIAN_FRONTEND=noninteractive; . /etc/os-release; apt-get() { command apt-get -o DPkg::Lock::Timeout=600 "$@"; }
echo "__STEP__ Installing ${d.label} desktop (download of several hundred MB)"
apt-get update -qq
PK="${d.apt}"; [ "$ID" = debian ] && PK="${d.debApt || d.apt}"
apt-get install -y -qq $PK tigervnc-standalone-server tigervnc-common novnc websockify x11-xserver-utils xauth fonts-dejavu >/dev/null
${browser ? `echo "__STEP__ Installing Firefox"
if [ "$ID" = ubuntu ]; then
  apt-get install -y -qq software-properties-common >/dev/null; add-apt-repository -y ppa:mozillateam/ppa >/dev/null
  printf 'Package: *\\nPin: release o=LP-PPA-mozillateam\\nPin-Priority: 1001\\n' > /etc/apt/preferences.d/mozilla-firefox   # the deb build, not the snap
  apt-get update -qq; apt-get install -y -qq firefox >/dev/null
else apt-get install -y -qq firefox-esr >/dev/null; fi` : ''}
echo "__STEP__ Configuring the VNC desktop session and the services"
U=${user}; H=$(getent passwd $U | cut -d: -f6); install -d -o $U -g $U $H/.vnc
XS=$(command -v Xtigervnc || command -v Xvnc)
# Xtigervnc is started directly (the tigervncserver wrapper needs a writable /tmp/.X11-unix, which WSL does not have); access to
# display :1 is limited to the user by an X cookie, the VNC port listens on localhost only.
cat > /etc/systemd/system/elo-vnc.service <<UNIT
[Unit]
Description=ELO desktop X/VNC server (display :1, localhost only)
After=network.target
[Service]
User=$U
Environment=HOME=$H
ExecStartPre=/bin/sh -c 'rm -f $H/.vnc/xauth /tmp/.X1-lock; xauth -f $H/.vnc/xauth add :1 . \\$\\$(mcookie)'
ExecStart=$XS :1 -auth $H/.vnc/xauth -rfbport 5901 -localhost yes -geometry 1600x900 -depth 24 -SecurityTypes None -AlwaysShared -nolisten tcp
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/elo-desktop.service <<UNIT
[Unit]
Description=ELO desktop session (${d.label})
After=elo-vnc.service
Requires=elo-vnc.service
[Service]
User=$U
Environment=HOME=$H DISPLAY=:1 XAUTHORITY=$H/.vnc/xauth XDG_SESSION_TYPE=x11
ExecStartPre=/bin/sleep 3
ExecStart=/usr/bin/dbus-launch --exit-with-session ${d.session}
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/elo-novnc.service <<UNIT
[Unit]
Description=ELO desktop noVNC (6080 -> VNC 5901)
After=elo-vnc.service
[Service]
ExecStart=$(command -v websockify) --web /usr/share/novnc 127.0.0.1:6080 127.0.0.1:5901
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload; systemctl enable elo-vnc.service elo-desktop.service elo-novnc.service >/dev/null 2>&1
systemctl restart elo-vnc.service elo-desktop.service elo-novnc.service
for i in $(seq 1 20); do ss -ltn | grep -q ':6080 ' && ss -ltn | grep -q ':5901 ' && break; sleep 2; done
ss -ltn | grep -E ':(6080|5901) ' || { echo "ERROR: the desktop services did not start"; journalctl -u elo-vnc -n 15 --no-pager; exit 1; }
sleep 4; systemctl is-active elo-desktop.service >/dev/null || { echo "ERROR: the desktop session did not start"; journalctl -u elo-desktop -n 15 --no-pager; exit 1; }
echo "__STEP__ Desktop ready: ${d.label}"`;
  };
  async function desktopState(m) {
    const out = await x.shOn(m.ssh, `test -f /etc/systemd/system/elo-vnc.service && echo yes || echo no; systemctl is-active elo-vnc.service elo-desktop.service elo-novnc.service 2>/dev/null | tr '\\n' ' '; echo; grep -o 'start[a-z0-9-]*\\|gnome-session' /etc/systemd/system/elo-desktop.service 2>/dev/null | head -1`, 30);
    const lines = out.trim().split('\n');
    return { installed: lines[0] === 'yes', running: /^(actives*){3}$/.test(lines[1] || ''), session: lines[2] || '' };
  }
  app.post('/api/desktop/install', localOnly, wrap(async req => {
    const { id, desktop = 'xfce', browser = true } = req.body || {};
    if (!DESKTOPS[desktop]) throw new Error('unknown desktop');
    const m = await resolve(id); if (!m.ssh || m.container) throw new Error('desktops can be installed in Linux machines');
    if (!/^[a-z_][a-z0-9_-]*$/.test(m.ssh.user)) throw new Error('bad user');
    return x.nodeJob('desktop', log => runScript(m, desktopScript(desktop, browser, m.ssh.user), log));
  }));
  // SSH tunnels (127.0.0.1:<local> → machine:6080 noVNC and :5901 VNC); kept until closed or the installer stops.
  const tunnels = new Map();
  const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const waitPort = async (p, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await new Promise(r => { const c = net.connect(p, '127.0.0.1').on('connect', () => { c.destroy(); r(true); }).on('error', () => r(false)); })) return true; await new Promise(r => setTimeout(r, 400)); } return false; };
  app.post('/api/desktop/open', localOnly, wrap(async req => {
    const id = req.body?.id, m = await resolve(id); if (!m.ssh || m.container) throw new Error('not a Linux machine');
    await x.shOn(m.ssh, 'systemctl start elo-vnc.service elo-desktop.service elo-novnc.service', 90);
    let t = tunnels.get(id);
    if (!t || t.proc.exitCode !== null) {
      const web = await freePort(), vnc = await freePort();
      const proc = cp.spawn(SSH_EXE, ['-N', '-o', 'ExitOnForwardFailure=yes', '-L', `127.0.0.1:${web}:127.0.0.1:6080`, '-L', `127.0.0.1:${vnc}:127.0.0.1:5901`, ...sshArgs(m.ssh)], { windowsHide: true, stdio: 'ignore' });
      t = { proc, web, vnc }; tunnels.set(id, t);
      if (!(await waitPort(web))) { proc.kill(); tunnels.delete(id); throw new Error('the SSH tunnel did not come up (is the desktop installed?)'); }
    }
    return { ok: true, url: `http://127.0.0.1:${t.web}/vnc.html?autoconnect=true&resize=scale`, vnc: `127.0.0.1:${t.vnc}`, tunnel: `ssh -L ${t.web}:127.0.0.1:6080 -L ${t.vnc}:127.0.0.1:5901 ${m.ssh.user}@${m.ssh.host}` };
  }));
  app.post('/api/desktop/close', localOnly, wrap(async req => { const t = tunnels.get(req.body?.id); if (t) { t.proc.kill(); tunnels.delete(req.body.id); } return { ok: true }; }));
  process.on('exit', () => tunnels.forEach(t => { try { t.proc.kill(); } catch {} }));

  return { attach, resolve, DESKTOPS, localOnly };
};
