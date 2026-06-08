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

// Parse ELO date format "20250730081900" → "2025-07-30"
function parseEloDate(d) {
  if (!d) return new Date().toISOString().slice(0,10);
  const s = String(d).replace(/\D/g,'');
  if (s.length >= 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return formatDate(d);
}

// Flatten an ELO objKeys value (may be string, number, or array)
function eloVal(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v);
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

    // ── Fast path: try saved session first (no browser needed) ─────────────────
    const saved = this._loadSession();
    if (saved?.cookies?.length) {
      this._log('Saved session found — verifying via native HTTP…');
      this._applySessionCookies(saved.cookies);
      const ok = await this._verifySession();
      if (ok) {
        this._log('Session restored and verified ✓ — browser not needed');
        return true;
      }
      this._log('Saved session expired — fresh login required', 'warn');
      this._cookieHeader   = '';
      this._sessionCookies = [];
    }

    // ── Browser login ───────────────────────────────────────────────────────────
    this._log(`Launching browser → ${auth.loginUrl}`);
    this.browser = await chromium.launch({ headless: false, slowMo: 40 });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });

    this.page = await this.context.newPage();
    await this.page.goto(auth.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await this._sleep(1200);

    // Auto-login
    this._log('Attempting auto-login…');
    let uFieldSel = null;
    try {
      const uField = await this._try(auth.selectors.usernameField, 6000);
      const pField = await this._try(auth.selectors.passwordField, 4000);
      uFieldSel = uField?.sel || null;
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
    } catch (e) { this._log(`Auto-login error: ${e.message}`, 'warn'); }

    // Verify login
    const postUrl   = this.page.url();
    const urlChanged = postUrl !== auth.loginUrl && !postUrl.includes('/login') &&
                       !postUrl.includes('?login') && !postUrl.includes('act=login');
    const formGone   = uFieldSel ? !(await this.page.$(uFieldSel).catch(() => null)) : false;
    const indicator  = await this._try(auth.selectors.loggedInIndicator, 2500);

    if (urlChanged || formGone || indicator) {
      this._log(`Browser login successful (url=${urlChanged}, form=${formGone}, indicator=${!!indicator})`);
    } else {
      this._log('Auto-login uncertain — browser open for manual login (up to 5 min)', 'warn');
      this.emit('progress', { type: 'needs-manual-login' });
      for (let i = 0; i < 300; i++) {
        await this._sleep(1000);
        const url2 = this.page.url();
        const ind2  = await this._try(auth.selectors.loggedInIndicator, 500);
        const gone2 = uFieldSel ? !(await this.page.$(uFieldSel).catch(() => null)) : false;
        if (ind2 || gone2 || (url2 !== auth.loginUrl && !url2.includes('/login'))) {
          this._log('Manual login detected'); break;
        }
        if (i === 299) { this._log('Login timeout after 5 min', 'error'); return false; }
      }
    }

    // Extract cookies, save, close browser — API calls use native HTTPS from here
    const cookies = await this.context.cookies();
    this._applySessionCookies(cookies);
    this._saveSession({ cookies });
    this._log(`Cookies extracted (${cookies.length}) — closing browser, switching to native HTTPS`);
    await this.browser.close();
    this.browser = null; this.context = null; this.page = null;

    // Final verify via native HTTP
    const verified = await this._verifySession();
    if (!verified) { this._log('WARNING: native HTTP verification failed — may have issues', 'warn'); }
    return true;
  }

  _applySessionCookies(cookies) {
    this._sessionCookies = cookies;
    this._cookieHeader   = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  async _verifySession() {
    try {
      const r = await this._apiCall('RF_sol_knowledge_services_Search_FindPosts', {
        searchMode: null, searchId: -1, language: 'de', idx: 0, max: 1,
        filter: [{ key: 'SOL_TYPE', val: 'KNOWLEDGE_POST' }],
        sordKeys: ['id'], objKeys: [], orderBy: 'objxdate DESC',
      });
      return Array.isArray(r?.sords);
    } catch { return false; }
  }

  // ── ELO Knowledge REST API via native HTTPS (cookie header from extracted session) ─

  async _apiCall(endpoint, payload) {
    const base = this.config.board.apiBase ||
      new URL(this.config.board.url).origin +
      '/community/plugin/de.elo.ix.plugin.proxy/wf/apps/rest/api/exec_registered_fct/';
    const url  = (base.endsWith('/') ? base : base + '/') + endpoint;
    const body = 'any=' + encodeURIComponent(JSON.stringify(payload));

    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(url);
        const req = https.request({
          hostname: parsed.hostname,
          port:     parsed.port || 443,
          path:     parsed.pathname + (parsed.search || ''),
          method:   'POST',
          headers: {
            'Content-Type':   'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
            'Cookie':         this._cookieHeader || '',
            'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer':        this.config.board.url,
          },
        }, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch { reject(new Error(`Non-JSON HTTP ${res.statusCode}: ${data.slice(0, 150)}`)); }
          });
        });
        req.setTimeout(25000, () => { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
      } catch (e) { reject(e); }
    }).catch(e => {
      this._log(`API error [${endpoint}]: ${e.message}`, 'warn');
      return null;
    });
  }

  async _findPosts(space, searchId, idx) {
    const boardId = this.config.board.boardId || 'COMMUNITY';
    return this._apiCall('RF_sol_knowledge_services_Search_FindPosts', {
      searchMode: null, searchId, language: 'de', idx, max: 25,
      filter: [
        { key: 'SOL_TYPE',                  val: 'KNOWLEDGE_POST' },
        { key: 'KNOWLEDGE_BOARD_REFERENCE', val: boardId },
        { key: 'KNOWLEDGE_SPACE_REFERENCE', val: space },
      ],
      sordKeys: ['name','id','desc','guid','ownerId','ownerName','IDateIso','XDateIso','TStamp'],
      objKeys: [
        'KNOWLEDGE_POST_SUBJECT','KNOWLEDGE_COUNT_VIEWS','KNOWLEDGE_COUNT_REPLIES',
        'KNOWLEDGE_SOLVED','KNOWLEDGE_POST_TYPE','KNOWLEDGE_LABEL','KNOWLEDGE_TOPICS',
        'KNOWLEDGE_LANGUAGE','KNOWLEDGE_POST_AUTHORS_NAMES',
        'KNOWLEDGE_SPACE_REFERENCE','KNOWLEDGE_BOARD_REFERENCE',
      ],
      orderBy: 'objxdate DESC',
    });
  }

  async _getLinkedPosts(objId) {
    return this._apiCall('RF_sol_knowledge_services_GetLinkedPosts', {
      objId: String(objId),
      sordKeys: ['name','id','desc','guid','ownerId','ownerName','IDateIso','XDateIso'],
      objKeys: ['KNOWLEDGE_POST_SUBJECT','KNOWLEDGE_POST_TYPE','KNOWLEDGE_SOLVED',
                'KNOWLEDGE_POST_AUTHORS_NAMES'],
    });
  }

  _buildArticleUrl(section, articleId, guid) {
    const pattern = this.config.board.articleUrlPattern || '#/post/{guid}';
    const boardId = this.config.board.boardId || 'COMMUNITY';
    const base    = this.config.board.url.replace(/#.*$/, '');
    const hash    = pattern
      .replace('{board}', boardId)
      .replace('{space}', encodeURIComponent(section.space || ''))
      .replace('{id}',    String(articleId || ''))   // no encode — ELO IDs are numeric
      .replace('{guid}',  String(guid || articleId || '')); // GUIDs have parens — no encode
    return base + hash;
  }

  // Opens a headless browser ONLY when needed for article detail page navigation.
  // Reuses existing browser if already open. Restores session cookies automatically.
  async _ensureBrowser() {
    if (this.browser && this.page) return;
    this._log('Opening headless browser for article detail extraction…');
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    });
    if (this._sessionCookies?.length) {
      await this.context.addCookies(this._sessionCookies);
    }
    this.page = await this.context.newPage();
    // Navigate to board once to establish same-origin context
    await this.page.goto(this.config.board.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    this._log('Headless browser ready');
  }

  // Downloads an ELO-authenticated image via native HTTPS using session cookie header.
  // Replaces the old page.evaluate()-based approach — no browser needed.
  async _downloadImageWithAuth(imgUrl, destPath) {
    return new Promise(resolve => {
      try {
        const parsed = new URL(imgUrl);
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request({
          hostname: parsed.hostname,
          port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path:     parsed.pathname + (parsed.search || ''),
          method:   'GET',
          headers: {
            'Cookie':     this._cookieHeader || '',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer':    this.config.board.url,
          },
        }, res => {
          if (res.statusCode !== 200) { res.resume(); resolve(false); return; }
          const dir = path.dirname(destPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const stream = fs.createWriteStream(destPath);
          res.pipe(stream);
          stream.on('finish', () => resolve(true));
          stream.on('error', () => resolve(false));
        });
        req.setTimeout(15000, () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
        req.end();
      } catch { resolve(false); }
    });
  }

  // ── Main scrape loop ───────────────────────────────────────────────────────

  async scrapeAll() {
    const { board, output } = this.config;
    const outDir = path.join(SCRIPT_DIR, output.dir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    this._log('Using native HTTPS session — no browser navigation required');
    this.emit('progress', { type: 'phase', phase: 'discovering', msg: 'Loading sections from config…' });

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
      // API sections need no inter-section delay (no navigation); DOM sections still need it
      await this._sleep(section.space ? 300 : (output.delayBetweenSections || 3000));
    }

    this._updateIndex(outDir);

    // Close headless browser if it was opened for article detail navigation
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null; this.context = null; this.page = null;
    }

    this._log(`\nScraping complete — Articles: ${this.stats.articles}, Images: ${this.stats.images}, Errors: ${this.stats.errors}`);
    this.emit('progress', { type: 'done', stats: { ...this.stats } });
  }

  // ── Section discovery ──────────────────────────────────────────────────────

  async _discoverSections() {
    const { board } = this.config;
    const { selectors } = board;

    // ── Use predefined sections from config (fastest + most reliable) ──────────
    if (Array.isArray(board.sections) && board.sections.length > 0) {
      this._log(`Using ${board.sections.length} predefined sections from config`);
      const baseUrl    = board.url.replace(/#.*$/, '');
      const boardMatch = board.url.match(/[#?&]board=([^&#]+)/);
      const boardId    = boardMatch ? boardMatch[1] : 'COMMUNITY';
      return board.sections
        .filter(s => s.space !== null && s.space !== undefined)
        .map(s => ({
          title: s.name,
          space: s.space,
          href: `${baseUrl}#/?board=${boardId}&space=${encodeURIComponent(s.space)}&page=1`,
        }));
    }

    // ── DOM-based discovery (fallback when no sections array in config) ─────────
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

    this._log(`\n📁 Section: ${section.title}${section.space ? ` [${section.space}]` : ''}`);
    this.emit('progress', { type: 'section-start', section: section.title, slug: sectionSlug });
    this.stats.sections++;

    // ── REST API path: browser is already on community.elo.com — no navigation needed ─
    if (section.space) {
      await this._scrapeSectionViaAPI(section, sectionDir, output);
      return;
    }

    // ── DOM fallback: navigate to section first ────────────────────────────────
    const sectionUrl = section.href
      ? (section.href.startsWith('http') ? section.href :
         section.href.startsWith('#')    ? board.url.split('#')[0] + section.href :
         new URL(section.href, board.url).href)
      : board.url;
    try {
      await this.page.goto(sectionUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await this._sleep(1500);
    } catch (e) { this._log(`  Navigation error: ${e.message}`, 'warn'); }

    let pageNum = 1, totalInSection = 0;
    const useUrlPag = section.href?.includes('page=');
    while (!this.stopped) {
      if (pageNum > 1 && useUrlPag) {
        const nextUrl = section.href.replace(/page=\d+/, `page=${pageNum}`);
        try {
          await this.page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
          await this._sleep(1500);
        } catch (e) { this._log(`  Pagination error: ${e.message}`, 'warn'); break; }
      }
      const articles = await this._getArticleLinks();
      if (!articles.length) { if (pageNum === 1) this._log(`  No articles found in "${section.title}"`, 'warn'); break; }
      this._log(`  Page ${pageNum}: ${articles.length} article(s)`);
      for (const art of articles) {
        if (this.stopped) break;
        if (output.maxArticlesPerSection > 0 && totalInSection >= output.maxArticlesPerSection) break;
        await this._scrapeArticle(art, section, sectionDir);
        totalInSection++;
        await this._sleep(output.delayBetweenArticles || 1500);
      }
      pageNum++;
      await this._sleep(output.delayBetweenPages || 2000);
      if (!useUrlPag && !await this._goNextPage()) break;
    }
  }

  // ── REST API article download ───────────────────────────────────────────────

  async _scrapeSectionViaAPI(section, sectionDir, output) {
    // Build set of already-downloaded article IDs for fast O(1) existence check
    const knownIds  = this._loadKnownIds(sectionDir);
    const isUpdate  = !output.overwriteExisting && knownIds.size > 0;
    const withReply = this.config.output?.includeReplies !== false;

    if (isUpdate && knownIds.size > 0) {
      this._log(`  Update mode: ${knownIds.size} articles already in local index`);
    }

    let searchId = -1, idx = 0, pageNum = 1, total = 0, skipped = 0;

    while (!this.stopped) {
      this._log(`  API batch ${pageNum} (idx=${idx})…`);
      const data = await this._findPosts(section.space, searchId, idx);

      if (!data) { this._log(`  API returned null — stopping section`, 'warn'); break; }
      if (!Array.isArray(data.sords) || !data.sords.length) {
        if (pageNum === 1) this._log(`  0 articles in "${section.title}" (space=${section.space})`, 'warn');
        break;
      }
      if (pageNum === 1 && data.searchId != null && data.searchId !== -1) searchId = data.searchId;

      // ── EARLY STOP for updates ─────────────────────────────────────────────
      // Articles are sorted objxdate DESC (newest modified first).
      // If all 25 on this page already exist → every older page is also complete.
      let sordsToProcess = data.sords;
      if (isUpdate) {
        const newSords = data.sords.filter(s => !knownIds.has(String(s.id)));
        const existCount = data.sords.length - newSords.length;
        skipped += existCount;

        if (newSords.length === 0) {
          this._log(`  Batch ${pageNum}: all ${data.sords.length} exist — stopping early ` +
                    `(${skipped} total skipped, ${total} downloaded this run)`);
          break;
        }
        this._log(`  Batch ${pageNum}: ${newSords.length} new / ${existCount} exist / moreResults=${data.moreResults}`);
        sordsToProcess = newSords;
      } else {
        this._log(`  Batch ${pageNum}: ${data.sords.length} / moreResults=${data.moreResults}`);
      }

      this.emit('progress', { type: 'log', level: 'info',
        msg: `  ${section.title}: batch ${pageNum} — ${sordsToProcess.length} to process` });

      for (const sord of sordsToProcess) {
        if (this.stopped) break;
        if (output.maxArticlesPerSection > 0 && total >= output.maxArticlesPerSection) break;

        const ok       = sord.objKeys;
        const cleanDesc = (sord.desc || '')
          .replace(/<!--StartFragment-->/g, '').replace(/<!--EndFragment-->/g, '').trim();

        const article = {
          id:           String(sord.id || ''),
          guid:         sord.guid || '',
          href:         this._buildArticleUrl(section, sord.id, sord.guid),
          title:        eloVal(ok?.KNOWLEDGE_POST_SUBJECT) || sord.name || `Post ${sord.id}`,
          date:         parseEloDate(sord.XDateIso || sord.IDateIso),
          author:       sord.ownerName || eloVal(ok?.KNOWLEDGE_POST_AUTHORS_NAMES) || '',
          type:         eloVal(ok?.KNOWLEDGE_POST_TYPE) || '',
          tags:         [ok?.KNOWLEDGE_LABEL, ok?.KNOWLEDGE_TOPICS, ok?.KNOWLEDGE_CATEGORY]
                          .flat().map(eloVal).filter(Boolean),
          apiBody:      cleanDesc,
          withReply,
          // Store reply count and solved from API — available even if _getLinkedPosts fails
          apiReplies:   parseInt(eloVal(ok?.KNOWLEDGE_COUNT_REPLIES) || '0', 10) || 0,
          apiSolved:    !!(eloVal(ok?.KNOWLEDGE_SOLVED) === '1' || eloVal(ok?.KNOWLEDGE_SOLVED) === 'true'),
        };

        await this._scrapeArticle(article, section, sectionDir);
        if (isUpdate) knownIds.add(article.id); // mark as known for same-run dedup
        total++;
        await this._sleep(output.delayBetweenArticles || 1500);
      }

      if (!data.moreResults) break;
      idx += data.sords.length;
      pageNum++;
      await this._sleep(output.delayBetweenPages || 2000);
    }

    if (typeof searchId === 'string' && searchId.startsWith('(')) {
      await this._apiCall('RF_sol_knowledge_services_Search_Close', { searchId }).catch(() => {});
    }
    this._log(`  Section done: ${total} downloaded, ${skipped} skipped`);
  }

  // Reads existing article IDs from sectionDir/*/metadata.json — O(n) fast filesystem read
  _loadKnownIds(sectionDir) {
    const ids = new Set();
    if (!fs.existsSync(sectionDir)) return ids;
    const tryAdd = mp => {
      try { const { eloId } = JSON.parse(fs.readFileSync(mp, 'utf8')); if (eloId) ids.add(String(eloId)); } catch {}
    };
    try {
      for (const entry of fs.readdirSync(sectionDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const entryPath = path.join(sectionDir, entry.name);
        const directMeta = path.join(entryPath, 'metadata.json');
        if (fs.existsSync(directMeta)) {
          // Old 3-level structure: section/article-dir/metadata.json
          tryAdd(directMeta);
        } else {
          // New 4-level structure: section/thread-dir/post-dir/metadata.json
          try {
            for (const sub of fs.readdirSync(entryPath, { withFileTypes: true })) {
              if (!sub.isDirectory()) continue;
              const mp = path.join(entryPath, sub.name, 'metadata.json');
              if (fs.existsSync(mp)) tryAdd(mp);
            }
          } catch {}
        }
      }
    } catch {}
    return ids;
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

    let articleUrl = article.href || '';
    if (articleUrl && !articleUrl.startsWith('http')) {
      try {
        articleUrl = articleUrl.startsWith('#')
          ? board.url.split('#')[0] + articleUrl
          : new URL(articleUrl, board.url).href;
      } catch { articleUrl = article.href; }
    }

    if (!articleUrl) {
      this._log(`  ✗ No URL for article: ${article.title}`, 'error');
      this.stats.errors++;
      return;
    }

    // ── Fast path: use desc from API if it has real content ────────────────────
    // For Questions, the desc IS the full body. For longer Articles we navigate.
    const hasApiBody = article.apiBody && article.apiBody.length >= 50;

    if (!hasApiBody) {
      // Need to navigate to the article detail page (#/post/{guid}).
      // Open headless browser lazily — reused for all subsequent articles.
      if (!articleUrl) {
        this._log(`  ✗ No URL for: ${article.title}`, 'error');
        this.stats.errors++;
        return;
      }
      try {
        await this._ensureBrowser();
        await this.page.goto(articleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.page.waitForFunction(() => {
          const el = document.querySelector('.post-body');
          return el && el.innerHTML.trim().length > 20;
        }, { timeout: 15000 }).catch(() => {});
      } catch (e) {
        this._log(`  ✗ Navigation failed: ${articleUrl} — ${e.message}`, 'error');
        this.stats.errors++;
        return;
      }
    }

    try {
      // Metadata: prefer API values (already extracted), fall back to DOM
      const title   = article.title ||
                      await this._extractText(selectors.articleTitle) ||
                      await this.page.title() || `Article ${article.id || Date.now()}`;
      const dateRaw = article.date ||
                      await this._extractAttrOrText(selectors.articleDate, 'datetime');
      const author  = article.author || (hasApiBody ? '' : await this._extractText(selectors.articleAuthor) || '');
      const tags    = article.tags?.length ? article.tags : await this._extractAll(selectors.articleTags);

      // Body: API desc (fast) or DOM extraction (navigation path)
      let bodyHtml;
      if (hasApiBody) {
        bodyHtml = article.apiBody;
        this._log(`  [API body ${bodyHtml.length}b] ${title}`);
      } else {
        bodyHtml = await this._extractPostBody(selectors.articleBody);
        if (!bodyHtml) {
          this._log(`  ⚠ No body found on page for: ${title}`, 'warn');
        }
      }

      const slug       = slugify(title || `article-${Date.now()}`);
      const date       = formatDate(dateRaw);
      // 4-level structure: section / thread-slug / date / article.md
      const threadDir  = path.join(sectionDir, slug);
      const artDirName = date || `post-${Date.now()}`;
      const artDir     = path.join(threadDir, artDirName);
      const dirName    = slug + '/' + artDirName; // stored as dir in metadata

      if (!output.overwriteExisting && fs.existsSync(path.join(artDir, 'article.md'))) {
        this._log(`  ↷ Skip (exists): ${title}`);
        return;
      }

      if (!fs.existsSync(artDir)) fs.mkdirSync(artDir, { recursive: true });

      // Thread-level metadata (title, type, tags, eloId) — written once
      const threadMetaPath = path.join(threadDir, 'metadata.json');
      if (!fs.existsSync(threadMetaPath)) {
        fs.writeFileSync(threadMetaPath, JSON.stringify({
          title, section: section.title, slug,
          eloId: article.id || '', type: article.type || '', tags,
          apiReplies: article.apiReplies || 0, apiSolved: article.apiSolved || false,
        }, null, 2), 'utf8');
      }

      let mdBody = bodyHtml || '';
      if (output.downloadImages && mdBody) {
        mdBody = await this._processImages(mdBody, path.join(artDir, 'images'), articleUrl);
      }
      mdBody = htmlToMarkdown(mdBody);

      // ── Replies / Antworten ──────────────────────────────────────────────────
      let replyCount = 0;
      if (article.withReply && article.id) {
        const linkedData = await this._getLinkedPosts(article.id).catch(() => null);
        if (linkedData?.sords?.length) {
          const replies = linkedData.sords;
          replyCount = replies.length;
          this._log(`    ↳ ${replyCount} reply(ies)`);
          const replyMdBlocks = [];
          for (let i = 0; i < replies.length; i++) {
            const r       = replies[i];
            const rDate   = parseEloDate(r.XDateIso || r.IDateIso);
            const rAuthor = r.ownerName || eloVal(r.objKeys?.KNOWLEDGE_POST_AUTHORS_NAMES) || '';
            const isSolved = !!(r.objKeys?.KNOWLEDGE_SOLVED);
            const rBody   = (r.desc || '')
              .replace(/<!--StartFragment-->/g, '').replace(/<!--EndFragment-->/g, '').trim();
            let rMd = rBody ? htmlToMarkdown(rBody) : '';

            // Save each reply as its own subdirectory under the thread dir
            const replyDirName = `reply-${i + 1}${rDate ? '-' + rDate : ''}`;
            const replyDir     = path.join(threadDir, replyDirName);
            if (!fs.existsSync(replyDir)) fs.mkdirSync(replyDir, { recursive: true });
            if (output.downloadImages && rMd) {
              rMd = await this._processImages(rMd, path.join(replyDir, 'images'), articleUrl);
            }
            const replyFm = [
              '---',
              `title: ${JSON.stringify(title)}`,
              `section: ${JSON.stringify(section.title)}`,
              `date: "${rDate}"`,
              `author: ${JSON.stringify(rAuthor)}`,
              `tags: [${tags.map(t => JSON.stringify(t)).join(', ')}]`,
              `url: ${JSON.stringify(articleUrl)}`,
              `eloId: "${article.id || ''}"`,
              `replyIndex: ${i + 1}`,
              isSolved ? `solved: true` : '',
              `scraped: "${new Date().toISOString()}"`,
              '---', '', `# Reply ${i + 1} — ${rAuthor}`, '',
            ].filter(l => l !== undefined).join('\n');
            fs.writeFileSync(path.join(replyDir, 'article.md'), replyFm + rMd, 'utf8');
            fs.writeFileSync(path.join(replyDir, 'metadata.json'), JSON.stringify({
              title, section: section.title, date: rDate, author: rAuthor,
              eloId: article.id || '', type: 'Reply', tags, url: articleUrl,
              dir: slug + '/' + replyDirName, replyIndex: i + 1,
              solved: isSolved, scraped: new Date().toISOString(),
            }, null, 2), 'utf8');

            replyMdBlocks.push(`### ${rAuthor}${isSolved ? ' ✓' : ''} — ${rDate}\n\n${rMd}`);
          }
          // Keep combined block in main article.md for backward-compat readers
          mdBody += `\n\n---\n\n## Antworten / Replies (${replyCount})\n\n${replyMdBlocks.join('\n\n---\n\n')}`;
        }
      }

      // YAML frontmatter + Markdown body
      const finalRepliesForFm = replyCount > 0 ? replyCount : (article.apiReplies || 0);
      const finalSolvedForFm  = article.apiSolved || (replyCount > 0 && mdBody.includes(' ✓'));
      const extra = (article.type ? `\ntype: "${article.type}"` : '')
        + (finalRepliesForFm > 0  ? `\nreplies: ${finalRepliesForFm}` : '')
        + (finalSolvedForFm       ? `\nsolved: true` : '');
      const fm = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `section: ${JSON.stringify(section.title)}`,
        `date: "${date}"`,
        `author: ${JSON.stringify(author)}`,
        `tags: [${tags.map(t => JSON.stringify(t)).join(', ')}]`,
        `url: ${JSON.stringify(articleUrl)}`,
        `eloId: "${article.id || ''}"`,
        `scraped: "${new Date().toISOString()}"${extra}`,
        '---',
        '',
        `# ${title}`,
        '',
      ].join('\n');

      fs.writeFileSync(path.join(artDir, 'article.md'), fm + mdBody, 'utf8');

      // Use actual reply count from linked posts if available; fall back to API count
      const finalReplies = replyCount > 0 ? replyCount : (article.apiReplies || 0);
      // Solved: true if the API says so, or if any linked reply was marked solved
      const finalSolved  = article.apiSolved || (replyCount > 0 && mdBody.includes(' ✓'));
      const meta = { title, section: section.title, date, author, tags,
        url: articleUrl, eloId: article.id || '', type: article.type || '',
        replies: finalReplies, solved: finalSolved,
        slug, dir: dirName, scraped: new Date().toISOString() };
      fs.writeFileSync(path.join(artDir, 'metadata.json'), JSON.stringify(meta, null, 2), 'utf8');

      this.stats.articles++;
      this._log(`  ✓ ${title} (${date})`);
      this.emit('progress', { type: 'article-done', title, section: section.title, date, stats: { ...this.stats } });

    } catch (e) {
      this._log(`  ✗ Error: ${articleUrl} — ${e.message}`, 'error');
      this.stats.errors++;
    }
  }

  // ── Quill + image helpers ──────────────────────────────────────────────────

  // Extract the main post body from the article detail page.
  // Prefers .post-body (clean body only), falls back to configured selectors.
  async _extractPostBody(fallbackSelectors) {
    try {
      const html = await this.page.evaluate(() => {
        // .post-body is the clean article body on ELO Community detail page
        const postBody = document.querySelector('.post-body');
        if (postBody && postBody.innerHTML.trim().length > 20) return postBody.innerHTML;
        // Fallback: first .section-body.post-content (excludes reply form)
        const sections = [...document.querySelectorAll('.section-body.post-content')];
        if (sections.length > 0) return sections[0].innerHTML;
        return null;
      });
      if (html) return html;
    } catch { /* fallback to configured selectors */ }
    return this._extractHtml(fallbackSelectors);
  }

  // Returns the innerHTML of the Quill editor with the most content on the page.
  // Falls back to configured selectors if no .ql-editor found.
  async _extractLargestQuillContent(fallbackSelectors) {
    try {
      const html = await this.page.evaluate(() => {
        const editors = [...document.querySelectorAll('.ql-editor')];
        if (!editors.length) return null;
        // Return the one with the most HTML (actual article, not tiny spinners)
        return editors.reduce((best, e) =>
          e.innerHTML.length > best.innerHTML.length ? e : best
        ).innerHTML;
      });
      if (html && html.trim().length > 50) return html;
    } catch { /* fallback */ }
    // Fallback to configured selectors
    return this._extractHtml(fallbackSelectors);
  }

  // Downloads an image using the browser session (cookies included) via page.evaluate().
  // Required for ELO-hosted images that require authentication.
  async _downloadImageViaPage(imgUrl, destPath) {
    try {
      const bytes = await this.page.evaluate(async (url) => {
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        return [...new Uint8Array(buf)]; // Transfer as plain array (serializable)
      }, imgUrl);

      if (!bytes || !bytes.length) return false;
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(destPath, Buffer.from(bytes));
      return true;
    } catch { return false; }
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

    // Detect community host to distinguish internal (authenticated) vs external images
    let communityHost = '';
    try { communityHost = new URL(this.config.board.url).hostname; } catch {}

    for (const dl of downloads) {
      const destPath = path.join(imgDir, dl.filename);
      if (!fs.existsSync(destPath)) {
        let ok = false;
        const isInternal = !dl.imgUrl.startsWith('http') ||
                           (communityHost && (() => {
                             try { return new URL(dl.imgUrl).hostname === communityHost; } catch { return false; }
                           })());
        if (isInternal) {
          // Internal images need session cookies — use native HTTPS with cookie header
          ok = await this._downloadImageWithAuth(dl.imgUrl, destPath);
        } else {
          // External: plain HTTP, no auth needed
          ok = await downloadImage(dl.imgUrl, destPath);
        }
        if (ok) this.stats.images++;
      }
      result = result.split(dl.src).join(`images/${dl.filename}`);
    }
    return result;
  }

  // ── Index ──────────────────────────────────────────────────────────────────

  _updateIndex(outDir) {
    const index = { updated: new Date().toISOString(), sections: {} };
    const tryRead = mp => { try { return JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { return null; } };
    try {
      const dirs = fs.readdirSync(outDir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'));
      for (const d of dirs) {
        const sectionPath = path.join(outDir, d.name);
        const arts = [];
        for (const entry of fs.readdirSync(sectionPath, { withFileTypes: true }).filter(x => x.isDirectory())) {
          const entryPath = path.join(sectionPath, entry.name);
          const directMeta = path.join(entryPath, 'metadata.json');
          if (fs.existsSync(directMeta)) {
            // Old 3-level structure
            const meta = tryRead(directMeta);
            if (meta) arts.push(meta);
          } else {
            // New 4-level structure: only include main posts (not replies)
            try {
              for (const sub of fs.readdirSync(entryPath, { withFileTypes: true }).filter(x => x.isDirectory())) {
                const mp = path.join(entryPath, sub.name, 'metadata.json');
                if (!fs.existsSync(mp)) continue;
                const meta = tryRead(mp);
                // Skip reply subdirs in the index — only the main post per thread
                if (meta && !meta.replyIndex) arts.push(meta);
              }
            } catch {}
          }
        }
        index.sections[d.name] = { count: arts.length, articles: arts };
      }
    } catch {}
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
    this._log(`Index updated — ${Object.values(index.sections).reduce((s,x)=>s+x.count,0)} total threads`);
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
    this.browser = null; this.context = null; this.page = null;
  }
}

module.exports = { CommunityScraper };
