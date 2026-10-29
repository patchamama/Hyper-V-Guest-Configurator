'use strict';
// Render the registry inventory JSON (registry-inventory.js) as Markdown: summary table of all images and one
// section per image with description, component versions, recent tags and links (registry UI + ELO docs).
// Usage: node inventory-md.js <inventory.json> <out.md>
const fs = require('fs');

// From the ELO image documentation (docs.elo.com/ops/eck-images, "Docker images").
const INFO = {
  server: ['ELO Index Server + Admin Console + Web Client + Web Forms Services; frontend for all connections, API calls and web services. Replaces `ix` and `ui` (from 21-3).', 'cloud-server'],
  ix: ['ELO Index Server; frontend for connections, API calls and ELO web services (older split setup; superseded by `server`).', 'cloud-ix'],
  ui: ['ELO user interface: Web Client, ELO WF and Administration Console (older split setup; superseded by `server`).', 'cloud-ui'],
  'ix-setup': ['Setup routine for the Index Server; init container that creates/updates the repository (PostgreSQL or MS SQL Server). Takes the ELO license.', 'cloud-ix-setup'],
  'ix-import': ['Import routine for the Index Server: imports thesaurus and dropzone.', 'cloud-ix-import'],
  search: ['ELO iSearch (Elasticsearch 8 from v25): full-text and other search functions. Needs vm.max_map_count ≥ 262144.', 'cloud-search'],
  tr2: ['Textreader 2 + OCR: analyzes documents for full-text extraction (replaces cv, ocr, ocr-setup from 21-4).', 'cloud-tr2'],
  as: ['ELO Automation Services: build automated tasks in ELO.', 'cloud-as'],
  flows: ['ELO Flows manager and service.', 'cloud-flows'],
  'flows-worker': ['ELO Flows worker (Karaf).', 'cloud-flows-worker'],
  'flows-worker-base': ['Base image for ELO Flows workers.', null],
  'flows-registry': ['Registry for ELO Flows components.', null],
  sl: ['ELO Smart Link service.', 'cloud-sl'],
  cmis: ['ELO CMIS service (CMIS interface).', 'cloud-cmis'],
  'elo-sync': ['ELO Sync: synchronization between ELO and third-party systems (e.g. Microsoft 365). Not yet runnable with docker-compose per ELO docs.', 'cloud-elo-sync'],
  rest: ['ELO REST service.', null],
  'model-processor': ['ELO AI model processor (recommended 2 GiB heap / 3 GiB container).', 'cloud-mp'],
  'entity-extraction-service': ['ELO Entity Extraction Service (recommended 3 GiB heap / 4 GiB container).', 'cloud-ees'],
  aio: ['All-in-one image (ELO 23 only).', null],
  cv: ['Content viewer/converter (legacy; replaced by tr2 from 21-4).', null],
  ocr: ['OCR service (legacy; replaced by tr2 from 21-4).', null],
  'ocr-setup': ['OCR setup (legacy; replaced by tr2 from 21-4).', null],
  postgresql: ['Standard PostgreSQL image, for testing only.', null],
  'postgresql-exporter': ['PostgreSQL metrics exporter (Prometheus).', null],
  traefik: ['Traefik reverse proxy / ingress used by ECK.', null],
  busybox: ['BusyBox helper image.', null],
  replication: ['ELO replication (no tagged versions).', null],
  rp: ['ELO rp service.', null],
  analytics: ['ELO Analytics.', null],
  imo: ['ELO imo service.', null],
};
const DOCS = 'https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/images/';
const DOCS_BETA = 'https://docs.elo.com/ops/eck-images/en-us/administration-docker/images/';

const gb = n => n == null ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`;
const day = s => (s || '').slice(0, 10);
const line = t => (t.match(/^v(\d+)/) || [])[1];               // ELO major line from tag (v25-0.30.1 -> 25)
const stable = t => /^v\d+-\d+(\.\d+)*$/.test(t);                // v25-0.30.1 (no -beta, -debian, ...)

function render(inv) {
  const out = [];
  out.push('# ELO container images (registry.elo.com)', '');
  out.push(`Generated ${inv.generated.slice(0, 16).replace('T', ' ')} UTC from ${inv.registry} (Harbor ${inv.harbor}) with`,
    '`tools/registry-inventory.js` + `tools/inventory-md.js`. Requires an ELO partner/customer login; the list may change.', '');
  out.push('- **Registry web UI:** ' + inv.registry + ' → "Login via OIDC provider" → project **eck-services**',
    '- **Pull:** `docker login registry.elo.com -u <user> --password-stdin` (CLI secret from the registry user profile), then `docker pull registry.elo.com/eck-services/<image>:<tag>`',
    '- **Docs:** https://docs.elo.com/ops/eck-images/25-lts/en-us/administration-docker/ (ELO login)',
    '- **Platform:** all images are `linux/amd64` (no Windows images); base distro shown per image (Wolfi OS for current ELO 25).', '');
  for (const p of inv.projects) {
    const uiRepo = r => `${inv.registry}/harbor/projects/${p.id}/repositories/${encodeURIComponent(r).replace(/%2F/g, '%252F')}/artifacts-tab`;
    const repos = [...p.repos].sort((a, b) => (b.pulls || 0) - (a.pulls || 0));
    out.push(`## Project \`${p.name}\` — ${repos.length} images`, '');
    out.push('| Image | ELO lines | Latest stable ELO 25 | Latest tag | Size | Updated | Pulls | Base | Links |', '|---|---|---|---|---|---|---|---|---|');
    for (const r of repos) {
      const all = r.tags.flatMap(t => t.tags.map(n => ({ n, a: t })));
      const lines = [...new Set(all.map(x => line(x.n)).filter(Boolean))].sort((a, b) => b - a).join(', ');
      const s25 = all.find(x => line(x.n) === '25' && stable(x.n));
      const last = r.tags[0];
      const base = last ? (last.labels.distro || last.labels.summary || '').replace(/:$/, '') : '';
      const doc = INFO[r.name]?.[1] ? ` · [docs](${(['cloud-mp', 'cloud-ees'].includes(INFO[r.name][1]) ? DOCS_BETA : DOCS) + INFO[r.name][1]}.html)` : '';
      out.push(`| [\`${r.name}\`](#${r.name}) | ${lines || '—'} | ${s25 ? '`' + s25.n + '`' : '—'} | ${last ? '`' + last.tags[0] + '`' : '—'} | ${gb(last?.size)} | ${day(last?.pushed)} | ${r.pulls ?? ''} | ${base} | [registry](${uiRepo(r.name)})${doc} |`);
    }
    out.push('');
    for (const r of repos) {
      const info = INFO[r.name] || [];
      out.push(`### ${r.name}`, '');
      out.push(`\`registry.elo.com/${p.name}/${r.name}\` · ${r.tags.length} tagged versions · ${r.pulls ?? 0} pulls · [registry](${uiRepo(r.name)})` +
        (info[1] ? ` · [ELO docs](${(['cloud-mp', 'cloud-ees'].includes(info[1]) ? DOCS_BETA : DOCS) + info[1]}.html)` : ''), '');
      if (info[0] || r.description) out.push(info[0] || r.description, '');
      const last = r.tags[0];
      if (last) {
        const L = last.labels, ver = Object.entries(L).filter(([k]) => /^com\.elo\.cloud\.version\.(ix|web|ac|wf)$/.test(k));
        const facts = [`OS/arch: ${last.os}/${last.arch}`, (L.distro || L.summary) && `base: ${(L.distro || L.summary).replace(/:$/, '')}`,
          L.openjdk && `OpenJDK ${L.openjdk}${L.compiler ? ` (${L.compiler})` : ''}`, L.tomcat && `Tomcat ${L.tomcat}`,
          ...ver.map(([k, v]) => `${k.split('.').pop().toUpperCase()} ${v}`),
          L['com.elo.cloud.locales'] && `locales: ${L['com.elo.cloud.locales'].split(';').length}`].filter(Boolean);
        out.push(`Latest \`${last.tags.join('`, `')}\` (${day(last.pushed)}, ${gb(last.size)}): ${facts.join(' · ')}`, '');
      }
      // Newest tags per ELO line (up to 4 each).
      const byLine = {};
      for (const t of r.tags) for (const n of t.tags) { const l = line(n) || 'other'; (byLine[l] ||= []).length < 4 && byLine[l].push({ n, t }); }
      const rows = Object.keys(byLine).sort((a, b) => (b === 'other') - (a === 'other') || b - a).flatMap(l => byLine[l]);
      if (rows.length) {
        out.push('| Tag | Size | Pushed | ELO IX version |', '|---|---|---|---|');
        for (const { n, t } of rows) out.push(`| \`${n}\` | ${gb(t.size)} | ${day(t.pushed)} | ${t.labels['com.elo.cloud.version.ix'] || ''} |`);
        out.push('');
      }
    }
  }
  return out.join('\n') + '\n';
}

// Summary table only, for embedding (README block between <!-- images:start --> and <!-- images:end -->).
function summary(inv) {
  const md = render(inv);
  const a = md.indexOf('| Image |'), b = md.indexOf('\n\n', a);
  return `_Updated ${inv.generated.slice(0, 10)} from ${inv.registry} — full details per image in [elo-docker-list.md](elo-docker-list.md)._\n\n` +
    md.slice(a, b).replace(/\]\(#([a-z0-9-]+)\)/g, '](elo-docker-list.md#$1)') + '\n';
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--readme'); const readme = ri >= 0 ? args.splice(ri, 2)[1] : null;
  const [inFile, outFile] = args;
  if (!inFile || (!outFile && !readme)) { console.error('usage: node inventory-md.js <inventory.json> [<out.md>] [--readme README.md]'); process.exit(2); }
  const inv = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  if (outFile) { fs.writeFileSync(outFile, render(inv)); console.log('written', outFile); }
  if (readme) {
    const txt = fs.readFileSync(readme, 'utf8');
    const s = '<!-- images:start -->', e = '<!-- images:end -->';
    if (!txt.includes(s) || !txt.includes(e)) throw new Error(`${readme}: missing ${s} / ${e} markers`);
    fs.writeFileSync(readme, txt.slice(0, txt.indexOf(s) + s.length) + '\n' + summary(inv) + txt.slice(txt.indexOf(e)));
    console.log('updated images block in', readme);
  }
}
module.exports = { render, summary };
