'use strict';
// Inventory of registry.elo.com (Harbor 2.x): every visible project/repository/tagged artifact (size, date, os/arch,
// OCI image labels) as JSON, over the Harbor API with basic auth = registry user + CLI secret.
// The CLI secret can also be fetched with the ELO login (username/password, OIDC) through a headless browser.
//
// Usage: node registry-inventory.js <credentials.json> <out.json>
//   credentials.json: { "username": "...", "cli-secret": "..." }  or  { "username": "...", "password": "..." }
//   (values are never printed)
const fs = require('fs');
const path = require('path');

const REGISTRY = process.env.ELO_REGISTRY || 'https://registry.elo.com';

// Headless OIDC login (auth.elo.com) and CLI secret from the current-user API. Needs Playwright + Chromium.
async function fetchCliSecret(username, password) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { ({ chromium } = require(path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright'))); }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(REGISTRY + '/', { waitUntil: 'networkidle' }).catch(() => {});
    const oidc = await page.$('button:has-text("OIDC"), a:has-text("OIDC"), #log_oidc');
    if (oidc) await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), oidc.click()]);
    if (/auth\./.test(page.url())) {
      await page.waitForSelector('#username, input[name=username]', { timeout: 30000 });
      await page.fill('#username, input[name=username]', username);
      if (!(await page.$('#password'))) { await page.click('#kc-login, button[type=submit]'); await page.waitForSelector('#password', { timeout: 15000 }); }
      await page.fill('#password', password);
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('#kc-login, button[type=submit], input[type=submit]')]);
      await page.waitForTimeout(3000);
    }
    if (/oidc-onboard/.test(page.url())) throw new Error('first registry login: open the registry in a browser once and choose a username');
    const me = await page.evaluate(async () => { const r = await fetch('/api/v2.0/users/current'); return r.ok ? r.json() : { status: r.status }; });
    if (!me.username) throw new Error(`registry login failed (${me.status || 'no user'})`);
    if (!me.oidc_user_meta?.secret) throw new Error('no CLI secret in the registry profile');
    return { username: me.username, secret: me.oidc_user_meta.secret };
  } finally { await browser.close(); }
}

// Inventory over the API with basic auth (registry user + CLI secret).
async function inventory(username, secret, { onProgress } = {}) {
  const auth = 'Basic ' + Buffer.from(`${username}:${secret}`).toString('base64');
  const get = async u => {
    const r = await fetch(REGISTRY + u, { headers: { authorization: auth, accept: 'application/json' } });
    if (r.status === 401) throw new Error('registry rejected the credentials (user / CLI secret)');
    return r.ok ? r.json() : null;
  };
  const all = async u => { let out = [], p = 1; for (;;) { const r = await get(`${u}${u.includes('?') ? '&' : '?'}page_size=100&page=${p}`); if (!r || !r.length) break; out = out.concat(r); if (r.length < 100) break; p++; } return out; };
  const info = await get('/api/v2.0/systeminfo');
  const out = { registry: REGISTRY, harbor: info?.harbor_version, generated: new Date().toISOString(), projects: [] };
  for (const pr of await all('/api/v2.0/projects')) {
    const proj = { name: pr.name, id: pr.project_id, public: pr.metadata?.public === 'true', repos: [] };
    const repos = await all(`/api/v2.0/projects/${encodeURIComponent(pr.name)}/repositories`);
    let i = 0;
    for (const r of repos) {
      const short = r.name.slice(pr.name.length + 1);
      onProgress?.(`${pr.name}/${short}`, ++i, repos.length);
      const enc = encodeURIComponent(short).replace(/%2F/g, '%252F');
      const arts = await all(`/api/v2.0/projects/${encodeURIComponent(pr.name)}/repositories/${enc}/artifacts?with_tag=true&sort=-push_time`);
      proj.repos.push({
        name: short, description: r.description || '', artifacts: r.artifact_count, pulls: r.pull_count, updated: r.update_time,
        tags: arts.filter(a => (a.tags || []).length).map(a => ({
          tags: a.tags.map(t => t.name), size: a.size, pushed: a.push_time, digest: a.digest,
          os: a.extra_attrs?.os, arch: a.extra_attrs?.architecture, labels: a.extra_attrs?.config?.Labels || {},
        })),
      });
    }
    out.projects.push(proj);
  }
  return out;
}

async function main() {
  const [credFile, outFile] = process.argv.slice(2);
  if (!credFile || !outFile) { console.error('usage: node registry-inventory.js <credentials.json> <out.json>'); process.exit(2); }
  const c = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  let user = c.username, secret = c['cli-secret'];
  if (!secret) ({ username: user, secret } = await fetchCliSecret(c.username, c.password));
  const inv = await inventory(user, secret);
  fs.writeFileSync(outFile, JSON.stringify(inv, null, 2));
  for (const p of inv.projects) console.log(`${p.name}: ${p.repos.length} repositories, ${p.repos.reduce((n, r) => n + r.tags.length, 0)} tagged artifacts`);
}

if (require.main === module) main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
module.exports = { inventory, fetchCliSecret, REGISTRY };
