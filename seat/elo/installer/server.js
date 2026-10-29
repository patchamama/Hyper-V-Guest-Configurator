'use strict';
// ELO on Docker — installer & admin backend. Open http://localhost:3200
// Linux: run as root (or with passwordless sudo). Windows: runs the Linux side in WSL2 (see exec.js);
// "Expose to the network" needs an elevated PowerShell (portproxy + firewall).
const express = require('express');
const fs = require('fs');
const path = require('path');
const x = require('./exec');
const { inventory, fetchCliSecret } = require('../tools/registry-inventory');
const { acceptEula, webClientCheck } = require('./eula');

const PORT = Number(process.env.ELO_INSTALLER_PORT) || 3200;
const ELO = x.ELO_DIR, ELO_L = x.toLinux(ELO);
const PORTS = { server: 9090, as: 9060, flows: 9010, search: 9200, 'search-transport': 9204 };
const session = { registry: null };          // { username, secret } kept in memory only
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const wrap = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.json({ ok: false, error: e.message }); } };

// Run elo.sh (CRLF-safe copy) with optional environment.
const elo = (args, env = {}, t = 600) => x.sh(
  `export ELO_DIR=${x.shq(ELO_L)}; ${Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `export ${k}=${x.shq(v)}; `).join('')}` +
  `tr -d '\\r' < "$ELO_DIR/elo.sh" > /tmp/elo.sh; bash /tmp/elo.sh ${args}`, t);

function readEnv() {
  try {
    return Object.fromEntries(fs.readFileSync(path.join(ELO, '.env'), 'utf8').split(/\r?\n/)
      .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  } catch { return null; }
}

// Base URL to reach the published ports from where this backend runs (WSL IP on Windows).
async function baseUrl() {
  const { mode } = await x.detect();
  if (mode === 'linux') return 'http://localhost:9090';
  const ip = (await x.sh('hostname -I | awk \'{print $1}\'', 60)).trim().split(/\s+/)[0];
  return `http://${ip}:9090`;
}

// ── Environment & requirements ──────────────────────────────────────────────
app.get('/api/env', wrap(async () => ({ ok: true, platform: process.platform, ...(await x.detect()) })));

app.get('/api/checks', wrap(async () => {
  const env = await x.detect();
  const out = await x.sh(`
echo "os=$(. /etc/os-release; echo "$PRETTY_NAME")"
echo "docker=$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
echo "compose=$(docker compose version --short 2>/dev/null)"
echo "mem_total=$(awk '/MemTotal/{print $2}' /proc/meminfo)"
echo "mem_avail=$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
root=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /); echo "disk_free=$(df -k --output=avail "$root" 2>/dev/null | tail -1)"
echo "max_map_count=$(sysctl -n vm.max_map_count)"
for p in 9090 9060 9010 9200 9204; do o=$(ss -ltnp 2>/dev/null | grep ":$p "); if [ -z "$o" ]; then echo "port_$p=free"; elif echo "$o" | grep -q docker; then echo "port_$p=elo"; else echo "port_$p=used"; fi; done
echo "registry=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://registry.elo.com/v2/)"
echo "license_server=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 https://license.services.elo.cloud)"
echo "logged_in=$(grep -qs registry.elo.com /root/.docker/config.json && echo yes || echo no)"
echo "images=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -c registry.elo.com)"
echo "installed=$(docker ps -aq -f name=elo-server 2>/dev/null | grep -q . && echo yes || echo no)"
echo "running=$(docker ps -q -f name=elo-server 2>/dev/null | grep -q . && echo yes || echo no)"
`, 120);
  const v = Object.fromEntries(out.split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  let host = null;
  if (x.IS_WIN) {
    const r = await x.ps(`$os=Get-CimInstance Win32_OperatingSystem; $vms=@(); try { $vms=@(Get-VM -EA Stop | ?{$_.State -eq 'Running'} | %{ "$($_.Name)=$([math]::Round($_.MemoryAssigned/1GB,1))" }) } catch {}; ` +
      `ConvertTo-Json -Compress @{ totalGB=[math]::Round($os.TotalVisibleMemorySize/1MB,1); freeGB=[math]::Round($os.FreePhysicalMemory/1MB,1); vms=$vms }`);
    try { host = JSON.parse(r.out.trim().split('\n').pop()); } catch {}
  }
  const gb = kb => Math.round(Number(kb || 0) / 1048576 * 10) / 10;
  const items = [
    { id: 'linux', label: 'Linux environment', ok: env.mode !== 'none', value: env.mode === 'linux' ? v.os : `WSL2 ${env.distro || ''} — ${v.os || '?'}`, fix: 'Install WSL2 + Ubuntu (Windows)' },
    { id: 'docker', label: 'Docker Engine', ok: !!v.docker, value: v.docker || 'missing', fix: 'install' },
    { id: 'compose', label: 'Docker Compose', ok: !!v.compose, value: v.compose || 'missing', fix: 'install' },
    { id: 'memory', label: 'Memory (Linux side)', ok: gb(v.mem_total) >= 12, warn: gb(v.mem_avail) < 10, value: `${gb(v.mem_avail)} GB free of ${gb(v.mem_total)} GB (full stack ~10-16 GB)` },
    { id: 'disk', label: 'Disk space (Docker)', ok: gb(v.disk_free) >= 25, value: `${gb(v.disk_free)} GB free (images ~16 GB + data)` },
    { id: 'mmap', label: 'vm.max_map_count (Elasticsearch)', ok: Number(v.max_map_count) >= 262144, value: v.max_map_count, fix: 'set at start' },
    { id: 'ports', label: 'Ports 9090/9060/9010/9200/9204', ok: !Object.entries(v).some(([k, s]) => k.startsWith('port_') && s === 'used'),
      value: Object.entries(v).filter(([k]) => k.startsWith('port_')).map(([k, s]) => `${k.slice(5)}:${s}`).join(' ') },
    { id: 'registry', label: 'registry.elo.com reachable', ok: ['200', '401'].includes(v.registry), value: `HTTP ${v.registry}` },
    { id: 'license', label: 'ELO license server reachable', ok: v.license_server === '200', value: `HTTP ${v.license_server}` },
  ];
  if (host) items.push({ id: 'host', label: 'Windows host memory', ok: host.freeGB >= 12, warn: host.freeGB < 16,
    value: `${host.freeGB} GB free of ${host.totalGB} GB${host.vms?.length ? ` · running VMs: ${host.vms.join(', ')} GB` : ''}` });
  return { ok: true, env, items, loggedIn: v.logged_in === 'yes', images: Number(v.images || 0), installed: v.installed === 'yes', running: v.running === 'yes' };
}));

// Install Docker Engine + compose plugin (Docker's apt repository) in Ubuntu/Debian.
app.post('/api/install-docker', wrap(async () => x.startJob('docker', `
set -e; export DEBIAN_FRONTEND=noninteractive; . /etc/os-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/$ID/gpg -o /etc/apt/keyrings/docker.asc; chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID \${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
apt-get update -qq; apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin apache2-utils
systemctl enable --now docker 2>/dev/null || service docker start
docker version --format 'Docker {{.Server.Version}} installed'`)));

// ── Registry ────────────────────────────────────────────────────────────────
app.post('/api/registry/secret', wrap(async req => {
  const { username, password } = req.body || {};
  const r = await fetchCliSecret(username, password);
  session.registry = { username: r.username, secret: r.secret };
  return { ok: true, username: r.username };
}));

app.post('/api/registry/login', wrap(async req => {
  const { username, secret } = req.body || {};
  if (secret) session.registry = { username, secret };
  if (!session.registry) throw new Error('registry user and CLI secret required');
  const tmp = path.join(x.RUN_DIR, `elo-cred-${Date.now()}.tmp`);
  fs.writeFileSync(tmp, session.registry.secret);
  try {
    const out = await x.sh(`tr -d '\\r\\n' < ${x.shq(x.toLinux(tmp))} | docker login registry.elo.com -u ${x.shq(session.registry.username)} --password-stdin 2>&1`, 120);
    if (!/Login Succeeded/.test(out)) throw new Error(out.trim().split('\n').pop());
    return { ok: true };
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}));

app.post('/api/registry/inventory', wrap(async () => {
  if (!session.registry) throw new Error('enter the registry user and CLI secret first');
  const inv = await inventory(session.registry.username, session.registry.secret);
  fs.writeFileSync(path.join(x.RUN_DIR, 'elo-inventory.json'), JSON.stringify(inv));
  const local = new Set((await x.sh(`docker images --format '{{.Repository}}:{{.Tag}}' | grep registry.elo.com`, 60)).split('\n').map(s => s.trim()));
  const repos = inv.projects.flatMap(p => p.repos.map(r => ({
    name: r.name, pulls: r.pulls, description: r.description,
    tags: r.tags.slice(0, 40).flatMap(t => t.tags.map(tag => ({
      tag, size: t.size, pushed: t.pushed, os: `${t.os}/${t.arch}`, base: (t.labels.distro || '').replace(/:$/, ''),
      ix: t.labels['com.elo.cloud.version.ix'] || '', local: local.has(`registry.elo.com/${p.name}/${r.name}:${tag}`),
    }))),
  })));
  return { ok: true, generated: inv.generated, repos };
}));

// ── License ─────────────────────────────────────────────────────────────────
app.post('/api/license', wrap(async req => {
  const { name, content } = req.body || {};
  const buf = Buffer.from(content || '', 'base64');
  if (!buf.length) throw new Error('empty license file');
  const text = buf.toString('utf8').replace(/\r/g, '');
  const isKey = /^2\+MII|BEGIN (RSA )?PRIVATE KEY/.test(text.trim()) && !/customer1=/.test(text);
  const file = path.join(ELO, isKey ? 'uploaded-license.pk' : 'elo-license.lic');
  fs.writeFileSync(file, text);
  const fields = isKey ? {} : Object.fromEntries(text.split('\n').filter(l => /^(customer1|product|validThru|usercount\d*|ELO_[A-Z_]+)=/.test(l)).map(l => l.split(/=(.*)/s).slice(0, 2)));
  return { ok: true, name, type: isKey ? 'private-key' : 'license-text', file: path.basename(file), fields,
    note: isKey ? 'Private key: ELO downloads the license from license.services.elo.cloud during setup.' : '' };
}));

// ── Install (background job) ────────────────────────────────────────────────
const SETTINGS = ['ELO_TAG', 'ELO_SEARCH_TAG', 'REPO', 'REPO_LANGUAGE', 'ELO_DISPLAY_NAME', 'ELO_LICENSE_TYPE', 'COMPOSE_PROFILES',
  'AUTH_ADMIN_USERNAME', 'AUTH_ADMIN_PASSWORD', 'AUTH_SERVICE_USERNAME', 'AUTH_SERVICE_PASSWORD', 'DATABASE_USERNAME', 'DATABASE_PASSWORD', 'IX_URL_PUBLIC'];

app.post('/api/install', wrap(async req => {
  const c = req.body || {};
  const lic = fs.existsSync(path.join(ELO, 'elo-license.lic')) ? 'elo-license.lic'
    : fs.existsSync(path.join(ELO, 'uploaded-license.pk')) ? 'uploaded-license.pk' : '';
  const env = Object.fromEntries(SETTINGS.map(k => [k, c[k]]));
  if (lic) env.LICENSE_FILE = lic;
  const exports = Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `export ${k}=${x.shq(v)}`).join('\n');
  return x.startJob('install', `
set -e
export ELO_DIR=${x.shq(ELO_L)}; cd "$ELO_DIR"; tr -d '\\r' < elo.sh > /tmp/elo.sh
${exports}
step() { echo "__STEP__ $*"; }
${c.fresh ? 'step "Removing the previous installation (containers and data volumes)"; bash /tmp/elo.sh down --volumes || true' : ''}
step "Writing configuration (.env)"; bash /tmp/elo.sh env ${c.fresh ? '--force' : ''}
step "Downloading images"; bash /tmp/elo.sh pull 2>&1 | grep -E 'Pulling|Pulled|Error|error' || true
step "Starting the stack"; bash /tmp/elo.sh up
. ./.env
step "Waiting for the repository setup and the services"
for i in $(seq 1 80); do
  sleep 15
  ix=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://localhost:9090/$REPO/ix?cmd=status")
  web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://localhost:9090/$REPO/plugin/de.elo.ix.plugin.proxy/web/")
  setup=$(docker inspect -f '{{.State.Status}}/{{.State.ExitCode}}' elo-ix-setup 2>/dev/null)
  echo "__CHECK__ {\\"ix\\":\\"$ix\\",\\"web\\":\\"$web\\",\\"setup\\":\\"$setup\\",\\"t\\":$((i*15))}"
  case "$setup" in exited/0) [ "$ix" = 200 ] && break ;; exited/*) echo "ix-setup failed:"; docker logs --tail 30 elo-ix-setup; exit 1 ;; esac
done
search=$(curl -sk --max-time 8 -u "$AUTH_SERVICE_USERNAME:$AUTH_SERVICE_PASSWORD" https://localhost:9200/_cluster/health | sed -n 's/.*"status":"\\([a-z]*\\)".*/\\1/p')
echo "__CHECK__ {\\"search\\":\\"\${search:-down}\\"}"
step "Done"`);
}));

// Stream a job log (Server-Sent Events) until "__EXIT__".
app.get('/api/jobs/:id/stream', (req, res) => {
  const log = path.join(x.RUN_DIR, `${path.basename(req.params.id)}.log`);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.flushHeaders();
  let pos = 0, done = false;
  const tick = () => {
    if (done) return;
    let chunk = '';
    try { const fd = fs.openSync(log, 'r'); const st = fs.fstatSync(fd); if (st.size > pos) { const b = Buffer.alloc(st.size - pos); fs.readSync(fd, b, 0, b.length, pos); pos = st.size; chunk = b.toString('utf8'); } fs.closeSync(fd); } catch {}
    for (const line of chunk.split('\n').filter(Boolean)) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
      if (line.startsWith('__EXIT__:')) { done = true; res.end(); return; }
    }
    setTimeout(tick, 1000);
  };
  req.on('close', () => { done = true; });
  tick();
});

// ── Post-install: EULA and Web Client ───────────────────────────────────────
app.post('/api/eula', wrap(async () => {
  const e = readEnv(); if (!e) throw new Error('not installed');
  return acceptEula({ base: await baseUrl(), repo: e.REPO, user: e.AUTH_ADMIN_USERNAME || 'Administrator', pass: e.AUTH_ADMIN_PASSWORD });
}));
app.post('/api/webcheck', wrap(async () => {
  const e = readEnv(); if (!e) throw new Error('not installed');
  return webClientCheck({ base: await baseUrl(), repo: e.REPO, user: e.AUTH_ADMIN_USERNAME || 'Administrator', pass: e.AUTH_ADMIN_PASSWORD });
}));

// ── Administration ──────────────────────────────────────────────────────────
app.get('/api/status', wrap(async () => {
  const e = readEnv();
  const out = await x.sh(`cd ${x.shq(ELO_L)} 2>/dev/null; echo "__PS__"; docker ps -a --filter network=elo-network --format '{{json .}}' 2>/dev/null
echo "__STATS__"; docker stats --no-stream --format '{{json .}}' $(docker ps -q --filter network=elo-network) 2>/dev/null
echo "__MEM__"; free -b | awk '/Mem/ {print $2, $3, $7}'; echo "__DOCKER__"; systemctl is-active docker 2>/dev/null || (pgrep dockerd >/dev/null && echo active)`, 120);
  const sect = n => (out.split(`__${n}__`)[1] || '').split(/__[A-Z]+__/)[0].split('\n').map(s => s.trim()).filter(Boolean);
  const json = l => { try { return JSON.parse(l); } catch { return null; } };
  const stats = Object.fromEntries(sect('STATS').map(json).filter(Boolean).map(s => [s.Name, s]));
  const containers = sect('PS').map(json).filter(Boolean).map(c => ({
    name: c.Names, service: c.Names.replace(/^elo-/, ''), state: c.State, status: c.Status, image: c.Image,
    mem: stats[c.Names]?.MemUsage || '', memPerc: stats[c.Names]?.MemPerc || '', cpu: stats[c.Names]?.CPUPerc || '',
  }));
  const [total, used, avail] = (sect('MEM')[0] || '').split(' ').map(Number);
  const base = await baseUrl();
  const repo = e?.REPO || 'repository';
  return {
    ok: true, installed: !!e, docker: sect('DOCKER')[0] || 'inactive', memory: { total, used, avail }, containers,
    urls: e ? {
      'Web Client': `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/web/`,
      'Admin Console': `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/ac/`,
      'Index Server status': `${base}/${repo}/ix?cmd=status`,
      'IX URL (Java Client / API)': `${base}/${repo}/ix`,
      'Automation Services': base.replace(':9090', ':9060') + '/',
      'Flows': base.replace(':9090', ':9010') + '/',
      'Elasticsearch': base.replace('http:', 'https:').replace(':9090', ':9200') + '/_cluster/health',
    } : {},
    // Shown in the local admin panel only.
    credentials: e ? {
      'ELO administrator': [e.AUTH_ADMIN_USERNAME || 'Administrator', e.AUTH_ADMIN_PASSWORD],
      'ELO service user': [e.AUTH_SERVICE_USERNAME || 'ELO Service', e.AUTH_SERVICE_PASSWORD],
      'Database (PostgreSQL)': [e.DATABASE_USERNAME || 'elodb', e.DATABASE_PASSWORD],
      'Tomcat manager': ['admin', e.AUTH_TOMCAT_PASSWORD],
      'Karaf (flows worker)': ['karaf', e.AUTH_KARAF_PASSWORD],
      'Keystore': ['', e.KEYSTORE_PASSWORD],
    } : {},
    settings: e ? Object.fromEntries(['ELO_TAG', 'ELO_SEARCH_TAG', 'REPO', 'REPO_LANGUAGE', 'ELO_DISPLAY_NAME', 'ELO_LICENSE_TYPE', 'COMPOSE_PROFILES', 'IX_URL_PUBLIC'].map(k => [k, e[k]])) : {},
  };
}));

app.post('/api/service', wrap(async req => {
  const { action, services } = req.body || {};
  if (!['stop', 'start', 'restart'].includes(action)) throw new Error('bad action');
  const list = (services || []).map(s => String(s).replace(/[^a-z0-9-]/g, '')).filter(Boolean);
  if (!list.length) throw new Error('no services');
  return { ok: true, out: await elo(`${action} ${list.join(' ')}`, {}, 300) };
}));

app.get('/api/logs/:svc', wrap(async req => ({ ok: true, out: await elo(`logs ${req.params.svc.replace(/[^a-z0-9-]/g, '')} 300`, {}, 120) })));

app.post('/api/engine', wrap(async req => {
  const { action } = req.body || {};
  if (action === 'stop-stack') return { ok: true, out: await elo('down', {}, 300) };
  if (action === 'start-stack') return { ok: true, out: await elo('up', {}, 600) };
  if (action === 'stop-docker') return { ok: true, out: await x.sh('systemctl stop docker docker.socket 2>&1 || service docker stop 2>&1; echo stopped', 120) };
  if (action === 'start-docker') return { ok: true, out: await x.sh('systemctl start docker 2>&1 || service docker start 2>&1; docker version --format "Docker {{.Server.Version}} running"', 120) };
  throw new Error('bad action');
}));

// Save selected images to tar files (offline copy / backup if they disappear from the registry).
app.post('/api/backup', wrap(async req => {
  const images = (req.body?.images || []).filter(i => /^[\w./:-]+$/.test(i));
  if (!images.length) throw new Error('no images');
  return x.startJob('backup', `set -e; d=${x.shq(ELO_L + '/backup')}; mkdir -p "$d"
for i in ${images.map(x.shq).join(' ')}; do f="$d/$(echo "$i" | tr '/:' '__').tar"; echo "__STEP__ saving $i"; docker save -o "$f" "$i"; ls -lh "$f" | awk '{print "saved", $5, $9}'; done
echo "__STEP__ Done"`);
}));

// Windows: forward the ELO ports from the host network to the WSL IP (portproxy + firewall; elevated).
app.post('/api/expose', wrap(async req => {
  if (!x.IS_WIN) return { ok: true, note: 'On Linux the published Docker ports are already reachable on the host IP.' };
  const ports = (req.body?.ports || Object.values(PORTS)).map(Number).filter(p => p > 0 && p < 65536);
  const ip = (await x.sh('hostname -I | awk \'{print $1}\'', 60)).trim().split(/\s+/)[0];
  const r = await x.ps(ports.map(p => `netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=${p} | Out-Null; ` +
    `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=${p} connectaddress=${ip} connectport=${p} | Out-Null; ` +
    `Remove-NetFirewallRule -DisplayName 'ELO-Docker-${p}' -EA SilentlyContinue; New-NetFirewallRule -DisplayName 'ELO-Docker-${p}' -Direction Inbound -Protocol TCP -LocalPort ${p} -Action Allow -Profile Any | Out-Null`).join('; ') + "; 'EXPOSED'");
  if (!/EXPOSED/.test(r.out)) throw new Error(r.err || 'portproxy failed (run the installer elevated)');
  return { ok: true, ip, ports, note: 'Ports now forward to ELO in WSL (any previous forwarding of these ports, e.g. to a Hyper-V VM, was replaced).' };
}));

app.listen(PORT, () => console.log(`ELO installer: http://localhost:${PORT}`));
