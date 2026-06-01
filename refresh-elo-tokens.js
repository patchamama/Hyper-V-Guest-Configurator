#!/usr/bin/env node
// refresh-elo-tokens.js
//
// Opens partner.elo.com in a real browser, intercepts CDN download URLs
// with their embedded tokens, and rewrites downloads.txt with fresh entries.
//
// Setup (one-time):
//   npm install
//   npx playwright install chromium
//
// Usage:
//   node refresh-elo-tokens.js

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const DOWNLOADS_TXT = path.join(__dirname, 'downloads.txt');

const PRODUCTS = [
  { key: '/Serversetup_Windows/', name: 'ELO Server Setup' },
  { key: '/Java_Client_Windows/', name: 'ELO Java Client'  },
  { key: '/XC/',                  name: 'ELO XC'           },
];

function productName(url) {
  const urlPath = url.split('?')[0];
  for (const { key, name } of PRODUCTS) {
    if (urlPath.includes(key)) {
      const ver = urlPath.match(/\/(\d+\.\d+[\d.]*)\//);
      return ver ? `${name} ${ver[1]}` : name;
    }
  }
  return urlPath.split('/').pop();
}

function setupPage(page, captured, handleUrl) {
  page.on('request',  req => handleUrl(req.url(), captured));
  page.on('download', async dl => {
    handleUrl(dl.url(), captured);
    await dl.cancel().catch(() => {});
  });
}

async function main() {
  const captured = new Map(); // name → url

  const handleUrl = (url, map) => {
    if (!url.includes('cdn2.elo.com') || !url.includes('token=')) return;
    const name = productName(url);
    if (!map.has(name)) {
      map.set(name, url);
      console.log(`\n  [+] ${name}`);
      console.log(`      ${url.slice(0, 100)}...`);
      console.log(`  Captured ${map.size} URL(s) so far.`);
    }
  };

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  context.on('page', p => setupPage(p, captured, handleUrl));

  const page = await context.newPage();
  setupPage(page, captured, handleUrl);

  console.log('\n================================================');
  console.log('  ELO Token Refresher');
  console.log('================================================');
  console.log('  1. Log in at partner.elo.com');
  console.log('  2. Go to the software downloads section');
  console.log('  3. Click each download link:');
  console.log('       - ELO Server Setup');
  console.log('       - ELO Java Client');
  console.log('       - ELO XC');
  console.log('  4. Press ENTER here when done');
  console.log('================================================\n');

  await page.goto('https://partner.elo.com');

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });

  await browser.close();

  if (captured.size === 0) {
    console.log('\nNothing captured — downloads.txt unchanged.');
    return;
  }

  // Preserve comment lines and non-ELO entries; replace all cdn2.elo.com lines
  const existing = fs.existsSync(DOWNLOADS_TXT)
    ? fs.readFileSync(DOWNLOADS_TXT, 'utf8').split('\n')
    : [];

  const kept       = existing.filter(l => !l.includes('cdn2.elo.com'));
  const newEntries = [...captured.entries()].map(([name, url]) => `${name} | ${url}`);
  const output     = [...kept, ...newEntries].join('\n').trimEnd() + '\n';

  fs.writeFileSync(DOWNLOADS_TXT, output, 'utf8');

  console.log(`\ndownloads.txt updated with ${captured.size} fresh URL(s):`);
  captured.forEach((_, name) => console.log(`  - ${name}`));
}

main().catch(err => { console.error(err); process.exit(1); });
