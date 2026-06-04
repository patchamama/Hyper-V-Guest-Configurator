'use strict';
const { EventEmitter } = require('events');
const { chromium }     = require('playwright');
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');
const crypto  = require('crypto');

const SCRIPT_DIR   = path.join(__dirname, '..');
const SESSION_FILE = path.join(SCRIPT_DIR, 'community', '.session.json');

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[äÄ]/g,'ae').replace(/[öÖ]/g,'oe').replace(/[üÜ]/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0, 80) || 'untitled';
}

function formatDate(str) {
  if (!str) return new Date().toISOString().slice(0,10);
  try { return new Date(str).toISOString().slice(0,10); } catch { return new Date().toISOString().slice(0,10); }
}

function stripHtmlTags(s) {
  return s.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
          .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
          .replace(/&nbsp;/g,' ').trim();
}

function htmlToMarkdown(html) {
  if (!html) return '';

  // Try to use turndown if available, otherwise use built-in converter
  try {
    const TurndownService = require('turndown');
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    td.addRule('removeScripts', { filter: ['script','style'], replacement: () => '' });
    return td.turndown(html);
  } catch { /* fallback */ }

  // Built-in HTML→Markdown converter
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_,c) => `\n# ${stripHtmlTags(c)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_,c) => `\n## ${stripHtmlTags(c)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_,c) => `\n### ${stripHtmlTags(c)}\n`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_,c) => `\n#### ${stripHtmlTags(c)}\n`)
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_,c) => `\n##### ${stripHtmlTags(c)}\n`)
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_,c) => `**${stripHtmlTags(c)}**`)
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_,c) => `**${stripHtmlTags(c)}**`)
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_,c) => `_${stripHtmlTags(c)}_`)
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_,c) => `_${stripHtmlTags(c)}_`)
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_,c) => `\n\`\`\`\n${stripHtmlTags(c)}\n\`\`\`\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_,c) => `\`${stripHtmlTags(c)}\``)
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_,href,c) => `[${stripHtmlTags(c)}](${href})`)
    .replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, (_,src,alt) => `![${alt}](${src})`)
    .replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, (_,src) => `![](${src})`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_,c) => `- ${stripHtmlTags(c).trim()}\n`)
    .replace(/<[ou]l[^>]*>/gi, '\n').replace(/<\/[ou]l>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_,c) => `\n${c}\n`)
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_,c) => `\n${c}\n`)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n))
    .replace(/\n{3,}/g,'\n\n').trim();
}

async function downloadImage(url, destPath) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(url, { timeout: 12000 }, res => {
        if (res.statusCode !== 200) { resolve(false); return; }
        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const stream = fs.createWriteStream(destPath);
        res.pipe(stream);
        stream.on('finish', () => resolve(true));
        stream.on('error', () => resolve(false));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    } catch { resolve(false); }
  });
}

// ── CommunityScraper ───────────────────────────────────────────────────────────

class CommunityScraper extends EventEmitter {
  constructor(config) {
    super();
    this.config  = config;
    this.browser = null;
    this.context = null;
    this.page    = null;
    this.stopped = false;
    this.stats   = { sections: 0, articles: 0, images: 0, errors: 0 };
  }

  _log(msg, level = 'info') {
    this.emit('progress', { type: 'log', level, msg, time: new Date().toISOString() });
  }

  async _sleep(ms) {
    await new Promise(r => setTimeout(r, ms));
    if (this.stopped) throw new Error('Scraping stopped by user');
  }

  // Try each comma-separated CSS selector in order, return first match
  async _try(selectors, timeout = 4000) {
    if (!selectors) return null;
    const list = selectors.split(',').map(s => s.trim()).filter(Boolean);
    const perSel = Math.max(600, Math.floor(timeout / list.length));
    for (const sel of list) {
      try {
        const el = await this.page.waitForSelector(sel, { timeout: perSel });
        if (el) return { sel, el };
      } catch { /* next */ }
    }
    return null;
  }

  // ── Login ──────────────────────────────────────────────────────────────────

  async login(username, password) {
    const { auth } = this.config;
    this._log(`Launching browser → ${auth.loginUrl}`);

    this.browser = await chromium.launch({ headless: false, slowMo: 40 });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    // Try to restore saved session cookies
    const session = this._loadSession();
    if (session?.cookies?.length) {
      await this.context.addCookies(session.cookies).catch(() => {});
      this._log('Session cookies restored');
    }

    this.page = await this.context.newPage();
    await this.page.goto(auth.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await this._sleep(1200);

    // Check if already authenticated
    const alreadyIn = await this._try(auth.selectors.loggedInIndicator, 3000);
    if (alreadyIn) {
      this._log('Already authenticated (session valid)');
      return true;
    }

    // Auto-login
    this._log('Attempting auto-login…');
    try {
      const uField = await this._try(auth.selectors.usernameField, 6000);
      const pField = await this._try(auth.selectors.passwordField, 4000);

      if (uField && pField) {
        await uField.el.fill(username);
        await this._sleep(350);
        await pField.el.fill(password);
        await this._sleep(350);

        const submit = await this._try(auth.selectors.submitButton, 3000);
        if (submit) {
          await submit.el.click();
          await this.page.waitForLoadState('networkidle', { timeout: 18000 }).catch(() => {});
          await this._sleep(1500);
        }
      } else {
        this._log('Login form fields not found with configured selectors', 'warn');
      }
    } catch (e) {
      this._log(`Auto-login error: ${e.message}`, 'warn');
    }

    // Verify
    const verified = await this._try(auth.selectors.loggedInIndicator, 8000);
    if (!verified) {
      this._log('Auto-login uncertain. Browser is open — please log in manually (checking for up to 5 minutes)', 'warn');
      this.emit('progress', { type: 'needs-manual-login' });
      for (let i = 0; i < 300; i++) {
        await this._sleep(1000);
        const check = await this._try(auth.selectors.loggedInIndicator, 800);
        if (check) { this._log('Manual login detected'); break; }
        if (i === 299) { this._log('Login timeout after 5 minutes', 'error'); return false; }
      }
    } else {
      this._log('Login successful');
    }

    // Save session
    try {
      const cookies = await this.context.cookies();
      this._saveSession({ cookies });
    } catch { /* ignore */ }

    return true;
  }

  // ── Main scrape loop ───────────────────────────────────────────────────────

  async scrapeAll() {
    const { board, output } = this.config;
    const outDir = path.join(SCRIPT_DIR, output.dir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    this._log(`Navigating to board → ${board.url}`);
    this.emit('progress', { type: 'phase', phase: 'discovering', msg: 'Discovering sections (Bereiche)…' });

    await this.page.goto(board.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await this._sleep(2500);

    if (board.waitForSelector) {
      const found = await this._try(board.waitForSelector, board.waitTimeout || 20000);
      if (!found) this._log(`Board root selector not found: ${board.waitForSelector}`, 'warn');
    }

    // Save debug snapshot
    try { fs.writeFileSync(path.join(outDir, '.debug-board.html'), await this.page.content(), 'utf8'); } catch {}

    const sections = await this._discoverSections();

    if (!sections.length) {
      this._log('No sections found. Review selectors in community-config.json and inspect .debug-board.html', 'warn');
      this.emit('progress', { type: 'done', stats: this.stats });
      return;
    }

    this._log(`Found ${sections.length} section(s): ${sections.map(s => s.title).join(', ')}`);
    this.emit('progress', { type: 'sections-found', count: sections.length, sections: sections.map(s => s.title) });

    for (const section of sections) {
      if (this.stopped) break;
      await this._scrapeSection(section, outDir);
      await this._sleep(output.delayBetweenSections || 3000);
    }

    this._updateIndex(outDir);

    this._log(`\nScraping complete — Articles: ${this.stats.articles}, Images: ${this.stats.images}, Errors: ${this.stats.errors}`);
    this.emit('progress', { type: 'done', stats: { ...this.stats } });
  }

  // ── Section discovery ──────────────────────────────────────────────────────

  async _discoverSections() {
    const { selectors } = this.config.board;
    const sections = [];

    try {
      const sectionEls = await this.page.$$(selectors.sectionItems);
      for (const el of sectionEls) {
        try {
          let title = '';
          const titCandidates = selectors.sectionTitle.split(',').map(s => s.trim());
          for (const tc of titCandidates) {
            try { title = await el.$eval(tc, e => e.textContent?.trim() || ''); if (title) break; } catch {}
          }
          if (!title) title = await el.textContent().then(t => t.trim().split('\n')[0].slice(0, 60)).catch(() => '');

          const linkEl = await el.$(selectors.sectionLink).catch(() => null);
          const href = linkEl ? await linkEl.getAttribute('href').catch(() => null) : null;

          if (title && title.length > 1) sections.push({ title: title.trim(), href });
        } catch { /* skip element */ }
      }
    } catch { /* ignore */ }

    // Fallback: find navigation links that look like sections
    if (!sections.length) {
      this._log('Primary section selectors found nothing — trying link-based fallback', 'warn');
      try {
        const links = await this.page.$$('nav a[href], aside a[href], .sidebar a[href], [class*="menu"] a[href]');
        for (const link of links) {
          const text = await link.textContent().then(t => t.trim()).catch(() => '');
          const href = await link.getAttribute('href').catch(() => null);
          if (text.length > 2 && text.length < 80 && href) {
            sections.push({ title: text, href });
          }
        }
      } catch { /* ignore */ }
    }

    // Deduplicate by title
    const seen = new Set();
    return sections.filter(s => { const k = s.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ── Per-section scraping ───────────────────────────────────────────────────

  async _scrapeSection(section, outDir) {
    const { board, output } = this.config;
    const sectionSlug = slugify(section.title);
    const sectionDir  = path.join(outDir, sectionSlug);
    if (!fs.existsSync(sectionDir)) fs.mkdirSync(sectionDir, { recursive: true });

    this._log(`\n📁 Section: ${section.title}`);
    this.emit('progress', { type: 'section-start', section: section.title, slug: sectionSlug });
    this.stats.sections++;

    // Navigate to section
    if (section.href) {
      try {
        let url;
        if (section.href.startsWith('http')) {
          url = section.href;
        } else if (section.href.startsWith('#')) {
          url = board.url.split('#')[0] + section.href;
        } else {
          url = new URL(section.href, board.url).href;
        }
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await this._sleep(1500);
      } catch (e) {
        this._log(`Navigation error for section "${section.title}": ${e.message}`, 'warn');
      }
    }

    let pageNum = 1;
    let totalInSection = 0;
    while (!this.stopped) {
      const articles = await this._getArticleLinks();
      if (!articles.length) {
        if (pageNum === 1) this._log(`  No articles found on page 1 of "${section.title}"`, 'warn');
        break;
      }

      this._log(`  Page ${pageNum}: ${articles.length} article(s)`);

      for (const article of articles) {
        if (this.stopped) break;
        if (output.maxArticlesPerSection > 0 && totalInSection >= output.maxArticlesPerSection) break;
        await this._scrapeArticle(article, section, sectionDir);
        totalInSection++;
        await this._sleep(output.delayBetweenArticles || 1500);
      }

      const hasNext = await this._goNextPage();
      if (!hasNext) break;
      pageNum++;
      await this._sleep(output.delayBetweenPages || 2000);
    }
  }

  // ── Article list extraction ────────────────────────────────────────────────

  async _getArticleLinks() {
    const { selectors } = this.config.board;
    const articles = [];

    try {
      const items = await this.page.$$(selectors.articleItems);
      for (const item of items) {
        const linkEl = await item.$(selectors.articleLink).catch(() => null);
        if (!linkEl) continue;
        const href  = await linkEl.getAttribute('href').catch(() => null);
        const title = await linkEl.textContent().then(t => t.trim()).catch(() => '') ||
                      await item.textContent().then(t => t.trim().slice(0, 80)).catch(() => '');
        if (href) articles.push({ href, title });
      }
    } catch { /* ignore */ }

    // Fallback
    if (!articles.length) {
      try {
        const links = await this.page.$$('a[href*="article"], a[href*="?article="], a[href*="&article="], a[href*="#/"][href*="article"]');
        for (const link of links) {
          const href  = await link.getAttribute('href').catch(() => null);
          const title = await link.textContent().then(t => t.trim()).catch(() => '');
          if (href && title.length > 2) articles.push({ href, title });
        }
      } catch { /* ignore */ }
    }

    return articles;
  }

  async _goNextPage() {
    const { selectors } = this.config.board;
    try {
      const btn = await this._try(selectors.paginationNext, 2500);
      if (!btn) return false;
      const disabled = await btn.el.getAttribute('disabled').catch(() => null);
      const ariaDisabled = await btn.el.getAttribute('aria-disabled').catch(() => null);
      if (disabled !== null || ariaDisabled === 'true') return false;
      await btn.el.click();
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this._sleep(800);
      return true;
    } catch { return false; }
  }

  // ── Individual article ─────────────────────────────────────────────────────

  async _scrapeArticle(article, section, sectionDir) {
    const { board, output } = this.config;
    const { selectors } = board;

    let articleUrl = article.href;
    if (!articleUrl.startsWith('http')) {
      try {
        articleUrl = articleUrl.startsWith('#')
          ? board.url.split('#')[0] + articleUrl
          : new URL(articleUrl, board.url).href;
      } catch { articleUrl = article.href; }
    }

    try {
      await this.page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await this._sleep(700);
    } catch (e) {
      this._log(`  ✗ Navigation failed: ${articleUrl} — ${e.message}`, 'error');
      this.stats.errors++;
      return;
    }

    try {
      // Extract fields
      const title = await this._extractText(selectors.articleTitle) || article.title || await this.page.title();
      const dateRaw = await this._extractAttrOrText(selectors.articleDate, 'datetime');
      const author  = await this._extractText(selectors.articleAuthor) || '';
      const tags    = await this._extractAll(selectors.articleTags);
      const bodyHtml = await this._extractHtml(selectors.articleBody);

      if (!bodyHtml && !title) {
        this._log(`  ⚠ Empty article skipped: ${articleUrl}`, 'warn');
        this.stats.errors++;
        return;
      }

      const slug = slugify(title || article.title || `article-${Date.now()}`);
      const date = formatDate(dateRaw);
      const dirName = `${slug}-${date}`;
      const artDir  = path.join(sectionDir, dirName);

      if (!output.overwriteExisting && fs.existsSync(path.join(artDir, 'article.md'))) {
        this._log(`  ↷ Skip (exists): ${title}`);
        return;
      }

      if (!fs.existsSync(artDir)) fs.mkdirSync(artDir, { recursive: true });

      // Download images + convert HTML to Markdown
      let mdBody = bodyHtml;
      if (output.downloadImages && bodyHtml) {
        mdBody = await this._processImages(bodyHtml, path.join(artDir, 'images'), articleUrl);
      }
      mdBody = htmlToMarkdown(mdBody);

      // Write article.md with YAML frontmatter
      const fm = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `section: ${JSON.stringify(section.title)}`,
        `date: "${date}"`,
        `author: ${JSON.stringify(author)}`,
        `tags: [${tags.map(t => JSON.stringify(t)).join(', ')}]`,
        `url: ${JSON.stringify(articleUrl)}`,
        `scraped: "${new Date().toISOString()}"`,
        '---',
        '',
        `# ${title}`,
        '',
      ].join('\n');

      fs.writeFileSync(path.join(artDir, 'article.md'), fm + mdBody, 'utf8');

      const meta = { title, section: section.title, date, author, tags, url: articleUrl, slug, dir: dirName, scraped: new Date().toISOString() };
      fs.writeFileSync(path.join(artDir, 'metadata.json'), JSON.stringify(meta, null, 2), 'utf8');

      this.stats.articles++;
      this._log(`  ✓ ${title} (${date})`);
      this.emit('progress', { type: 'article-done', title, section: section.title, date, stats: { ...this.stats } });

    } catch (e) {
      this._log(`  ✗ Error: ${articleUrl} — ${e.message}`, 'error');
      this.stats.errors++;
    }
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  async _extractText(selectors) {
    if (!selectors) return '';
    for (const sel of selectors.split(',').map(s => s.trim())) {
      try { const t = await this.page.$eval(sel, e => e.textContent?.trim() || ''); if (t) return t; } catch {}
    }
    return '';
  }

  async _extractHtml(selectors) {
    if (!selectors) return '';
    for (const sel of selectors.split(',').map(s => s.trim())) {
      try { const h = await this.page.$eval(sel, e => e.innerHTML || ''); if (h) return h; } catch {}
    }
    return '';
  }

  async _extractAttrOrText(selectors, attr) {
    if (!selectors) return '';
    for (const sel of selectors.split(',').map(s => s.trim())) {
      try {
        const val = await this.page.$eval(sel, (e, a) => e.getAttribute(a) || e.textContent?.trim() || '', attr);
        if (val) return val;
      } catch {}
    }
    return '';
  }

  async _extractAll(selectors) {
    if (!selectors) return [];
    for (const sel of selectors.split(',').map(s => s.trim())) {
      try {
        const vals = await this.page.$$eval(sel, els => els.map(e => e.textContent?.trim()).filter(Boolean));
        if (vals.length) return vals;
      } catch {}
    }
    return [];
  }

  // ── Image processing ───────────────────────────────────────────────────────

  async _processImages(html, imgDir, baseUrl) {
    const srcRegex = /src="([^"]+)"/g;
    const downloads = [];
    let m;

    while ((m = srcRegex.exec(html)) !== null) {
      const src = m[1];
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      try {
        const imgUrl = src.startsWith('http') ? src : new URL(src, baseUrl).href;
        const ext = (path.extname(new URL(imgUrl).pathname) || '.png').slice(0, 5);
        const hash = crypto.createHash('md5').update(imgUrl).digest('hex').slice(0, 10);
        const filename = `img-${hash}${ext}`;
        downloads.push({ src, imgUrl, filename });
      } catch { /* skip invalid */ }
    }

    if (!downloads.length) return html;

    let result = html;
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

    for (const dl of downloads) {
      const destPath = path.join(imgDir, dl.filename);
      if (!fs.existsSync(destPath)) {
        const ok = await downloadImage(dl.imgUrl, destPath);
        if (ok) this.stats.images++;
      }
      result = result.split(dl.src).join(`images/${dl.filename}`);
    }
    return result;
  }

  // ── Index ──────────────────────────────────────────────────────────────────

  _updateIndex(outDir) {
    const index = { updated: new Date().toISOString(), sections: {} };
    try {
      const dirs = fs.readdirSync(outDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'));
      for (const d of dirs) {
        const sectionPath = path.join(outDir, d.name);
        const arts = [];
        const artDirs = fs.readdirSync(sectionPath, { withFileTypes: true }).filter(x => x.isDirectory());
        for (const ad of artDirs) {
          const mp = path.join(sectionPath, ad.name, 'metadata.json');
          if (fs.existsSync(mp)) { try { arts.push(JSON.parse(fs.readFileSync(mp, 'utf8'))); } catch {} }
        }
        index.sections[d.name] = { count: arts.length, articles: arts };
      }
    } catch { /* ignore */ }
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
    this._log(`Index updated — ${Object.values(index.sections).reduce((s,x)=>s+x.count,0)} total articles`);
  }

  // ── Session storage ────────────────────────────────────────────────────────

  _loadSession() {
    try { if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch {}
    return null;
  }

  _saveSession(state) {
    try {
      fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
      fs.writeFileSync(SESSION_FILE, JSON.stringify(state), 'utf8');
    } catch { /* ignore */ }
  }

  async stop() {
    this.stopped = true;
    try { if (this.browser) await this.browser.close(); } catch {}
    this.browser = null;
  }
}

module.exports = { CommunityScraper };
