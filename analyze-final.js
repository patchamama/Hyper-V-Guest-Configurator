const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║ ELO COMMUNITY COMPLETE ANALYSIS - WAITING FOR YOUR LOGIN  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log('Opening login page...\n');
  await page.goto('https://community.elo.com/', { waitUntil: 'domcontentloaded' });

  console.log('✓ Login page ready');
  console.log('➜ Please log in now in the browser window\n');
  console.log('Waiting for Knowledge Board to load...\n');

  // Wait for Knowledge Board page to load with actual content
  let loaded = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(5000);

    const pageState = await page.evaluate(() => {
      const url = window.location.href;
      const hasArticles = document.body.innerText.includes('Breaking Change') || 
                         document.body.innerText.includes('Server') ||
                         document.querySelectorAll('a[href*="/post/"]').length > 0;
      const isKnowledgeBoard = url.includes('KnowledgeBoard');
      const hasContent = document.body.innerText.length > 5000;

      return { url, hasArticles, isKnowledgeBoard, hasContent };
    });

    if (pageState.isKnowledgeBoard && pageState.hasContent) {
      console.log('✓ Knowledge Board loaded with content!\n');
      loaded = true;
      break;
    }

    console.log(`  Waiting... (${(i + 1) * 5}s)`);
  }

  if (!loaded) {
    console.log('✗ Timeout - could not load Knowledge Board\n');
    await browser.close();
    return;
  }

  // FULL ANALYSIS
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('STARTING FULL SITE ANALYSIS...\n');

  const fullAnalysis = await page.evaluate(() => {
    const pageText = document.body.innerText;
    const pageHtml = document.documentElement.outerHTML;

    // Get all sections/bereiche by looking for common keywords
    const sectionKeywords = [
      'Additional Clients', 'AI & Machine Learning', 'Analytics', 'Beta Test',
      'Business Solutions', 'Community Server', 'Contelo', 'Default', 'DocXtractor',
      'ELO Academy', 'ELO Automation', 'ELO Cloud', 'ELO for DATEV', 'ELOxc', 'Flows',
      'Gen.', 'Important announcements', 'Installation', 'Integrationen', 'Java',
      'Known Issues', 'Marketplace', 'Other topics', 'Server', 'Web Client'
    ];

    const foundSections = sectionKeywords.filter(kw => pageText.includes(kw));

    // Get all links
    const allLinks = Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({
        text: a.textContent.trim(),
        href: a.href,
        visible: a.offsetParent !== null
      }))
      .filter(l => l.text.length > 0);

    // Get section links specifically
    const sectionLinks = allLinks.filter(l => 
      foundSections.some(s => l.text.includes(s))
    );

    // Get article items
    const articles = Array.from(document.querySelectorAll('a[href*="/post/"], [class*="post"], [class*="article"]'))
      .slice(0, 15)
      .map(el => ({
        text: el.textContent.trim().slice(0, 150),
        href: el.getAttribute('href') || el.querySelector('a')?.href,
        tag: el.tagName,
        class: el.className.slice(0, 100)
      }));

    return {
      foundSections,
      sectionLinksCount: sectionLinks.length,
      sectionLinksSample: sectionLinks.slice(0, 10),
      articlesFound: articles.length,
      articleSamples: articles.slice(0, 5),
      totalLinksCount: allLinks.length,
      pageTextLength: pageText.length,
      url: window.location.href
    };
  });

  console.log(`URL: ${fullAnalysis.url}\n`);

  console.log(`SECTIONS FOUND (${fullAnalysis.foundSections.length}):`);
  fullAnalysis.foundSections.forEach((sec, i) => {
    console.log(`  ${i + 1}) ${sec}`);
  });

  console.log(`\nSECTION LINKS (${fullAnalysis.sectionLinksCount} total):`);
  fullAnalysis.sectionLinksSample.forEach((link, i) => {
    console.log(`  ${i + 1}) "${link.text}" → ${link.href.slice(0, 120)}`);
  });

  console.log(`\nARTICLES IN CURRENT VIEW (${fullAnalysis.articlesFound}):`);
  fullAnalysis.articleSamples.forEach((art, i) => {
    console.log(`  ${i + 1}) ${art.text.slice(0, 100)}`);
    if (art.href) console.log(`     → ${art.href.slice(0, 120)}`);
  });

  // CLICK FIRST SECTION
  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('NAVIGATING TO FIRST SECTION...\n');

  if (fullAnalysis.sectionLinksSample.length > 0) {
    const firstSectionUrl = fullAnalysis.sectionLinksSample[0].href;
    const firstSectionName = fullAnalysis.sectionLinksSample[0].text;

    console.log(`Opening: "${firstSectionName}"`);
    console.log(`URL: ${firstSectionUrl}\n`);

    await page.goto(firstSectionUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Analyze section content
    const sectionAnalysis = await page.evaluate(() => {
      const articles = Array.from(document.querySelectorAll('a[href*="/post/"], [class*="post"], [class*="article"]'))
        .slice(0, 20)
        .map(el => ({
          text: el.textContent.trim().slice(0, 150),
          href: el.getAttribute('href') || el.querySelector('a')?.href
        }));

      // Check for pagination
      const nextButton = document.querySelector('button:has-text("Next"), button[aria-label*="Next"], .pagination-next, [class*="next"]');
      const pageInfo = document.body.innerText.match(/page\s*(\d+)\s*of\s*(\d+)/i) || 
                       document.body.innerText.match(/(\d+)\s*-\s*(\d+)\s*of\s*(\d+)/i);

      return {
        articlesCount: articles.length,
        articles: articles.slice(0, 5),
        hasNextButton: !!nextButton,
        pageInfo: pageInfo ? pageInfo[0] : 'unknown'
      };
    });

    console.log(`ARTICLES IN "${firstSectionName}" (${sectionAnalysis.articlesCount}):\n`);
    sectionAnalysis.articles.forEach((art, i) => {
      console.log(`  ${i + 1}) ${art.text.slice(0, 100)}`);
      if (art.href) console.log(`     → ${art.href.slice(0, 150)}\n`);
    });

    console.log(`Has pagination: ${sectionAnalysis.hasNextButton}`);
    console.log(`Page info: ${sectionAnalysis.pageInfo}`);

    // CLICK FIRST ARTICLE
    if (sectionAnalysis.articles.length > 0) {
      console.log('\n═══════════════════════════════════════════════════════════\n');
      console.log('OPENING FIRST ARTICLE...\n');

      const firstArticleUrl = sectionAnalysis.articles[0].href;
      console.log(`URL: ${firstArticleUrl}\n`);

      await page.goto(firstArticleUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const articleContent = await page.evaluate(() => {
        const title = document.querySelector('h1, [class*="title"]')?.textContent.trim() || 'No title';
        const body = document.querySelector('[class*="content"], .ql-editor, article, [role="main"]')?.textContent.trim().slice(0, 500) || 'No content';
        const date = document.querySelector('time, [class*="date"]')?.textContent.trim() || 'No date';
        const author = document.querySelector('[class*="author"], [class*="by"]')?.textContent.trim() || 'No author';
        const tags = Array.from(document.querySelectorAll('[class*="tag"], [class*="label"], .tag'))
          .map(t => t.textContent.trim())
          .filter(t => t.length > 0 && t.length < 50)
          .slice(0, 5);

        return { title, body, date, author, tags, url: window.location.href };
      });

      console.log(`ARTICLE: "${articleContent.title}"`);
      console.log(`DATE: ${articleContent.date}`);
      console.log(`AUTHOR: ${articleContent.author}`);
      console.log(`TAGS: ${articleContent.tags.join(', ') || 'none'}`);
      console.log(`\nCONTENT PREVIEW:\n${articleContent.body.slice(0, 300)}\n`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('\n✓ Analysis complete. Browser will stay open.');
  console.log('Close it manually when done.\n');

  // Keep browser open
  await new Promise(() => {});
})().catch(console.error);
