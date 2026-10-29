'use strict';
// Inventory of registry.elo.com (Harbor 2.x): signs in through ELO's OIDC login with the account in a credentials
// file and writes every visible project/repository/tagged artifact (size, date, os/arch, image labels) as JSON.
// Usage: node registry-inventory.js <credentials.json> <out.json>
//   credentials.json: { "username": "...", "password": "..." }   (never printed)
// Needs Playwright (Chromium): npm i playwright && npx playwright install chromium
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require('path').join(__dirname, '..', '..', '..', 'node_modules', 'playwright'))); }

const REGISTRY = process.env.ELO_REGISTRY || 'https://registry.elo.com';

async function login(page, cred) {
  await page.goto(REGISTRY + '/', { waitUntil: 'networkidle' }).catch(() => {});
  const oidc = await page.$('button:has-text("OIDC"), a:has-text("OIDC"), #log_oidc');
  if (oidc) await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}), oidc.click()]);
  if (/auth\./.test(page.url())) {
    await page.waitForSelector('#username, input[name=username]', { timeout: 30000 });
    await page.fill('#username, input[name=username]', cred.username);
    if (!(await page.$('#password'))) { await page.click('#kc-login, button[type=submit]'); await page.waitForSelector('#password', { timeout: 15000 }); }
    await page.fill('#password', cred.password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}), page.click('#kc-login, button[type=submit], input[type=submit]')]);
    await page.waitForTimeout(3000);
  }
  const ok = await page.evaluate(async () => (await fetch('/api/v2.0/users/current')).status);
  if (ok !== 200) throw new Error(`login failed (users/current -> ${ok})`);
}

async function inventory(page) {
  return page.evaluate(async () => {
    const get = async u => { const r = await fetch(u, { headers: { accept: 'application/json' } }); return r.ok ? r.json() : null; };
    const info = await get('/api/v2.0/systeminfo');
    const projects = (await get('/api/v2.0/projects?page_size=100')) || [];
    const out = { registry: location.origin, harbor: info?.harbor_version, generated: new Date().toISOString(), projects: [] };
    for (const pr of projects) {
      const proj = { name: pr.name, id: pr.project_id, public: pr.metadata?.public === 'true', repos: [] };
      let page = 1, repos = [];
      for (;;) {
        const r = await get(`/api/v2.0/projects/${encodeURIComponent(pr.name)}/repositories?page_size=100&page=${page}`);
        if (!r || !r.length) break; repos = repos.concat(r); if (r.length < 100) break; page++;
      }
      for (const r of repos) {
        const short = r.name.slice(pr.name.length + 1);
        const enc = encodeURIComponent(short).replace(/%2F/g, '%252F');
        let arts = [], ap = 1;
        for (;;) {
          const a = await get(`/api/v2.0/projects/${encodeURIComponent(pr.name)}/repositories/${enc}/artifacts?page_size=100&page=${ap}&with_tag=true&sort=-push_time`);
          if (!a || !a.length) break; arts = arts.concat(a); if (a.length < 100) break; ap++;
        }
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
  });
}

async function main() {
  const [credFile, outFile] = process.argv.slice(2);
  if (!credFile || !outFile) { console.error('usage: node registry-inventory.js <credentials.json> <out.json>'); process.exit(2); }
  const cred = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await login(page, cred);
    const inv = await inventory(page);
    fs.writeFileSync(outFile, JSON.stringify(inv, null, 2));
    for (const p of inv.projects) console.log(`${p.name}: ${p.repos.length} repositories, ${p.repos.reduce((n, r) => n + r.tags.length, 0)} tagged artifacts`);
  } finally { await browser.close(); }
}

if (require.main === module) main().catch(e => { console.error('ERROR', e.message); process.exit(1); });
module.exports = { login, inventory, REGISTRY };
