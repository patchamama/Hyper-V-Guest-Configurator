'use strict';
const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const PORT        = 3000;
const SCRIPT_DIR  = path.join(__dirname, '..');
const STATE_FILE  = 'C:\\ollama-ssl\\deploy-state.json';

function toWinPath(p) {
  const m = p.match(/^\/mnt\/([a-z])\/(.*)/i);
  if (m) return m[1].toUpperCase() + ':\\' + m[2].replace(/\//g, '\\');
  return p;
}
const DOWNLOADS    = path.join(SCRIPT_DIR, 'downloads.txt');
const SOFTWARES    = path.join(SCRIPT_DIR, 'softwares');
const MODELS_FILE  = path.join(SCRIPT_DIR, 'ollama-models.json');

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
  const blank = { VMName: '', Completed: [], Models: [], Features: [], LocalFiles: [], WingetPkgs: [], DownloadUrls: [], InstallMode: '' };
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
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  activeProc = ps;
  ps.stdout.on('data', d => ws.send(JSON.stringify({ type: 'out', text: d.toString() })));
  ps.stderr.on('data', d => ws.send(JSON.stringify({ type: 'err', text: d.toString() })));
  ps.on('close',  code => { activeProc = null; ws.send(JSON.stringify({ type: 'done', code })); });
  ps.on('error',  err  => { activeProc = null; ws.send(JSON.stringify({ type: 'error', text: err.message })); });
}

function runPS(cmd, cb) {
  let out = '', err = '';
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd]);
  ps.stdout.on('data', d => out += d);
  ps.stderr.on('data', d => err += d);
  ps.on('close', () => cb(out.trim(), err.trim() || null));
  ps.on('error', e => cb('', e.message));
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hyper-V Web Configurator → http://127.0.0.1:${PORT}`);
});
