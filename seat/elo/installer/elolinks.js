'use strict';
// ELO links for Windows machines (Hyper-V VMs through PowerShell Direct, VirtualBox through guest control):
//  scan  – finds the ELO folder on every drive (C:\ELO, D:\ELO …), ELO\prog\serversetup2\setup.bat, the Tomcat servers in
//          ELO\servers (webapps ix-<repo>, web-<repo>, wf-<repo>, as-<repo>; ports from conf\server.xml), the ELO clients and the
//          browsers (Chrome, Edge, Firefox), and says what was found and what was not;
//  apply – creates desktop shortcuts (.url / .lnk) and adds the web apps to the bookmarks bar of Chrome / Edge (folder "ELO",
//          existing entries are kept) and of Firefox (distribution\policies.json), skipping what already exists.
// "Server Application status" = setup.bat --status (opens the status of all ELO applications in the browser).
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const x = require('./exec');
const machines = require('./machines');

const SCAN_PS = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$r = [ordered]@{ host = $env:COMPUTERNAME.ToLower(); os = (Get-CimInstance Win32_OperatingSystem).Caption; elo = @(); setup = $null; servers = @(); clients = [ordered]@{}; browsers = [ordered]@{}; bookmarks = @(); desktop = @(); firefoxDist = $null }
foreach ($d in Get-PSDrive -PSProvider FileSystem) { $p = "$($d.Name):\ELO"; if (Test-Path $p) { $r.elo += $p } }
foreach ($p in $r.elo) { $s = "$p\prog\serversetup2\setup.bat"; if (Test-Path $s) { $r.setup = $s; break } }
foreach ($p in $r.elo) { Get-ChildItem "$p\servers" -Directory | % {
  $wa = "$($_.FullName)\webapps"; $conf = "$($_.FullName)\conf\server.xml"; if (-not (Test-Path $wa)) { return }
  $https = $null; $http = $null
  if (Test-Path $conf) { try { $xml = [xml](Get-Content $conf -Raw); foreach ($c in @($xml.Server.Service.Connector)) {
      if ($c.protocol -like 'AJP*') { continue }
      if ($c.SSLEnabled -eq 'true') { if (-not $https) { $https = [int]$c.port } } elseif (-not $http -and [int]$c.port -notin 8443,8009) { $http = [int]$c.port } } } catch {} }
  $svc = Get-Service -Name $_.Name -ErrorAction SilentlyContinue
  $r.servers += [ordered]@{ name = $_.Name; dir = $_.FullName; apps = @(Get-ChildItem $wa -Directory | % Name); https = $https; http = $http; service = if ($svc) { "$($svc.Status)" } else { $null } } } }
foreach ($e in @(@('javaClient','C:\Program Files\ELO Java Client\ELOclient.exe'), @('javaClientBat','C:\Program Files\ELO Java Client\EloClient.bat'), @('dropzone','C:\Program Files\ELO Java Client\Dropzone\StartDropzone.exe'),
    @('desktopClient','C:\Program Files\ELO Digital Office\ELO Desktop\ELO Desktop Client.exe'), @('javaClient86','C:\Program Files (x86)\ELO Java Client\ELOclient.exe'))) { if (Test-Path $e[1]) { $r.clients[$e[0]] = $e[1] } }
foreach ($e in @(@('chrome','C:\Program Files\Google\Chrome\Application\chrome.exe'), @('chrome','C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'), @('edge','C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
    @('edge','C:\Program Files\Microsoft\Edge\Application\msedge.exe'), @('firefox','C:\Program Files\Mozilla Firefox\firefox.exe'), @('firefox','C:\Program Files (x86)\Mozilla Firefox\firefox.exe'))) { if ((Test-Path $e[1]) -and -not $r.browsers[$e[0]]) { $r.browsers[$e[0]] = $e[1] } }
if ($r.browsers['firefox']) { $r.firefoxDist = (Split-Path $r.browsers['firefox']) + '\distribution\policies.json' }
foreach ($u in Get-ChildItem C:\Users -Directory | ? { $_.Name -notin 'Public','Default','Default User','All Users' }) {
  foreach ($b in @(@('chrome', "$($u.FullName)\AppData\Local\Google\Chrome\User Data"), @('edge', "$($u.FullName)\AppData\Local\Microsoft\Edge\User Data"))) {
    foreach ($prof in Get-ChildItem $b[1] -Directory | ? { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }) { $f = "$($prof.FullName)\Bookmarks"; if (Test-Path $f) { $r.bookmarks += [ordered]@{ browser = $b[0]; user = $u.Name; profile = $prof.Name; file = $f } } } } }
foreach ($d in @('C:\Users\Public\Desktop') + @(Get-ChildItem C:\Users -Directory | % { "$($_.FullName)\Desktop" })) { if (Test-Path $d) { Get-ChildItem $d -File | ? { $_.Extension -in '.lnk','.url' } | % { $e = ''
  if ($_.Extension -eq '.lnk') { $s = (New-Object -ComObject WScript.Shell).CreateShortcut($_.FullName); $e = "$($s.TargetPath) $($s.Arguments)" } else { $e = (Select-String -Path $_.FullName -Pattern '^URL=' | % { $_.Line -replace '^URL=','' }) }
  if ("$($_.Name) $e" -match 'ELO|ix-|serversetup') { $r.desktop += [ordered]@{ dir = $d; name = $_.Name; to = "$e" } } } } }
$r | ConvertTo-Json -Depth 7 -Compress
`;

const APPLY_PS = String.raw`
$ErrorActionPreference = 'Continue'
$in = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:HVC_IN)) | ConvertFrom-Json
$out = [ordered]@{ shortcuts = @(); bookmarks = @(); notes = @() }
$wsh = New-Object -ComObject WScript.Shell
foreach ($dir in @($in.desktopDirs)) {
  if (-not $in.dryRun) { New-Item -ItemType Directory -Force $dir | Out-Null }
  foreach ($it in @($in.items)) {
    $file = Join-Path $dir ($it.name + $(if ($it.kind -eq 'web') { '.url' } else { '.lnk' }))
    if ((Test-Path $file) -and -not $in.overwrite) { $out.shortcuts += [ordered]@{ name = $it.name; dir = $dir; result = 'exists' }; continue }
    if ($in.dryRun) { $out.shortcuts += [ordered]@{ name = $it.name; dir = $dir; result = 'would-create' }; continue }
    try {
      if ($it.kind -eq 'web') { Set-Content -Path $file -Value "[InternetShortcut]` + "`r`n" + String.raw`URL=$($it.url)" -Encoding ASCII }
      else { $s = $wsh.CreateShortcut($file); $s.TargetPath = $it.target; if ($it.args) { $s.Arguments = $it.args }; $s.WorkingDirectory = Split-Path $it.target; $s.Save() }
      $out.shortcuts += [ordered]@{ name = $it.name; dir = $dir; result = 'created' }
    } catch { $out.shortcuts += [ordered]@{ name = $it.name; dir = $dir; result = "error: $($_.Exception.Message)" } }
  } }
function AllNodes($n) { if ($null -eq $n) { return }; $n; foreach ($c in @($n.children)) { if ($null -ne $c) { AllNodes $c } } }
function ChromeTime { [string][long](([DateTime]::UtcNow - [DateTime]'1601-01-01').TotalSeconds * 1000000) }
foreach ($b in @($in.bookmarkFiles)) {
  $procName = if ($b.browser -eq 'chrome') { 'chrome' } else { 'msedge' }
  $file = $b.file
  if ($in.testDir) { New-Item -ItemType Directory -Force $in.testDir | Out-Null; $file = Join-Path $in.testDir ("$($b.browser)-$($b.user)-Bookmarks.json"); Copy-Item $b.file $file -Force }
  elseif (-not $in.dryRun -and (Get-Process $procName -ErrorAction SilentlyContinue)) {
    if ($in.closeBrowsers) { Get-Process $procName -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2 }
    elseif (-not $in.closeBrowsers) { $out.bookmarks += [ordered]@{ browser = $b.browser; user = $b.user; result = "skipped: $procName is running (close it, or tick 'close browsers')" }; continue } }
  try {
    $j = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
    $bar = $j.roots.bookmark_bar; $maxId = 0; $urls = @{}; $names = @{}
    foreach ($root in @($j.roots.bookmark_bar, $j.roots.other, $j.roots.synced)) { if ($root) { foreach ($n in AllNodes $root) { if ([int]$n.id -gt $maxId) { $maxId = [int]$n.id } } } }
    $folder = @($bar.children) | ? { $_.type -eq 'folder' -and $_.name.Trim() -eq 'ELO' } | Select-Object -First 1
    $created = $false
    if (-not $folder) { $maxId++; $folder = [pscustomobject]@{ children = @(); date_added = (ChromeTime); date_modified = (ChromeTime); id = "$maxId"; name = 'ELO'; type = 'folder' }; $created = $true }
    foreach ($n in AllNodes $folder) { if ($n.url) { $urls[$n.url] = 1; $names[$n.name.Trim()] = 1 } }
    $added = @(); $had = @()
    foreach ($it in @($in.items) | ? { $_.kind -eq 'web' }) {
      if ($urls.ContainsKey($it.url) -or $names.ContainsKey($it.name.Trim())) { $had += $it.name; continue }
      $maxId++; $folder.children = @($folder.children) + [pscustomobject]@{ date_added = (ChromeTime); id = "$maxId"; name = $it.name; type = 'url'; url = $it.url }; $added += $it.name }
    if ($created) { $bar.children = @($bar.children) + $folder }
    if ($added.Count -and -not $in.dryRun) {
      Copy-Item $file "$file.bak-elo-installer" -Force
      $j.PSObject.Properties.Remove('checksum')   # Chrome/Edge recompute it
      [IO.File]::WriteAllText($file, ($j | ConvertTo-Json -Depth 60 -Compress), (New-Object Text.UTF8Encoding $false))
    }
    $out.bookmarks += [ordered]@{ browser = $b.browser; user = $b.user; profile = $b.profile; file = $file; added = $added; alreadyThere = $had; result = if ($in.dryRun) { 'dry-run' } elseif ($added.Count) { 'updated' } else { 'nothing to add' } }
  } catch { $out.bookmarks += [ordered]@{ browser = $b.browser; user = $b.user; result = "error: $($_.Exception.Message)" } }
}
if ($in.firefoxDist) {
  $items = @($in.items) | ? { $_.kind -eq 'web' }
  try {
    $f = if ($in.testDir) { Join-Path $in.testDir 'firefox-policies.json' } else { $in.firefoxDist }
    $pol = if (Test-Path $f) { Get-Content $f -Raw | ConvertFrom-Json } else { [pscustomobject]@{ policies = [pscustomobject]@{} } }
    $have = @($pol.policies.Bookmarks) | ? { $_ } | % { $_.URL }
    $new = @($items | ? { $have -notcontains $_.url } | % { [pscustomobject]@{ Title = $_.name; URL = $_.url; Placement = 'toolbar'; Folder = 'ELO' } })
    if ($new.Count -and -not $in.dryRun) {
      New-Item -ItemType Directory -Force (Split-Path $f) | Out-Null
      $pol.policies | Add-Member -NotePropertyName Bookmarks -NotePropertyValue (@($pol.policies.Bookmarks) | ? { $_ } | % { $_ }) -Force
      $pol.policies.Bookmarks = @($pol.policies.Bookmarks) + $new
      [IO.File]::WriteAllText($f, ($pol | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false))
    }
    $out.bookmarks += [ordered]@{ browser = 'firefox'; user = '(all users)'; file = $f; added = @($new | % Title); result = if ($in.dryRun) { 'dry-run' } elseif ($new.Count) { 'updated' } else { 'nothing to add' } }
  } catch { $out.bookmarks += [ordered]@{ browser = 'firefox'; result = "error: $($_.Exception.Message)" } }
}
$out | ConvertTo-Json -Depth 7 -Compress
`;

module.exports = function register({ app, wrap, terminals, localOnly }) {
  // Runs a PowerShell script on a Windows machine and returns the JSON on its last line.
  async function runWindows(id, script, env = {}) {
    const m = await terminals.resolve(id);
    if (m.os !== 'windows') throw new Error('not a Windows machine');
    const file = path.join(x.RUN_DIR, `elolinks-${Date.now().toString(36)}.ps1`);
    fs.writeFileSync(file, script, 'utf8');
    const [kind, name] = id.split(/:(.+)/);
    try {
      let out;
      if (kind === 'hyperv') {
        out = await new Promise((res, rej) => {
          const p = cp.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$body=[IO.File]::ReadAllText('${file.replace(/'/g, "''")}'); ` +
            `$ErrorActionPreference='Stop'; $c=New-Object PSCredential($env:HVC_USER,(ConvertTo-SecureString $env:HVC_PW -AsPlainText -Force)); ` +
            `Invoke-Command -VMName '${name.replace(/'/g, "''")}' -Credential $c -ArgumentList $env:HVC_IN,$body -ScriptBlock { param($i,$b) $env:HVC_IN=$i; & ([scriptblock]::Create($b)) }`],
            { env: { ...process.env, HVC_USER: m.user, HVC_PW: m.password, HVC_IN: env.HVC_IN || '' }, windowsHide: true });
          let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d);
          p.on('close', code => code === 0 ? res(o) : rej(new Error((e || o).trim().split('\n').slice(0, 3).join(' '))));
        });
      } else {   // VirtualBox guest control (needs Guest Additions and a user with a password)
        const ps = fs.readFileSync(file, 'utf8');
        const enc = Buffer.from(`$env:HVC_IN='${(env.HVC_IN || '').replace(/'/g, "''")}'\n` + ps, 'utf16le').toString('base64');
        const r = await x.run('C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe', ['guestcontrol', name, 'run', '--username', m.user, '--password', m.password, '--exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '--wait-stdout', '--', 'powershell.exe', '-NoProfile', '-EncodedCommand', enc], { timeoutMs: 300000 });
        if (r.code !== 0) throw new Error((r.err || r.out).trim().split('\n').pop());
        out = r.out;
      }
      const line = out.trim().split('\n').filter(l => l.startsWith('{')).pop();
      if (!line) throw new Error('no result from the machine: ' + out.trim().slice(-300));
      return JSON.parse(line);
    } finally { try { fs.unlinkSync(file); } catch {} }
  }

  // What to create from a scan: only things that were found.
  function buildPlan(scan) {
    const items = [], multi = new Set();
    const baseOf = s => s.https ? `https://${scan.host}:${s.https}` : s.http ? `http://${scan.host}:${s.http}` : null;
    const ixServers = scan.servers.filter(s => s.apps.some(a => /^ix-/.test(a)));
    const repos = [...new Set(ixServers.flatMap(s => s.apps.filter(a => /^ix-/.test(a)).map(a => a.slice(3))))];
    const sfx = r => repos.length > 1 ? ` (${r})` : '';
    items.push({ key: 'setup-status', name: 'ELO Application Servers', kind: 'exe', found: !!scan.setup, target: scan.setup, args: '--status', detail: scan.setup ? `${scan.setup} --status` : 'no ELO\\prog\\serversetup2\\setup.bat on any drive' });
    items.push({ key: 'setup', name: 'ELO Server Setup', kind: 'exe', found: !!scan.setup, target: scan.setup, args: '', detail: scan.setup || 'not found' });
    for (const r of repos) {
      const s = ixServers.find(v => v.apps.includes('ix-' + r)), base = baseOf(s), up = !!base;
      const add = (key, name, url, found, why) => items.push({ key: `${key}:${r}`, name: name + sfx(r), kind: 'web', found: found && up, url, detail: found && up ? url : why || 'not found' });
      add('admin', 'ELO Administration Console', `${base}/ix-${r}/plugin/de.elo.ix.plugin.proxy/ac/`, true, 'no http/https connector in server.xml');
      add('web', 'ELO Web Client', `${base}/ix-${r}/plugin/de.elo.ix.plugin.proxy/web/`, true, 'no connector');
      add('web2', 'ELO Web Client (web-' + r + ')', `${base}/web-${r}/`, s.apps.includes('web-' + r), `webapp web-${r} not installed`);
      add('wf', 'ELO Workflow Client', `${base}/ix-${r}/plugin/de.elo.ix.plugin.proxy/wf/apps/app/elo.webapps.WorkflowClient/?debug=false`, s.apps.includes('wf-' + r), `webapp wf-${r} not installed`);
      add('basis', 'ELO Basis (Tomcat status)', `${base}/manager/status`, s.apps.some(a => /manager/.test(a)), 'manager webapp not installed');
      const as = scan.servers.find(v => v.apps.includes('as-' + r)); const asb = as && baseOf(as);
      items.push({ key: `as:${r}`, name: 'ELO Application Server (Tomcat status)' + sfx(r), kind: 'web', found: !!asb, url: asb ? `${asb}/manager/status` : '', detail: asb ? `${asb}/manager/status` : `no server with webapp as-${r}` });
    }
    if (!repos.length) items.push({ key: 'repo', name: 'ELO repository', kind: 'web', found: false, detail: scan.elo.length ? 'no ix-<repo> webapp in ELO\\servers' : 'no ELO folder on any drive' });
    const c = scan.clients;
    items.push({ key: 'java', name: 'ELO Java Client', kind: 'exe', found: !!(c.javaClient || c.javaClient86), target: c.javaClient || c.javaClient86, detail: c.javaClient || c.javaClient86 || 'not installed' });
    items.push({ key: 'dropzone', name: 'ELO Dropzone', kind: 'exe', found: !!c.dropzone, target: c.dropzone, detail: c.dropzone || 'not installed' });
    items.push({ key: 'desktop', name: 'ELO Desktop', kind: 'exe', found: !!c.desktopClient, target: c.desktopClient, detail: c.desktopClient || 'not installed' });
    return { repos, items };
  }

  app.post('/api/machine/credentials', localOnly, wrap(async req => {
    const { id, user, password, os } = req.body || {};
    if (!/^(hyperv|vbox):.+/.test(String(id)) || !user || !password) throw new Error('machine, user and password are required');
    machines.save(id, { os: os === 'linux' ? 'linux' : 'windows', user, password, label: os === 'linux' ? 'Linux' : 'Windows' });
    return { ok: true };
  }));

  // ── Linux machines (SSH): X desktop launchers + browser bookmarks ──
  // Launchers are .desktop files in the user's Desktop and applications menu. Bookmarks go through browser policies, so no browser
  // profile is edited: Firefox /etc/firefox/policies/policies.json (Bookmarks, toolbar folder "ELO"), Chrome / Chromium managed
  // policy ManagedBookmarks (folder "ELO" on the bookmarks bar). Existing entries are kept.
  const LIN_SCAN = String.raw`
"$ELO_PY" - "$ELO_USER" <<'PY'
import json, os, sys, re, glob, shutil, subprocess, pwd, socket
user = sys.argv[1]
def sh(c):
    try: return subprocess.run(c, shell=True, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception: return ''
def rj(p):
    try: return json.load(open(p))
    except Exception: return {}
home = pwd.getpwnam(user).pw_dir
desk = sh('sudo -u %s xdg-user-dir DESKTOP 2>/dev/null' % user)
if not desk or desk == home: desk = home + '/Desktop'
def env(p):
    d = {}
    try:
        for l in open(p, errors='ignore'):
            m = re.match(r'^\s*([A-Z_0-9]+)=(.*)$', l)
            if m: d[m.group(1)] = m.group(2).strip().strip('"\'')
    except Exception: pass
    return d
listening = set(re.findall(r':(\d+)\s', sh('ss -ltn 2>/dev/null')))
inst, seen = [], set()
for r in [home, '/opt', '/srv', '/usr/local', '/root']:
    for f in sh('find %s -maxdepth 4 -name elo.sh -not -path "*/node_modules/*" 2>/dev/null' % r).split('\n'):
        d = os.path.dirname(f)
        if not f or d in seen: continue
        seen.add(d)
        base = env(d + '/.env')
        sets = [('default', base)] + [(os.path.basename(os.path.dirname(p)), {**base, **env(p)}) for p in sorted(glob.glob(d + '/instances/*/.env'))]
        for name, e in sets:
            port = e.get('PORT_SERVER') or '9090'
            inst.append({'name': name, 'tag': e.get('ELO_TAG', ''), 'repo': e.get('REPO', 'repository'), 'port': port, 'listening': port in listening, 'dir': d})
if not inst:
    for l in sh("docker ps --format '{{.Image}}|{{.Ports}}' 2>/dev/null").split('\n'):
        if 'eck-services/server' in l:
            im, ports = l.split('|', 1); m = re.search(r':(\d+)->', ports)
            if m: inst.append({'name': 'docker', 'tag': im.split(':')[-1], 'repo': 'repository', 'port': m.group(1), 'listening': True, 'dir': ''})
br = {}
for k, names in {'firefox': ['firefox', 'firefox-esr'], 'chrome': ['google-chrome', 'google-chrome-stable'], 'chromium': ['chromium', 'chromium-browser']}.items():
    for n in names:
        p = shutil.which(n)
        if p: br[k] = p; break
def urls(path, kind):
    j = rj(path)
    if kind == 'firefox': return [b.get('URL') for b in j.get('policies', {}).get('Bookmarks', []) if isinstance(b, dict)]
    return [b.get('url') for b in j.get('ManagedBookmarks', []) if isinstance(b, dict)]
cd = {'chrome': '/etc/opt/chrome/policies/managed', 'chromium': '/var/snap/chromium/current/policies/managed' if os.path.isdir('/snap/chromium') else '/etc/chromium/policies/managed'}
ex = {'launchers': [os.path.basename(p) for p in glob.glob(desk + '/elo-*.desktop')], 'firefox': urls('/etc/firefox/policies/policies.json', 'firefox'),
      'chrome': urls(cd['chrome'] + '/elo-links.json', 'c'), 'chromium': urls(cd['chromium'] + '/elo-links.json', 'c')}
de = os.path.exists('/etc/systemd/system/elo-desktop.service') or any(shutil.which(c) for c in ['startxfce4', 'startlxqt', 'gnome-session', 'plasma_session'])
print(json.dumps({'host': socket.gethostname().lower(), 'user': user, 'home': home, 'deskDir': desk, 'desktopInstalled': bool(de), 'instances': inst, 'browsers': br, 'existing': ex}))
PY
`;
  const LIN_APPLY = String.raw`
"$ELO_PY" - "$ELO_USER" <<'PY'
import json, os, sys, base64, pwd, subprocess
user = sys.argv[1]
i = json.loads(base64.b64decode(os.environ['ELO_IN']))
pw = pwd.getpwnam(user); out = {'shortcuts': [], 'bookmarks': []}
def rj(p):
    try: return json.load(open(p))
    except Exception: return {}
def wj(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(json.dumps(d, indent=2)); os.chmod(p, 0o644)
apps = pw.pw_dir + '/.local/share/applications'
for it in i['items']:
    fn = 'elo-' + it['key'].replace(':', '-').replace('/', '-') + '.desktop'
    body = '[Desktop Entry]\nVersion=1.0\nType=Application\nName=%s\nComment=%s\nExec=xdg-open "%s"\nIcon=applications-internet\nTerminal=false\nCategories=Network;Office;\n' % (it['name'], it['url'], it['url'])
    for d in [i['deskDir'], apps]:
        f = d + '/' + fn
        if os.path.exists(f) and not i['overwrite']:
            out['shortcuts'].append({'name': it['name'], 'dir': d, 'result': 'exists'}); continue
        try:
            os.makedirs(d, exist_ok=True); open(f, 'w').write(body); os.chmod(f, 0o755)
            for p in {d, f}: os.chown(p, pw.pw_uid, pw.pw_gid)
            if d == i['deskDir']: subprocess.run(['sudo', '-u', user, 'gio', 'set', f, 'metadata::trusted', 'true'], capture_output=True, timeout=15)
            out['shortcuts'].append({'name': it['name'], 'dir': d, 'result': 'created'})
        except Exception as e: out['shortcuts'].append({'name': it['name'], 'dir': d, 'result': 'error: %s' % e})
web = i['items']
if 'firefox' in i['browsers']:
    p = '/etc/firefox/policies/policies.json'
    try:
        j = rj(p); j.setdefault('policies', {}); have = [b.get('URL') for b in j['policies'].get('Bookmarks', []) if isinstance(b, dict)]
        new = [{'Title': it['name'], 'URL': it['url'], 'Placement': 'toolbar', 'Folder': 'ELO'} for it in web if it['url'] not in have]
        if new: j['policies']['Bookmarks'] = j['policies'].get('Bookmarks', []) + new; wj(p, j)
        out['bookmarks'].append({'browser': 'firefox', 'user': '(all users)', 'file': p, 'added': [n['Title'] for n in new], 'result': 'updated' if new else 'nothing to add'})
    except Exception as e: out['bookmarks'].append({'browser': 'firefox', 'result': 'error: %s' % e})
dirs = {'chrome': '/etc/opt/chrome/policies/managed', 'chromium': '/var/snap/chromium/current/policies/managed' if os.path.isdir('/snap/chromium') else '/etc/chromium/policies/managed'}
for b in ['chrome', 'chromium']:
    if b not in i['browsers']: continue
    p = dirs[b] + '/elo-links.json'
    try:
        j = rj(p); mb = j.get('ManagedBookmarks') or [{'toplevel_name': 'ELO'}]
        have = [e.get('url') for e in mb if isinstance(e, dict)]
        new = [{'name': it['name'], 'url': it['url']} for it in web if it['url'] not in have]
        if new: j['ManagedBookmarks'] = mb + new; wj(p, j)
        out['bookmarks'].append({'browser': b, 'user': '(all users)', 'file': p, 'added': [n['name'] for n in new], 'result': 'updated' if new else 'nothing to add'})
    except Exception as e: out['bookmarks'].append({'browser': b, 'result': 'error: %s' % e})
print(json.dumps(out))
PY
`;

  // Requirements of a Linux machine: python3 (the scripts use only its standard library), the venv module and xdg-open (what the
  // launchers run). Missing ones are installed with the machine's package manager; python then runs from a private venv
  // (/opt/elo-installer/venv) so nothing is changed in the system python.
  const VENV = '/opt/elo-installer/venv';
  const LIN_REQ = String.raw`
PY=$(command -v python3 || true)
VENV_OK=false; [ -n "$PY" ] && "$PY" -c 'import venv, ensurepip' >/dev/null 2>&1 && VENV_OK=true
HAS_VENV=false; [ -x ${VENV}/bin/python ] && HAS_VENV=true
PM=none; for p in apt-get dnf zypper pacman; do command -v $p >/dev/null && { PM=$p; break; }; done
printf '{"python3":%s,"pythonVersion":"%s","venvModule":%s,"venvReady":%s,"xdgOpen":%s,"gio":%s,"packageManager":"%s"}\n' \
  "$([ -n "$PY" ] && echo true || echo false)" "$([ -n "$PY" ] && "$PY" -c 'import sys;print("%d.%d.%d"%sys.version_info[:3])')" "$VENV_OK" "$HAS_VENV" \
  "$(command -v xdg-open >/dev/null && echo true || echo false)" "$(command -v gio >/dev/null && echo true || echo false)" "$PM"
`;
  const LIN_PREPARE = String.raw`
set -e; export DEBIAN_FRONTEND=noninteractive
need() { command -v "$1" >/dev/null 2>&1; }
PM=none; for p in apt-get dnf zypper pacman; do need $p && { PM=$p; break; }; done
PYOK=false; need python3 && python3 -c 'import venv, ensurepip' >/dev/null 2>&1 && PYOK=true
if [ "$PYOK" = false ] || ! need xdg-open; then
  echo "__STEP__ Installing python3 / venv / xdg-utils with $PM"
  case $PM in
    apt-get) apt-get -o DPkg::Lock::Timeout=300 update -qq; apt-get -o DPkg::Lock::Timeout=300 install -y -qq python3 python3-venv xdg-utils libglib2.0-bin >/dev/null ;;
    dnf) dnf install -y -q python3 xdg-utils glib2 >/dev/null ;;
    zypper) zypper -n install python3 xdg-utils glib2-tools >/dev/null ;;
    pacman) pacman -Sy --noconfirm python xdg-utils glib2 >/dev/null ;;
    *) echo "ERROR: no supported package manager (apt-get, dnf, zypper, pacman): install python3 with the venv module and xdg-utils by hand" >&2; exit 1 ;;
  esac
fi
echo "__STEP__ Creating the private venv ${VENV}"
[ -x ${VENV}/bin/python ] || { mkdir -p $(dirname ${VENV}); python3 -m venv ${VENV}; }
${VENV}/bin/python -c 'import sys,json;print(json.dumps({"ok":True,"python":sys.version.split()[0],"venv":"${VENV}"}))'
`;
  async function linuxSh(m, body, env = {}, secs = 120) {
    if (!m.ssh || m.container) throw new Error('not a Linux machine reachable by SSH');
    if (!/^[a-z_][a-z0-9_-]*$/.test(m.ssh.user)) throw new Error('bad user');
    const pre = Object.entries({ ELO_USER: m.ssh.user, ...env }).map(([k, v]) => `export ${k}=${x.shq(v)}`).join('; ');
    return x.shOn(m.ssh, `${pre}\n${body}`, secs);
  }
  const lastJson = out => { const line = out.trim().split('\n').filter(l => l.startsWith('{')).pop(); if (!line) throw new Error('no result from the machine: ' + out.trim().slice(-400)); return JSON.parse(line); };
  const linuxRequirements = async m => lastJson(await linuxSh(m, LIN_REQ, {}, 60));
  async function runLinux(m, script, extraEnv = {}) {
    let req = await linuxRequirements(m);
    if (!req.python3 || !req.venvModule || !req.venvReady || !req.xdgOpen) { await linuxPrepare(m); req = await linuxRequirements(m); }
    if (!req.venvReady) throw new Error('could not prepare python on the machine');
    return lastJson(await linuxSh(m, script, { ELO_PY: `${VENV}/bin/python`, ...extraEnv }));
  }
  async function linuxPrepare(m) {
    const out = await linuxSh(m, LIN_PREPARE, {}, 900);
    if (!/"ok": ?true/.test(out)) throw new Error(('could not install the requirements: ' + out.trim().split('\n').slice(-3).join(' ')).slice(0, 400));
    return lastJson(out);
  }
  const reqItems = r => [
    { key: 'python3', ok: r.python3, detail: r.python3 ? r.pythonVersion : 'missing' },
    { key: 'venv', ok: r.venvModule, detail: r.venvModule ? 'python venv module' : 'python3-venv missing' },
    { key: 'venvReady', ok: r.venvReady, detail: r.venvReady ? VENV : 'not created yet' },
    { key: 'xdg-open', ok: r.xdgOpen, detail: r.xdgOpen ? 'xdg-utils' : 'missing (what the launchers run)' },
    { key: 'gio', ok: r.gio, detail: r.gio ? 'marks launchers as trusted' : 'optional: launchers may ask to be trusted once' }];
  function buildPlanLinux(scan) {
    const items = [], multi = scan.instances.length > 1;
    const old = i => /^v2[0-3]-/.test(i.tag || '');
    for (const i of scan.instances) {
      const base = `http://localhost:${i.port}`, sfx = multi ? ` (${i.name})` : '', slug = `${i.name}`.replace(/[^\w.-]/g, '_');
      const url = a => old(i) ? `${base}/${a}/` : `${base}/${i.repo}/plugin/de.elo.ix.plugin.proxy/${a}/`;
      const note = i.listening ? '' : ' (not running now)';
      for (const [k, name, a] of [['web', 'ELO Web Client', 'web'], ['ac', 'ELO Administration Console', 'ac'], ['wf', 'ELO Web Forms', 'wf']])
        items.push({ key: `${k}:${slug}`, name: name + sfx, kind: 'web', found: true, url: url(a), detail: url(a) + note });
    }
    if (!items.length) items.push({ key: 'elo', name: 'ELO', kind: 'web', found: false, detail: 'no ELO installation (elo.sh / docker containers) found on this machine' });
    return { repos: scan.instances.map(i => i.name), items };
  }
  // Pending = what applying would still add.
  function pendingLinux(scan, plan) {
    const ex = scan.existing, keys = Object.keys(scan.browsers);
    let n = 0;
    for (const it of plan.items.filter(i => i.found)) {
      if (!ex.launchers.includes('elo-' + it.key.replace(/[:/]/g, '-') + '.desktop')) n++;
      for (const b of keys) if (!(ex[b] || []).includes(it.url)) n++;
    }
    return n;
  }
  const isWin = m => m.os === 'windows' && !m.container;
  const pub = ({ key, name, kind, found, detail }) => ({ key, name, kind, found, detail });

  // Scan + what is still missing, so the UI offers the operation only when something is pending.
  app.post('/api/elolinks/status', localOnly, wrap(async req => {
    const id = req.body?.id, m = await terminals.resolve(id);
    if (isWin(m)) {
      const scan = await runWindows(id, SCAN_PS, { HVC_IN: '' }), plan = buildPlan(scan), found = plan.items.filter(i => i.found);
      let pending = 0;
      if (found.length) {
        const input = { items: found, desktopDirs: ['C:\\Users\\Public\\Desktop'], overwrite: false, dryRun: true, closeBrowsers: false, testDir: '',
          bookmarkFiles: scan.bookmarks, firefoxDist: scan.firefoxDist };
        const dry = await runWindows(id, APPLY_PS, { HVC_IN: Buffer.from(JSON.stringify(input)).toString('base64') });
        pending = [].concat(dry.shortcuts || []).filter(s => s.result === 'would-create').length + [].concat(dry.bookmarks || []).reduce((a, b) => a + [].concat(b.added || []).length, 0);
      }
      return { ok: true, os: 'windows', scan: { host: scan.host, elo: scan.elo, repos: plan.repos, browsers: Object.keys(scan.browsers), clients: Object.keys(scan.clients) }, items: plan.items.map(pub), pending };
    }
    // Read-only: when something is missing the machine is not touched; the UI offers "install requirements" (/prepare).
    const need = await linuxRequirements(m), requirements = reqItems(need);
    if (!need.python3 || !need.venvModule || !need.venvReady || !need.xdgOpen) return { ok: true, os: 'linux', needsSetup: true, packageManager: need.packageManager, requirements, items: [], scan: { browsers: [] }, pending: 0 };
    const scan = await runLinux(m, LIN_SCAN), plan = buildPlanLinux(scan);
    return { ok: true, os: 'linux', requirements, scan: { host: scan.host, desktopInstalled: scan.desktopInstalled, repos: plan.repos, browsers: Object.keys(scan.browsers), user: scan.user }, items: plan.items.map(pub), pending: pendingLinux(scan, plan) };
  }));
  app.post('/api/elolinks/prepare', localOnly, wrap(async req => {
    const m = await terminals.resolve(req.body?.id);
    if (isWin(m)) return { ok: true, note: 'nothing to install on Windows machines' };
    const r = await linuxPrepare(m);
    return { ok: true, ...r, requirements: reqItems(await linuxRequirements(m)) };
  }));
  app.post('/api/elolinks/scan', localOnly, wrap(async req => {
    const m = await terminals.resolve(req.body?.id);
    if (!isWin(m)) { const scan = await runLinux(m, LIN_SCAN); return { ok: true, scan, plan: buildPlanLinux(scan) }; }
    const scan = await runWindows(req.body?.id, SCAN_PS, { HVC_IN: '' });
    return { ok: true, scan, plan: buildPlan(scan) };
  }));
  app.post('/api/elolinks/apply', localOnly, wrap(async req => {
    const { id, keys, where = 'public', overwrite = false, closeBrowsers = false, dryRun = false, testDir = '', browsers = ['chrome', 'edge', 'firefox', 'chromium'] } = req.body || {};
    const m = await terminals.resolve(id), sel = i => i.found && (!keys || keys.includes(i.key));
    if (!isWin(m)) {
      const scan = await runLinux(m, LIN_SCAN), plan = buildPlanLinux(scan), items = plan.items.filter(sel);
      if (!items.length) throw new Error('nothing to create: no ELO installation found on the machine');
      const input = { items: items.map(({ key, name, url }) => ({ key, name, url })), deskDir: scan.deskDir, overwrite,
        browsers: Object.fromEntries(Object.entries(scan.browsers).filter(([b]) => browsers.includes(b))) };
      const result = await runLinux(m, LIN_APPLY, { ELO_IN: Buffer.from(JSON.stringify(input)).toString('base64') });
      return { ok: true, scan: { host: scan.host, repos: plan.repos, desktopInstalled: scan.desktopInstalled }, items: items.map(pub), result,
        skipped: plan.items.filter(i => !i.found).map(i => ({ name: i.name, why: i.detail })), noBrowsers: Object.keys(scan.browsers).length === 0 };
    }
    const scan = await runWindows(id, SCAN_PS, { HVC_IN: '' }), plan = buildPlan(scan), items = plan.items.filter(sel);
    if (!items.length) throw new Error('nothing selected that was found on the machine');
    const desktopDirs = testDir ? [testDir + '\\Desktop'] : where === 'public' ? ['C:\\Users\\Public\\Desktop'] : [`C:\\Users\\${String(where).replace(/^user:/, '').replace(/[^\w .-]/g, '')}\\Desktop`];
    const input = { items, desktopDirs, overwrite, dryRun, closeBrowsers, testDir,
      bookmarkFiles: scan.bookmarks.filter(b => browsers.includes(b.browser) && (where === 'public' || b.user === String(where).replace(/^user:/, ''))),
      firefoxDist: browsers.includes('firefox') ? scan.firefoxDist : null };
    const result = await runWindows(id, APPLY_PS, { HVC_IN: Buffer.from(JSON.stringify(input)).toString('base64') });
    return { ok: true, scan: { host: scan.host, elo: scan.elo, repos: plan.repos }, items: items.map(pub), result,
      skipped: plan.items.filter(i => !i.found).map(i => ({ name: i.name, why: i.detail })), noBrowsers: Object.keys(scan.browsers).length === 0 };
  }));
  return { buildPlan, buildPlanLinux, runWindows, runLinux };
};
