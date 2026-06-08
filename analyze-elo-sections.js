#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');

async function analyzeSections() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  ELO COMMUNITY SECTIONS & PAGINATION ANALYSIS             ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // STEP 1: Navigate to knowledge board
  console.log('STEP 1: Navigating to Knowledge Board...\n');
  const boardUrl = 'https://community.elo.com/community/plugin/de.elo.ix.plugin.proxy/wf/apps/app/sol.knowledge.apps.KnowledgeBoard/#/?board=COMMUNITY&page=1';

  await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  console.log('✓ Board loaded\n');

  // STEP 2: Analyze sections structure
  console.log('STEP 2: Analyzing SECTIONS (Bereiche) structure...\n');

  const sectionsAnalysis = await page.evaluate(() => {
    // Look for section/category containers
    const possibleContainers = [
      document.querySelectorAll('[class*="section"]'),
      document.querySelectorAll('[class*="category"]'),
      document.querySelectorAll('[class*="bereiche"]'),
      document.querySelectorAll('.board-entry'),
      document.querySelectorAll('sol-board-entry'),
      document.querySelectorAll('[data-section]')
    ];

    let sections = [];
    let bestSelector = '';

    for (let i = 0; i < possibleContainers.length; i++) {
      const container = possibleContainers[i];
      if (container.length > 3) {
        const selector = ['[class*="section"]', '[class*="category"]', '[class*="bereiche"]', '.board-entry', 'sol-board-entry', '[data-section]'][i];
        sections = Array.from(container).slice(0, 25).map((el, idx) => ({
          index: idx,
          tag: el.tagName,
          class: el.className,
          text: el.textContent.trim().slice(0, 100),
          html: el.outerHTML.slice(0, 300),
          innerHTML: el.innerHTML.slice(0, 200)
        }));
        bestSelector = selector;
        break;
      }
    }

    // Try to find section titles/links
    const sectionTitles = Array.from(document.querySelectorAll('h2, h3, [class*="title"], [class*="name"]'))
      .filter(el => el.textContent.length > 3 && el.textContent.length < 200)
      .slice(0, 25)
      .map(el => ({
        tag: el.tagName,
        class: el.className,
        text: el.textContent.trim(),
        parent: el.parentElement?.className || 'none'
      }));

    // Try to find navigation links to sections
    const navLinks = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => !a.textContent.includes('logout') && !a.textContent.includes('Login'))
      .slice(0, 30)
      .map(a => ({
        text: a.textContent.trim().slice(0, 60),
        href: a.href,
        class: a.className
      }));

    return { sections, bestSelector, sectionTitles, navLinks };
  });

  console.log(`Found section containers with selector: "${sectionsAnalysis.bestSelector}"`);
  console.log(`Total sections found: ${sectionsAnalysis.sections.length}\n`);

  console.log('SECTION SAMPLES:');
  sectionsAnalysis.sections.slice(0, 5).forEach((sec, i) => {
    console.log(`${i + 1}) ${sec.text.slice(0, 80)}`);
  });

  console.log(`\n... and ${sectionsAnalysis.sections.length - 5} more\n`);

  // STEP 3: Analyze pagination
  console.log('STEP 3: Analyzing PAGINATION structure...\n');

  const paginationAnalysis = await page.evaluate(() => {
    // Look for pagination elements
    const paginationSelectors = [
      'nav[aria-label*="paginat"]',
      '[class*="pagination"]',
      '[class*="paginator"]',
      'button[aria-label*="page"]',
      'button[aria-label*="next"]',
      '.mat-paginator'
    ];

    const pagination = {};
    for (const sel of paginationSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        pagination[sel] = {
          count: els.length,
          samples: Array.from(els).slice(0, 2).map(el => ({
            tag: el.tagName,
            text: el.textContent.trim().slice(0, 50),
            class: el.className,
            ariaLabel: el.getAttribute('aria-label')
          }))
        };
      }
    }

    // Look for "next page" or "previous page" buttons
    const allButtons = Array.from(document.querySelectorAll('button')).slice(0, 50);
    const navButtons = allButtons.filter(b =>
      b.textContent.toLowerCase().includes('next') ||
      b.textContent.toLowerCase().includes('previous') ||
      b.textContent.toLowerCase().includes('prev') ||
      b.getAttribute('aria-label')?.toLowerCase().includes('next') ||
      b.getAttribute('aria-label')?.toLowerCase().includes('prev')
    );

    return { pagination, navButtons: navButtons.map(b => ({
      text: b.textContent.trim(),
      class: b.className,
      ariaLabel: b.getAttribute('aria-label'),
      disabled: b.disabled
    })) };
  });

  console.log('Pagination elements found:');
  Object.entries(paginationAnalysis.pagination).forEach(([sel, data]) => {
    console.log(`  - ${sel}: ${data.count} elements`);
  });

  if (paginationAnalysis.navButtons.length > 0) {
    console.log('\nNavigation buttons:');
    paginationAnalysis.navButtons.forEach(btn => {
      console.log(`  - "${btn.text}" (aria-label: "${btn.ariaLabel || 'none'}", disabled: ${btn.disabled})`);
    });
  }

  // STEP 4: Click into first section and analyze articles
  console.log('\nSTEP 4: Clicking into FIRST SECTION...\n');

  // Try to find and click a section link
  const firstSectionUrl = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(a => a.href.includes('#') && a.textContent.length > 5 && a.textContent.length < 200)
      .filter(a => !a.href.includes('logout') && !a.href.includes('profile'));

    if (links.length > 0) {
      return {
        text: links[0].textContent.trim(),
        href: links[0].href
      };
    }
    return null;
  });

  if (firstSectionUrl) {
    console.log(`Found first section link: "${firstSectionUrl.text}"`);
    console.log(`Navigating to: ${firstSectionUrl.href.slice(0, 120)}...\n`);

    await page.goto(firstSectionUrl.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Analyze articles in this section
    console.log('STEP 5: Analyzing ARTICLES in first section...\n');

    const articlesAnalysis = await page.evaluate(() => {
      // Look for article items
      const articleSelectors = [
        'sol-article-item',
        '[class*="article-item"]',
        '[class*="post"]',
        '[class*="entry"]',
        'a[href*="/post/"]',
        '[data-article]'
      ];

      let articles = [];
      let bestSelector = '';

      for (const sel of articleSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          articles = Array.from(els).slice(0, 10).map((el, idx) => ({
            index: idx,
            tag: el.tagName,
            class: el.className,
            text: el.textContent.trim().slice(0, 150),
            href: el.getAttribute('href'),
            html: el.outerHTML.slice(0, 400)
          }));
          bestSelector = sel;
          break;
        }
      }

      return { articles, bestSelector, count: articles.length };
    });

    console.log(`Articles found with selector: "${articlesAnalysis.bestSelector}"`);
    console.log(`Total articles in section: ${articlesAnalysis.count}\n`);

    console.log('ARTICLE SAMPLES:');
    articlesAnalysis.articles.slice(0, 3).forEach((art, i) => {
      console.log(`${i + 1}) ${art.text.slice(0, 100)}`);
      if (art.href) console.log(`   → ${art.href.slice(0, 150)}`);
    });
  }

  // STEP 6: Generate summary
  console.log('\n═════════════════════════════════════════════════════════════\n');

  const summary = {
    sections: {
      selector: sectionsAnalysis.bestSelector,
      count: sectionsAnalysis.sections.length,
      samples: sectionsAnalysis.sections.slice(0, 5)
    },
    pagination: {
      selectors: Object.keys(paginationAnalysis.pagination),
      navButtons: paginationAnalysis.navButtons
    },
    articles: articlesAnalysis,
    recommendations: {
      sectionSelector: sectionsAnalysis.bestSelector || 'sol-board-entry, [class*="section"], [class*="category"]',
      articleSelector: articlesAnalysis.bestSelector || 'a[href*="/post/"], [class*="article-item"]',
      nextPageButton: 'button[aria-label*="next"], button:has-text("Next")',
      navigation_strategy: 'For each section: 1) Get section URL or ID, 2) Navigate to section, 3) Extract all articles, 4) Handle pagination'
    }
  };

  fs.writeFileSync('elo-sections-report.json', JSON.stringify(summary, null, 2));
  console.log('✓ Report saved: elo-sections-report.json\n');

  console.log('NAVIGATION STRATEGY:');
  console.log('1. Get all section titles/links from main board page');
  console.log('2. For EACH section:');
  console.log('   a) Navigate to section URL');
  console.log('   b) Extract all articles from that page');
  console.log('   c) While "next page" button exists:');
  console.log('      - Click next page');
  console.log('      - Extract articles from new page');
  console.log('3. For EACH article:');
  console.log('   a) Navigate to article URL');
  console.log('   b) Extract title, body, date, author, tags\n');

  console.log('Browser stays open. Close manually when done.\n');
}

analyzeSections().catch(console.error);
