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
const STATE_FILE    = path.join(SCRIPT_DIR, 'deploy-state.json');
const EXPOSURE_FILE = path.join(SCRIPT_DIR, 'vm-exposure.json');
const PS_EXE = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';

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

// Resolve current IPv4 of a Hyper-V VM by name — called fresh on every DB connect
app.get('/api/vm-ip', (req, res) => {
  const vmName = (req.query.vmName || '').trim();
  if (!vmName) return res.status(400).json({ ok: false, error: 'vmName required' });
  runPS(
    `$addrs = @(Get-VMNetworkAdapter -VMName '${vmName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | ` +
    `ForEach-Object { $_.IPAddresses } | Where-Object { $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' }); ` +
    `if ($addrs.Count -gt 0) { $addrs[0] } else { '' }`,
    (out, err) => {
      const ip = out.trim().split(/\r?\n/)[0].trim();
      if (!ip) return res.json({ ok: false, error: err || 'No IPv4 address found for this VM' });
      res.json({ ok: true, ip });
    }
  );
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
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.post('/api/state', (req, res) => {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.delete('/api/state', (req, res) => {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.get('/api/vm-exposure', (req, res) => {
  try {
    if (!fs.existsSync(EXPOSURE_FILE)) return res.json(null);
    const raw = fs.readFileSync(EXPOSURE_FILE, 'utf8').replace(/^﻿/, '');
    res.json(JSON.parse(raw));
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.post('/api/vm-exposure', (req, res) => {
  try {
    fs.writeFileSync(EXPOSURE_FILE, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.delete('/api/vm-exposure', (req, res) => {
  try {
    if (fs.existsSync(EXPOSURE_FILE)) fs.unlinkSync(EXPOSURE_FILE);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

// ── Database Admin ─────────────────────────────────────────────────────────────

// Read a PostgreSQL pre-auth error via raw TCP socket decoded as Latin-1.
// The pg library decodes server bytes as UTF-8, replacing non-ASCII with U+FFFD.
// This fetches the same error with correct encoding, preserving German characters.
async function pgRawError(host, port, user, dbName) {
  return new Promise(resolve => {
    const net = require('net');
    const sock = net.createConnection({ host, port: +port });
    let buf = Buffer.alloc(0);
    const done = v => { try { sock.destroy(); } catch {} resolve(v); };
    sock.setTimeout(4000);
    sock.on('timeout', () => done(null));
    sock.on('error',   () => done(null));
    sock.once('connect', () => {
      const params = Buffer.from('user\0' + user + '\0database\0' + dbName + '\0\0', 'latin1');
      const hdr = Buffer.allocUnsafe(8);
      hdr.writeInt32BE(8 + params.length, 0);
      hdr.writeInt32BE(196608, 4); // protocol 3.0
      sock.write(Buffer.concat([hdr, params]));
    });
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 5) return;
      const type = buf[0];
      const mlen = buf.readInt32BE(1);
      if (buf.length < 1 + mlen) return;
      const body = buf.slice(5, 1 + mlen);
      if (type === 0x45) { // 'E' = ErrorResponse
        let i = 0, msg = '';
        while (i < body.length) {
          const ft = body[i++]; if (!ft) break;
          const nul = body.indexOf(0, i); if (nul < 0) break;
          if (ft === 0x4D) msg = body.slice(i, nul).toString('latin1');
          i = nul + 1;
        }
        done(msg || null);
      } else { done(null); }
    });
  });
}

// Sync fallback — used where error is already captured as a JS string.
function dbErrMsg(e) { return e?.message || String(e); }

// Async version — recovers German/Latin-1 chars by re-fetching via raw socket.
async function dbErrMsgAsync(e, host, port, user, dbName) {
  const raw = e?.message || String(e);
  if (raw.includes('�') && host && port && user) {
    try {
      const fix = await pgRawError(host, port, user, dbName || 'postgres');
      if (fix && !fix.includes('�')) return fix;
    } catch {}
  }
  return raw;
}

async function dbOpen(type, host, port, database, user, password, sslMode = 'auto') {
  if (type === 'postgresql') {
    let pg; try { pg = require('pg'); } catch { throw new Error('Package missing – run: npm install pg'); }
    const requestedDb = database || 'postgres';
    const isPgHba = m => m.includes('pg_hba') || m.includes('verschl') || m.includes('encryption');
    const noSsl   = m => m.includes('does not support ssl') || m.includes('ssl connections');
    const tryConn = async (ssl, dbName) => {
      const c = new pg.Client({
        host, port: +port, database: dbName, user, password,
        connectionTimeoutMillis: 8000,
        ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
      });
      await c.connect();
      return c;
    };
    // Build attempt list based on sslMode
    // 'auto': plain first (try both db names), then ssl fallback
    // 'on':   ssl only
    // 'off':  plain only
    const sslValues = sslMode === 'on' ? [true] : sslMode === 'off' ? [false] : [false, true];
    const dbNames   = [requestedDb, ...(user && user !== requestedDb ? [user] : [])];
    const attempts  = sslValues.flatMap(ssl => dbNames.map(db => [ssl, db]));

    let c, usedSsl = false, usedDb = requestedDb, pgHbaErr, noSslErr;
    for (const [ssl, dbName] of attempts) {
      try {
        c = await tryConn(ssl, dbName);
        usedSsl = ssl;
        usedDb  = dbName;
        break;
      } catch (e) {
        const msg = dbErrMsg(e).toLowerCase();
        if (isPgHba(msg)) { pgHbaErr = pgHbaErr || e; continue; }
        if (noSsl(msg))   { noSslErr = noSslErr || e; continue; }
        throw e;
      }
    }
    // Prefer pg_hba error (root cause) over "does not support SSL" (symptom).
    // Re-fetch the error with Latin-1 decoding so German chars display correctly.
    if (!c) {
      const rootErr = pgHbaErr || noSslErr;
      if (rootErr) {
        const cleanMsg = await dbErrMsgAsync(rootErr, host, port, user, requestedDb);
        throw new Error(cleanMsg);
      }
      throw new Error('Connection failed');
    }
    return {
      query:  async (sql, p=[]) => { const r = await c.query(sql, p); return { rows: r.rows, fields: (r.fields||[]).map(f=>f.name) }; },
      close:  ()  => c.end(),
      esc:    v   => v===null?'NULL':typeof v==='number'||typeof v==='boolean'?String(v):`'${String(v).replace(/'/g,"''")}'`,
      qid:    s   => `"${String(s).replace(/"/g,'""')}"`,
      ssl:    usedSsl,
      database: usedDb,
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

// Returns table counts for every database — runs parallel connections so it's fast
app.post('/api/db/db-table-counts', async (req, res) => {
  const { type, host, port, user, password, sslMode, databases } = req.body;
  if (!Array.isArray(databases) || !databases.length) return res.json({ ok: true, counts: {} });
  const counts = {};
  await Promise.all(databases.map(async dbName => {
    try {
      const db = await dbOpen(type, host, port, dbName, user, password, sslMode || 'auto');
      let c = 0;
      if (type === 'postgresql') {
        const r = await db.query(`SELECT COUNT(*)::int AS c FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
        c = r.rows[0].c;
      } else if (type === 'mssql') {
        const r = await db.query(`SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' AND TABLE_SCHEMA='dbo'`);
        c = r.rows[0].c || 0;
      } else {
        const r = await db.query(`SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'`);
        c = r.rows[0].c || 0;
      }
      counts[dbName] = c;
      await db.close();
    } catch { counts[dbName] = null; }
  }));
  res.json({ ok: true, counts });
});

app.post('/api/db/connect', async (req, res) => {
  const { type, host, port, database, user, password, sslMode } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password, sslMode || 'auto');
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
    const ssl = db.ssl || false;
    const connectedDb = db.database || database || '';
    await db.close();
    res.json({ ok: true, databases: dbs, ssl, database: connectedDb });
  } catch(e) {
    // Try raw socket to recover proper Latin-1 encoding of PostgreSQL error messages
    const msg = type === 'postgresql'
      ? await dbErrMsgAsync(e, host, port, user, database || 'postgres')
      : dbErrMsg(e);
    res.json({ ok: false, error: msg });
  }
});

app.post('/api/db/tables', async (req, res) => {
  const { type, host, port, database, user, password, sslMode } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password, sslMode || 'auto');
    let tables = [];
    if (type === 'postgresql') {
      // Fast catalog estimate first (readable by any user, no ownership restriction)
      const r = await db.query(
        `SELECT t.table_name,
                COUNT(c.column_name)::int                  AS col_count,
                CASE WHEN pc.reltuples < 0 THEN NULL
                     ELSE pc.reltuples::bigint END          AS row_count
         FROM information_schema.tables t
         LEFT JOIN information_schema.columns c USING (table_name, table_schema)
         JOIN pg_class     pc ON pc.relname = t.table_name
         JOIN pg_namespace pn ON pn.oid = pc.relnamespace
                              AND pn.nspname = t.table_schema
         WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         GROUP BY t.table_name, pc.reltuples
         ORDER BY t.table_name`);
      tables = r.rows;
      // For tables never ANALYZEd (reltuples = -1 → null), run exact COUNT(*)
      const unanalyzed = tables.filter(t => t.row_count == null);
      if (unanalyzed.length > 0) {
        await Promise.all(unanalyzed.map(async t => {
          try {
            const cr = await db.query(`SELECT COUNT(*)::bigint AS c FROM "${t.table_name}"`);
            t.row_count = cr.rows[0].c;
          } catch (_) { t.row_count = 0; }
        }));
      }
    } else if (type === 'mssql') {
      // sys.partitions gives fast row-count estimates without a full scan
      const r = await db.query(
        `SELECT t.TABLE_NAME AS table_name,
                COUNT(c.COLUMN_NAME)                       AS col_count,
                COALESCE(SUM(p.rows), 0)                   AS row_count
         FROM INFORMATION_SCHEMA.TABLES t
         LEFT JOIN INFORMATION_SCHEMA.COLUMNS c
               ON t.TABLE_NAME=c.TABLE_NAME AND t.TABLE_SCHEMA=c.TABLE_SCHEMA
         LEFT JOIN sys.tables  st ON st.name = t.TABLE_NAME
         LEFT JOIN sys.partitions p
               ON st.object_id = p.object_id AND p.index_id IN (0,1)
         WHERE t.TABLE_TYPE='BASE TABLE' AND t.TABLE_SCHEMA='dbo'
         GROUP BY t.TABLE_NAME ORDER BY t.TABLE_NAME`);
      tables = r.rows.map(r => ({ table_name: r.table_name, col_count: r.col_count || 0, row_count: r.row_count || 0 }));
    } else {
      // MySQL/MariaDB: TABLE_ROWS is an InnoDB estimate (fast, no scan)
      const r = await db.query(
        `SELECT TABLE_NAME AS table_name,
                TABLE_ROWS AS row_count
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`);
      tables = r.rows.map(row => ({ table_name: row.table_name, col_count: 0, row_count: row.row_count || 0 }));
    }
    await db.close();
    res.json({ ok:true, tables });
  } catch(e) { res.json({ ok:false, error: dbErrMsg(e) }); }
});

app.post('/api/db/columns', async (req, res) => {
  const { type, host, port, database, user, password, table, sslMode } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password, sslMode || 'auto');
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
  } catch(e) { res.json({ ok:false, error: dbErrMsg(e) }); }
});

app.post('/api/db/query', async (req, res) => {
  const { type, host, port, database, user, password, sql, sslMode } = req.body;
  if (!sql?.trim()) return res.json({ ok:false, error:'No SQL provided' });
  try {
    const db = await dbOpen(type, host, port, database, user, password, sslMode || 'auto');
    const r = await db.query(sql);
    await db.close();
    const rows = (r.rows||[]);
    res.json({ ok:true, rows: rows.slice(0,500), fields: r.fields||[], total: rows.length });
  } catch(e) { res.json({ ok:false, error: dbErrMsg(e) }); }
});

app.post('/api/db/search', async (req, res) => {
  const { type, host, port, database, user, password, query, tableList, sslMode,
          rowLimit = 100, searchMeta = true } = req.body;
  if (!query?.trim()) return res.json({ ok: false, error: 'No search term' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = obj => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
  let cancelled = false;
  res.on('close', () => { cancelled = true; }); // res, not req — in Node 18+ req.close fires on body-read, not on client disconnect

  let db;
  try {
    db = await dbOpen(type, host, port, database, user, password, sslMode || 'auto');
  } catch (e) {
    send({ type: 'error', error: dbErrMsg(e) });
    return res.end();
  }

  const tables = tableList || [];
  const limit  = Math.min(Math.max(1, +rowLimit || 100), 1000);
  const lq     = query.toLowerCase();
  send({ type: 'start', total: tables.length });

  let found = 0;
  for (let i = 0; i < tables.length; i++) {
    if (cancelled) break;
    const tname = tables[i];
    send({ type: 'progress', table: tname, idx: i + 1, total: tables.length });
    try {
      let cols = [], rrows = [];
      if (type === 'postgresql') {
        const cr = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [tname]);
        cols = cr.rows.map(r => r.column_name);
        if (!cols.length) continue;
        const where = cols.map(c => `CAST("${c}" AS TEXT) ILIKE $1`).join(' OR ');
        const rr = await db.query(`SELECT * FROM "${tname}" WHERE ${where} LIMIT ${limit}`, [`%${query}%`]);
        rrows = rr.rows;
      } else if (type === 'mssql') {
        const cr = await db.query(`SELECT COLUMN_NAME AS column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${tname.replace(/'/g,"''")}' AND TABLE_SCHEMA='dbo' ORDER BY ORDINAL_POSITION`);
        cols = cr.rows.map(r => r.column_name);
        if (!cols.length) continue;
        const safeQ = query.replace(/'/g, "''");
        const where = cols.map(c => `CAST([${c.replace(/\]/g, ']]')}] AS NVARCHAR(MAX)) LIKE '%${safeQ}%'`).join(' OR ');
        const rr = await db.query(`SELECT TOP ${limit} * FROM [${tname.replace(/\]/g, ']]')}] WHERE ${where}`);
        rrows = rr.rows;
      } else {
        const cr = await db.query(`SHOW COLUMNS FROM \`${tname}\``);
        cols = cr.rows.map(r => r.Field || r.column_name);
        if (!cols.length) continue;
        const where = cols.map(c => `CAST(\`${c}\` AS CHAR) LIKE ?`).join(' OR ');
        const rr = await db.query(`SELECT * FROM \`${tname}\` WHERE ${where} LIMIT ${limit}`, cols.map(() => `%${query}%`));
        rrows = rr.rows;
      }
      const metaCols  = searchMeta ? cols.filter(c => c.toLowerCase().includes(lq)) : [];
      const metaTable = searchMeta && tname.toLowerCase().includes(lq);
      if (rrows.length || metaCols.length || metaTable) {
        found++;
        send({ type: 'result', table: tname, columns: cols, rows: rrows, metaCols, metaTable });
      }
    } catch (_) { /* skip table on error, continue searching */ }
  }
  try { await db.close(); } catch {}
  send({ type: 'done', searched: tables.length, found, cancelled });
  res.end();
});

app.post('/api/db/export', async (req, res) => {
  const { type, host, port, database, user, password, sslMode } = req.body;
  try {
    const db = await dbOpen(type, host, port, database, user, password, sslMode || 'auto');
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
  } catch(e) { res.json({ ok:false, error: dbErrMsg(e) }); }
});

// ── VM Port Exposure ──────────────────────────────────────────────────────────

// Returns currently active portproxy rules (forwarded ports) + host external IP
app.get('/api/vm/exposure-status', (req, res) => {
  runPS(
    `$rules = @(); ` +
    `(netsh interface portproxy show v4tov4 2>$null) -split '\\r?\\n' | ForEach-Object { ` +
    `  if ($_ -match '^\\s+\\S+\\s+(\\d+)\\s+\\S+\\s+(\\d+)') { $rules += [int]$Matches[2] } ` +
    `}; ` +
    `$hostIp = (Get-NetIPAddress -AddressFamily IPv4 | ` +
    `  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ` +
    `  Sort-Object @{E={$a=$_.InterfaceAlias;if($a -match 'WLAN|Wi-Fi'){1}elseif($a -match 'Ethernet'){2}else{3}}} | ` +
    `  Select-Object -First 1).IPAddress; ` +
    `ConvertTo-Json -InputObject ([ordered]@{ports=@($rules|Sort-Object -Unique);hostIp="$hostIp"}) -Compress`,
    (out) => { try { res.json(JSON.parse(out || '{}')); } catch { res.json({ ports: [], hostIp: null }); } }
  );
});

// Returns TCP ports listening on the local host machine (simple list)
app.get('/api/host/ports', (req, res) => {
  runPS(
    `$ex = @(135,139,445,2179,5985,47001); ` +
    `$p = @(Get-NetTCPConnection -State Listen -EA SilentlyContinue | ` +
    `  Where-Object { $_.LocalPort -notin $ex -and $_.LocalPort -lt 49000 } | ` +
    `  Select-Object -ExpandProperty LocalPort | Sort-Object -Unique); ` +
    `if ($p.Count -gt 0) { ConvertTo-Json -InputObject $p -Compress } else { Write-Output '[]' }`,
    (out) => { try { const d = JSON.parse(out || '[]'); res.json(Array.isArray(d) ? d : [d]); } catch { res.json([]); } }
  );
});

// Returns rich port info: process name, portproxy target, VM name from exposure file
app.get('/api/host/ports-rich', (req, res) => {
  const expFile = EXPOSURE_FILE;
  runPS(
    `$ex = @(135,139,445,2179,5985,47001); ` +
    `$conns = @(Get-NetTCPConnection -State Listen -EA SilentlyContinue | ` +
    `  Where-Object { $_.LocalPort -notin $ex -and $_.LocalPort -lt 49000 } | ` +
    `  Sort-Object LocalPort -Unique); ` +
    `$pMap = @{}; ` +
    `Get-Process -Id @($conns.OwningProcess) -EA SilentlyContinue | ForEach-Object { $pMap[$_.Id] = @{n=$_.ProcessName;d=$_.Description} }; ` +
    `$pp = @{}; ` +
    `(netsh interface portproxy show v4tov4 2>$null) -split '\\r?\\n' | ForEach-Object { ` +
    `  if ($_ -match '^\\s*[\\d.]+\\s+(\\d+)\\s+([\\d.]+)\\s+(\\d+)') { $pp[[int]$Matches[1]]=@{ip=$Matches[2];port=[int]$Matches[3]} } ` +
    `}; ` +
    `$vmIpMap = @{}; ` +
    `if (Test-Path '${expFile.replace(/\\/g,'\\\\').replace(/'/g,"''")}') { ` +
    `  try { $exp=Get-Content '${expFile.replace(/\\/g,'\\\\').replace(/'/g,"''")}' -Raw | ConvertFrom-Json; $vmIpMap["$($exp.vmIp)"]="$($exp.vmName)" } catch {} ` +
    `}; ` +
    `$r = @($conns | ForEach-Object { ` +
    `  $port=$_.LocalPort; $pid=$_.OwningProcess; $pr=$pMap[$pid]; $ppI=$pp[$port]; ` +
    `  [ordered]@{port=$port;pid=$pid;process=if($pr){"$($pr.n)"}else{""};description=if($pr){"$($pr.d)"}else{""}; ` +
    `   isPortProxy=[bool]$ppI;proxyIp=if($ppI){"$($ppI.ip)"}else{$null};proxyPort=if($ppI){[int]$ppI.port}else{0}; ` +
    `   vmName=if($ppI){"$($vmIpMap[$ppI.ip])"}else{$null}} ` +
    `}); ` +
    `if ($r.Count -gt 0) { ConvertTo-Json -InputObject $r -Compress } else { Write-Output "[]" }`,
    (out) => { try { const d = JSON.parse(out || '[]'); res.json(Array.isArray(d) ? d : [d]); } catch { res.json([]); } }
  );
});

// On-demand: resolve process name for a specific local port (for "Request" button)
app.get('/api/host/resolve-port-process', (req, res) => {
  const port = +req.query.port;
  if (!port) return res.status(400).json({ error: 'port required' });
  runPS(
    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -EA SilentlyContinue | Select-Object -First 1; ` +
    `if ($c) { $proc = Get-Process -Id $c.OwningProcess -EA SilentlyContinue; ` +
    `  ConvertTo-Json -InputObject @{pid=$c.OwningProcess;process="$($proc.ProcessName)";description="$($proc.Description)";company="$($proc.Company)"} -Compress ` +
    `} else { Write-Output '{}' }`,
    (out) => { try { res.json(JSON.parse(out || '{}')); } catch { res.json({}); } }
  );
});

// Clear all VM portproxy rules + firewall rules (call before switching to a different VM)
app.post('/api/vm/clear-exposure', (req, res) => {
  runPS(
    `$removed = 0; ` +
    `(netsh interface portproxy show v4tov4 2>$null) -split '\\r?\\n' | ForEach-Object { ` +
    `  if ($_ -match '^\\s*[\\d.]+\\s+(\\d+)') { ` +
    `    $p = [int]$Matches[1]; ` +
    `    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$p 2>&1 | Out-Null; ` +
    `    Remove-NetFirewallRule -DisplayName "VMProxy-$p" -EA SilentlyContinue; ` +
    `    $removed++ ` +
    `  } ` +
    `}; ` +
    `Remove-NetFirewallRule -DisplayName 'VM-FullExposure-Auto'   -EA SilentlyContinue; ` +
    `Remove-NetFirewallRule -DisplayName 'VM-PortsExposure-Auto' -EA SilentlyContinue; ` +
    `Write-Output "REMOVED:$removed"`,
    (out) => {
      const n = +(out.match(/REMOVED:(\d+)/)?.[1] || '0');
      try { if (fs.existsSync(EXPOSURE_FILE)) fs.unlinkSync(EXPOSURE_FILE); } catch {}
      res.json({ ok: true, removed: n });
    }
  );
});

// Test PSSession credentials for a VM
app.post('/api/vm/test-credentials', (req, res) => {
  const { vmName, vmUser, vmPass } = req.body;
  if (!vmName || !vmUser || !vmPass) return res.status(400).json({ ok: false, error: 'vmName, vmUser, vmPass required' });
  const esc = s => String(s).replace(/'/g, "''");
  runPS(
    `$cred = New-Object PSCredential('${esc(vmUser)}', (ConvertTo-SecureString '${esc(vmPass)}' -AsPlainText -Force)); ` +
    `try { $r = Invoke-Command -VMName '${esc(vmName)}' -Credential $cred -ScriptBlock { $env:COMPUTERNAME } -EA Stop; Write-Output "OK:$r" } ` +
    `catch { Write-Output "ERR:$($_.Exception.Message)" }`,
    (out) => {
      const line = out.trim();
      if (line.startsWith('OK:')) res.json({ ok: true, computerName: line.slice(3) });
      else res.json({ ok: false, error: line.startsWith('ERR:') ? line.slice(4) : line });
    }
  );
});

// TCP probe: check which ports on a host are open (for DB auto-detect)
app.post('/api/probe-ports', (req, res) => {
  const { host, ports } = req.body;
  if (!host || !Array.isArray(ports) || !ports.length) return res.status(400).json({ error: 'host and ports[] required' });
  const net = require('net');
  const results = {};
  const checks = ports.map(port => new Promise(resolve => {
    const sock = net.createConnection({ host, port: +port });
    sock.setTimeout(1500);
    sock.on('connect', () => { results[port] = true;  sock.destroy(); resolve(); });
    sock.on('timeout', () => { results[port] = false; sock.destroy(); resolve(); });
    sock.on('error',   () => { results[port] = false;               resolve(); });
  }));
  Promise.all(checks).then(() => res.json(results));
});

// Expose VM ports via portproxy + firewall rules (SSE stream, mode: 'full' | 'ports')
app.post('/api/vm/expose', (req, res) => {
  const { vmName, vmUser, vmPass, mode, ports } = req.body;
  if (!vmName || !vmUser || !vmPass) return res.status(400).json({ error: 'vmName, vmUser, vmPass required' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = obj => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
  const portList = mode === 'ports' ? (Array.isArray(ports) ? ports : []).map(p => +p).filter(p => p > 0 && p < 65536) : [];
  if (mode === 'ports' && !portList.length) { send({ type: 'error', error: 'No valid ports specified' }); return res.end(); }

  const esc = s => String(s).replace(/'/g, "''");
  const tmpScript = path.join(os.tmpdir(), `vm_expose_${Date.now()}.ps1`);

  const lines = [
    `$ErrorActionPreference = 'Stop'`,
    `$cred = New-Object PSCredential('${esc(vmUser)}', (ConvertTo-SecureString '${esc(vmPass)}' -AsPlainText -Force))`,
    `$vmIp = @(Get-VMNetworkAdapter -VMName '${esc(vmName)}' -EA SilentlyContinue | ForEach-Object { $_.IPAddresses } | Where-Object { $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' })[0]`,
    `if (-not $vmIp) { Write-Output 'ERROR:Cannot resolve VM IP'; exit 1 }`,
    `Write-Output "VM_IP:$vmIp"`,
  ];

  if (mode === 'full') {
    lines.push(
      `Write-Output 'STEP:Enabling RDP in VM'`,
      `Invoke-Command -VMName '${esc(vmName)}' -Credential $cred -ScriptBlock {`,
      `  Set-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' fDenyTSConnections -Value 0 -Type DWord`,
      `  Set-Service TermService -StartupType Automatic -EA SilentlyContinue; Start-Service TermService -EA SilentlyContinue`,
      `  Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -EA SilentlyContinue | Set-NetFirewallRule -Profile Any -Enabled True`,
      `}`,
      `Write-Output 'STEP:Scanning VM listening ports'`,
      `$ex = @(135,139,445,2179,5985,47001)`,
      `$vmPorts = @(Invoke-Command -VMName '${esc(vmName)}' -Credential $cred -ScriptBlock {`,
      `  Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -ne '127.0.0.1' -and $_.LocalPort -notin $using:ex -and $_.LocalPort -lt 49000 } | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique`,
      `})`,
      `if (3389 -notin $vmPorts) { $vmPorts = @(3389) + @($vmPorts) }`,
      `Write-Output "PORTS:$($vmPorts -join ',')"`,
      `Write-Output 'STEP:Opening VM firewall for all detected ports'`,
      `Invoke-Command -VMName '${esc(vmName)}' -Credential $cred -ScriptBlock {`,
      `  Remove-NetFirewallRule -DisplayName 'VM-FullExposure-Auto' -EA SilentlyContinue`,
      `  New-NetFirewallRule -DisplayName 'VM-FullExposure-Auto' -Direction Inbound -Protocol TCP -LocalPort $using:vmPorts -Action Allow -Profile Any | Out-Null`,
      `}`
    );
  } else {
    lines.push(
      `$vmPorts = @(${portList.join(',')})`,
      `Write-Output "PORTS:$($vmPorts -join ',')"`,
      `Write-Output 'STEP:Opening VM firewall for selected ports'`,
      `Invoke-Command -VMName '${esc(vmName)}' -Credential $cred -ScriptBlock {`,
      `  Remove-NetFirewallRule -DisplayName 'VM-PortsExposure-Auto' -EA SilentlyContinue`,
      `  New-NetFirewallRule -DisplayName 'VM-PortsExposure-Auto' -Direction Inbound -Protocol TCP -LocalPort $using:vmPorts -Action Allow -Profile Any | Out-Null`,
      `}`
    );
  }

  lines.push(
    `Write-Output 'STEP:Configuring host portproxy and firewall rules'`,
    `foreach ($port in $vmPorts) {`,
    `  netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>&1 | Out-Null`,
    `  netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$vmIp connectport=$port | Out-Null`,
    `  $rn = "VMProxy-$port"`,
    `  Remove-NetFirewallRule -DisplayName $rn -EA SilentlyContinue`,
    `  New-NetFirewallRule -DisplayName $rn -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any | Out-Null`,
    `}`,
    `$hostIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Sort-Object @{E={$a=$_.InterfaceAlias;if($a -match 'WLAN|Wi-Fi'){1}elseif($a -match 'Ethernet'){2}else{3}}} | Select-Object -First 1).IPAddress`,
    `$json = [ordered]@{ vmName='${esc(vmName)}'; vmIp=$vmIp; hostIp=$hostIp; rdp=(3389 -in $vmPorts); ports=@($vmPorts|ForEach-Object{[int]$_}); timestamp=(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') } | ConvertTo-Json -Compress`,
    `$utf8 = New-Object System.Text.UTF8Encoding $false`,
    `[System.IO.File]::WriteAllText('C:\\ollama-ssl\\vm-exposure.json', $json, $utf8)`,
    `Write-Output "DONE:$hostIp"`
  );

  fs.writeFileSync(tmpScript, lines.join('\r\n'), 'utf8');
  const ps = spawn(PS_EXE,['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpScript]);
  res.on('close', () => { try { ps.kill(); } catch {} });
  ps.stdout.on('data', d => {
    for (const line of cleanOutput(d.toString('utf8')).split('\n').filter(l => l.trim())) {
      if      (line.startsWith('VM_IP:'))  send({ type: 'vmip',  ip:     line.slice(6).trim() });
      else if (line.startsWith('STEP:'))   send({ type: 'step',  text:   line.slice(5).trim() });
      else if (line.startsWith('PORTS:'))  send({ type: 'ports', ports:  line.slice(6).trim().split(',').map(Number).filter(Boolean) });
      else if (line.startsWith('DONE:'))   send({ type: 'done',  hostIp: line.slice(5).trim() });
      else if (line.startsWith('ERROR:'))  send({ type: 'error', error:  line.slice(6).trim() });
      else                                 send({ type: 'log',   text:   line });
    }
  });
  ps.stderr.on('data', d => { for (const l of cleanOutput(d.toString('utf8')).split('\n').filter(Boolean)) send({ type: 'log', text: l }); });
  ps.on('close', code => { if (code !== 0) send({ type: 'error', error: `Exit ${code}` }); try { fs.unlinkSync(tmpScript); } catch {} res.end(); });
  ps.on('error', e => { send({ type: 'error', error: e.message }); res.end(); });
});

// ── pg_hba.conf management ────────────────────────────────────────────────────

const PGHBA_BACKUP_DIR = path.join(SCRIPT_DIR, 'pghba-backups');

function pgHbaBackupPath(vmName) {
  const safe = vmName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(PGHBA_BACKUP_DIR, `${safe}_pg_hba.conf`);
}

// Check if a local backup exists for a VM
app.get('/api/db/pghba-backup-status', (req, res) => {
  const vmName = req.query.vmName || '';
  if (!vmName) return res.json({ exists: false });
  const p = pgHbaBackupPath(vmName);
  if (!fs.existsSync(p)) return res.json({ exists: false });
  try {
    const stat = fs.statSync(p);
    res.json({ exists: true, size: stat.size, modified: stat.mtime.toISOString(), path: p });
  } catch { res.json({ exists: false }); }
});

// Return local backup content as text
app.get('/api/db/pghba-backup-content', (req, res) => {
  const vmName = req.query.vmName || '';
  if (!vmName) return res.status(400).json({ error: 'vmName required' });
  const p = pgHbaBackupPath(vmName);
  if (!fs.existsSync(p)) return res.json({ ok: false, error: 'No backup found' });
  try {
    const content = fs.readFileSync(p, 'utf8');
    res.json({ ok: true, content });
  } catch (e) { res.json({ ok: false, error: dbErrMsg(e) }); }
});

// Restore backup file to VM — overwrites current pg_hba.conf and reloads
app.post('/api/db/pghba-restore', async (req, res) => {
  const { vmName, vmUser, vmPass, pgDataDir } = req.body;
  if (!vmName || !vmUser || !vmPass) return res.json({ ok: false, error: 'vmName, vmUser, vmPass required' });
  const backupPath = pgHbaBackupPath(vmName);
  if (!fs.existsSync(backupPath)) return res.json({ ok: false, error: 'No local backup found for this VM' });
  const content = fs.readFileSync(backupPath, 'utf8');
  const escapedContent = JSON.stringify(content);
  const esc = s => String(s).replace(/'/g, "''");
  const tmpScript = path.join(os.tmpdir(), `pghba_restore_${Date.now()}.ps1`);
  const psLines = [
    `$ErrorActionPreference = 'Stop'`,
    `$dataDir = '${(pgDataDir || '').replace(/'/g, "''")}'`,
    `if (-not $dataDir) {`,
    `    $f = Get-ChildItem 'C:\\Program Files\\PostgreSQL' -Recurse -Filter 'pg_hba.conf' -EA SilentlyContinue | Select-Object -First 1`,
    `    $dataDir = if ($f) { $f.DirectoryName } else { $null }`,
    `}`,
    `if (-not $dataDir) { throw 'pg_hba.conf not found' }`,
    `$hbaPath = Join-Path $dataDir 'pg_hba.conf'`,
    `$pgCtl   = Join-Path (Split-Path $dataDir -Parent) 'bin\\pg_ctl.exe'`,
    `$content = ${escapedContent}`,
    `$enc = New-Object System.Text.UTF8Encoding($false)`,
    `[System.IO.File]::WriteAllText($hbaPath, $content, $enc)`,
    `if (Test-Path $pgCtl) { & $pgCtl reload -D $dataDir | Out-Null }`,
    `Write-Output 'RESTORED'`,
  ].join('\r\n');
  fs.writeFileSync(tmpScript, psLines, 'utf8');
  try {
    const result = await new Promise((resolve, reject) => {
      const cmd = `$cred = New-Object PSCredential('${esc(vmUser)}', (ConvertTo-SecureString '${esc(vmPass)}' -AsPlainText -Force)); Invoke-Command -VMName '${esc(vmName)}' -Credential $cred -FilePath '${tmpScript}'`;
      const proc = spawn(PS_EXE,['-NonInteractive', '-Command', cmd], { timeout: 35000 });
      let out = '', err = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => err += d);
      proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`)));
    });
    res.json({ ok: result.includes('RESTORED'), message: 'pg_hba.conf restored and reloaded.' });
  } catch (e) { res.json({ ok: false, error: dbErrMsg(e) }); }
  finally { try { fs.unlinkSync(tmpScript); } catch {} }
});

// ── Fix pg_hba.conf via PSSession ─────────────────────────────────────────────
// Adds host entries for the connecting host IPs so external connections are allowed.
app.post('/api/db/fix-pghba', async (req, res) => {
  const { vmName, vmUser, vmPass, pgDataDir } = req.body;
  if (!vmName || !vmUser || !vmPass) return res.json({ ok: false, error: 'vmName, vmUser, vmPass required' });

  // Determine the host IPs that need access (all non-loopback IPv4 addresses)
  const os = require('os');
  const hostIps = Object.values(os.networkInterfaces())
    .flat().filter(n => n.family === 'IPv4' && !n.internal).map(n => n.address);

  // Build CIDR list from host IPs — use /32 for exact match
  const cidrs = hostIps.map(ip => `${ip}/32`);
  // Also add common Hyper-V subnets
  const extra = ['172.31.48.0/20', '172.16.0.0/12', '192.168.0.0/16'];
  const allCidrs = [...new Set([...cidrs, ...extra])];

  const cidrLines = allCidrs.map(c => `host    all             all             ${c.padEnd(24)}scram-sha-256`).join('\r\n');

  // Build the PowerShell script as a temp file — avoids quoting issues with inline ScriptBlock
  const tmpScript = path.join(os.tmpdir(), `fix_pghba_${Date.now()}.ps1`);
  const newLines = `\r\n# Added by ollama-ssl-installator\r\n${cidrLines}\r\n`;
  // PowerShell uses backtick escapes in double-quoted strings, not backslash.
  // JSON.stringify would produce \r\n which PS treats as literal chars — convert to `r`n instead.
  const psNewLines = '"' + newLines
    .replace(/`/g, '``').replace(/"/g, '`"').replace(/\r/g, '`r').replace(/\n/g, '`n') + '"';
  const psScript = [
    `$ErrorActionPreference = 'Stop'`,
    `$dataDir = '${(pgDataDir || '').replace(/'/g, "''")}'`,
    `if (-not $dataDir) {`,
    `    $f = Get-ChildItem 'C:\\Program Files\\PostgreSQL' -Recurse -Filter 'pg_hba.conf' -EA SilentlyContinue | Select-Object -First 1`,
    `    $dataDir = if ($f) { $f.DirectoryName } else { $null }`,
    `}`,
    `if (-not $dataDir) { throw 'pg_hba.conf not found' }`,
    `$hbaPath = Join-Path $dataDir 'pg_hba.conf'`,
    `$pgCtl   = Join-Path (Split-Path $dataDir -Parent) 'bin\\pg_ctl.exe'`,
    `$bytes   = [System.IO.File]::ReadAllBytes($hbaPath)`,
    `if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $bytes = $bytes[3..($bytes.Length-1)] }`,
    `$text    = [System.Text.Encoding]::UTF8.GetString($bytes)`,
    `$marker  = '# Added by ollama-ssl-installator'`,
    // Always output original content as base64 so Node.js can save a backup
    `$originalB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))`,
    `Write-Output "ORIGINAL_B64:$originalB64"`,
    `if ($text -notmatch [regex]::Escape($marker)) {`,
    `    $enc = New-Object System.Text.UTF8Encoding($false)`,
    `    [System.IO.File]::WriteAllText($hbaPath, $text + ${psNewLines}, $enc)`,
    `    if (Test-Path $pgCtl) { & $pgCtl reload -D $dataDir | Out-Null }`,
    `    Write-Output 'UPDATED'`,
    `} else { Write-Output 'ALREADY_DONE' }`,
  ].join('\r\n');

  fs.writeFileSync(tmpScript, psScript, 'utf8');
  try {
    const result = await new Promise((resolve, reject) => {
      const cmd = [
        `$cred = New-Object PSCredential('${vmUser.replace(/'/g,"''")}', (ConvertTo-SecureString '${vmPass.replace(/'/g,"''")}' -AsPlainText -Force))`,
        `Invoke-Command -VMName '${vmName.replace(/'/g,"''")}' -Credential $cred -FilePath '${tmpScript}'`,
      ].join('; ');
      const proc = spawn(PS_EXE,['-NonInteractive', '-Command', cmd], { timeout: 35000 });
      let out = '', err = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => err += d);
      proc.on('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`)));
    });
    // Save original content as local backup (always, so user can restore even if already configured)
    const b64Match = result.match(/ORIGINAL_B64:([A-Za-z0-9+/=]+)/);
    let backupSaved = false;
    if (b64Match) {
      try {
        if (!fs.existsSync(PGHBA_BACKUP_DIR)) fs.mkdirSync(PGHBA_BACKUP_DIR, { recursive: true });
        const original = Buffer.from(b64Match[1], 'base64').toString('utf8');
        fs.writeFileSync(pgHbaBackupPath(vmName), original, 'utf8');
        backupSaved = true;
      } catch (_) {}
    }
    const msg = result.includes('UPDATED') ? 'pg_hba.conf updated and reloaded.' : 'Already configured.';
    res.json({ ok: true, message: msg, cidrs: allCidrs, backupSaved });
  } catch (e) {
    res.json({ ok: false, error: dbErrMsg(e) });
  } finally {
    try { fs.unlinkSync(tmpScript); } catch {}
  }
});

// ── VM Tools Installation ──────────────────────────────────────────────────────

const _wg = (id, tag) =>
  `winget install --id ${id} --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output '${tag}_DONE'`;

const VM_INSTALL_CMDS = {
  // Remote Access
  ssh:          `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -EA SilentlyContinue; Start-Service sshd -EA SilentlyContinue; Set-Service sshd -StartupType Automatic -EA SilentlyContinue; New-NetFirewallRule -DisplayName 'OpenSSH-Server-In-TCP' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Profile Any -EA SilentlyContinue; Write-Output 'SSH_DONE'`,
  ftp:          _wg('GlFtpD.GlFTPD',                        'FTP'),
  winscp:       _wg('WinSCP.WinSCP',                        'WINSCP'),
  putty:        _wg('PuTTY.PuTTY',                          'PUTTY'),
  // Browsers
  firefox:      _wg('Mozilla.Firefox',                      'FIREFOX'),
  chrome:       _wg('Google.Chrome',                        'CHROME'),
  // Editors & IDEs
  notepadpp:    _wg('Notepad++.Notepad++',                  'NOTEPADPP'),
  vscode:       _wg('Microsoft.VisualStudioCode',           'VSCODE'),
  // Development & Runtime
  git:          _wg('Git.Git',                              'GIT'),
  nodejs:       _wg('OpenJS.NodeJS.LTS',                    'NODE'),
  python312:    _wg('Python.Python.3.12',                   'PYTHON'),
  docker:       _wg('Docker.DockerDesktop',                 'DOCKER'),
  // Web & Application Servers
  xampp:        _wg('ApacheFriends.Xampp.8_2',              'XAMPP'),
  // Databases
  postgresql18: _wg('PostgreSQL.PostgreSQL.18',             'POSTGRESQL'),
  mysql:        _wg('Oracle.MySQL',                         'MYSQL'),
  mssqldev:     _wg('Microsoft.SQLServer.2022.Developer',   'MSSQL_DEV'),
  mssqlexpress: _wg('Microsoft.SQLServer.2022.Express',     'MSSQL_EXP'),
  ssms:         _wg('Microsoft.SQLServerManagementStudio',  'SSMS'),
  heidisql:     _wg('HeidiSQL.HeidiSQL',                    'HEIDISQL'),
  // Office, Media & Utilities
  libreoffice:  _wg('TheDocumentFoundation.LibreOffice',    'LO'),
  openoffice:   _wg('Apache.OpenOffice',                    'OO'),
  vlc:          _wg('VideoLAN.VLC',                         'VLC'),
  sevenzip:     _wg('7zip.7zip',                            '7ZIP'),
  chocolatey:   _wg('Chocolatey.Chocolatey',                'CHOCO'),
  // AI Developer Tools (npm-based, require Node.js + Git)
  claude:       `winget install --id Git.Git --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User'); npm install -g @anthropic-ai/claude-code 2>&1; Write-Output 'CLAUDE_DONE'`,
  opencode:     `winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User'); npm install -g opencode-ai 2>&1; Write-Output 'OPENCODE_DONE'`,
  codex:        `winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent 2>&1 | Out-Null; $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User'); npm install -g @openai/codex 2>&1; Write-Output 'CODEX_DONE'`,
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

// DB tools that support a superuser password at install time
const DB_PASS_CMDS = {
  postgresql18: (u, p) => {
    const safe = p.replace(/'/g, "''");
    return `winget install --id PostgreSQL.PostgreSQL.18 --source winget --accept-package-agreements --accept-source-agreements --silent --override "/S /Password=${safe}" 2>&1; Write-Output 'POSTGRESQL_DONE'`;
  },
  mysql: (u, p) => {
    const safe = p.replace(/'/g, "''");
    return `winget install --id Oracle.MySQL --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'MYSQL_DONE'`;
  },
  mssqldev: (u, p) => {
    return `winget install --id Microsoft.SQLServer.2022.Developer --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'MSSQL_DEV_DONE'`;
  },
  mssqlexpress: (u, p) => {
    return `winget install --id Microsoft.SQLServer.2022.Express --source winget --accept-package-agreements --accept-source-agreements --silent 2>&1; Write-Output 'MSSQL_EXP_DONE'`;
  },
};

app.post('/api/vm-tools/install', (req, res) => {
  const { vmName, user, pass, tool, dbUser = '', dbPass = '' } = req.body;
  // Build command: use DB-specific password command if credentials provided, else default
  let cmd = (dbPass && DB_PASS_CMDS[tool]) ? DB_PASS_CMDS[tool](dbUser, dbPass) : VM_INSTALL_CMDS[tool];
  if (!cmd || !vmName || !user || !pass) return res.status(400).json({ error:'Missing params or unknown tool' });
  const esc = s => String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
  const psCmd = `$cred=New-Object PSCredential("${esc(user)}",(ConvertTo-SecureString "${esc(pass)}" -AsPlainText -Force));Invoke-Command -VMName "${esc(vmName)}" -Credential $cred -ScriptBlock { ${cmd} }`;
  res.setHeader('Content-Type','text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control','no-cache');
  res.flushHeaders();
  const ps = spawn(PS_EXE,['-NoProfile','-NonInteractive','-Command',psCmd]);
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
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
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
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
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
  catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.delete('/api/winget/:id', (req, res) => {
  const id = decodeURIComponent(req.params.id);
  const list = loadWinget().filter(p => p.id !== id);
  try { fs.writeFileSync(WINGET_FILE, JSON.stringify(list, null, 2), 'utf8'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
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
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

// Always reads from disk so edits to ollama-models.json take effect without restart
app.get('/api/models', (req, res) => res.json(loadModels()));
// Always reads from disk so edits to tools.json take effect without restart
app.get('/api/tools', (req, res) => {
  try {
    if (!fs.existsSync(TOOLS_FILE)) return res.json([]);
    res.json(JSON.parse(fs.readFileSync(TOOLS_FILE, 'utf8')));
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.get('/api/host-info', (req, res) => {
  const ip = getHostIP();
  const isDocker = fs.existsSync('/.dockerenv');
  res.json({
    ip,
    port:       PORT,
    webUrl:     `http://${ip}:${PORT}`,
    filesUrl:   `http://${ip}:${PORT}/files/`,
    platform:   process.platform,
    dockerMode: isDocker || process.platform !== 'win32',
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
  catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
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
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

app.post('/api/notes', (req, res) => {
  try {
    fs.writeFileSync(NOTES_FILE, req.body.content ?? '', 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
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
  const ps = spawn(PS_EXE,['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_UTF8 + script]);
  activeProc = ps;
  ps.stdout.on('data', d => ws.send(JSON.stringify({ type: 'out', text: cleanOutput(d.toString('utf8')) })));
  ps.stderr.on('data', d => ws.send(JSON.stringify({ type: 'err', text: cleanOutput(d.toString('utf8')) })));
  ps.on('close',  code => { activeProc = null; ws.send(JSON.stringify({ type: 'done', code })); });
  ps.on('error',  err  => { activeProc = null; ws.send(JSON.stringify({ type: 'error', text: err.message })); });
}

function runPS(cmd, cb) {
  let out = '', err = '';
  const ps = spawn(PS_EXE,['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_UTF8 + cmd]);
  ps.stdout.on('data', d => out += d.toString('utf8'));
  ps.stderr.on('data', d => err += d.toString('utf8'));
  ps.on('close', () => cb(out.trim(), err.trim() || null));
  ps.on('error', e => cb('', e.message));
}

// ── Community Knowledge Base ──────────────────────────────────────────────────

const COMMUNITY_CONFIG_FILE = path.join(SCRIPT_DIR, 'community-config.json');
const COMMUNITY_DIR         = path.join(SCRIPT_DIR, 'community');

function loadCommunityConfig() {
  try {
    if (fs.existsSync(COMMUNITY_CONFIG_FILE))
      return JSON.parse(fs.readFileSync(COMMUNITY_CONFIG_FILE, 'utf8'));
  } catch (e) { console.warn('[community] config load error:', e.message); }
  return { enabled: false, elasticsearch: { enabled: false } };
}

// GET /api/community/config — returns config without passwords
app.get('/api/community/config', (req, res) => {
  const cfg  = loadCommunityConfig();
  const safe = JSON.parse(JSON.stringify(cfg));
  if (safe.elasticsearch) { delete safe.elasticsearch.username; delete safe.elasticsearch.password; }
  res.json(safe);
});

// POST /api/community/config — update config fields
app.post('/api/community/config', (req, res) => {
  try {
    const current = loadCommunityConfig();
    const body = req.body || {};
    const updated = { ...current, ...body };
    // Deep-merge nested objects so partial updates don't wipe sub-keys
    ['elasticsearch', 'output', 'auth', 'board'].forEach(k => {
      if (body[k]) updated[k] = { ...(current[k] || {}), ...body[k] };
    });
    fs.writeFileSync(COMMUNITY_CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

// GET /api/community/status
app.get('/api/community/status', async (req, res) => {
  const cfg       = loadCommunityConfig();
  const indexFile = path.join(COMMUNITY_DIR, 'index.json');
  let indexData   = null;
  if (fs.existsSync(indexFile)) { try { indexData = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch {} }

  let esStatus = 'disabled';
  if (cfg.elasticsearch?.enabled) {
    try {
      const { Client } = require('@elastic/elasticsearch');
      const c = new Client({ node: cfg.elasticsearch.host, requestTimeout: 3000 });
      await c.ping();
      esStatus = 'ok';
    } catch { esStatus = 'unreachable'; }
  }

  let articleCount = indexData
    ? Object.values(indexData.sections || {}).reduce((s, x) => s + (x.count || 0), 0) : 0;
  let sectionCount = indexData ? Object.keys(indexData.sections || {}).length : 0;
  let lastUpdate   = indexData?.updated || null;

  // Fall back to SQLite DB when index.json is absent
  if (!indexData) {
    try {
      const dbStats = communityDb.getDbStats();
      if (dbStats.built) {
        articleCount = dbStats.total;
        const secs = communityDb.getSectionStats();
        sectionCount = secs.length;
      }
    } catch {}
  }

  res.json({
    enabled:      cfg.enabled ?? false,
    name:         cfg.name || 'Community',
    articleCount,
    sectionCount,
    lastUpdate,
    elasticsearch: esStatus,
    scraping:     !!communityScraperInst,
  });
});

// POST /api/community/scrape — start full scrape (SSE stream)
let communityScraperInst = null;

app.post('/api/community/scrape', async (req, res) => {
  const cfg = loadCommunityConfig();
  if (!cfg.enabled) return res.status(403).json({ error: 'Community feature is not enabled. Enable it first.' });
  if (communityScraperInst) return res.status(409).json({ error: 'Scraping already in progress' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  try {
    const { CommunityScraper } = require('./community-scraper');
    communityScraperInst = new CommunityScraper(cfg);
    communityScraperInst.on('progress', send);
    communityScraperInst.on('error', e => send({ type: 'error', msg: e.message }));

    const ok = await communityScraperInst.login(username, password);
    if (!ok) { send({ type: 'error', msg: 'Login failed — check credentials and selectors' }); res.end(); communityScraperInst = null; return; }

    await communityScraperInst.scrapeAll();
  } catch (e) {
    send({ type: 'error', msg: e.message });
  } finally {
    communityScraperInst = null;
    try { res.end(); } catch {}
  }
});

// POST /api/community/scrape/stop
app.post('/api/community/scrape/stop', (req, res) => {
  if (communityScraperInst) { communityScraperInst.stop().catch(() => {}); communityScraperInst = null; }
  res.json({ ok: true });
});

// POST /api/community/purge — delete all scraped content, SQLite DB and ES index
app.post('/api/community/purge', async (req, res) => {
  if (communityScraperInst) return res.status(409).json({ error: 'Scraping in progress — stop it first' });

  const report = { sections: 0, articles: 0, images: 0, sqliteDeleted: false, esDeleted: false, errors: [] };

  // 1. Close SQLite and delete DB files
  try {
    communityDb.closeDb();
    for (const ext of ['', '-shm', '-wal']) {
      const p = path.join(COMMUNITY_DIR, `community.db${ext}`);
      if (fs.existsSync(p)) { fs.unlinkSync(p); }
    }
    report.sqliteDeleted = true;
  } catch (e) { report.errors.push(`SQLite: ${e.message}`); }

  // 2. Delete section directories (scraped content)
  try {
    const entries = fs.existsSync(COMMUNITY_DIR)
      ? fs.readdirSync(COMMUNITY_DIR, { withFileTypes: true }).filter(d => d.isDirectory())
      : [];
    for (const entry of entries) {
      try {
        const secPath = path.join(COMMUNITY_DIR, entry.name);
        const artDirs = fs.readdirSync(secPath, { withFileTypes: true }).filter(d => d.isDirectory());
        report.articles += artDirs.length;
        // Count images
        for (const art of artDirs) {
          const imgDir = path.join(secPath, art.name, 'images');
          if (fs.existsSync(imgDir)) {
            report.images += fs.readdirSync(imgDir).length;
          }
        }
        fs.rmSync(secPath, { recursive: true, force: true });
        report.sections++;
      } catch (e) { report.errors.push(`Section ${entry.name}: ${e.message}`); }
    }
    // Also delete index.json if present
    const idxFile = path.join(COMMUNITY_DIR, 'index.json');
    if (fs.existsSync(idxFile)) fs.unlinkSync(idxFile);
  } catch (e) { report.errors.push(`Sections: ${e.message}`); }

  // 3. Delete Elasticsearch index (if configured)
  const cfg = loadCommunityConfig();
  if (cfg.elasticsearch?.enabled && cfg.elasticsearch?.host) {
    try {
      const { Client } = require('@elastic/elasticsearch');
      const client = new Client({ node: cfg.elasticsearch.host, requestTimeout: 5000 });
      const exists = await client.indices.exists({ index: cfg.elasticsearch.index }).catch(() => false);
      if (exists) {
        await client.indices.delete({ index: cfg.elasticsearch.index });
        report.esDeleted = true;
      }
    } catch (e) { report.errors.push(`Elasticsearch: ${e.message}`); }
  }

  res.json({ ok: true, report });
});

// POST /api/community/index — (re)index articles in Elasticsearch (SSE stream)
app.post('/api/community/index', async (req, res) => {
  const cfg = loadCommunityConfig();
  if (!cfg.elasticsearch?.enabled) return res.status(400).json({ error: 'Elasticsearch is not enabled in config' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  try {
    const { loadCommunityArticles, indexArticles } = require('./community-indexer');
    send({ type: 'log', msg: 'Loading local articles…' });
    const articles = loadCommunityArticles(COMMUNITY_DIR);
    send({ type: 'log', msg: `Found ${articles.length} article(s) — generating embeddings (first run downloads mE5-small model ~66 MB)…` });
    await indexArticles(articles, cfg.elasticsearch, p => send({ type: 'progress', ...p }));
    send({ type: 'done', count: articles.length });
  } catch (e) {
    send({ type: 'error', msg: e.message });
  }
  try { res.end(); } catch {}
});

// GET /api/community/sections
app.get('/api/community/sections', (req, res) => {
  const normTags = tags => (tags||[]).flatMap(t =>
    typeof t === 'string' ? t.replace(/Â¶/g,'¶').split('¶').map(s=>s.trim()).filter(s=>s.length>0&&s.length<80) : []
  );

  const indexFile = path.join(COMMUNITY_DIR, 'index.json');
  if (fs.existsSync(indexFile)) {
    try {
      const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      const sections = Object.entries(idx.sections || {}).map(([slug, data]) => ({
        slug,
        count: data.count || 0,
        articles: (data.articles || []).map(a => ({
          title: a.title, date: a.date, author: a.author, dir: a.dir,
          tags: normTags(a.tags), replies: a.replies||0, solved: !!a.solved,
          type: a.type||'',
        })),
      }));
      return res.json({ sections, updated: idx.updated });
    } catch (e) { return res.status(500).json({ error: dbErrMsg(e) }); }
  }

  // No index.json — build sections list from SQLite DB
  try {
    if (!communityDb.isBuilt()) return res.json({ sections: [], updated: null });
    const secStats = communityDb.getSectionStats();
    const sections = secStats.map(s => {
      const articles = communityDb.search('', { section: s.section, limit: 500 }).map(a => ({
        title: a.title, date: a.date, author: a.author, dir: a.dir,
        tags: a.tags || [], replies: a.replies||0, solved: !!a.solved, type: a.type||'',
      }));
      return { slug: s.section, count: s.total, articles };
    });
    res.json({ sections, updated: null });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

// GET /api/community/article?section=X&dir=Y
// dir can be:  old 3-level → "article-slug"
//              new 4-level → "thread-slug/YYYY-MM-DD"
app.get('/api/community/article', (req, res) => {
  const section = path.basename(req.query.section || '');
  // Sanitise dir: allow a single slash (thread/post) but block traversal attempts
  const dir = (req.query.dir || '')
    .replace(/\.\./g, '')         // no parent traversal
    .replace(/^\/+|\/+$/g, '')    // strip leading/trailing slashes
    .replace(/\/+/g, '/')         // collapse double slashes
    .replace(/[\\]/g, '');        // no backslashes
  if (!section || !dir) return res.status(400).json({ error: 'section and dir required' });

  const mdPath = path.resolve(path.join(COMMUNITY_DIR, section, dir, 'article.md'));
  if (!mdPath.startsWith(path.resolve(COMMUNITY_DIR)))
    return res.status(403).json({ error: 'Forbidden' });
  if (!fs.existsSync(mdPath)) return res.status(404).json({ error: 'Not found' });
  try { res.json({ content: fs.readFileSync(mdPath, 'utf8') }); }
  catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

// GET /api/community/image?section=X&dir=Y&file=Z
app.get('/api/community/image', (req, res) => {
  const section = path.basename(req.query.section || '');
  const dir     = (req.query.dir||'').replace(/\.\./g,'').replace(/^\/+|\/+$/g,'').replace(/\/+/g,'/').replace(/[\\]/g,'');
  const file    = path.basename(req.query.file    || '');
  if (!section || !dir || !file) return res.status(400).send('Missing params');

  const imgPath = path.resolve(path.join(COMMUNITY_DIR, section, dir, 'images', file));
  if (!imgPath.startsWith(path.resolve(COMMUNITY_DIR))) return res.status(403).send('Forbidden');
  if (!fs.existsSync(imgPath)) return res.status(404).send('Not found');
  res.sendFile(imgPath);
});

// GET /api/community/search?q=...&mode=text|semantic|hybrid&section=...  (SSE)
app.get('/api/community/search', async (req, res) => {
  const { q = '', mode = 'text', section } = req.query;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  if (!q.trim()) { send({ type: 'done', total: 0 }); return res.end(); }

  send({ type: 'start', msg: mode === 'semantic' ? 'Generating embedding…' : 'Scanning files…' });

  const cfg = loadCommunityConfig();
  try {
    if (cfg.elasticsearch?.enabled && (mode === 'semantic' || mode === 'hybrid')) {
      send({ type: 'progress', msg: `Running ${mode} search in Elasticsearch…` });
      const { searchES } = require('./community-indexer');
      let results = await searchES(q, cfg.elasticsearch, mode);
      if (section) results = results.filter(r => r.section === section || r.section?.toLowerCase().includes(section.toLowerCase()));
      if (results.length) send({ type: 'results', results, section: 'all' });
      send({ type: 'done', total: results.length, mode });
      return res.end();
    }
  } catch (e) {
    console.warn('[community/search] ES error, falling back to local:', e.message);
    send({ type: 'log', msg: `Elasticsearch unavailable — falling back to file scan` });
  }

  // File scan — stream per-section progress
  const { loadCommunityArticles } = require('./community-indexer');
  const lq    = q.toLowerCase().trim();
  const terms = lq.split(/\s+/).filter(t => t.length > 1);

  const sectionDirs = fs.existsSync(COMMUNITY_DIR)
    ? fs.readdirSync(COMMUNITY_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name)
    : [];

  send({ type: 'start', total: sectionDirs.length, msg: `Scanning ${sectionDirs.length} sections…` });

  const allResults = [];
  for (let i = 0; i < sectionDirs.length; i++) {
    const sec    = sectionDirs[i];
    const secDir = path.join(COMMUNITY_DIR, sec);
    if (section && sec !== section) { send({ type: 'progress', idx: i + 1, total: sectionDirs.length, section: sec }); continue; }

    send({ type: 'progress', idx: i + 1, total: sectionDirs.length, section: sec });

    let artDirs;
    try { artDirs = fs.readdirSync(secDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
    catch { continue; }

    const secResults = [];
    for (const ad of artDirs) {
      const metaPath = path.join(secDir, ad, 'metadata.json');
      const mdPath   = path.join(secDir, ad, 'article.md');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta    = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const rawMd   = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
        const content = rawMd.replace(/^---[\s\S]*?---\n?/, '').replace(/^#\s+.*\n?/, '').trim();
        const titleLc   = (meta.title||'').toLowerCase();
        const haystack  = `${titleLc} ${(meta.author||'').toLowerCase()} ${(meta.tags||[]).join(' ').toLowerCase()} ${content.toLowerCase()}`;
        // AND logic: every term must be present
        if (!terms.every(t => haystack.includes(t))) continue;
        // Score: weight by how many terms appear in the title vs body
        const score = terms.reduce((s, t) => s + (titleLc.includes(t) ? 3 : 1), 0);
        // Excerpt: best window — find position where most terms cluster
        let excerpt = '';
        const lc = content.toLowerCase();
        const positions = terms.map(t => lc.indexOf(t)).filter(p => p >= 0);
        const center = positions.length ? Math.round(positions.reduce((a,b)=>a+b,0)/positions.length) : -1;
        if (center >= 0) {
          const start = Math.max(0, center - 80);
          excerpt = (start > 0 ? '…' : '') + content.slice(start, center + 220) + (center + 220 < content.length ? '…' : '');
        } else {
          excerpt = content.slice(0, 200) + (content.length > 200 ? '…' : '');
        }
        const normTags = (meta.tags||[]).flatMap(t => typeof t==='string' ? t.replace(/Â¶/g,'¶').split('¶').map(s=>s.trim()).filter(Boolean) : []);
        secResults.push({ title: meta.title||'', section: sec, date: meta.date||'', author: meta.author||'',
          tags: normTags, url: meta.url||'', dir: meta.dir||ad, excerpt, score });
      } catch { /* skip */ }
    }
    secResults.sort((a, b) => b.score - a.score);
    if (secResults.length) {
      allResults.push(...secResults);
      send({ type: 'results', results: secResults.slice(0, 20), section: sec });
    }
  }

  send({ type: 'done', total: allResults.length, mode: 'file-scan' });
  res.end();
});

// ── Community SQLite Local Index ──────────────────────────────────────────────

const communityDb = require('./community-db');

// POST /api/community/build-db — build/rebuild SQLite FTS index (SSE)
app.post('/api/community/build-db', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };
  try {
    send({ type: 'log', msg: 'Building SQLite index…' });
    const result = communityDb.buildIndex(COMMUNITY_DIR, prog => {
      if (prog.phase === 'start') send({ type: 'start', total: prog.total, sections: prog.sections });
      else send({ type: 'progress', done: prog.done, total: prog.total, section: prog.section });
    });
    send({ type: 'done', indexed: result.indexed, sections: result.sections });
  } catch (e) {
    send({ type: 'error', msg: e.message });
  }
  try { res.end(); } catch {}
});

// GET /api/community/db-stats
app.get('/api/community/db-stats', (req, res) => {
  try { res.json(communityDb.getDbStats()); }
  catch { res.json({ total: 0, solved: 0, built: false }); }
});

// GET /api/community/tags?section=...
app.get('/api/community/tags', (req, res) => {
  try { res.json(communityDb.getTags(req.query.section || null)); }
  catch { res.json([]); }
});

// GET /api/community/section-stats
app.get('/api/community/section-stats', (req, res) => {
  try { res.json(communityDb.getSectionStats()); }
  catch { res.json([]); }
});

// GET /api/community/search-db?q=...&section=...&tag=...&author=...  (SSE streaming)
app.get('/api/community/search-db', (req, res) => {
  const { q = '', section: secFilter, tag, author } = req.query;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };
  try {
    if (!communityDb.isBuilt()) {
      send({ type: 'error', msg: 'SQLite index not built yet. Use "Build Local Index" first.' });
      return res.end();
    }
    const opts = { limit: 100 };
    if (secFilter) opts.section = secFilter;
    if (tag)       opts.tag     = tag;
    if (author)    opts.author  = author;

    // Run single search for relevance ordering, then group by section to stream progress
    const allResults = communityDb.search(q, opts);
    const bySection = {};
    for (const r of allResults) {
      if (!bySection[r.section]) bySection[r.section] = [];
      bySection[r.section].push(r);
    }
    const stats = communityDb.getSectionStats();
    const allSections = secFilter ? stats.filter(s => s.section === secFilter) : stats;

    send({ type: 'start', total: allSections.length });
    for (let i = 0; i < allSections.length; i++) {
      const sec = allSections[i];
      const results = bySection[sec.section] || [];
      send({ type: 'progress', section: sec.section, idx: i + 1, total: allSections.length });
      if (results.length) send({ type: 'results', results, section: sec.section });
    }
    send({ type: 'done', total: allResults.length });
  } catch (e) {
    send({ type: 'error', msg: e.message });
  }
  try { res.end(); } catch {}
});

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

// ── LLM / RAG ─────────────────────────────────────────────────────────────────

const LLM_CONFIG_FILE = path.join(SCRIPT_DIR, 'llm-config.json');

function loadLLMConfig() {
  try { if (fs.existsSync(LLM_CONFIG_FILE)) return JSON.parse(fs.readFileSync(LLM_CONFIG_FILE, 'utf8')); }
  catch {}
  return {
    provider: 'ollama',
    ollama: { host: 'http://localhost:11434', model: '' },
    systemPrompt: 'You are a helpful expert on ELO DMS. Answer questions based exclusively on the provided community articles. Be concise and cite the relevant article titles.',
    userPromptTemplate: 'Question: {query}\n\nRelevant community articles:\n{context}\n\nAnswer:',
    contextMode: 'excerpts',
    maxResults: 8,
    maxContextLength: 6000,
  };
}

app.get('/api/llm/config', (req, res) => res.json(loadLLMConfig()));

app.post('/api/llm/config', (req, res) => {
  try {
    const cur = loadLLMConfig();
    const upd = { ...cur, ...req.body };
    if (req.body.ollama) upd.ollama = { ...cur.ollama, ...req.body.ollama };
    fs.writeFileSync(LLM_CONFIG_FILE, JSON.stringify(upd, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: dbErrMsg(e) }); }
});

// GET /api/llm/status — check if Ollama (or configured LLM) is reachable
app.get('/api/llm/status', async (req, res) => {
  const cfg  = loadLLMConfig();
  const out  = { provider: cfg.provider || 'ollama', model: cfg.ollama?.model || '', active: false, models: [] };
  const host = cfg.ollama?.host || 'http://localhost:11434';
  try {
    const parsed = new URL(host + '/api/tags');
    const mod    = require(parsed.protocol === 'https:' ? 'https' : 'http');
    await new Promise((resolve) => {
      const req = mod.get(parsed.href, { timeout: 2000 }, r => {
        let data = '';
        r.on('data', d => data += d);
        r.on('end', () => {
          try {
            const j = JSON.parse(data);
            out.active = true;
            out.models = (j.models || []).map(m => m.name || m.model || '').filter(Boolean);
          } catch {}
          resolve();
        });
      });
      req.on('error', resolve);
      req.on('timeout', () => { req.destroy(); resolve(); });
    });
  } catch {}
  res.json(out);
});

// POST /api/llm/ask — RAG query, SSE streaming
app.post('/api/llm/ask', async (req, res) => {
  const { query = '', results = [], contextMode } = req.body;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();
  const send = d => { try { res.write(`data: ${JSON.stringify(d)}\n\n`); } catch {} };

  const cfg   = loadLLMConfig();
  const model = cfg.ollama?.model;
  if (!model) { send({ type: 'error', msg: 'No model configured — set one in LLM settings.' }); return res.end(); }

  const mode    = contextMode || cfg.contextMode || 'excerpts';
  const maxLen  = cfg.maxContextLength || 6000;
  const usedRes = results.slice(0, cfg.maxResults || 8);

  // Build context string
  let context = '';
  for (const r of usedRes) {
    let snippet = '';
    if (mode === 'full' && r.section && r.dir) {
      try {
        const mp = path.join(COMMUNITY_DIR, r.section, r.dir, 'article.md');
        if (fs.existsSync(mp)) {
          snippet = fs.readFileSync(mp, 'utf8')
            .replace(/^---[\s\S]*?---\n?/, '').replace(/^#\s+.*\n?/, '')
            .replace(/\n---\n\n## Antworten[\s\S]*$/, '').trim().slice(0, 1800);
        }
      } catch {}
    }
    if (!snippet) snippet = r.excerpt || '';
    if (!snippet) continue;
    const entry = `\n\n[${r.title || '?'} — ${r.section || ''}, ${r.date || ''}]\n${snippet}`;
    if (context.length + entry.length > maxLen) break;
    context += entry;
  }

  if (!context.trim()) { send({ type: 'error', msg: 'No context available — run a search first.' }); return res.end(); }

  const systemPrompt = cfg.systemPrompt || 'You are an ELO DMS expert.';
  const userPrompt   = (cfg.userPromptTemplate || 'Question: {query}\n\nArticles:\n{context}\n\nAnswer:')
    .replace('{query}', query).replace('{context}', context.trim());

  send({ type: 'start', model, articles: usedRes.length });

  try {
    const host   = cfg.ollama?.host || 'http://localhost:11434';
    const parsed = new URL(host + '/api/chat');
    const body   = JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      stream: true,
    });
    const mod = require(parsed.protocol === 'https:' ? 'https' : 'http');
    await new Promise((resolve, reject) => {
      const r = mod.request({ hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 120000,
      }, ollamaRes => {
        let buf = '';
        ollamaRes.on('data', chunk => {
          buf += chunk.toString();
          const lines = buf.split('\n'); buf = lines.pop();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.message?.content) send({ type: 'token', text: msg.message.content });
              if (msg.done) { send({ type: 'done' }); resolve(); }
            } catch {}
          }
        });
        ollamaRes.on('end', resolve);
        ollamaRes.on('error', reject);
      });
      r.on('error', reject);
      r.write(body); r.end();
    });
  } catch (e) { send({ type: 'error', msg: 'Ollama error: ' + e.message }); }
  res.end();
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
