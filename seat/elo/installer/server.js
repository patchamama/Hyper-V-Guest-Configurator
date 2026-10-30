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
const ELO = x.ELO_DIR;
const DOCS_DIR = path.join(ELO, '..', '..', 'docs');      // ELO partner documentation copied by the user (git-ignored)
const PORTS = { server: 9090, as: 9060, flows: 9010, search: 9200, 'search-transport': 9204 };
const session = { registry: null };          // { username, secret } kept in memory only
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const wrap = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.json({ ok: false, error: e.message }); } };

// Run elo.sh (CRLF-safe copy) with optional environment.
const elo = async (args, env = {}, t = 600) => { await x.detect(); return x.sh(
  `export ELO_DIR=${x.shq(x.eloDir())}; ${Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `export ${k}=${x.shq(v)}; `).join('')}` +
  `tr -d '\\r' < "$ELO_DIR/elo.sh" > /tmp/elo.sh; bash /tmp/elo.sh ${args}`, t); };

// .env of the installation (local file; on an SSH target read remotely).
async function readEnv() {
  await x.detect();
  let txt = null;
  if (x.getMode() === 'ssh') txt = await x.sh(`cat ${x.REMOTE_DIR}/.env 2>/dev/null`, 30);
  else { try { txt = fs.readFileSync(path.join(ELO, '.env'), 'utf8'); } catch {} }
  if (!txt || !/=/.test(txt)) return null;
  return Object.fromEntries(txt.replace(/\r/g, '').split('\n').filter(l => /^[A-Z_]+=/.test(l))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}

// Base URL to reach the published ports from where this backend runs (WSL IP on Windows, target host over SSH).
async function baseUrl() {
  const { mode } = await x.detect();
  if (mode === 'linux') return 'http://localhost:9090';
  if (mode === 'ssh') return `http://${x.getTarget().host}:9090`;
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
  await x.detect(); await x.deployRemote();
  return x.startJob('install', `
set -e
export ELO_DIR=${x.shq(x.eloDir())}; cd "$ELO_DIR"; tr -d '\\r' < elo.sh > /tmp/elo.sh
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
  const job = path.basename(req.params.id);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.flushHeaders();
  let pos = 0, done = false, rest = '';
  const tick = async () => {
    if (done) return;
    const r = await x.readLog(job, pos).catch(() => ({ chunk: '', pos }));
    pos = r.pos;
    const lines = (rest + r.chunk).split('\n'); rest = lines.pop();   // keep a partial last line for the next read
    for (const line of lines.filter(Boolean)) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
      if (line.startsWith('__EXIT__:')) { done = true; res.end(); return; }
    }
    setTimeout(tick, x.getMode() === 'ssh' ? 2500 : 1000);
  };
  req.on('close', () => { done = true; });
  tick();
});

// ── Post-install: EULA and Web Client ───────────────────────────────────────
app.post('/api/eula', wrap(async () => {
  const e = await readEnv(); if (!e) throw new Error('not installed');
  return acceptEula({ base: await baseUrl(), repo: e.REPO, user: e.AUTH_ADMIN_USERNAME || 'Administrator', pass: e.AUTH_ADMIN_PASSWORD });
}));
app.post('/api/webcheck', wrap(async () => {
  const e = await readEnv(); if (!e) throw new Error('not installed');
  return webClientCheck({ base: await baseUrl(), repo: e.REPO, user: e.AUTH_ADMIN_USERNAME || 'Administrator', pass: e.AUTH_ADMIN_PASSWORD });
}));

// ── ELO IX API test with curl (JSON API: /<repo>/rest/IXServicePortIF/<method>, session via cookie) ──
app.post('/api/ixtest', wrap(async () => {
  const e = await readEnv(); if (!e) throw new Error('not installed');
  const user = e.AUTH_ADMIN_USERNAME || 'Administrator', repo = e.REPO || 'repository';
  const B = `http://localhost:9090/${repo}`, J = `${B}/rest/IXServicePortIF`;
  // In the ECK images the /rest interface allows login for any user; other IXServicePortIF methods answer 401/403
  // there (reserved for internal services), so the test covers the status page and an authenticated login.
  const steps = [
    ['Index Server status page', `curl -s -w '\\nHTTP:%{http_code}' '${B}/ix?cmd=status'`],
    ['IX JSON API: login (POST /rest/IXServicePortIF/login)', `curl -s -X POST -H 'Content-Type: application/json' -d '{"userName":"${user}","userPwd":"$P","clientComputer":"elo-installer","runAsUser":""}' '${J}/login'`],
  ];
  // Password passed via the environment of the script (never in the returned commands).
  const script = `P=${x.shq(e.AUTH_ADMIN_PASSWORD)}\n` + steps.map(([, c], i) =>
    `echo "__S${i}__"; t0=$(date +%s%N); out=$(${c.replace('"userPwd":"$P"', `"userPwd":"'"$P"'"`)} 2>&1); echo "$out" | head -c 60000; echo; echo "__T${i}__ $(( ($(date +%s%N)-t0)/1000000 ))"`).join('\n');
  const out = await x.sh(script, 120);
  const text = h => h.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return { ok: true, steps: steps.map(([name, cmd], i) => {
    const part = (out.split(`__S${i}__`)[1] || '').split(/__T\d+__/)[0].trim();
    const ms = Number(((out.split(`__T${i}__`)[1] || '').trim().split(/\s/)[0]) || 0);
    let ok = false, summary = part.slice(0, 300), raw = part.slice(0, 1200);
    if (i === 0) {
      const code = (part.match(/HTTP:(\d+)/) || [])[1], t = text(part.replace(/HTTP:\d+$/, ''));
      const ver = (t.match(/(?:Version|version)\s*:?\s*([\d.]{8,})/) || [])[1];
      ok = code === '200'; summary = `HTTP ${code}${/Running/.test(t) ? ' · Running' : ''}${ver ? ' · IX ' + ver : ''}`; raw = t.slice(0, 600);
    } else {
      try {
        const j = JSON.parse(part); const r = j.result || {};
        ok = !j.exception;
        summary = j.exception ? j.exception : `user ${r.user?.name} (id ${r.user?.id}) · ${(r.user?.groupList || []).length} groups · client types ${(r.clientInfo?.userProductClientTypes || []).join(',')} · ticket lifetime ${r.ticketLifetime}s`;
        raw = JSON.stringify({ ...j, result: j.result ? { clientInfo: r.clientInfo, ticketLifetime: r.ticketLifetime, user: { id: r.user?.id, name: r.user?.name, groupList: r.user?.groupList } } : undefined }, null, 1);
      } catch { ok = false; }
    }
    return { name, ok, ms, curl: cmd.replace('$P', '********'), summary, raw };
  }) };
}));

// ── Administration ──────────────────────────────────────────────────────────
app.get('/api/status', wrap(async () => {
  const e = await readEnv();
  const out = await x.sh(`cd ${x.shq(x.eloDir())} 2>/dev/null; echo "__PS__"; docker ps -a --filter network=elo-network --format '{{json .}}' 2>/dev/null
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
      'ELO WF (Web Forms)': `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/wf/`,
      'Index Server status': `${base}/${repo}/ix?cmd=status`,
      'IX URL (Java Client / API)': `${base}/${repo}/ix`,
      'Tomcat manager (server)': `${base}/manager/html`,
      'Automation Services': base.replace(':9090', ':9060') + '/',
      'Flows': base.replace(':9090', ':9010') + '/',
      'Elasticsearch (iSearch)': base.replace('http:', 'https:').replace(':9090', ':9200') + '/_cluster/health',
      'pgAdmin': base.replace(':9090', ':5050') + '/',
      'This installer': `http://localhost:${PORT}/`,
    } : {},
    javaClient: e ? { ixUrl: `${base}/${repo}/ix`, user: e.AUTH_ADMIN_USERNAME || 'Administrator',
      note: 'ELO Java Client: add a profile with this IX URL (download the client from the ELO partner portal; on Linux see the OpS letter "Installing ELO on Ubuntu").' } : null,
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
  if (action === 'restart-stack') return { ok: true, out: await elo('restart', {}, 600) };
  if (action === 'start-stack') return { ok: true, out: await elo('up', {}, 600) };
  if (action === 'stop-docker') return { ok: true, out: await x.sh('systemctl stop docker docker.socket 2>&1 || service docker stop 2>&1; echo stopped', 120) };
  if (action === 'start-docker') return { ok: true, out: await x.sh('systemctl start docker 2>&1 || service docker start 2>&1; docker version --format "Docker {{.Server.Version}} running"', 120) };
  throw new Error('bad action');
}));

// Save selected images to tar files (offline copy / backup if they disappear from the registry).
app.post('/api/backup', wrap(async req => {
  const images = (req.body?.images || []).filter(i => /^[\w./:-]+$/.test(i));
  if (!images.length) throw new Error('no images');
  await x.detect();
  return x.startJob('backup', `set -e; d=${x.shq(x.eloDir() + '/backup')}; mkdir -p "$d"
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

// ── Installation target ─────────────────────────────────────────────────────
// wsl (WSL2 + Docker Engine in the distro; Docker Desktop with WSL integration uses the same path), linux (native),
// ssh (Hyper-V VM, Oracle VirtualBox VM or any Ubuntu/Debian server reachable over SSH with a key).
const SSH_KEY = path.join(x.RUN_DIR, 'elo-installer-key');
app.get('/api/target', wrap(async () => {
  const env = await x.detect();
  const pub = fs.existsSync(SSH_KEY + '.pub') ? fs.readFileSync(SSH_KEY + '.pub', 'utf8').trim() : null;
  let desktop = false;
  if (x.IS_WIN) desktop = fs.existsSync('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe');
  return { ok: true, ...env, publicKey: pub, keyPath: SSH_KEY, dockerDesktopInstalled: desktop };
}));
app.post('/api/target', wrap(async req => {
  const { kind, host, port, user, key } = req.body || {};
  if (kind !== 'ssh') { x.setTarget(null); return { ok: true, ...(await x.detect()) }; }
  if (!host || !user) throw new Error('host and user required');
  x.setTarget({ host, port, user, key: key || SSH_KEY });
  const env = await x.detect();
  const info = await x.sh(`. /etc/os-release; echo "$PRETTY_NAME | $(nproc) CPU | $(awk '/MemTotal/{printf "%.1f GB", $2/1048576}' /proc/meminfo) | docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo missing)"`, 60);
  return { ok: true, ...env, info: info.trim() };
}));
// SSH key for the remote target (ed25519, no passphrase); its public part goes to ~/.ssh/authorized_keys on the VM.
app.post('/api/target/key', wrap(async () => {
  if (!fs.existsSync(SSH_KEY)) {
    const r = await x.run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'elo-installer', '-f', SSH_KEY], { timeoutMs: 30000 });
    if (r.code !== 0) throw new Error('ssh-keygen failed: ' + r.err);
  }
  return { ok: true, publicKey: fs.readFileSync(SSH_KEY + '.pub', 'utf8').trim(), keyPath: SSH_KEY };
}));
// Docker Desktop (Windows): signed installer; afterwards enable "WSL integration" for the distro in its settings.
app.post('/api/install-docker-desktop', wrap(async () => {
  if (!x.IS_WIN) throw new Error('Windows only');
  const r = await x.ps(`$f=Join-Path $env:TEMP 'DockerDesktopInstaller.exe'; Invoke-WebRequest 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe' -OutFile $f -UseBasicParsing; ` +
    `if((Get-AuthenticodeSignature $f).Status -ne 'Valid'){ 'BADSIG'; exit }; Start-Process $f -ArgumentList 'install','--quiet','--accept-license' -Wait; 'DONE'`, 1800000);
  if (/BADSIG/.test(r.out)) throw new Error('installer signature is not valid');
  if (!/DONE/.test(r.out)) throw new Error(r.err || 'installation failed');
  return { ok: true, note: 'Docker Desktop installed. Open it → Settings → Resources → WSL integration → enable your distro; then use the WSL target.' };
}));

// ── Help: documentation files and links ─────────────────────────────────────
app.get('/api/docs', wrap(async () => {
  const list = d => { try { return fs.readdirSync(d).filter(f => /\.(pdf|md|txt|html)$/i.test(f)); } catch { return []; } };
  return { ok: true,
    local: [
      ...['README.md', 'elo-docker-list.md'].filter(f => fs.existsSync(path.join(ELO, f))).map(f => ({ name: f, url: `/help/elo/${encodeURIComponent(f)}`, where: 'project' })),
      ...list(DOCS_DIR).map(f => ({ name: f, url: `/help/docs/${encodeURIComponent(f)}`, where: 'docs/' })),
    ],
    online: [
      ['ELO registry (images)', 'https://registry.elo.com'],
      ['ELO images for Docker (25 LTS)', 'https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/'],
      ['Deploy a repository with docker-compose', 'https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/getting-started/docker-compose.html'],
      ['ELO Cloud on Kubernetes', 'https://docs.elo.com/ops/eck/en-us/getting-started/'],
      ['ELO system requirements', 'https://docs.elo.com/ops/requirements/pdf/en-us_ops-requirements_overview.pdf'],
      ['pgAdmin documentation', 'https://www.pgadmin.org/docs/pgadmin4/latest/'],
    ].map(([name, url]) => ({ name, url })) };
}));
app.use('/help/elo', express.static(ELO, { index: false, setHeaders: r => r.set('Content-Type', 'text/plain; charset=utf-8') }));
app.use('/help/docs', express.static(DOCS_DIR, { index: false }));

// ── Installed images ────────────────────────────────────────────────────────
app.get('/api/images', wrap(async () => {
  const out = await x.sh(`echo "__IMG__"; docker images --format '{{json .}}' 2>/dev/null
echo "__USED__"; docker ps -a --format '{{.Image}}|{{.Names}}|{{.State}}' 2>/dev/null
echo "__TAR__"; ls -l --time-style=+%F ${x.shq(x.eloDir() + '/backup')}/*.tar 2>/dev/null | awk '{print $5"|"$6"|"$7}'`, 120);
  const sect = n => (out.split(`__${n}__`)[1] || '').split(/__[A-Z]+__/)[0].split('\n').map(s => s.trim()).filter(Boolean);
  const used = {};
  for (const l of sect('USED')) { const [img, name, st] = l.split('|'); (used[img] ||= []).push(`${name} (${st})`); }
  const images = sect('IMG').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .filter(i => /registry\.elo\.com|postgres|pgadmin|hvc-seat|guacamole/.test(i.Repository))
    .map(i => ({ ref: `${i.Repository}:${i.Tag}`, id: i.ID, size: i.Size, created: i.CreatedSince, usedBy: used[`${i.Repository}:${i.Tag}`] || [] }));
  const backups = sect('TAR').map(l => { const [size, date, file] = l.split('|'); return { file: path.posix.basename(file), size: Number(size), date }; });
  return { ok: true, images, backups };
}));
app.post('/api/images/remove', wrap(async req => {
  const refs = (req.body?.refs || []).filter(r => /^[\w./:-]+$/.test(r));
  return { ok: true, out: await x.sh(refs.map(r => `docker rmi ${x.shq(r)} 2>&1`).join('\n'), 300) };
}));
app.post('/api/images/load', wrap(async req => {
  const file = path.posix.basename(String(req.body?.file || ''));
  if (!/\.tar$/.test(file)) throw new Error('bad file');
  await x.detect();
  return x.startJob('load', `docker load -i ${x.shq(x.eloDir() + '/backup/' + file)}`);
}));

// ── All containers (ELO and others) with details; single-container actions ──
app.get('/api/containers', wrap(async () => {
  const out = await x.sh(`docker ps -a --size --format '{{json .}}' 2>/dev/null; echo "__STATS__"; docker stats --no-stream --format '{{json .}}' 2>/dev/null`, 180);
  const [ps, st] = out.split('__STATS__');
  const json = s => s.split('\n').map(l => { try { return JSON.parse(l.trim()); } catch { return null; } }).filter(Boolean);
  const stats = Object.fromEntries(json(st || '').map(s => [s.Name, s]));
  return { ok: true, containers: json(ps).map(c => ({
    name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports, created: c.RunningFor, size: c.Size,
    networks: c.Networks, mem: stats[c.Names]?.MemUsage || '', cpu: stats[c.Names]?.CPUPerc || '', elo: /^elo-/.test(c.Names),
  })) };
}));
app.post('/api/container', wrap(async req => {
  const { action, name } = req.body || {};
  if (!['start', 'stop', 'restart', 'rm'].includes(action) || !/^[\w.-]+$/.test(name || '')) throw new Error('bad request');
  return { ok: true, out: await x.sh(`docker ${action === 'rm' ? 'rm -f' : action} ${x.shq(name)} 2>&1`, 300) };
}));

// ── License update on an existing installation ──────────────────────────────
app.post('/api/license/apply', wrap(async () => {
  const lic = ['elo-license.lic', 'uploaded-license.pk'].find(f => fs.existsSync(path.join(ELO, f)));
  if (!lic) throw new Error('upload a license first');
  await x.detect(); await x.deployRemote();
  return x.startJob('license', `export ELO_DIR=${x.shq(x.eloDir())}; tr -d '\\r' < "$ELO_DIR/elo.sh" > /tmp/elo.sh
echo "__STEP__ Applying ${lic} (re-running ix-setup)"; bash /tmp/elo.sh license ${x.shq(lic)}
echo "__STEP__ Done"`);
}));

// ── Optional services (as | flows | pgadmin) ────────────────────────────────
app.post('/api/optional', wrap(async req => {
  const { name, enable } = req.body || {};
  if (!['as', 'flows', 'pgadmin'].includes(name)) throw new Error('unknown optional service');
  return { ok: true, out: await elo(`${enable ? 'enable' : 'disable'} ${name}`, {}, 900) };
}));

// ── Open folders: logs, archive files, data (Docker volumes) ────────────────
app.post('/api/open', wrap(async req => {
  const vol = { logs: 'logs', archive: 'repository-basis', system: 'repository-system', data: 'data-ix' }[req.body?.what];
  if (!vol) throw new Error('unknown folder');
  // Docker volume of the compose project; make it readable for the file manager (test environment).
  const mp = (await x.sh(`v=$(docker volume ls -q | grep -E '_${vol}$' | head -1); m=$(docker volume inspect -f '{{.Mountpoint}}' "$v" 2>/dev/null); ` +
    `[ -n "$m" ] && chmod o+x /var/lib/docker /var/lib/docker/volumes "$(dirname "$m")" 2>/dev/null; [ -n "$m" ] && chmod -R o+rX "$m" 2>/dev/null; echo "$m"`, 120)).trim().split('\n').pop();
  if (!mp) throw new Error(`volume ${vol} not found`);
  const mode = x.getMode();
  if (mode === 'wsl' || mode === 'wsl-user') {
    const win = `\\\\wsl.localhost\\${x.getDistro()}${mp.replace(/\//g, '\\')}`;
    const cmd = `Start-Process explorer.exe -ArgumentList '${win.replace(/'/g, "''")}'`;
    if (mode === 'wsl-user') await x.getSeatLib().runAsUser(cmd, 60); else await x.ps(cmd);
    return { ok: true, path: win, linuxPath: mp };
  }
  if (mode === 'linux') { await x.sh(`(command -v xdg-open && sudo -u "\${SUDO_USER:-root}" xdg-open ${x.shq(mp)}) >/dev/null 2>&1 &`, 20); return { ok: true, linuxPath: mp }; }
  return { ok: true, linuxPath: mp, note: `On the SSH target: ${mp}` };
}));

// ── Provisioning of targets (Windows): WSL2 + distro, Docker Desktop, Hyper-V, VirtualBox, Ubuntu/Debian VMs ──
const prov = require('./provision');
app.get('/api/provision/status', wrap(() => prov.status()));
app.post('/api/provision/wsl', wrap(async req => x.nodeJob('wsl', log => prov.installWsl(req.body || {}, log))));
app.post('/api/provision/hyperv', wrap(async () => x.nodeJob('hyperv', log => prov.enableHyperV(log))));
app.post('/api/provision/vbox', wrap(async () => x.nodeJob('vbox', log => prov.installVirtualBox(log))));
app.post('/api/provision/vm', wrap(async req => x.nodeJob('vm', log => prov.createVm(req.body || {}, log, SSH_KEY))));

app.listen(PORT, () => console.log(`ELO installer: http://localhost:${PORT}`));
