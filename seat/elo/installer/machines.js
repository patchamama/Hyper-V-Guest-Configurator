'use strict';
// Access data of the machines this installer created or set up (user, password, SSH port, OS), kept in
// RUN_DIR/machines.json. Only administrators can read the file on Windows. Keys: "wsl", "hyperv:<vm>", "vbox:<vm>".
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const x = require('./exec');

const FILE = path.join(x.RUN_DIR, 'machines.json');
const all = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
function save(id, rec) {
  const m = all(); m[id] = { ...(m[id] || {}), ...rec, updated: new Date().toISOString() };
  fs.writeFileSync(FILE, JSON.stringify(m, null, 2));
  // Administrators + SYSTEM only (the file holds passwords).
  if (x.IS_WIN) try { cp.execFileSync('icacls', [FILE, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '*S-1-5-18:F'], { stdio: 'ignore' }); } catch {}
  else try { fs.chmodSync(FILE, 0o600); } catch {}
}
const get = id => all()[id] || null;
const remove = id => { const m = all(); delete m[id]; fs.writeFileSync(FILE, JSON.stringify(m, null, 2)); };

module.exports = { all, get, save, remove, FILE };
