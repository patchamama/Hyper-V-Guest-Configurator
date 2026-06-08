'use strict';
const fs   = require('fs');
const path = require('path');

const SCRIPT_DIR = path.join(__dirname, '..');
let _embeddingPipeline = null;

// ── Embedding model (mE5-small via @xenova/transformers) ───────────────────────

async function getEmbeddingPipeline(modelHfId, cacheDir) {
  if (_embeddingPipeline) return _embeddingPipeline;
  // @xenova/transformers is an ESM module — use dynamic import
  const { pipeline, env } = await import('@xenova/transformers');
  if (cacheDir) {
    env.cacheDir = cacheDir;
    env.localModelPath = cacheDir;
  }
  env.allowRemoteModels = true;
  _embeddingPipeline = await pipeline('feature-extraction', modelHfId || 'Xenova/multilingual-e5-small', {
    revision: 'main',
  });
  return _embeddingPipeline;
}

async function embed(texts, modelHfId, cacheDir) {
  const extractor = await getEmbeddingPipeline(modelHfId, cacheDir);
  const results = [];
  for (const text of texts) {
    // mE5 models require "passage: " prefix for documents being indexed
    const output = await extractor(`passage: ${text}`, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

async function embedQuery(queryText, modelHfId, cacheDir) {
  const extractor = await getEmbeddingPipeline(modelHfId, cacheDir);
  // mE5 models require "query: " prefix for search queries
  const output = await extractor(`query: ${queryText}`, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// ── Article loader ─────────────────────────────────────────────────────────────

function loadCommunityArticles(communityDir) {
  const articles = [];
  if (!fs.existsSync(communityDir)) return articles;

  const sections = fs.readdirSync(communityDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name);

  for (const section of sections) {
    const sectionPath = path.join(communityDir, section);
    const artDirs = fs.readdirSync(sectionPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const artDir of artDirs) {
      const metaPath = path.join(sectionPath, artDir, 'metadata.json');
      const mdPath   = path.join(sectionPath, artDir, 'article.md');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const raw  = fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : '';
        const content = raw
          .replace(/^---[\s\S]*?---\n?/, '')  // strip YAML frontmatter
          .replace(/^#\s+.*\n?/, '')           // strip H1 (= title)
          .trim()
          .slice(0, 12000);
        articles.push({ id: `${section}/${artDir}`, section, ...meta, content, filePath: path.join(sectionPath, artDir) });
      } catch { /* skip */ }
    }
  }
  return articles;
}

// ── Elasticsearch integration ──────────────────────────────────────────────────

function getESClient(esConfig) {
  const { Client } = require('@elastic/elasticsearch');
  const opts = { node: esConfig.host };
  if (esConfig.username && esConfig.password) opts.auth = { username: esConfig.username, password: esConfig.password };
  // Allow self-signed certs for local dev
  if (esConfig.host.startsWith('https')) {
    const { Agent } = require('https');
    opts.agent = new Agent({ rejectUnauthorized: false });
  }
  return new Client(opts);
}

async function ensureIndex(client, indexName, dims) {
  let exists = false;
  try { await client.indices.get({ index: indexName }); exists = true; } catch { /* 404 = not found */ }
  if (exists) return;
  await client.indices.create({
    index: indexName,
    mappings: {
      properties: {
        title:     { type: 'text',    analyzer: 'standard' },
        content:   { type: 'text',    analyzer: 'standard' },
        section:   { type: 'keyword' },
        date:      { type: 'date',    ignore_malformed: true },
        author:    { type: 'keyword' },
        tags:      { type: 'keyword' },
        url:       { type: 'keyword', index: false },
        filePath:  { type: 'keyword', index: false },
        scraped:   { type: 'date',    ignore_malformed: true },
        embedding: { type: 'dense_vector', dims, index: true, similarity: 'cosine' },
      },
    },
    settings: { number_of_replicas: 0 },
  });
}

async function indexArticles(articles, esConfig, onProgress) {
  const client    = getESClient(esConfig);
  const dims      = esConfig.dimensions || 384;
  const modelId   = esConfig.modelHfId || 'Xenova/multilingual-e5-small';
  const cacheDir  = path.join(SCRIPT_DIR, '.model-cache');
  const batchSize = esConfig.batchSize || 16;

  await ensureIndex(client, esConfig.index, dims);

  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const texts = batch.map(a => `${a.title || ''}\n\n${a.content || ''}`.slice(0, 512));

    if (onProgress) onProgress({ phase: 'embedding', done: i, total: articles.length });
    const embeddings = await embed(texts, modelId, cacheDir);

    const ops = batch.flatMap((art, j) => [
      { index: { _index: esConfig.index, _id: art.id } },
      {
        title:    art.title    || '',
        content:  art.content  || '',
        section:  art.section  || '',
        date:     art.date     || null,
        author:   art.author   || '',
        tags:     art.tags     || [],
        url:      art.url      || '',
        filePath: art.filePath || '',
        scraped:  art.scraped  || null,
        embedding: embeddings[j],
      },
    ]);

    await client.bulk({ operations: ops, refresh: false });
    if (onProgress) onProgress({ phase: 'indexing', done: i + batch.length, total: articles.length });
  }

  await client.indices.refresh({ index: esConfig.index });
}

async function searchES(query, esConfig, mode) {
  const client  = getESClient(esConfig);
  const cacheDir = path.join(SCRIPT_DIR, '.model-cache');
  const modelId  = esConfig.modelHfId || 'Xenova/multilingual-e5-small';

  const textQuery = {
    bool: {
      should: [
        { match: { title:   { query, boost: 2.5 } } },
        { match: { content: { query } } },
        { match: { section: { query } } },
        { match: { author:  { query, boost: 0.5 } } },
      ],
    },
  };
  const src = ['title', 'section', 'date', 'author', 'tags', 'url', 'filePath'];

  // Normalise a hit — extract section slug from filePath when available
  const normHit = h => {
    const src = h._source || {};
    // filePath = .../community/section-slug/article-dir  — extract slug from it
    const parts = (src.filePath || '').replace(/\\/g, '/').split('/');
    const ci = parts.findLastIndex(p => p === 'community' || p.startsWith('community'));
    const sectionSlug = ci >= 0 && parts[ci + 1] ? parts[ci + 1] : src.section;
    const dir = ci >= 0 && parts[ci + 2] ? parts[ci + 2] : (src.dir || '');
    return { ...src, section: sectionSlug, dir, score: h._score, id: h._id };
  };

  if (mode === 'text') {
    const r = await client.search({ index: esConfig.index, query: textQuery, size: 20, _source: src });
    return r.hits.hits.map(normHit);
  }

  const qvec = await embedQuery(query, modelId, cacheDir);

  if (mode === 'semantic') {
    const r = await client.search({
      index: esConfig.index,
      knn: { field: 'embedding', query_vector: qvec, k: 20, num_candidates: 100 },
      _source: src,
    });
    return r.hits.hits.map(normHit);
  }

  // Hybrid: text + kNN
  const r = await client.search({
    index: esConfig.index,
    query: textQuery,
    knn:   { field: 'embedding', query_vector: qvec, k: 10, num_candidates: 50, boost: 0.8 },
    size:  20,
    _source: src,
  });
  return r.hits.hits.map(normHit);
}

// ── Local (no-ES) search ───────────────────────────────────────────────────────

function localSearch(query, communityDir) {
  const lq = query.toLowerCase().trim();
  if (!lq) return [];
  const terms = lq.split(/\s+/).filter(t => t.length > 1);

  const articles = loadCommunityArticles(communityDir);
  const scored = articles.map(a => {
    const haystack = `${a.title} ${a.section} ${a.author} ${(a.tags || []).join(' ')} ${a.content}`.toLowerCase();
    const score = terms.reduce((s, t) => {
      const inTitle   = (a.title?.toLowerCase().includes(t) ? 3 : 0);
      const inSection = (a.section?.toLowerCase().includes(t) ? 1 : 0);
      const inContent = haystack.includes(t) ? 1 : 0;
      return s + inTitle + inSection + inContent;
    }, 0);
    return { a, score };
  }).filter(x => x.score > 0);

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 30).map(({ a }) => ({
    title:    a.title,
    section:  a.id ? a.id.split('/')[0] : a.section, // always use folder slug
    date:     a.date,
    author:   a.author,
    tags:     a.tags,
    url:      a.url,
    filePath: a.filePath,
    dir:      a.dir || (a.id ? a.id.split('/')[1] : ''),
    excerpt:  buildExcerpt(a.content || '', lq),
  }));
}

function buildExcerpt(content, query) {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.split(/\s+/)[0]);
  if (idx === -1) return content.slice(0, 200) + (content.length > 200 ? '…' : '');
  const start = Math.max(0, idx - 60);
  const end   = Math.min(content.length, idx + 200);
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '');
}

module.exports = { loadCommunityArticles, indexArticles, searchES, localSearch };
