const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║  ELO COMMUNITY ANALYSIS - WAITING FOR YOUR LOGIN          ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('Opening ELO Community login page...\n');
  await page.goto('https://community.elo.com/', { waitUntil: 'domcontentloaded' });

  console.log('✓ Login page open in browser window');
  console.log('➜ Please enter your credentials and click "Log in"\n');
  console.log('Waiting for login...\n');

  // Wait for login to complete by checking for logged-in indicator
  let loggedIn = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(5000);

    const isLoggedIn = await page.evaluate(() => {
      return document.body.innerText.includes('Armando') || 
             document.body.innerText.includes('Logout') ||
             window.location.href.includes('KnowledgeBoard');
    });

    if (isLoggedIn) {
      console.log('✓ Login detected! Starting analysis...\n');
      loggedIn = true;
      break;
    }

    console.log(`  Waiting... (${(i + 1) * 5}s)`);
  }

  if (!loggedIn) {
    console.log('✗ Login timeout. Please try again.\n');
    await browser.close();
    return;
  }

  // Navigate to knowledge board if not already there
  const boardUrl = 'https://community.elo.com/community/plugin/de.elo.ix.plugin.proxy/wf/apps/app/sol.knowledge.apps.KnowledgeBoard/#/?board=COMMUNITY&page=1';
  await page.goto(boardUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('ANALYZING SITE STRUCTURE...\n');

  // Get complete page analysis
  const analysis = await page.evaluate(() => {
    const fullText = document.body.innerText;
    const lines = fullText.split('\n').filter(l => l.trim().length > 0);

    // Look for section names (Bereiche)
    const sections = [];
    const sectionKeywords = ['Additional Clients', 'AI &', 'Analytics', 'Beta', 'Business Solutions',
      'Community Server', 'Contelo', 'Default', 'DocXtractor', 'ELO Academy', 'ELO Automation',
      'ELO Cloud', 'ELO for DATEV', 'ELOxc', 'Flows', 'Gen.', 'Important', 'Installation',
      'Integrationen', 'Java', 'Known Issues', 'Marketplace', 'Other', 'Server', 'Web Client'];

    lines.forEach(line => {
      sectionKeywords.forEach(keyword => {
        if (line.includes(keyword) && sections.indexOf(line) === -1) {
          sections.push(line.trim());
        }
      });
    });

    // Get articles/posts list
    const articles = Array.from(document.querySelectorAll('a[href*="/post/"], [class*="post"], [class*="article"]'))
      .slice(0, 20)
      .map(el => ({
        text: el.textContent.trim().slice(0, 150),
        href: el.getAttribute('href'),
        tag: el.tagName
      }));

    return {
      sections: sections.slice(0, 25),
      articlesCount: articles.length,
      articleSamples: articles,
      bodyLength: fullText.length,
      title: document.title,
      url: window.location.href
    };
  });

  console.log('CURRENT PAGE:');
  console.log(`URL: ${analysis.url}`);
  console.log(`Title: ${analysis.title}\n`);

  console.log('SECTIONS FOUND (Bereiche):');
  if (analysis.sections.length > 0) {
    analysis.sections.forEach((sec, i) => {
      console.log(`  ${i + 1}) ${sec}`);
    });
  } else {
    console.log('  (No sections found in text)');
  }

  console.log('\nARTICLES/POSTS FOUND:');
  if (analysis.articleSamples.length > 0) {
    analysis.articleSamples.slice(0, 5).forEach((art, i) => {
      console.log(`\n  ${i + 1}) ${art.text}`);
      if (art.href) console.log(`     → ${art.href}`);
    });
  } else {
    console.log('  (No posts found with that selector)');
  }

  // Get all visible text structure
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('PAGE CONTENT (first 3000 characters):\n');

  const pageContent = await page.innerText('body');
  console.log(pageContent.slice(0, 3000));
  console.log('\n...\n');

  // Get all clickable elements
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('CLICKABLE ELEMENTS (Links & Buttons):\n');

  const clickables = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button'))
      .filter(el => el.offsetParent !== null && el.textContent.trim().length > 0)
      .slice(0, 50)
      .map(el => ({
        text: el.textContent.trim().slice(0, 80),
        href: el.href || el.getAttribute('data-href') || '(no href)',
        tag: el.tagName
      }));
  });

  clickables.forEach((item, i) => {
    console.log(`${i + 1}) [${item.tag}] ${item.text}`);
    if (item.href && item.href !== '(no href)') {
      console.log(`   → ${item.href.slice(0, 120)}`);
    }
  });

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('Browser will stay open for you to inspect manually if needed.');
  console.log('Close it when done.\n');

  // Keep browser open
  await new Promise(() => {});
})().catch(console.error);
