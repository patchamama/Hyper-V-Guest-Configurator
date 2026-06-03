'use strict';
const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const PORT        = 3000;
const SCRIPT_DIR  = path.join(__dirname, '..');
const STATE_FILE    = 'C:\\ollama-ssl\\deploy-state.json';
const EXPOSURE_FILE = 'C:\\ollama-ssl\\vm-exposure.json';

function toWinPath(p) {
  const m = p.match(/^\/mnt\/([a-z])\/(.*)/i);
  if (m) return m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\');
  return p;
}

function getHostIP() {
  const nets = os.networkInterfaces();
  // Prefer vEthernet (Hyper-V virtual switch) adapters
  for (const [name, addrs] of Object.entries(nets)) {
    if (!name.toLowerCase().includes('hyper-v') && !name.toLowerCase().includes('vethernet')) continue;
    const v4 = addrs.find(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'));
    if (v4) return v4.address;
  }
  // Fallback: any non-loopback, non-APIPA IPv4
  for (const [, addrs] of Object.entries(nets)) {
    const v4 = addrs.find(a => a.family === 'IPv4' && !a.internal &&
                                !a.address.startsWith('169.254.') && !a.address.startsWith('127.'));
    if (v4) return v4.address;
  }
  return '127.0.0.1';
}

function formatSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
const DOWNLOADS    = path.join(SCRIPT_DIR, 'downloads.txt');
const SOFTWARES    = path.join(SCRIPT_DIR, 'softwares');
const MODELS_FILE  = path.join(SCRIPT_DIR, 'ollama-models.json');
const TOOLS_FILE   = path.join(SCRIPT_DIR, 'tools.json');

function loadModels() {
  try {
    if (fs.existsSync(MODELS_FILE)) return JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
  } catch (e) { console.warn('[models] Failed to load ollama-models.json:', e.message); }
  return [
    { tag: 'deepseek-r1:1.5b', desc: 'DeepSeek R1 1.5B — fast, lightweight'     },
    { tag: 'llama3.1:8b',      desc: 'Meta LLaMA 3.1 8B — balanced quality'     },
    { tag: 'gemma4:latest',    desc: 'Google Gemma 4 — latest release'           },
    { tag: 'phi4:latest',      desc: 'Microsoft Phi-4 — efficient reasoning'     },
    { tag: 'mistral:latest',   desc: 'Mistral 7B — strong multilingual'          },
    { tag: 'qwen2.5:7b',       desc: 'Alibaba Qwen 2.5 7B — coding & reasoning' },
  ];
}

const app    = express();
const server = createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Catalogues ────────────────────────────────────────────────────────────────

const WINGET = [
  { name: 'Mozilla Firefox',           id: 'Mozilla.Firefox'                     },
  { name: 'Notepad++',                 id: 'Notepad++.Notepad++'                 },
  { name: 'Docker Desktop',            id: 'Docker.DockerDesktop'                },
  { name: 'PostgreSQL 18',             id: 'PostgreSQL.PostgreSQL.18'            },
  { name: 'SQL Server 2022 Developer', id: 'Microsoft.SQLServer.2022.Developer'  },
  { name: 'SQL Server Mgmt Studio',    id: 'Microsoft.SQLServerManagementStudio' },
  { name: 'Git',                       id: 'Git.Git'                             },
  { name: 'Visual Studio Code',        id: 'Microsoft.VisualStudioCode'          },
  { name: '7-Zip',                     id: '7zip.7zip'                           },
  { name: 'Google Chrome',             id: 'Google.Chrome'                       },
  { name: 'VLC Media Player',          id: 'VideoLAN.VLC'                        },
  { name: 'Chocolatey',                id: 'Chocolatey.Chocolatey'               },
];


// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/vms', (req, res) => {
  // -AsArray requires PS 7+; use ConvertTo-Json -InputObject @(...) for PS 5.1 compat
  const cmd =
    `Import-Module Hyper-V -ErrorAction SilentlyContinue; ` +
    `$raw = @(Get-VM -ErrorAction SilentlyContinue | ` +
    `Sort-Object @{E={if($_.State -eq "Running"){0}else{1}}},Name | ` +
    `ForEach-Object { [PSCustomObject]@{Name=$_.Name;State="$($_.State)";MemGB=[math]::Round($_.MemoryAssigned/1GB,1)} }); ` +
    `if ($raw.Count -gt 0) { ConvertTo-Json -InputObject $raw -Depth 2 } else { Write-Output "[]" }`;
  runPS(cmd, (out, err) => {
    if (!out && err) { console.error('[/api/vms]', err); return res.json({ error: err }); }
    try { res.json(JSON.parse(out || '[]')); }
    catch (e) { console.error('[/api/vms parse]', e.message, out); res.json([]); }
  });
});

// Debug endpoint — returns raw PS stdout/stderr without parsing
app.get('/api/vms/debug', (req, res) => {
  runPS(
    `Import-Module Hyper-V -ErrorAction SilentlyContinue; ` +
    `Get-VM -ErrorAction SilentlyContinue | Select-Object Name,State | ConvertTo-Json`,
    (out, err) => res.json({ out, err })
  );
});

app.get('/api/state', (req, res) => {
  const blank = { VMName: '', Completed: [], Models: [], Features: [], LocalFiles: [], WingetPkgs: [], DownloadUrls: [], InstallMode: '', CopyMethod: 'http' };
  try {
    if (!fs.existsSync(STATE_FILE)) return res.json(blank);
    res.json({ ...blank, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/state', (req, res) => {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/state', (req, res) => {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vm-exposure', (req, res) => {
  try {
    if (!fs.existsSync(EXPOSURE_FILE)) return res.json(null);
    res.json(JSON.parse(fs.readFileSync(EXPOSURE_FILE, 'utf8')));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vm-exposure', (req, res) => {
  try {
    fs.writeFileSync(EXPOSURE_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vm-exposure', (req, res) => {
  try {
    if (fs.existsSync(EXPOSURE_FILE)) fs.unlinkSync(EXPOSURE_FILE);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/downloads', (req, res) => {
  try {
    if (!fs.existsSync(DOWNLOADS)) return res.json([]);
    const entries = fs.readFileSync(DOWNLOADS, 'utf8').split('\n')
      .filter(l => l.trim() && !l.trim().startsWith('#'))
      .map(l => {
        const m = l.match(/^(.+?)\s*\|\s*(https?:\/\/.+)$/);
        if (m) return { name: m[1].trim(), url: m[2].trim() };
        if (/^https?:\/\//.test(l.trim())) {
          return { name: l.trim().split('?')[0].split('/').pop(), url: l.trim() };
        }
        return null;
      }).filter(Boolean);
    res.json(entries);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/softwares', (req, res) => {
  try {
    if (!fs.existsSync(SOFTWARES)) return res.json([]);
    const folders = fs.readdirSync(SOFTWARES, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({
        folder: d.name,
        files: fs.readdirSync(path.join(SOFTWARES, d.name), { withFileTypes: true })
          .filter(f => f.isFile())
          .map(f => {
            const bytes = fs.statSync(path.join(SOFTWARES, d.name, f.name)).size;
            const sizeLabel = bytes >= 1048576
              ? `${(bytes / 1048576).toFixed(1)} MB`
              : `${Math.round(bytes / 1024)} KB`;
            return { name: f.name, relativePath: `${d.name}/${f.name}`, bytes, sizeLabel };
          })
      }));
    res.json(folders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/config', (req, res) => res.json({ scriptDir: toWinPath(SCRIPT_DIR) }));
app.get('/api/winget', (req, res) => res.json(WINGET));
// Always reads from disk so edits to ollama-models.json take effect without restart
app.get('/api/models', (req, res) => res.json(loadModels()));
// Always reads from disk so edits to tools.json take effect without restart
app.get('/api/tools', (req, res) => {
  try {
    if (!fs.existsSync(TOOLS_FILE)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(TOOLS_FILE, 'utf8')));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/host-info', (req, res) => {
  const ip = getHostIP();
  res.json({
    ip,
    port:     PORT,
    webUrl:   `http://${ip}:${PORT}`,
    filesUrl: `http://${ip}:${PORT}/files/`,
  });
});

app.post('/api/open-in-vm', (req, res) => {
  const { vmName, user, pass, url } = req.body;
  if (!vmName || !user || !pass || !url) return res.status(400).json({ error: 'Missing fields' });
  const esc = s => String(s).replace(/"/g, '`"');
  const cmd = `$cred = New-Object PSCredential("${esc(user)}", (ConvertTo-SecureString "${esc(pass)}" -AsPlainText -Force)); ` +
              `Invoke-Command -VMName "${esc(vmName)}" -Credential $cred ` +
              `-ScriptBlock { Start-Process "explorer.exe" -ArgumentList $using:url } -ErrorAction SilentlyContinue`;
  runPS(cmd, () => {});
  res.json({ ok: true });
});

// ── File browser (VM-accessible at /files/) ───────────────────────────────────

const SOFTWARES_ABS = path.resolve(SOFTWARES);

app.use('/files', (req, res) => {
  try {
    const rel = decodeURIComponent(req.path);
    const abs = path.resolve(path.join(SOFTWARES, rel));
    if (!abs.startsWith(SOFTWARES_ABS)) return res.status(403).send('Forbidden');
    if (!fs.existsSync(abs)) return res.status(404).send('Not found');

    const stat = fs.statSync(abs);

    if (stat.isFile()) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(abs)}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      fs.createReadStream(abs).pipe(res);
      return;
    }

    if (stat.isDirectory()) {
      const items = fs.readdirSync(abs, { withFileTypes: true })
        .map(d => ({
          name:  d.name,
          isDir: d.isDirectory(),
          size:  d.isDirectory() ? '' : formatSize(fs.statSync(path.join(abs, d.name)).size),
        }))
        .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)));

      const relDisp   = rel.replace(/^\//, '');
      const parentRow = relDisp ? `<tr><td colspan="2"><a href="../">&#8593; Parent directory</a></td></tr>` : '';
      const rows = items.map(item => {
        const enc  = encodeURIComponent(item.name) + (item.isDir ? '/' : '');
        const icon = item.isDir ? '&#128193;' : '&#128196;';
        return `<tr><td>${icon} <a href="${enc}">${item.name}</a></td>` +
               `<td style="text-align:right;color:#8b949e;padding-left:24px;white-space:nowrap">${item.size}</td></tr>`;
      }).join('');

      const title = relDisp || 'Shared Files';
      const css   = '*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#0d1117;color:#e6edf3;padding:24px;margin:0}' +
                    'h2{color:#E8820C;margin-bottom:16px;font-size:18px}' +
                    'table{border-collapse:collapse;width:100%;max-width:720px}' +
                    'td{padding:8px 14px;border-bottom:1px solid #30363d;font-size:14px}' +
                    'tr:hover td{background:#161b22}a{color:#58a6ff;text-decoration:none}a:hover{color:#E8820C;text-decoration:underline}' +
                    '.note{color:#8b949e;font-size:12px;margin-top:16px}';
      const html  = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${css}</style></head>` +
                    `<body><h2>${title}</h2><table>${parentRow}${rows}</table>` +
                    `<p class="note">Hyper-V Configurator — host file browser</p></body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    }
  } catch (e) { res.status(500).send(e.message); }
});

// ── ELO token refresh ─────────────────────────────────────────────────────────

let eloRefreshProc = null;

app.post('/api/refresh-elo-tokens/start', (req, res) => {
  if (eloRefreshProc) return res.status(409).json({ error: 'Already running' });
  const script = path.join(SCRIPT_DIR, 'refresh-elo-tokens.js');
  if (!fs.existsSync(script)) return res.status(404).json({ error: 'refresh-elo-tokens.js not found' });
  eloRefreshProc = spawn('node', [script], {
    env: { ...process.env, WEB_MODE: '1' },
    cwd: SCRIPT_DIR,
    stdio: 'pipe',
  });
  eloRefreshProc.on('close', () => { eloRefreshProc = null; });
  res.json({ ok: true });
});

app.post('/api/refresh-elo-tokens/done', (req, res) => {
  const sig = path.join(SCRIPT_DIR, '.elo-refresh-done');
  try { fs.writeFileSync(sig, '1', 'utf8'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/refresh-elo-tokens/status', (req, res) => {
  res.json({ running: !!eloRefreshProc });
});

// ── Notes ─────────────────────────────────────────────────────────────────────

const NOTES_FILE = path.join(SCRIPT_DIR, 'notes.txt');

app.get('/api/notes', (req, res) => {
  try {
    const content = fs.existsSync(NOTES_FILE) ? fs.readFileSync(NOTES_FILE, 'utf8') : '';
    res.json({ content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/notes', (req, res) => {
  try {
    fs.writeFileSync(NOTES_FILE, req.body.content ?? '', 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Output helpers ────────────────────────────────────────────────────────────

// Force PowerShell to emit UTF-8 on both stdout and stderr
const PS_UTF8 = 'chcp 65001 | Out-Null; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ';

// Strip ANSI/VT CSI escape sequences (progress bars, cursor moves, etc.) and bare CR
function cleanOutput(text) {
  return text
    .replace(/\x1b\[[\x20-\x3f]*[\x40-\x7e]/g, '')
    .replace(/\r/g, '');
}

// ── WebSocket execution ───────────────────────────────────────────────────────

let activeProc = null;

wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'ready' }));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'run') {
      if (activeProc) { ws.send(JSON.stringify({ type: 'error', text: 'A task is already running.' })); return; }
      execute(msg.script, ws);
    }
    if (msg.type === 'cancel' && activeProc) {
      activeProc.kill();
      activeProc = null;
      ws.send(JSON.stringify({ type: 'cancelled' }));
    }
  });

  ws.on('close', () => { if (activeProc) { activeProc.kill(); activeProc = null; } });
});

function execute(script, ws) {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_UTF8 + script]);
  activeProc = ps;
  ps.stdout.on('data', d => ws.send(JSON.stringify({ type: 'out', text: cleanOutput(d.toString('utf8')) })));
  ps.stderr.on('data', d => ws.send(JSON.stringify({ type: 'err', text: cleanOutput(d.toString('utf8')) })));
  ps.on('close',  code => { activeProc = null; ws.send(JSON.stringify({ type: 'done', code })); });
  ps.on('error',  err  => { activeProc = null; ws.send(JSON.stringify({ type: 'error', text: err.message })); });
}

function runPS(cmd, cb) {
  let out = '', err = '';
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_UTF8 + cmd]);
  ps.stdout.on('data', d => out += d.toString('utf8'));
  ps.stderr.on('data', d => err += d.toString('utf8'));
  ps.on('close', () => cb(out.trim(), err.trim() || null));
  ps.on('error', e => cb('', e.message));
}

// ── Redirect bare softwares paths → /files/ (backwards-compat with PS server) ─

app.use((req, res, next) => {
  const rel = decodeURIComponent(req.path);
  if (rel === '/') return next();
  try {
    const abs = path.resolve(path.join(SOFTWARES, rel));
    if (abs.startsWith(SOFTWARES_ABS) && fs.existsSync(abs)) {
      return res.redirect('/files' + req.path);
    }
  } catch (_) {}
  next();
});

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  const ip = getHostIP();
  console.log(`Hyper-V Web Configurator → http://127.0.0.1:${PORT}  (localhost)`);
  if (ip !== '127.0.0.1') {
    console.log(`Hyper-V Web Configurator → http://${ip}:${PORT}  (VM-accessible)`);
    console.log(`File browser (from VM)   → http://${ip}:${PORT}/files/`);
  }
});
