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
const DOWNLOADS         = path.join(SCRIPT_DIR, 'downloads.txt');
const SOFTWARES         = path.join(SCRIPT_DIR, 'softwares');
const MODELS_FILE       = path.join(SCRIPT_DIR, 'ollama-models.json');
const TOOLS_FILE        = path.join(SCRIPT_DIR, 'tools.json');
const WINGET_FILE       = path.join(SCRIPT_DIR, 'winget.json');
const PORT_SERVICES_FILE= path.join(SCRIPT_DIR, 'port-services.json');

function loadWinget() {
  try {
    if (fs.existsSync(WINGET_FILE)) return JSON.parse(fs.readFileSync(WINGET_FILE, 'utf8'));
  } catch (e) { console.warn('[winget] Failed to load winget.json:', e.message); }
  return [];
}

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
    const raw = fs.readFileSync(EXPOSURE_FILE, 'utf8').replace(/^﻿/, '');
    res.json(JSON.parse(raw));
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

// ── Database Admin ─────────────────────────────────────────────────────────────

async function dbOpen(type, host, port, database, user, password) {
  if (type === 'postgresql') {
    let pg; try { pg = require('pg'); } catch { throw new Error('Package missing – run: npm install pg'); }
    const c = new pg.Client({ host, port: +port, database: database || 'postgres', user, password, connectionTimeoutMillis: 8000 });
    await c.connect();
    return {
      query:  async (sql, p=[]) => { const r = await c.query(sql, p); return { rows: r.rows, fields: (r.fields||[]).map(f=>f.name) }; },
      close:  ()  => c.end(),
      esc:    v   => v===null?'NULL':typeof v==='number'||typeof v==='boolean'?String(v):`'${String(v).replace(/'/g,"''")}'`,
      qid:    s   => `"${String(s).replace(/"/g,'""')}"`,
    };
  } else if (type === 'mssql') {
    let sql; try { sql = require('mssql'); } catch { throw new Error('Package missing – run: npm install mssql'); }
    const pool = await sql.connect({ server: host, port: +port || 1433, database: database || 'master', user, password, options: { encrypt: true, trustServerCertificate: true }, connectionTimeout: 8000 });
    return {
      query:  async (q) => { const r = await pool.request().query(q); return { rows: r.recordset || [], fields: r.recordset?.columns ? Object.keys(r.recordset.columns) : (r.recordset?.[0] ? Object.keys(r.recordset[0]) : []) }; },
      close:  ()  => pool.close(),
      esc:    v   => v===null?'NULL':typeof v==='number'||typeof v==='boolean'?String(v):`'${String(v).replace(/'/g,"''")}'`,
      qid:    s   => `[${String(s).replace(/\]/g,']]')}]`,
    };
  } else {
    let my; try { my = require('mysql2/promise'); } catch { throw new Error('Package missing – run: npm install mysql2'); }
    const c = await my.createConnection({ host, port: +port, database: database||'information_schema', user, password, connectTimeout: 8000 });
    return {
      query:  async (sql, p=[]) => { const [rows,fields] = await c.execute(sql,p); return { rows, fields: (fields||[]).map(f=>f.name) }; },
      close:  ()  => c.end(),
      esc:    v   => v===null?'NULL':typeof v==='number'||typeof v==='boolean'?String(v):`'${String(v).replace(/'/g,"''")}'`,
      qid:    s   => `\`${String(s).replace(/`/g,'``')}\``,
    };
  }
}

app.post('/api/db/connect', async (req, res) => {
  const { type, host, port, database, user, password } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password);
    let dbs = [];
    if (type === 'postgresql') {
      const r = await db.query("SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname");
      dbs = r.rows.map(r => r.datname);
    } else if (type === 'mssql') {
      const r = await db.query("SELECT name FROM sys.databases WHERE state_desc='ONLINE' ORDER BY name");
      dbs = r.rows.map(r => r.name);
    } else {
      const r = await db.query("SHOW DATABASES");
      dbs = r.rows.map(row => Object.values(row)[0]);
    }
    await db.close();
    res.json({ ok:true, databases: dbs });
  } catch(e) { res.json({ ok:false, error: e.message }); }
});

app.post('/api/db/tables', async (req, res) => {
  const { type, host, port, database, user, password } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password);
    let tables = [];
    if (type === 'postgresql') {
      const r = await db.query(
        `SELECT t.table_name, COUNT(c.column_name)::int AS col_count
         FROM information_schema.tables t
         LEFT JOIN information_schema.columns c USING (table_name, table_schema)
         WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
         GROUP BY t.table_name ORDER BY t.table_name`);
      tables = r.rows;
    } else if (type === 'mssql') {
      const r = await db.query(
        `SELECT t.TABLE_NAME AS table_name, COUNT(c.COLUMN_NAME) AS col_count
         FROM INFORMATION_SCHEMA.TABLES t
         LEFT JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME=c.TABLE_NAME AND t.TABLE_SCHEMA=c.TABLE_SCHEMA
         WHERE t.TABLE_TYPE='BASE TABLE' AND t.TABLE_SCHEMA='dbo'
         GROUP BY t.TABLE_NAME ORDER BY t.TABLE_NAME`);
      tables = r.rows.map(r => ({ table_name: r.table_name, col_count: r.col_count || 0 }));
    } else {
      const r = await db.query('SHOW TABLES');
      tables = r.rows.map(row => ({ table_name: Object.values(row)[0], col_count: 0 }));
    }
    await db.close();
    res.json({ ok:true, tables });
  } catch(e) { res.json({ ok:false, error: e.message }); }
});

app.post('/api/db/columns', async (req, res) => {
  const { type, host, port, database, user, password, table } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password);
    let cols = [];
    if (type === 'postgresql') {
      const r = await db.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
      cols = r.rows;
    } else if (type === 'mssql') {
      const r = await db.query(
        `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable
         FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${table.replace(/'/g,"''")}' AND TABLE_SCHEMA='dbo' ORDER BY ORDINAL_POSITION`);
      cols = r.rows;
    } else {
      const r = await db.query(`DESCRIBE \`${table}\``);
      cols = r.rows.map(r => ({ column_name: r.Field, data_type: r.Type, is_nullable: r.Null }));
    }
    await db.close();
    res.json({ ok:true, columns: cols });
  } catch(e) { res.json({ ok:false, error: e.message }); }
});

app.post('/api/db/query', async (req, res) => {
  const { type, host, port, database, user, password, sql } = req.body;
  if (!sql?.trim()) return res.json({ ok:false, error:'No SQL provided' });
  try {
    const db = await dbOpen(type, host, port, database, user, password);
    const r = await db.query(sql);
    await db.close();
    const rows = (r.rows||[]);
    res.json({ ok:true, rows: rows.slice(0,500), fields: r.fields||[], total: rows.length });
  } catch(e) { res.json({ ok:false, error: e.message }); }
});

app.post('/api/db/search', async (req, res) => {
  const { type, host, port, database, user, password, query, tableList } = req.body;
  if (!query?.trim()) return res.json({ ok:false, error:'No search term' });
  try {
    const db = await dbOpen(type, host, port, database, user, password);
    const results = [];
    for (const tname of (tableList||[]).slice(0,20)) {
      let cols = [], rrows = [];
      if (type === 'postgresql') {
        const cr = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[tname]);
        cols = cr.rows.map(r=>r.column_name);
        if (!cols.length) continue;
        const where = cols.map(c=>`CAST("${c}" AS TEXT) ILIKE $1`).join(' OR ');
        const rr = await db.query(`SELECT * FROM "${tname}" WHERE ${where} LIMIT 20`,[`%${query}%`]);
        rrows = rr.rows;
      } else if (type === 'mssql') {
        const cr = await db.query(`SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${tname.replace(/'/g,"''")}' AND TABLE_SCHEMA='dbo' ORDER BY ORDINAL_POSITION`);
        cols = cr.rows.map(r=>r.column_name);
        if (!cols.length) continue;
        const safeQ = query.replace(/'/g,"''");
        const where = cols.map(c=>`CAST([${c.replace(/\]/g,']]')}] AS NVARCHAR(MAX)) LIKE '%${safeQ}%'`).join(' OR ');
        const rr = await db.query(`SELECT TOP 20 * FROM [${tname.replace(/\]/g,']]')}] WHERE ${where}`);
        rrows = rr.rows;
      } else {
        const cr = await db.query(`SHOW COLUMNS FROM \`${tname}\``);
        cols = cr.rows.map(r=>r.Field||r.column_name);
        if (!cols.length) continue;
        const where = cols.map(c=>`CAST(\`${c}\` AS CHAR) LIKE ?`).join(' OR ');
        const rr = await db.query(`SELECT * FROM \`${tname}\` WHERE ${where} LIMIT 20`,cols.map(()=>`%${query}%`));
        rrows = rr.rows;
      }
      if (rrows.length) results.push({ table:tname, columns:cols, rows:rrows });
    }
    await db.close();
    res.json({ ok:true, results, searched:(tableList||[]).slice(0,20).length });
  } catch(e) { res.json({ ok:false, error: e.message }); }
});

app.post('/api/db/export', async (req, res) => {
  const { type, host, port, database, user, password } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password);
    let out = `-- Export: ${database}  type: ${type}  date: ${new Date().toISOString()}\n\n`;
    let tnames = [];
    if (type === 'postgresql') {
      const r = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
      tnames = r.rows.map(r=>r.table_name);
    } else {
      const r = await db.query('SHOW TABLES');
      tnames = r.rows.map(row=>Object.values(row)[0]);
    }
    for (const tname of tnames) {
      let cols = [];
      if (type === 'postgresql') {
        const c = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[tname]);
        cols = c.rows.map(r=>r.column_name);
      } else {
        const c = await db.query(`SHOW COLUMNS FROM \`${tname}\``);
        cols = c.rows.map(r=>r.Field);
      }
      out += `-- Table: ${tname}\n`;
      const colList = cols.map(c=>db.qid(c)).join(',');
      const rows = await db.query(`SELECT * FROM ${db.qid(tname)}`);
      for (const row of rows.rows) {
        const vals = Object.values(row).map(v=>db.esc(v));
        out += `INSERT INTO ${db.qid(tname)} (${colList}) VALUES (${vals.join(',')});\n`;
      }
      out += '\n';
    }
    await db.close();
    res.setHeader('Content-Disposition',`attachment; filename="${database}_export.sql"`);
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.send(out);
  } catch(e) { res.json({ ok:false, error: e.message }); }
});

// ── VM Tools Installation ──────────────────────────────────────────────────────

const VM_INSTALL_CMDS = {
  ssh:      `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -EA SilentlyContinue; Start-Service sshd -EA SilentlyContinue; Set-Service sshd -StartupType Automatic -EA SilentlyContinue; New-NetFirewallRule -DisplayName 'OpenSSH-Server-In-TCP' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Profile Any -EA SilentlyContinue; Write-Output 'SSH_DONE'`,
  ftp:      `winget install --id GlFtpD.GlFTPD --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'FTP_DONE'`,
  proftpd:  `winget install --id WinSCP.WinSCP --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'WINSCP_DONE'`,
  xampp:    `winget install --id ApacheFriends.Xampp.8_2 --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'XAMPP_DONE'`,
  mysql:    `winget install --id Oracle.MySQL --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'MYSQL_DONE'`,
  nodejs:   `winget install --id OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'NODE_DONE'`,
  git:      `winget install --id Git.Git --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'GIT_DONE'`,
  claude:   `winget install --id Git.Git --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User'); npm install -g @anthropic-ai/claude-code 2>&1; Write-Output 'CLAUDE_DONE'`,
  opencode: `winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User'); npm install -g opencode-ai 2>&1; Write-Output 'OPENCODE_DONE'`,
  codex:    `winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User'); npm install -g @openai/codex 2>&1; Write-Output 'CODEX_DONE'`,
  putty:    `winget install --id PuTTY.PuTTY --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'PUTTY_DONE'`,
  libreoffice: `winget install --id TheDocumentFoundation.LibreOffice --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'LO_DONE'`,
};

app.post('/api/vm-tools/enable-rdp', (req, res) => {
  const { vmName, user, pass } = req.body;
  if (!vmName||!user||!pass) return res.status(400).json({ error:'Missing params' });
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const ps = `$c=New-Object PSCredential("${esc(user)}",(ConvertTo-SecureString "${esc(pass)}" -AsPlainText -Force));Invoke-Command -VMName "${esc(vmName)}" -Credential $c -ScriptBlock { Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' fDenyTSConnections -Value 0; Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -EA SilentlyContinue | Set-NetFirewallRule -Profile Any -Enabled True; Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp' UserAuthentication -Value 0 -EA SilentlyContinue; netsh advfirewall firewall set rule group="remote desktop" new enable=yes 2>&1 | Out-Null; Write-Output 'RDP_ENABLED' }`;
  runPS(ps, (out, err) => {
    if ((out||'').includes('RDP_ENABLED')) return res.json({ ok: true });
    res.json({ ok: false, error: (err || out || 'Unknown — check VM credentials').substring(0, 300) });
  });
});

app.post('/api/vm-tools/install', (req, res) => {
  const { vmName, user, pass, tool } = req.body;
  const cmd = VM_INSTALL_CMDS[tool];
  if (!cmd || !vmName || !user || !pass) return res.status(400).json({ error:'Missing params or unknown tool' });
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const psCmd = `$cred=New-Object PSCredential("${esc(user)}",(ConvertTo-SecureString "${esc(pass)}" -AsPlainText -Force));Invoke-Command -VMName "${esc(vmName)}" -Credential $cred -ScriptBlock { ${cmd} }`;
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  res.flushHeaders();
  const ps = spawn('powershell',['-NoProfile','-NonInteractive','-Command',psCmd]);
  const send = d => { const lines = d.toString().replace(/\r/g,'').split('\n').filter(Boolean); lines.forEach(l=>res.write(`data: ${l}\n\n`)); };
  ps.stdout.on('data',send);
  ps.stderr.on('data',d=>send('[ERR] '+d));
  ps.on('close',code=>{ res.write(`data: [DONE] exit=${code}\n\n`); res.end(); });
});

app.post('/api/vm-tools/services', (req, res) => {
  const { vmName, user, pass } = req.body;
  if (!vmName||!user||!pass) return res.status(400).json({ error:'Missing params' });
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const ps = `$c=New-Object PSCredential("${esc(user)}",(ConvertTo-SecureString "${esc(pass)}" -AsPlainText -Force));Invoke-Command -VMName "${esc(vmName)}" -Credential $c -ScriptBlock { Get-Service | Select-Object Name,DisplayName,Status,StartType | Sort-Object Status,DisplayName } | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Depth 2 -Compress`;
  runPS(ps, out => { try { res.json(JSON.parse(out.replace(/^﻿/,''))); } catch { res.json([]); } });
});

app.post('/api/vm-tools/set-service', (req, res) => {
  const { vmName, user, pass, serviceName, startType } = req.body;
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const ps = `$c=New-Object PSCredential("${esc(user)}",(ConvertTo-SecureString "${esc(pass)}" -AsPlainText -Force));Invoke-Command -VMName "${esc(vmName)}" -Credential $c -ScriptBlock { Set-Service -Name "${esc(serviceName)}" -StartupType "${esc(startType)}"; if("${esc(startType)}" -eq "Automatic"){ Start-Service "${esc(serviceName)}" -EA SilentlyContinue } }`;
  runPS(ps, () => res.json({ ok:true }));
});

app.post('/api/vm-tools/installed', (req, res) => {
  const { vmName, user, pass } = req.body;
  if (!vmName||!user||!pass) return res.status(400).json({ error:'Missing params' });
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const ps = `$c=New-Object PSCredential("${esc(user)}",(ConvertTo-SecureString "${esc(pass)}" -AsPlainText -Force));Invoke-Command -VMName "${esc(vmName)}" -Credential $c -ScriptBlock { Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -EA SilentlyContinue | Where-Object { \\$_.DisplayName } | Select-Object DisplayName,DisplayVersion,Publisher,EstimatedSize | Sort-Object DisplayName } | Select-Object DisplayName,DisplayVersion,Publisher,EstimatedSize | ConvertTo-Json -Depth 2 -Compress`;
  runPS(ps, out => { try { const d=JSON.parse(out.replace(/^﻿/,'')); res.json(Array.isArray(d)?d:[d]); } catch { res.json([]); } });
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
// Winget packages — loaded from winget.json (editable)
app.get('/api/winget', (req, res) => res.json(loadWinget()));

app.post('/api/winget', (req, res) => {
  const { name, id } = req.body;
  if (!name || !id) return res.status(400).json({ error: 'name and id required' });
  const list = loadWinget();
  if (list.find(p => p.id === id)) return res.json({ ok: true, exists: true });
  list.push({ name, id });
  try { fs.writeFileSync(WINGET_FILE, JSON.stringify(list, null, 2), 'utf8'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/winget/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const list = loadWinget().filter(p => p.id !== id);
  try { fs.writeFileSync(WINGET_FILE, JSON.stringify(list, null, 2), 'utf8'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/winget/search', (req, res) => {
  const q = (req.query.q || '').replace(/[";`]/g, '').trim();
  if (q.length < 2) return res.json([]);
  runPS(
    `winget search --query "${q}" --source winget --accept-source-agreements 2>&1`,
    (out) => {
      const lines = out.split('\n');
      const sepIdx = lines.findIndex(l => /^-[-\s]+-/.test(l.trim()));
      if (sepIdx < 1) return res.json([]);
      const sep = lines[sepIdx];
      const segs = sep.match(/-+/g);
      if (!segs || segs.length < 2) return res.json([]);
      const results = [];
      let pos = 0;
      const starts = segs.map(s => { const p = pos; pos += s.length + 1; return p; });
      for (let i = sepIdx + 1; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln.trim() || ln.includes('...')) continue;
        const getName = (idx) => ln.substring(starts[idx] || 0, starts[idx + 1] ? starts[idx + 1] - 1 : ln.length).trim();
        const name = getName(0); const id = getName(1); const version = getName(2);
        if (id && id.includes('.')) results.push({ name, id, version });
        if (results.length >= 25) break;
      }
      res.json(results);
    }
  );
});

// Ollama models — proxied from ollama.com
app.get('/api/ollama-models', (req, res) => {
  const https = require('https');
  const q = (req.query.q || '').trim();
  const url = q
    ? `https://ollama.com/search?q=${encodeURIComponent(q)}&num=20`
    : 'https://ollama.com/api/tags';
  const opts = { headers: { 'Accept': 'application/json, text/html', 'User-Agent': 'Mozilla/5.0' } };
  https.get(url, opts, r => {
    let data = '';
    r.on('data', d => data += d);
    r.on('end', () => {
      // Try JSON first
      try {
        const parsed = JSON.parse(data);
        const models = (parsed.models || parsed || []).map(m => ({
          name: m.name || m.model || m,
          description: m.description || '',
          pullCount: m.pulls || 0,
          updated: m.updated_at || m.modified_at || '',
        }));
        return res.json(models);
      } catch { /* fall through to HTML scrape */ }
      // Scrape model names from HTML search results
      const names = [];
      const re = /href="\/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:+-]+|[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.:+-]+)"/g;
      const re2 = /<h2[^>]*>\s*([a-zA-Z0-9_.-]+)\s*<\/h2>/g;
      let m;
      while ((m = re2.exec(data)) !== null) {
        const n = m[1].trim();
        if (n && !n.includes(' ') && n.length > 2) names.push({ name: n });
      }
      res.json(names.slice(0, 30));
    });
  }).on('error', () => res.json([]));
});

// Port services config — editable via frontend
app.get('/api/port-services', (req, res) => {
  try {
    if (fs.existsSync(PORT_SERVICES_FILE))
      return res.json(JSON.parse(fs.readFileSync(PORT_SERVICES_FILE, 'utf8')));
  } catch {}
  res.json(null);
});
app.post('/api/port-services', (req, res) => {
  try {
    fs.writeFileSync(PORT_SERVICES_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
