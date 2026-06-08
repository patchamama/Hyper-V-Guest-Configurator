#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');

async function analyzeEloComplete() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const results = {};

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  ELO COMMUNITY COMPLETE STRUCTURE ANALYSIS                ║');
  console.log('║  This will inspect login, sections, and article structure ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // STEP 1: LOGIN
  console.log('STEP 1: Analyzing LOGIN PAGE...\n');
  await page.goto('https://community.elo.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const loginForm = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map(el => ({
      type: el.type,
      name: el.name,
      id: el.id,
      class: el.className
    }));
    const buttons = Array.from(document.querySelectorAll('button[type="submit"]')).map(el => ({
      text: el.textContent.trim(),
      class: el.className,
      dataTestId: el.getAttribute('data-test-id')
    }));
    return { inputs, buttons };
  });

  results.login = loginForm;
  console.log('✓ Login form structure captured');
  console.log(`  - Input fields: ${loginForm.inputs.length}`);
  console.log(`  - Submit buttons: ${loginForm.buttons.length}\n`);

  // STEP 2: WAIT FOR MANUAL LOGIN
  console.log('STEP 2: Please LOG IN MANUALLY in the browser window now...\n');
  console.log('Waiting for successful login (checking every 5 seconds, up to 5 minutes)...\n');

  let loggedIn = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(5000);

    // Try to detect login
    const isLoggedIn = await page.evaluate(() => {
      // Look for any element that suggests logged-in state
      const html = document.documentElement.outerHTML;
      return html.includes('logout') || html.includes('Logout') || html.includes('Sign out') ||
             document.querySelector('.navbar-item.has-dropdown') !== null;
    });

    if (isLoggedIn) {
      console.log('✓ Login detected!\n');
      loggedIn = true;
      break;
    }

    console.log(`  Waiting... (${i * 5}s)`);
  }

  if (!loggedIn) {
    console.log('✗ Login timeout. Please try again.\n');
    await browser.close();
    return;
  }

  // STEP 3: ANALYZE LOGGED-IN STATE
  console.log('STEP 3: Analyzing LOGGED-IN PAGE structure...\n');

  const loggedInState = await page.evaluate(() => {
    const navbarItems = Array.from(document.querySelectorAll('.navbar-item, [class*="navbar"]')).slice(0, 10).map(el => ({
      class: el.className,
      text: el.textContent.trim().slice(0, 50),
      html: el.outerHTML.slice(0, 200)
    }));

    const userMenuElements = Array.from(document.querySelectorAll('[class*="user"], [data-test*="user"], [class*="profile"]')).slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className,
      text: el.textContent.trim().slice(0, 30),
      href: el.getAttribute('href')
    }));

    return { navbarItems, userMenuElements };
  });

  results.loggedIn = loggedInState;
  console.log('✓ Logged-in page structure captured\n');

  // STEP 4: NAVIGATE TO KNOWLEDGE BOARD / SECTIONS
  console.log('STEP 4: Navigating to KNOWLEDGE BOARD / SECTIONS...\n');

  // Try different URLs to find sections
  const boardUrls = [
    'https://community.elo.com/community/plugin/de.elo.ix.plugin.proxy/wf/apps/app/sol.knowledge.apps.KnowledgeBoard/#/?board=COMMUNITY&page=1',
    'https://community.elo.com/community/plugin/de.elo.ix.plugin.proxy/wf/apps/app/sol.knowledge.apps.KnowledgeBoard/',
    'https://community.elo.com/'
  ];

  for (const url of boardUrls) {
    try {
      console.log(`  Trying: ${url.slice(0, 80)}...`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const hasBoard = await page.evaluate(() => {
        const html = document.documentElement.outerHTML;
        return html.includes('board') || html.includes('section') ||
               document.querySelector('[class*="board"], [class*="section"], sol-board') !== null;
      });

      if (hasBoard) {
        console.log('  ✓ Found board!\n');
        break;
      }
    } catch (e) {
      console.log(`  ✗ Failed: ${e.message}`);
    }
  }

  // STEP 5: ANALYZE SECTION STRUCTURE
  console.log('STEP 5: Analyzing SECTION STRUCTURE...\n');

  const sectionStructure = await page.evaluate(() => {
    // Look for section containers
    const possibleSelectors = [
      'sol-board-entry', '[class*="section"]', '[class*="entry"]',
      '[data-section]', '.board-entry', '.kb-entry'
    ];

    let sections = [];
    for (const sel of possibleSelectors) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length > 0) {
        sections = els.slice(0, 3).map(el => ({
          selector: sel,
          tag: el.tagName,
          class: el.className,
          text: el.textContent.trim().slice(0, 100),
          html: el.outerHTML.slice(0, 300)
        }));
        break;
      }
    }

    // Look for section titles and links
    const titles = Array.from(document.querySelectorAll('h1, h2, h3, [class*="title"], [class*="name"]')).slice(0, 5).map(el => ({
      tag: el.tagName,
      class: el.className,
      text: el.textContent.trim().slice(0, 80)
    }));

    // Look for clickable section links
    const links = Array.from(document.querySelectorAll('a[href]')).filter(a =>
      a.textContent.length > 5 && a.textContent.length < 200 &&
      !a.textContent.toLowerCase().includes('logout')
    ).slice(0, 5).map(el => ({
      text: el.textContent.trim().slice(0, 80),
      href: el.href.slice(0, 200),
      class: el.className
    }));

    return { sections, titles, links };
  });

  results.sections = sectionStructure;
  console.log(`✓ Section structure captured`);
  console.log(`  - Possible section containers: ${sectionStructure.sections.length}`);
  console.log(`  - Titles found: ${sectionStructure.titles.length}`);
  console.log(`  - Links found: ${sectionStructure.links.length}\n`);

  // STEP 6: CLICK INTO FIRST SECTION/ARTICLE
  console.log('STEP 6: Navigating to FIRST ARTICLE...\n');

  const firstLink = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).filter(a =>
      a.textContent.length > 5 && a.textContent.length < 200 &&
      !a.href.includes('logout') && !a.href.includes('profile') &&
      a.offsetParent !== null // visible
    );
    return links.length > 0 ? links[0].href : null;
  });

  if (firstLink) {
    console.log(`  Clicking: ${firstLink.slice(0, 100)}...\n`);
    try {
      await page.goto(firstLink, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);
      console.log('✓ Article page loaded\n');
    } catch (e) {
      console.log(`✗ Failed to navigate: ${e.message}\n`);
    }
  }

  // STEP 7: ANALYZE ARTICLE STRUCTURE
  console.log('STEP 7: Analyzing ARTICLE STRUCTURE...\n');

  const articleStructure = await page.evaluate(() => {
    const selectors = {
      titles: ['h1', '[class*="title"]', '[class*="heading"]', 'sol-article-title'],
      body: ['[class*="content"]', '[class*="body"]', '[class*="article"]', '.ql-editor', 'article'],
      dates: ['time', '[class*="date"]', '[class*="created"]', '[datetime]'],
      authors: ['[class*="author"]', '[class*="writer"]', '[class*="user"]', '[class*="by"]'],
      tags: ['[class*="tag"]', '[class*="label"]', '[class*="category"]', '.tag', '[role="listitem"]']
    };

    const results = {};
    for (const [key, sels] of Object.entries(selectors)) {
      for (const sel of sels) {
        const els = Array.from(document.querySelectorAll(sel));
        if (els.length > 0) {
          results[key] = {
            selector: sel,
            count: els.length,
            samples: els.slice(0, 2).map(el => ({
              tag: el.tagName,
              class: el.className,
              text: el.textContent.trim().slice(0, 100),
              html: el.outerHTML.slice(0, 250)
            }))
          };
          break;
        }
      }
    }

    return results;
  });

  results.article = articleStructure;
  console.log('✓ Article structure captured');
  Object.entries(articleStructure).forEach(([key, data]) => {
    if (data) console.log(`  - ${key}: Found with selector "${data.selector}" (${data.count} elements)`);
  });

  // SAVE RESULTS
  console.log('\n═════════════════════════════════════════════════════════════\n');
  const reportPath = '/mnt/c/ollama-ssl/installator/elo-analysis-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`✓ Full analysis saved to: ${reportPath}\n`);

  console.log('NEXT STEPS:');
  console.log('1. Review the report: elo-analysis-report.json');
  console.log('2. Use the findings to update community-config.json selectors');
  console.log('3. Test with inspect-elo-login.js and inspect-elo-logged-in.js\n');

  console.log('Browser stays open. Close manually when done inspecting.\n');
}

analyzeEloComplete().catch(console.error);
