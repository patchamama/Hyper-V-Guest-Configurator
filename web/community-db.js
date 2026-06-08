'use strict';
// Uses Node.js built-in node:sqlite (available from Node 22.5+, stable in 24+)
// No native compilation needed.
const path = require('path');
const fs   = require('fs');

const SCRIPT_DIR = path.join(__dirname, '..');
const DB_FILE    = path.join(SCRIPT_DIR, 'community', 'community.db');

let _db = null;

// ── Open / init ────────────────────────────────────────────────────────────────

function openDb() {
  if (_db) return _db;
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  _db = new DatabaseSync(DB_FILE);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA synchronous = NORMAL');
  _initSchema(_db);
  return _db;
}

function closeDb() {
  if (_db) { try { _db.close(); } catch {} _db = null; }
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id        INTEGER PRIMARY KEY,
      elo_id    TEXT    UNIQUE NOT NULL,
      section   TEXT    NOT NULL DEFAULT '',
      title     TEXT    NOT NULL DEFAULT '',
      date      TEXT    DEFAULT '',
      author    TEXT    DEFAULT '',
      type      TEXT    DEFAULT '',
      replies   INTEGER DEFAULT 0,
      solved    INTEGER DEFAULT 0,
      tags_json TEXT    DEFAULT '[]',
      url       TEXT    DEFAULT '',
      dir       TEXT    DEFAULT '',
      content   TEXT    DEFAULT '',
      scraped   TEXT    DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_section ON articles(section);
    CREATE INDEX IF NOT EXISTS idx_author  ON articles(author);
    CREATE INDEX IF NOT EXISTS idx_solved  ON articles(solved);
    CREATE INDEX IF NOT EXISTS idx_date    ON articles(date DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS art_fts USING fts5(
      elo_id   UNINDEXED,
      section  UNINDEXED,
      dir      UNINDEXED,
      title,
      content,
      author,
      tags,
      tokenize = 'unicode61 remove_diacritics 1'
    );
  `);
}

// ── Build index from scraped files ─────────────────────────────────────────────

function buildIndex(communityDir, onProgress) {
  closeDb();
  // Delete and recreate DB file for clean rebuild
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  const db = openDb();

  const sections = fs.existsSync(communityDir)
    ? fs.readdirSync(communityDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name)
    : [];

  // Count indexable articles across both old (3-level) and new (4-level) structures
  let total = 0;
  for (const sec of sections) {
    try {
      for (const d of fs.readdirSync(path.join(communityDir, sec), { withFileTypes: true }).filter(x => x.isDirectory())) {
        const p = path.join(communityDir, sec, d.name);
        if (fs.existsSync(path.join(p, 'metadata.json'))) {
          total++;  // old structure: article dir
        } else {
          try { total += fs.readdirSync(p, { withFileTypes: true }).filter(x => x.isDirectory()).length; } catch {}
        }
      }
    } catch {}
  }
  if (onProgress) onProgress({ phase: 'start', total, sections: sections.length });

  const insArt = db.prepare(`
    INSERT OR REPLACE INTO articles
      (elo_id,section,title,date,author,type,replies,solved,tags_json,url,dir,content,scraped)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insFts = db.prepare(`
    INSERT INTO art_fts(elo_id,section,dir,title,content,author,tags)
    VALUES (?,?,?,?,?,?,?)
  `);

  let indexed = 0;

  // Helper: collect (metaPath, mdPath, relDir) for both 3-level and 4-level structures
  function collectArticlePaths(secPath) {
    const results = [];
    let topDirs;
    try { topDirs = fs.readdirSync(secPath, { withFileTypes: true }).filter(d => d.isDirectory()); }
    catch { return results; }
    for (const top of topDirs) {
      const topPath    = path.join(secPath, top.name);
      const directMeta = path.join(topPath, 'metadata.json');
      if (fs.existsSync(directMeta)) {
        // Old 3-level: section/article-dir/metadata.json
        results.push({ mp: directMeta, mdp: path.join(topPath, 'article.md'), relDir: top.name });
      } else {
        // New 4-level: section/thread-dir/post-dir/metadata.json
        let subDirs;
        try { subDirs = fs.readdirSync(topPath, { withFileTypes: true }).filter(d => d.isDirectory()); }
        catch { continue; }
        for (const sub of subDirs) {
          const subPath = path.join(topPath, sub.name);
          const mp = path.join(subPath, 'metadata.json');
          if (fs.existsSync(mp)) {
            results.push({ mp, mdp: path.join(subPath, 'article.md'), relDir: top.name + '/' + sub.name });
          }
        }
      }
    }
    return results;
  }

  for (const sec of sections) {
    const sp = path.join(communityDir, sec);
    const artPaths = collectArticlePaths(sp);

    db.exec('BEGIN');
    try {
      for (const { mp, mdp, relDir } of artPaths) {
        try {
          const meta = JSON.parse(fs.readFileSync(mp, 'utf8'));

          // Skip reply entries — they're sub-articles of a thread, not standalone threads
          if (meta.replyIndex) continue;

          // Normalize tags
          const rawTags = Array.isArray(meta.tags) ? meta.tags : [];
          const tags = rawTags.flatMap(t => {
            if (typeof t !== 'string' || !t) return [];
            return t.replace(/Â¶/g, '¶').split('¶').map(s => s.trim()).filter(s => s.length > 0 && s.length < 80);
          });

          let content = '', replies = 0, solved = false;
          if (fs.existsSync(mdp)) {
            const fullMd = fs.readFileSync(mdp, 'utf8');
            const replyMatches = fullMd.match(/^###\s+.+\s+—\s+\d{4}-\d{2}-\d{2}/gm);
            replies = replyMatches ? replyMatches.length : 0;
            solved = /^###\s+.*✓/m.test(fullMd);
            content = fullMd
              .replace(/^---[\s\S]*?---\n?/, '')
              .replace(/^#\s+.*\n?/, '')
              .replace(/\n---\n\n## Antworten[\s\S]*$/, '')
              .trim().slice(0, 5000);
          }

          // Use API reply count/solved if parsed count is 0 (replies not yet in article.md)
          if (!replies && meta.replies) replies = meta.replies;
          if (!solved && meta.solved)   solved  = !!meta.solved;

          const eloId = meta.eloId || meta.elo_id || `${sec}_${relDir}`;
          const dir   = meta.dir || relDir;
          insArt.run(eloId, sec, meta.title||'', meta.date||'', meta.author||'',
            meta.type||'', replies, solved ? 1 : 0,
            JSON.stringify(tags), meta.url||'', dir, content, meta.scraped||'');
          insFts.run(eloId, sec, dir, meta.title||'', content, meta.author||'', tags.join(' '));
          indexed++;
        } catch { /* skip corrupt */ }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    if (onProgress) onProgress({ phase: 'indexing', section: sec, done: indexed, total });
  }

  return { indexed, sections: sections.length };
}

// ── Search ─────────────────────────────────────────────────────────────────────

function search(query, opts = {}) {
  const db = openDb();
  const { section, tag, author, limit = 40 } = opts;

  if (!query || !query.trim()) return _filterOnly(db, { section, tag, author, limit });

  // Build safe FTS5 query — each word as prefix match
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const ftsQ  = terms.map(t => `"${t.replace(/["*]/g,'')}"*`).join(' ');

  const extraConds = [];
  const extraVals  = [];
  if (section) { extraConds.push('a.section = ?');              extraVals.push(section); }
  if (author)  { extraConds.push('a.author LIKE ?');            extraVals.push(`%${author}%`); }
  if (tag)     { extraConds.push("a.tags_json LIKE '%'||?||'%'"); extraVals.push(tag); }
  const where = extraConds.length ? ' AND ' + extraConds.join(' AND ') : '';

  try {
    const rows = db.prepare(`
      SELECT a.elo_id, a.section, a.title, a.date, a.author, a.type,
             a.replies, a.solved, a.tags_json, a.url, a.dir,
             snippet(art_fts, 4, '**', '**', '…', 28) AS excerpt,
             bm25(art_fts, 10, 5, 1, 3) AS score
      FROM art_fts
      JOIN articles a ON a.elo_id = art_fts.elo_id
      WHERE art_fts MATCH ?${where}
      ORDER BY score
      LIMIT ?
    `).all(ftsQ, ...extraVals, limit);
    return rows.map(_norm);
  } catch {
    return _likeSearch(db, query, { section, tag, author, limit });
  }
}

function _likeSearch(db, query, { section, tag, author, limit = 40 }) {
  const lq = `%${query}%`;
  const conds = ['(a.title LIKE ? OR a.content LIKE ? OR a.author LIKE ? OR a.tags_json LIKE ?)'];
  const vals  = [lq, lq, lq, lq];
  if (section) { conds.push('a.section = ?');              vals.push(section); }
  if (author)  { conds.push('a.author LIKE ?');            vals.push(`%${author}%`); }
  if (tag)     { conds.push("a.tags_json LIKE '%'||?||'%'"); vals.push(tag); }
  vals.push(limit);
  return db.prepare(`SELECT elo_id,section,title,date,author,type,replies,solved,tags_json,url,dir,
    substr(content,0,300) as excerpt FROM articles a WHERE ${conds.join(' AND ')} ORDER BY date DESC LIMIT ?`)
    .all(...vals).map(_norm);
}

function _filterOnly(db, { section, tag, author, limit = 100 }) {
  const conds = ['1=1'];
  const vals  = [];
  if (section) { conds.push('section = ?');                vals.push(section); }
  if (author)  { conds.push('author LIKE ?');              vals.push(`%${author}%`); }
  if (tag)     { conds.push("tags_json LIKE '%'||?||'%'"); vals.push(tag); }
  vals.push(limit);
  return db.prepare(`SELECT elo_id,section,title,date,author,type,replies,solved,tags_json,url,dir,
    '' as excerpt FROM articles WHERE ${conds.join(' AND ')} ORDER BY date DESC LIMIT ?`)
    .all(...vals).map(_norm);
}

function _norm(r) {
  const obj = { ...r };  // spread null-prototype object
  try { obj.tags = JSON.parse(obj.tags_json || '[]'); } catch { obj.tags = []; }
  delete obj.tags_json;
  obj.solved   = !!obj.solved;
  obj.replies  = obj.replies || 0;
  obj.excerpt  = obj.excerpt || '';
  return obj;
}

// ── Tags / Authors / Stats ──────────────────────────────────────────────────────

function getTags(section = null) {
  const db = openDb();
  const rows = section
    ? db.prepare('SELECT tags_json FROM articles WHERE section = ?').all(section)
    : db.prepare('SELECT tags_json FROM articles').all();
  const counts = {};
  for (const r of rows) {
    try { JSON.parse(r.tags_json||'[]').forEach(t => { if (t?.length > 0 && t.length < 60) counts[t] = (counts[t]||0)+1; }); } catch {}
  }
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([tag,count])=>({tag,count}));
}

function getAuthors(section = null) {
  const db = openDb();
  const sql = section
    ? `SELECT author, COUNT(*) c FROM articles WHERE section=? AND author!='' GROUP BY author ORDER BY c DESC LIMIT 60`
    : `SELECT author, COUNT(*) c FROM articles WHERE author!='' GROUP BY author ORDER BY c DESC LIMIT 60`;
  const rows = section ? db.prepare(sql).all(section) : db.prepare(sql).all();
  return rows.map(r => ({ ...r }));
}

function getSectionStats() {
  const db = openDb();
  const rows = db.prepare(`
    SELECT section, COUNT(*) total, SUM(solved) solved, ROUND(AVG(replies),1) avg_replies
    FROM articles GROUP BY section ORDER BY total DESC
  `).all();
  return rows.map(r => ({
    section:      r.section,
    total:        r.total || 0,
    solved:       r.solved || 0,
    avg_replies:  r.avg_replies || 0,
    top_tags:     getTags(r.section).slice(0, 5).map(t => t.tag),
  }));
}

function getDbStats() {
  try {
    const db = openDb();
    const r = { ...db.prepare('SELECT COUNT(*) total, SUM(solved) solved FROM articles').get() };
    return { total: r.total||0, solved: r.solved||0, built: (r.total||0) > 0 };
  } catch { return { total: 0, solved: 0, built: false }; }
}

function isBuilt() { return getDbStats().built; }

module.exports = { buildIndex, search, getTags, getAuthors, getSectionStats, getDbStats, isBuilt, closeDb };
