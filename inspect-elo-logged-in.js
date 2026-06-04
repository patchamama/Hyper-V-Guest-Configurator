#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');

async function inspectLoggedInState() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Opening https://community.elo.com/...');
  await page.goto('https://community.elo.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  console.log('\nPlease log in manually in the browser window.');
  console.log('Waiting for login indicator (up to 2 minutes)...\n');

  // Wait for logged-in indicator
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);

    // Check various indicators
    const navbarItems = await page.$$eval('.navbar-item', els => els.length);
    const userMenus = await page.$$eval('[data-test*="user"], [class*="user-menu"], [class*="profile"]', els => els.length);
    const logoutBtn = await page.$('a[href*="logout"], button:has-text("Logout"), button:has-text("Sign out")').catch(() => null);

    if (navbarItems > 0 || userMenus > 0 || logoutBtn) {
      console.log('✓ Login detected!\n');

      // Inspect what changed
      console.log('=== LOGGED-IN PAGE STRUCTURE ===\n');

      // Check navbar
      const navHtml = await page.$eval('nav', el => el.outerHTML.slice(0, 2000)).catch(() => null);
      if (navHtml) {
        console.log('NAVBAR (first 2000 chars):');
        console.log(navHtml);
        console.log('\n');
      }

      // Get all elements with "user" in various attributes
      const userElements = await page.$$eval('[class*="user"], [data-test*="user"], [class*="profile"], [class*="account"]', els =>
        els.map(el => ({
          tag: el.tagName,
          class: el.className,
          id: el.id,
          text: el.textContent.trim().slice(0, 50),
          dataTest: el.getAttribute('data-test'),
          href: el.getAttribute('href')
        }))
      );

      console.log('USER-RELATED ELEMENTS:');
      userElements.forEach((el, i) => {
        if (i < 10) {
          console.log(`${i}) ${el.tag} class="${el.class}" data-test="${el.dataTest || 'none'}"`);
          console.log(`   Text: "${el.text}", href: "${el.href || 'none'}"\n`);
        }
      });

      // Get navbar dropdown
      const dropdowns = await page.$$eval('.navbar-dropdown, [role="menu"], .dropdown-menu', els =>
        els.map(el => ({
          class: el.className,
          children: el.children.length,
          text: el.textContent.trim().slice(0, 100)
        }))
      );

      console.log('DROPDOWN MENUS:');
      dropdowns.forEach((dd, i) => {
        console.log(`${i}) Class: "${dd.class}", Children: ${dd.children}, Text preview: "${dd.text}"\n`);
      });

      // Get logout/profile links
      const profileLinks = await page.$$eval('a, button', els =>
        els.filter(el =>
          el.textContent.toLowerCase().includes('profile') ||
          el.textContent.toLowerCase().includes('logout') ||
          el.textContent.toLowerCase().includes('sign out') ||
          el.getAttribute('href')?.includes('profile') ||
          el.getAttribute('href')?.includes('logout')
        ).map(el => ({
          tag: el.tagName,
          text: el.textContent.trim(),
          class: el.className,
          href: el.getAttribute('href')
        }))
      );

      console.log('PROFILE/LOGOUT LINKS:');
      profileLinks.forEach(link => {
        console.log(`- ${link.tag} "${link.text}" href="${link.href || 'none'}"`);
      });

      console.log('\n=== RECOMMENDED SELECTORS ===');
      console.log('loggedInIndicator: ".navbar-item.has-dropdown .navbar-link, .navbar-item .navbar-link[href*=\'profile\'], a[href*=\'/profile\'], .user-menu"');
      break;
    }

    if (i % 10 === 0 && i > 0) {
      console.log(`Waiting... (${i}s elapsed)`);
    }
  }

  console.log('\nBrowser window will stay open. Close manually when done.');
}

inspectLoggedInState().catch(console.error);
