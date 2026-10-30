'use strict';
// ELO on Docker — installer & admin backend. Open http://localhost:3200
// Linux: run as root (or with passwordless sudo). Windows: runs the Linux side in WSL2 (see exec.js);
// "Expose to the network" needs an elevated PowerShell (portproxy + firewall).
const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const x = require('./exec');
const { inventory, fetchCliSecret } = require('../tools/registry-inventory');
const { acceptEula, webClientCheck } = require('./eula');

const PORT = Number(process.env.ELO_INSTALLER_PORT) || 3200;
const ELO = x.ELO_DIR;
const DOCS_DIR = path.join(ELO, '..', '..', 'docs');      // ELO partner documentation copied by the user (git-ignored)
const PORTS = { server: 9090, as: 9060, flows: 9010, search: 9200, 'search-transport': 9204 };
const session = { registry: null };          // { username, secret } kept in memory only

// Installer settings (local file, not committed): cache sources for container images.
const CONFIG_FILE = path.join(x.RUN_DIR, 'elo-installer-config.json');
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return { cacheSources: [] }; } };
// Cache source entries → CACHE_SOURCES for elo.sh: URLs as they are, \\server\share → unc:…, C:\… → /mnt/c/… (WSL).
function cacheSourcesEnv() {
  const mode = x.getMode();
  return (readConfig().cacheSources || []).map(s => String(s).trim()).filter(Boolean).map(s => {
    if (/^(ftp|https?):\/\//i.test(s)) return s;
    if (/^\\\\/.test(s)) return mode === 'ssh' ? null : 'unc:' + s;
    if (/^[A-Za-z]:[\\/]/.test(s)) return mode === 'ssh' ? null : x.toLinux(s.replace(/\//g, '\\'));
    return s;
  }).filter(Boolean).join(';');
}

// ELO tags: v<release>-<major>.<minor>[.<patch>][-suffix]. Newest first: release, major, minor, patch;
// on equal numbers the plain version before its variants (-beta, -debian…). Non-matching tags go last.
function tagKey(tag) {
  const m = String(tag).match(/^v(\d+)-(\d+)(?:\.(\d+))?(?:\.(\d+))?(.*)$/);
  return m ? [1, +m[1], +m[2], +(m[3] || 0), +(m[4] || 0), m[5] ? 0 : 1, m[5]] : [0, 0, 0, 0, 0, 0, tag];
}
function compareTags(a, b) {
  const x = tagKey(a), y = tagKey(b);
  for (let i = 0; i < 6; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return String(x[6]).localeCompare(String(y[6]));
}
// Local cache file name for an image ref (reversible): "/" → "~", ":" → "@".
const cacheName = ref => ref.replace(/\//g, '~').replace(/:/g, '@') + '.tar';
const cacheRef = file => file.replace(/\.tar$/, '').replace(/~/g, '/').replace(/@/g, ':');

// Images present in Docker and in the local cache (backup/*.tar) of the Linux environment.
async function localImages() {
  await x.detect();
  const out = await x.sh(`docker images --format '{{.Repository}}:{{.Tag}}|{{.Size}}' 2>/dev/null; echo "__TAR__"; ` +
    `ls -l --time-style=+%F ${x.shq(x.eloDir() + '/backup')}/*.tar 2>/dev/null | awk '{print $5"|"$6"|"$7}'`, 120);
  const [d, t] = out.split('__TAR__');
  const docker = Object.fromEntries(d.split('\n').map(s => s.trim()).filter(s => s.includes('|')).map(s => s.split('|')));
  const tars = (t || '').split('\n').map(s => s.trim()).filter(Boolean).map(l => { const [size, date, f] = l.split('|'); const file = path.posix.basename(f); return { file, ref: cacheRef(file), size: Number(size), date }; });
  return { docker, tars, cached: new Set(tars.map(x => x.ref)) };
}
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const wrap = fn => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { res.json({ ok: false, error: e.message }); } };

// Run elo.sh (CRLF-safe copy) with optional environment.
const elo = async (args, env = {}, t = 600) => { await x.detect(); return x.sh(
  `export ELO_DIR=${x.shq(x.eloDir())}; ${Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `export ${k}=${x.shq(v)}; `).join('')}` +
  `E=$(mktemp /tmp/elo-XXXXXX); tr -d '\\r' < "$ELO_DIR/elo.sh" > $E; bash $E ${args}`, t); };

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
  if (mode === 'ssh') { const t = x.getTarget(); return `http://${t.host}:${t.portMap?.[9090] || 9090 + (t.portOffset || 0)}`; }
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
    { id: 'linux', label: 'Linux environment', ok: env.mode !== 'none', fix: 'Install WSL2 + Ubuntu (Windows)',
      value: env.mode === 'linux' ? v.os : env.mode === 'ssh' ? `SSH ${env.target.user}@${env.target.host} — ${v.os || '?'}` : `WSL2 ${env.distro || ''} — ${v.os || '?'}` },
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
  const loc = await localImages();
  const repos = inv.projects.flatMap(p => p.repos.map(r => ({
    name: r.name, pulls: r.pulls, description: r.description,
    tags: r.tags.flatMap(t => t.tags.map(tag => {
      const ref = `registry.elo.com/${p.name}/${r.name}:${tag}`;
      return { tag, size: t.size, pushed: t.pushed, os: `${t.os}/${t.arch}`, base: (t.labels.distro || '').replace(/:$/, ''),
        ix: t.labels['com.elo.cloud.version.ix'] || '', local: ref in loc.docker, cached: loc.cached.has(ref) };
    })).sort((a, b) => compareTags(a.tag, b.tag)),
  })));
  return { ok: true, generated: inv.generated, repos, source: 'registry' };
}));

// Configuration: cache sources (folders, network shares, FTP/HTTP URLs with image .tar files).
app.get('/api/config', (_req, res) => {
  const c = readConfig();
  res.json({ ok: true, cacheSources: (c.cacheSources || []).map(s => s.replace(/(\/\/[^:\/@]+:)[^@]+@/, '$1********@')), raw: c.cacheSources || [] });
});
app.post('/api/config', wrap(async req => {
  const list = (req.body?.cacheSources || []).map(s => String(s).trim()).filter(Boolean);
  for (const s of list) if (!/^((ftp|https?):\/\/\S+|\\\\[^\\]+\\\S+|[A-Za-z]:[\\/].*|\/\S*)$/i.test(s)) throw new Error(`not a folder, share or ftp/http URL: ${s}`);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...readConfig(), cacheSources: list }, null, 2));
  return { ok: true, count: list.length };
}));
// Which images of the stack (installation versions) the cache sources contain.
app.post('/api/cache/sources', wrap(async () => {
  await x.detect();
  const out = await elo('sources', { CACHE_SOURCES: cacheSourcesEnv() }, 900);
  const lines = out.split('\n').filter(l => /^(found|missing)/.test(l));
  return { ok: true, lines, found: lines.filter(l => l.startsWith('found')).length, total: lines.length };
}));

// Same shape as the registry inventory, built only from local images + cache (install without registry access).
app.get('/api/local-inventory', wrap(async () => {
  const loc = await localImages();
  const byRepo = {};
  const add = (ref, local, cached, size) => {
    const m = ref.match(/^registry\.elo\.com\/eck-services\/([^:]+):(.+)$/); if (!m) return;
    const e = ((byRepo[m[1]] ||= {}))[m[2]] ||= { tag: m[2], local: false, cached: false, size: null, pushed: '', os: 'linux/amd64', base: '', ix: '' };
    e.local ||= local; e.cached ||= cached; e.size ??= size;
  };
  for (const ref of Object.keys(loc.docker)) add(ref, true, loc.cached.has(ref), null);
  for (const t of loc.tars) add(t.ref, t.ref in loc.docker, true, t.size);
  const repos = Object.entries(byRepo).map(([name, tags]) => ({ name, pulls: null, description: '', tags: Object.values(tags).sort((a, b) => compareTags(a.tag, b.tag)) }));
  return { ok: true, generated: new Date().toISOString(), repos, source: 'local' };
}));

// Save the images of a version (all stack services incl. optional ones) into the local cache.
app.post('/api/cache/save', wrap(async req => {
  const { ELO_TAG, ELO_SEARCH_TAG } = req.body || {};
  if (!/^[\w.-]+$/.test(ELO_TAG || '') || !/^[\w.-]+$/.test(ELO_SEARCH_TAG || '')) throw new Error('bad version');
  await x.detect(); await x.deployRemote();
  return x.startJob('cache', `export ELO_DIR=${x.shq(x.eloDir())} ELO_TAG=${x.shq(ELO_TAG)} ELO_SEARCH_TAG=${x.shq(ELO_SEARCH_TAG)}
cd "$ELO_DIR"; E=$(mktemp /tmp/elo-XXXXXX); tr -d '\\r' < elo.sh > $E
echo "__STEP__ Saving ELO ${ELO_TAG} (+ iSearch ${ELO_SEARCH_TAG}) into the local cache"
# Use a temporary env so the installation's .env (versions) is not changed.
[ -f .env ] && cp .env /tmp/elo-env.bak; sed -i "s/^ELO_TAG=.*/ELO_TAG=$ELO_TAG/; s/^ELO_SEARCH_TAG=.*/ELO_SEARCH_TAG=$ELO_SEARCH_TAG/" .env 2>/dev/null || true
bash $E cache; rc=$?
[ -f /tmp/elo-env.bak ] && cp /tmp/elo-env.bak .env
echo "__STEP__ Done"; exit $rc`);
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
  await x.detect();
  env.CACHE_SOURCES = cacheSourcesEnv();
  const exports = Object.entries(env).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `export ${k}=${x.shq(v)}`).join('\n');
  await x.detect(); await x.deployRemote();
  return x.startJob('install', `
set -e
export ELO_DIR=${x.shq(x.eloDir())}; cd "$ELO_DIR"; E=$(mktemp /tmp/elo-XXXXXX); tr -d '\\r' < elo.sh > $E
${exports}
step() { echo "__STEP__ $*"; }
${c.fresh ? 'step "Removing the previous installation (containers and data volumes)"; bash $E down --volumes || true' : ''}
step "Writing configuration (.env)"; bash $E env ${c.fresh ? '--force' : ''}
step "Getting images (local Docker → local cache → registry)"; bash $E pull
step "Starting the stack"; bash $E up
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

// Executed commands since id (secrets masked) — "terminal commands" panel of each wizard step.
app.get('/api/commands', (req, res) => {
  const all = x.history(0), since = Number(req.query.since) || 0;
  res.json({ ok: true, commands: all.filter(h => h.id > since), last: all.length ? all[all.length - 1].id : 0 });
});

// Read a job log incrementally (scripts/CLI): returns new text from byte position pos.
app.get('/api/jobs/:id/log', wrap(async req => {
  const r = await x.readLog(path.basename(req.params.id), Number(req.query.pos) || 0);
  return { ok: true, chunk: r.chunk, pos: r.pos, done: /__EXIT__:\d/.test(r.chunk) };
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
  const tg = x.getMode() === 'ssh' ? x.getTarget() : null;
  // Same host, another ELO port (VirtualBox NAT forwards to other host ports: portMap).
  const at = p => base.replace(/:\d+$/, ':' + (tg?.portMap?.[p] || p + (tg?.portOffset || 0)));
  return {
    ok: true, installed: !!e, docker: sect('DOCKER')[0] || 'inactive', memory: { total, used, avail }, containers,
    urls: e ? {
      'Web Client': `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/web/`,
      'Admin Console': `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/ac/`,
      'ELO WF (Web Forms)': `${base}/${repo}/plugin/de.elo.ix.plugin.proxy/wf/`,
      'Index Server status': `${base}/${repo}/ix?cmd=status`,
      'IX URL (Java Client / API)': `${base}/${repo}/ix`,
      'Tomcat manager (server)': `${base}/manager/html`,
      'Automation Services': at(9060) + '/',
      'Flows': at(9010) + '/',
      'Elasticsearch (iSearch)': at(9200).replace('http:', 'https:') + '/_cluster/health',
      'pgAdmin': at(5050) + '/',
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
for i in ${images.map(x.shq).join(' ')}; do f="$d/$(echo "$i" | tr '/:' '~@').tar"; echo "__STEP__ saving $i"; docker save -o "$f" "$i"; ls -lh "$f" | awk '{print "saved", $5, $9}'; done
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
  return { ok: true, ...env, isWindows: x.IS_WIN, publicKey: pub, keyPath: SSH_KEY, dockerDesktopInstalled: desktop };
}));
app.post('/api/target', wrap(async req => {
  const { kind, host, port, user, key, targetKind } = req.body || {};
  if (kind !== 'ssh') { x.setTarget(null); return { ok: true, ...(await x.detect()) }; }
  if (!host || !user) throw new Error('host and user required');
  x.setTarget({ host, port, user, key: key || SSH_KEY, kind: targetKind || 'server' });
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
  const backups = sect('TAR').map(l => { const [size, date, file] = l.split('|'); const f = path.posix.basename(file); return { file: f, ref: cacheRef(f), size: Number(size), date }; });
  // Cloud images cached for VM creation (Windows side).
  let vmImages = [];
  try { const d = path.join(require('./provision').VM_DIR, 'cache'); vmImages = fs.readdirSync(d).map(f => ({ file: f, size: fs.statSync(path.join(d, f)).size, date: fs.statSync(path.join(d, f)).mtime.toISOString().slice(0, 10) })); } catch {}
  return { ok: true, images, backups, vmImages };
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
  return x.startJob('license', `export ELO_DIR=${x.shq(x.eloDir())}; E=$(mktemp /tmp/elo-XXXXXX); tr -d '\\r' < "$ELO_DIR/elo.sh" > $E
echo "__STEP__ Applying ${lic} (re-running ix-setup)"; bash $E license ${x.shq(lic)}
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
  // Local package caches are plain folders: the ELO image cache (backup/) and the VM cloud-image cache.
  const folder = { cache: path.join(ELO, 'backup'), vmcache: path.join(require('./provision').VM_DIR, 'cache') }[req.body?.what];
  if (folder) {
    await x.detect();
    if (x.getMode() === 'ssh' && req.body.what === 'cache') return { ok: true, linuxPath: x.REMOTE_DIR + '/backup', note: 'on the SSH target' };
    fs.mkdirSync(folder, { recursive: true });
    if (!x.IS_WIN) return { ok: true, linuxPath: folder };
    const cmd = `Start-Process explorer.exe -ArgumentList '${folder.replace(/'/g, "''")}'`;
    if (x.getMode() === 'wsl-user') await x.getSeatLib().runAsUser(cmd, 60); else await x.ps(cmd);
    return { ok: true, path: folder };
  }
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

// ── ELO installations found on this computer (all runtimes) ─────────────────
// local Docker (WSL/Linux), Docker Desktop, Hyper-V VMs, VirtualBox VMs, the configured SSH server.
const VBOXM = 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe';
const eloState = out => { const m = out.match(/__ELO__ (\d+) (\d+)/); return m ? { running: +m[1], total: +m[2] } : { running: 0, total: 0 }; };
// Docker host probe: ELO container counts, disk used by Docker, and each ELO container with status and ports.
const ELO_PROBE = `echo "__ELO__ $(docker ps -q -f name=^elo- 2>/dev/null | wc -l) $(docker ps -aq -f name=^elo- 2>/dev/null | wc -l)"
echo "__DISK__ $(du -sbc /var/lib/docker /var/lib/containerd 2>/dev/null | tail -1 | cut -f1)"
docker ps -a -f name=^elo- --format '__SVC__ {{.Names}}|{{.Status}}|{{.Ports}}' 2>/dev/null`;
const eloDisk = out => { const m = out.match(/__DISK__ (\d+)/); return m ? +m[1] : null; };
// "0.0.0.0:9090->9090/tcp, [::]:9090->9090/tcp" → "9090→9090/tcp" (IPv4/IPv6 duplicates merged).
const svcList = out => [...out.matchAll(/^__SVC__ ([^|]*)\|([^|]*)\|(.*)$/gm)].map(m => ({ name: m[1], status: m[2].trim(),
  ports: [...new Set(m[3].split(',').map(p => p.trim().replace(/^(0\.0\.0\.0|\[::\]|::):/, '')).filter(Boolean))].join(', ') }));
// TCP ports checked on running VMs (connect test, 800 ms).
const KNOWN_PORTS = { 22: 'SSH', 80: 'HTTP', 443: 'HTTPS', 3389: 'RDP', 5985: 'WinRM', 8080: 'HTTP alt / Tomcat', 9090: 'ELO server (Web Client, IX)',
  9060: 'ELO Automation Services', 9010: 'ELO Flows', 9200: 'iSearch (Elasticsearch)', 5050: 'pgAdmin', 5432: 'PostgreSQL', 1433: 'SQL Server' };
const tcpOpen = (host, port) => new Promise(res => { const s = net.connect({ host, port, timeout: 800 });
  const done = ok => { s.destroy(); res(ok); }; s.on('connect', () => done(true)); s.on('timeout', () => done(false)); s.on('error', () => done(false)); });
async function openPorts(host, ports) {   // ports: [{port, label, hostPort?}]
  const r = await Promise.all(ports.map(async p => ({ ...p, open: await tcpOpen(host, p.hostPort || p.port) })));
  return r.filter(p => p.open);
}
const fileSize = f => { try { return fs.statSync(f).size; } catch { return null; } };

// WSL utility VM (Windows): running = its vmmemWSL process exists (checked without starting WSL).
async function wslInfo() {
  const r = await x.ps(`$p=@(Get-Process vmmemWSL -EA SilentlyContinue); if($p){ "$(($p | Measure-Object WorkingSet64 -Sum).Sum)" } else { 'off' }`, 30000);
  const v = r.out.trim();
  return { running: v !== 'off' && v !== '', memBytes: +v || 0 };
}
// .wslconfig of the user whose WSL the installer uses (the signed-in user in wsl-user mode): [wsl2] memory=<n>GB.
let wslCfgPath = null;
async function wslConfigPath() {
  if (wslCfgPath) return wslCfgPath;
  await x.detect();   // the mode decides whose WSL (and .wslconfig) it is
  if (x.getMode() !== 'wsl-user') return (wslCfgPath = path.join(require('os').homedir(), '.wslconfig'));
  const r = await x.ps(`$u=(Get-CimInstance Win32_ComputerSystem).UserName; $sid=(New-Object Security.Principal.NTAccount($u)).Translate([Security.Principal.SecurityIdentifier]).Value
(Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\$sid").ProfileImagePath`, 30000);
  const home = r.out.trim().split('\n').pop().trim();
  if (!home) throw new Error('profile of the signed-in user not found');
  return (wslCfgPath = path.join(home, '.wslconfig'));
}
function wslMemLimit(text) { const m = /^\s*memory\s*=\s*([\d.]+)\s*(GB|MB)?\s*$/im.exec(text || ''); return m ? (m[2]?.toUpperCase() === 'MB' ? +m[1] / 1024 : +m[1]) : null; }
// Sets memory= in the [wsl2] section (added if missing), keeping the other settings.
function setWslMem(text, gb) {
  const lines = (text || '').split(/\r?\n/); let sec = -1;
  for (let i = 0; i < lines.length; i++) if (/^\s*\[wsl2\]\s*$/i.test(lines[i])) { sec = i; break; }
  if (sec < 0) { lines.push('[wsl2]'); sec = lines.length - 1; }
  let end = lines.length; for (let i = sec + 1; i < lines.length; i++) if (/^\s*\[/.test(lines[i])) { end = i; break; }
  const k = lines.slice(sec + 1, end).findIndex(l => /^\s*memory\s*=/i.test(l));
  if (k >= 0) lines[sec + 1 + k] = `memory=${gb}GB`; else lines.splice(sec + 1, 0, `memory=${gb}GB`);
  return lines.join('\r\n').replace(/(\r\n)+$/, '') + '\r\n';
}

app.get('/api/wsl', wrap(async () => {
  if (!x.IS_WIN) return { ok: true, available: false };
  const w = await wslInfo();
  if (w.running) try { const m = (await x.shLocal(`free -b | awk '/Mem:/{print $2, $3}'`, 60)).trim().split(/\s+/).map(Number); w.totalBytes = m[0]; w.usedBytes = m[1]; } catch {}
  const cfg = await wslConfigPath().catch(() => null);
  const text = cfg && fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
  const hostGB = require('os').totalmem() / 2 ** 30;
  // Without memory= WSL uses 50 % of the host memory.
  return { ok: true, available: true, ...w, distro: x.getDistro(), configPath: cfg, limitGB: wslMemLimit(text), defaultGB: Math.round(hostGB / 2), hostGB: Math.round(hostGB) };
}));
// Shut down WSL (frees its memory; stops Docker and the local ELO stack) or start it again.
app.post('/api/wsl', wrap(async req => {
  if (!x.IS_WIN) throw new Error('Windows only');
  const action = req.body?.action;
  if (action === 'shutdown') {
    // WSL runs one VM per Windows user: shut down the signed-in user's one (and the installer user's, if any).
    const cmd = `wsl.exe --shutdown; 'shut down'`;
    if (x.getMode() === 'wsl-user') await x.getSeatLib().runAsUser(cmd, 120); else await x.ps(cmd, 120000);
    await x.ps(cmd, 120000).catch(() => {});
    return { ok: true, ...(await wslInfo()) };
  }
  if (action === 'start') { await x.shLocal('true', 120); return { ok: true, ...(await wslInfo()) }; }
  if (action === 'memory') {
    // New limit in .wslconfig (backup kept); it applies when WSL starts again (optionally restarted right away).
    const gb = Number(req.body.gb), hostGB = require('os').totalmem() / 2 ** 30;
    if (!(gb >= 2 && gb <= Math.floor(hostGB))) throw new Error(`memory: 2–${Math.floor(hostGB)} GB`);
    const cfg = await wslConfigPath();
    const old = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
    if (old) fs.writeFileSync(cfg + '.bak-elo-installer', old);
    fs.writeFileSync(cfg, setWslMem(old, gb));
    let restarted = false;
    if (req.body.apply) {
      const cmd = `wsl.exe --shutdown; 'shut down'`;
      if (x.getMode() === 'wsl-user') await x.getSeatLib().runAsUser(cmd, 120); else await x.ps(cmd, 120000);
      await x.shLocal('true', 120); restarted = true;
    }
    return { ok: true, configPath: cfg, limitGB: gb, restarted, ...(await wslInfo()) };
  }
  throw new Error('bad action');
}));

// Host memory split by consumer (Windows): WSL utility VM (vmmemWSL; Docker Desktop's Linux side also lives there),
// running Hyper-V VMs (assigned memory), VirtualBox VM processes, Docker Desktop's Windows processes, rest of the system, free.
app.get('/api/hostmem', wrap(async () => {
  if (!x.IS_WIN) {
    const m = (await x.shLocal(`free -b | awk '/Mem:/{print $2, $7}'`, 30)).trim().split(/\s+/).map(Number);
    return { ok: true, total: m[0], free: m[1], parts: [] };
  }
  const r = await x.ps(`$os=Get-CimInstance Win32_OperatingSystem; $o=[ordered]@{ total=[int64]$os.TotalVisibleMemorySize*1KB; free=[int64]$os.FreePhysicalMemory*1KB }
$ws={ param($n) [int64](Get-Process $n -EA SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum }
$o.wsl=& $ws @('vmmemWSL'); $o.vbox=& $ws @('VBoxHeadless','VirtualBoxVM'); $o.desktop=& $ws @('Docker Desktop','com.docker.backend','com.docker.build')
$o.hyperv=@(try { Get-VM -EA Stop | ?{ $_.State -eq 'Running' } | %{ @{ name=$_.Name; bytes=[int64]$_.MemoryAssigned } } } catch {})
ConvertTo-Json -Compress -Depth 3 $o`, 60000);
  const m = JSON.parse(r.out.trim().split('\n').pop());
  const parts = [{ key: 'wsl', bytes: m.wsl }, ...(m.hyperv || []).map(v => ({ key: 'hyperv', name: v.name, bytes: v.bytes })),
    { key: 'vbox', bytes: m.vbox }, { key: 'desktop', bytes: m.desktop }].filter(p => p.bytes > 0);
  const used = m.total - m.free, other = Math.max(0, used - parts.reduce((a, p) => a + p.bytes, 0));
  return { ok: true, total: m.total, free: m.free, parts: [...parts, { key: 'system', bytes: other }] };
}));

// Viewer of an installation: Hyper-V → vmconnect, VirtualBox → its window (VM started with a GUI) or the
// VirtualBox Manager, Docker Desktop → its dashboard, Docker (WSL/SSH) → ELO Web Client in the browser.
async function openViewer(id) {
  const launch = (exe, args) => { require('child_process').spawn(exe, args, { detached: true, stdio: 'ignore' }).unref(); };
  const [kind, name] = String(id).split(/:(.+)/);
  if (kind === 'hyperv') { launch('vmconnect.exe', ['localhost', name]); return { opened: 'vmconnect' }; }
  if (kind === 'vbox') { launch('C:\\Program Files\\Oracle\\VirtualBox\\VirtualBox.exe', []); return { opened: 'VirtualBox Manager' }; }
  if (id === 'desktop') { launch('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe', []); return { opened: 'Docker Desktop' }; }
  const e = await readEnv().catch(() => null);
  return { url: `${await baseUrl()}/${e?.REPO || 'repository'}/plugin/de.elo.ix.plugin.proxy/web/` };
}
app.post('/api/installations/viewer', wrap(async req => ({ ok: true, ...(await openViewer(req.body?.id)) })));

app.get('/api/installations', wrap(async () => {
  const list = [];
  const tgt = x.getTarget();
  const known = Object.entries(KNOWN_PORTS).map(([p, label]) => ({ port: +p, label }));
  const tasks = [];
  // Local Linux side (WSL / native): Docker stack of this installer. A shut-down WSL is not started just to look.
  const wslOff = x.IS_WIN && !(await wslInfo()).running;
  if (wslOff) list.push({ id: 'local', order: 0, name: `WSL ${x.getDistro() || ''}`.trim(), type: 'docker', typeLabel: 'Docker Engine (WSL2)',
    state: 'stopped', detail: 'WSL is shut down', active: !tgt });
  else tasks.push((async () => {
    const out = await x.shLocal(ELO_PROBE, 120);
    const s = eloState(out);
    // Also listed with 0 containers when this installer has an installation (.env) there.
    if (s.total || fs.existsSync(path.join(ELO, '.env'))) list.push({ id: 'local', order: 0, name: x.IS_WIN ? `WSL ${x.getDistro() || ''}`.trim() : 'This machine', type: 'docker',
      typeLabel: x.IS_WIN ? 'Docker Engine (WSL2)' : 'Docker Engine', state: s.running ? 'running' : 'stopped', detail: `${s.running}/${s.total} ELO containers`,
      disk: eloDisk(out), diskNote: 'Docker data', services: svcList(out), active: !tgt });
  })().catch(() => {}));
  if (x.IS_WIN) {
    // Docker Desktop: shown whenever it is installed; state = engine reachable; disk = its data VHDX.
    if (fs.existsSync('C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe')) tasks.push((async () => {
      const dd = await x.run('docker', ['--context', 'desktop-linux', 'ps', '-a', '--filter', 'name=^elo-', '--format', '__SVC__ {{.Names}}|{{.Status}}|{{.Ports}}'], { timeoutMs: 20000 });
      const svcs = dd.code === 0 ? svcList(dd.out) : [], r = svcs.filter(s => /^Up/.test(s.status)).length;
      const vhd = await x.ps(`(Get-ChildItem C:\\Users\\*\\AppData\\Local\\Docker\\wsl -Recurse -Filter *.vhdx -EA SilentlyContinue | Measure-Object Length -Sum).Sum`);
      list.push({ id: 'desktop', order: 1, name: 'Docker Desktop', type: 'desktop', typeLabel: 'Docker Desktop', state: dd.code === 0 ? 'running' : 'stopped',
        detail: dd.code !== 0 ? 'engine not running' : svcs.length ? `${r}/${svcs.length} ELO containers` : 'engine running · no ELO containers',
        disk: +vhd.out.trim() || null, diskNote: 'Docker Desktop data', services: svcs });
    })().catch(() => {}));
    // Hyper-V VMs (all; the installer's ones are marked): RAM, size of the virtual disks, IP and open ports.
    tasks.push((async () => {
      const hv = await x.ps(`try { Get-VM -EA Stop | % { $d=(Get-VMHardDiskDrive -VM $_ | % { if($_.Path -and (Test-Path $_.Path)){ (Get-Item $_.Path).Length } } | Measure-Object -Sum).Sum
$ip=@($_.NetworkAdapters.IPAddresses | ?{ $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]
"$($_.Name)|$($_.State)|$([math]::Round($_.MemoryStartup/1GB,1))|$($_.Path)|$d|$ip|$($_.DynamicMemoryEnabled)" } } catch {}`, 60000);
      await Promise.all(hv.out.trim().split('\n').filter(s => s.includes('|')).map(async l => {
        const [name, state, ram, vpath, disk, ip, dyn] = l.trim().split('|');
        const ours = /hvc-vms/i.test(vpath) || (tgt?.vm === name), running = state === 'Running';
        const item = { id: `hyperv:${name}`, order: 2, name, type: 'hyperv', typeLabel: ours ? `Hyper-V VM · ELO Docker (installer)${tgt?.vm === name && tgt.os ? ' · ' + tgt.os : ''}` : 'Hyper-V VM',
          state: running ? 'running' : state === 'Off' ? 'stopped' : state.toLowerCase(), detail: `${ram} GB RAM${dyn === 'True' ? ' (dynamic)' : ''}${ip ? ' · ' + ip : ''}`, ramGB: +ram,
          disk: +disk || null, diskNote: 'virtual disks', active: tgt?.vm === name };
        if (running && ip) {
          item.ports = await openPorts(ip, known);
          if (tgt?.vm === name) try { item.services = svcList(await x.sh(ELO_PROBE, 30)); } catch {}
        }
        list.push(item);
      }));
    })().catch(() => {}));
    // VirtualBox VMs: disk files, NAT port forwards (open ones listed when running).
    if (fs.existsSync(VBOXM)) tasks.push((async () => {
      const all = await x.run(VBOXM, ['list', 'vms'], { timeoutMs: 30000 }), run = await x.run(VBOXM, ['list', 'runningvms'], { timeoutMs: 30000 });
      const running = new Set([...run.out.matchAll(/"([^"]+)"/g)].map(m => m[1]));
      await Promise.all([...all.out.matchAll(/"([^"]+)"/g)].map(async m => {
        const name = m[1];
        // "<inaccessible>": registered VM whose files are missing — listed without actions.
        if (name === '<inaccessible>') { list.push({ id: `vbox:${name}`, order: 3, name, type: 'vbox', typeLabel: 'VirtualBox VM', state: 'unreachable', detail: '' }); return; }
        const info = (await x.run(VBOXM, ['showvminfo', name, '--machinereadable'], { timeoutMs: 30000 })).out;
        const disks = [...info.matchAll(/^"[^"]+-\d+-\d+"="([^"]+\.(?:vdi|vmdk|vhd|vhdx))"$/gim)].map(d => fileSize(d[1]) || 0);
        const ram = +(info.match(/^memory=(\d+)/m) || [])[1] || 0, vmState = (info.match(/^VMState="([^"]+)"/m) || [])[1] || '';
        const fwd = [...info.matchAll(/^Forwarding\(\d+\)="([^,]*),tcp,[^,]*,(\d+),[^,]*,(\d+)"$/gm)].map(f => ({ port: +f[3], hostPort: +f[2], label: KNOWN_PORTS[f[3]] || f[1] }));
        const item = { id: `vbox:${name}`, order: 3, name, type: 'vbox', typeLabel: /hvc-vms/i.test(info) ? 'VirtualBox VM · ELO Docker (installer)' : 'VirtualBox VM',
          state: vmState === 'running' ? 'running' : vmState === 'saved' ? 'saved' : vmState === 'paused' ? 'paused' : 'stopped', ramGB: ram / 1024,
          detail: ram ? `${Math.round(ram / 102.4) / 10} GB RAM` : '',
          disk: disks.reduce((a, b) => a + b, 0) || null, diskNote: 'virtual disks', active: tgt?.vm === name };
        if (item.state === 'running' && fwd.length) {
          item.ports = await openPorts('127.0.0.1', fwd);
          if (tgt?.vm === name) try { item.services = svcList(await x.sh(ELO_PROBE, 30)); } catch {}
        }
        list.push(item);
      }));
    })().catch(() => {}));
  }
  await Promise.all(tasks);
  // Configured SSH server (not one of the VMs above): ELO containers there.
  if (tgt && !list.some(i => i.active)) {
    let out = '', reach = true;
    try { out = await x.sh(ELO_PROBE, 60); } catch { reach = false; }
    const s = eloState(out);
    list.push({ id: 'ssh', order: 4, name: `${tgt.user}@${tgt.host}`, type: 'ssh', typeLabel: 'Linux server (SSH)', state: !reach ? 'unreachable' : s.running ? 'running' : 'stopped',
      detail: `${s.running}/${s.total} ELO containers`, disk: eloDisk(out), diskNote: 'Docker data', services: svcList(out),
      ports: reach ? await openPorts(tgt.host, known) : [], active: true });
  }
  list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return { ok: true, installations: list };
}));

// Memory of a VM (GB). Hyper-V: VM off; with static memory it is the RAM the VM gets, with dynamic memory its
// startup value. VirtualBox: VM powered off.
app.post('/api/installations/memory', wrap(async req => {
  const { id } = req.body || {}, gb = Number(req.body?.gb);
  const [kind, name] = String(id).split(/:(.+)/);
  if (!name || /['"]/.test(name)) throw new Error('bad id');
  const hostGB = require('os').totalmem() / 2 ** 30;
  if (!(gb >= 1 && gb <= Math.floor(hostGB))) throw new Error(`memory: 1–${Math.floor(hostGB)} GB`);
  if (kind === 'hyperv') {
    const r = await x.ps(`$v=Get-VM -Name '${name}' -EA Stop; if($v.State -ne 'Off'){ throw "the VM must be turned off (now: $($v.State)); a saved VM must be started and shut down first" }
$m=[int64]${gb}*1GB; if($v.DynamicMemoryEnabled){ if($v.MemoryMaximum -lt $m){ Set-VMMemory -VM $v -MaximumBytes $m }; if($v.MemoryMinimum -gt $m){ Set-VMMemory -VM $v -MinimumBytes $m } }
Set-VMMemory -VM $v -StartupBytes $m; $v=Get-VM -Name '${name}'; "memory: $([math]::Round($v.MemoryStartup/1GB,1)) GB$(if($v.DynamicMemoryEnabled){' (dynamic, startup value)'})"`, 120000);
    if (r.err.trim()) throw new Error(r.err.trim().split('\n')[0]);
    return { ok: true, out: r.out.trim() };
  }
  if (kind === 'vbox') {
    const r = await x.run(VBOXM, ['modifyvm', name, '--memory', String(Math.round(gb * 1024))], { timeoutMs: 60000 });
    if (r.code !== 0) throw new Error((r.err || r.out).trim().split('\n').pop() + ' (the VM must be powered off)');
    return { ok: true, out: `memory: ${gb} GB` };
  }
  throw new Error('memory can be changed for Hyper-V and VirtualBox VMs');
}));

app.post('/api/installations/action', wrap(async req => {
  const { id, action, viewer } = req.body || {};
  if (!['start', 'stop', 'save'].includes(action)) throw new Error('bad action');
  if (action === 'save' && !/^(hyperv|vbox):/.test(String(id))) throw new Error('save state: Hyper-V and VirtualBox VMs only');
  const r = await instAction(id, action, viewer);
  // After a start, open the matching viewer (vmconnect, VirtualBox window, Docker Desktop, ELO Web Client).
  if (action === 'start' && viewer && r.ok && !String(id).startsWith('vbox:')) Object.assign(r, await openViewer(id).catch(() => ({})));
  return r;
}));
async function instAction(id, action, viewer) {
  const eloCmd = `export ELO_DIR=${x.shq(x.toLinux(ELO))}; E=$(mktemp /tmp/elo-XXXXXX); tr -d '\\r' < "$ELO_DIR/elo.sh" > $E; bash $E ${action === 'start' ? 'up' : 'stop'}`;
  // stop keeps the containers (start = "up": starts them, or recreates them if they were removed).
  if (id === 'local') return { ok: true, out: await x.shLocal(eloCmd, 900) };
  if (id === 'ssh') return { ok: true, out: await elo(action === 'start' ? 'up' : 'stop', {}, 900) };
  if (id === 'desktop') {   // Docker Desktop itself (its engine); ELO containers there follow their restart policy.
    if (action === 'start') {
      await x.ps(`Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'`);
      for (let i = 0; i < 36; i++) { await new Promise(r => setTimeout(r, 5000)); if ((await x.run('docker', ['--context', 'desktop-linux', 'version'], { timeoutMs: 15000 })).code === 0) return { ok: true, out: 'Docker Desktop engine running' }; }
      return { ok: false, out: 'Docker Desktop did not start within 3 minutes' };
    }
    const r = await x.run('docker', ['desktop', 'stop'], { timeoutMs: 180000 });
    if (r.code !== 0) await x.ps(`Get-Process 'Docker Desktop','com.docker.backend' -EA SilentlyContinue | Stop-Process -Force`);
    return { ok: true, out: (r.out + r.err).trim() || 'Docker Desktop stopped' };
  }
  const [kind, name] = String(id).split(/:(.+)/);
  if (!name || /['"]/.test(name)) throw new Error('bad id');
  // save = freeze the VM (memory to disk, RAM freed); start resumes it exactly there.
  if (kind === 'hyperv') {
    const cmd = { start: `$v=Get-VM -Name '${name}' -EA Stop; if($v.State -eq 'Paused'){ Resume-VM -VM $v } else { Start-VM -VM $v -EA Stop }; 'started'`,
      stop: `Stop-VM -Name '${name}' -Force -EA Stop; 'stopped'`, save: `Save-VM -Name '${name}' -EA Stop; 'state saved'` }[action];
    const r = await x.ps(cmd, 600000);
    return { ok: !r.err.trim(), out: (r.out + r.err).trim() };
  }
  if (kind === 'vbox') {
    // With viewer: "separate" = VM process + its own window (closing the window keeps the VM running).
    const args = { start: ['startvm', name, '--type', viewer ? 'separate' : 'headless'], stop: ['controlvm', name, 'acpipowerbutton'], save: ['controlvm', name, 'savestate'] }[action];
    const r = await x.run(VBOXM, args, { timeoutMs: 300000 });
    return { ok: r.code === 0, out: (r.out + r.err).trim() || (action === 'save' ? 'state saved' : 'OK') };
  }
  throw new Error('unknown installation');
}

// ── Provisioning of targets (Windows): WSL2 + distro, Docker Desktop, Hyper-V, VirtualBox, Ubuntu/Debian VMs ──
const prov = require('./provision');
app.get('/api/provision/status', wrap(() => prov.status()));
app.post('/api/provision/wsl', wrap(async req => x.nodeJob('wsl', log => prov.installWsl(req.body || {}, log))));
app.post('/api/provision/hyperv', wrap(async () => x.nodeJob('hyperv', log => prov.enableHyperV(log))));
app.post('/api/provision/vbox', wrap(async () => x.nodeJob('vbox', log => prov.installVirtualBox(log))));
// Windows Server ISOs (cached evaluation ISOs and own ISOs in the VM cache folder): list, download, serve.
app.get('/api/isos', wrap(async () => ({ ok: true, ...prov.isoList() })));
app.post('/api/isos/download', wrap(async req => x.nodeJob('iso', log => prov.downloadIso(req.body?.id, log))));
app.get('/isos/:file', (req, res) => {
  const it = prov.isoList().isos.find(i => i.cached && i.file === req.params.file);
  if (!it) return res.status(404).send('not found');
  res.download(it.path, it.file);
});
app.post('/api/provision/vm', wrap(async req => {
  const b = req.body || {};
  if (prov.WIN_IMAGES[b.distro]) { if (b.platform !== 'hyperv') throw new Error('Windows Server VMs: Hyper-V only'); return x.nodeJob('winvm', log => prov.createWinVm(b, log, SSH_KEY)); }
  return x.nodeJob('vm', log => prov.createVm(b, log, SSH_KEY));
}));

app.listen(PORT, () => console.log(`ELO installer: http://localhost:${PORT}`));
