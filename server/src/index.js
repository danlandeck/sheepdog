/**
 * Sheepdog aggregation service.
 *
 * Privacy posture, which the extension repeats to the user verbatim:
 *   - /api/assess receives a registrable domain, never a full URL or query string.
 *   - Page text is only sent when the user turns on deep page analysis, and it
 *     is scored in memory and never written to disk or logs.
 *   - No cookies, no accounts, no per-user identifiers, no request logging of
 *     hostnames beyond an aggregate counter.
 */

import { createApp } from './http.js';
import { Store, defaultStorePath } from './store.js';
import { ingestAll, ingestLists } from './ingest.js';
import { SOURCES, LIST_SOURCES } from './sources.js';
import { assess, BANDS } from '../../shared/score.js';
import { buildIndex } from '../../shared/regulatory.js';

// Printed at startup so "which copy of the code am I actually running" is
// answerable at a glance. Bump it when you change anything structural.
const VERSION = '0.2.0 (no-dependencies build)';

const PORT = Number(process.env.PORT || 8787);
const INGEST_MINUTES = Number(process.env.INGEST_MINUTES || 20);
const ENRICH = process.env.ENRICH !== 'false';
const STORE_PATH = process.env.STORE_PATH || defaultStorePath();

const store = await new Store(STORE_PATH).load();
let regIndex = buildIndex(store.listEntries);

const app = createApp();

// CORS: the extension calls from a chrome-extension:// origin, which is opaque
// enough that a wildcard is the pragmatic choice for a read-only public feed.
app.use((req, res, next) => {
  res.set('access-control-allow-origin', '*');
  res.set('access-control-allow-headers', 'content-type');
  res.set('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const counters = { assessSite: 0, assessExtensions: 0, feed: 0 };

/** Trim an item down to what the crawl needs. */
function toTickerItem(i) {
  return {
    id: i.id,
    kind: i.kind,
    title: i.title,
    source: i.source,
    sourceName: i.sourceName,
    url: i.url,
    publishedAt: i.publishedAt,
    score: i.score,
    band: i.band,
    bandLabel: i.bandLabel,
    color: i.color,
    topSignal: topSignalLabel(i),
  };
}

function topSignalLabel(i) {
  const s = i.signals;
  if (!s) return null;
  const ranked = [
    { k: 'Regulatory', v: s.regulatory?.contribution || 0, n: s.regulatory?.matches?.length || 0 },
    { k: 'Incident', v: s.incident?.contribution || 0, n: s.incident?.categories?.length || 0 },
    { k: 'Structural', v: s.structural?.contribution || 0, n: s.structural?.findings?.length || 0 },
    { k: 'Behavioral', v: s.behavioral?.contribution || 0, n: s.behavioral?.categories?.length || 0 },
  ].filter((x) => x.n > 0).sort((a, b) => b.v - a.v);
  return ranked.length ? ranked[0].k : null;
}

app.get('/api/feed', (req, res) => {
  counters.feed++;
  const limit = Math.min(300, Number(req.query.limit) || 120);
  const minScore = Number(req.query.minScore) || 0;
  const bands = req.query.bands ? String(req.query.bands).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const sources = req.query.sources ? String(req.query.sources).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const since = req.query.since ? String(req.query.since) : null;

  const items = store.list({ limit, minScore, bands, sources, since }).map(toTickerItem);
  res.set('cache-control', 'public, max-age=120');
  res.json({
    // Deliberately the ingest time, not "now". The body must be byte-identical
    // for a given ETag, or conditional requests and CDN caching both break.
    generatedAt: store.lastIngest,
    lastIngest: store.lastIngest,
    bands: BANDS,
    count: items.length,
    items,
  }, { etag: true });
});

app.get('/api/item/:id', (req, res) => {
  const item = store.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  res.set('cache-control', 'public, max-age=600');
  res.json(item, { etag: true });
});

/**
 * Live site assessment.
 * Body: { host, protocol, tlsValid?, sampleText?, extraDomains? }
 * `sampleText` is optional and only sent when the user enables deep analysis.
 */
app.post('/api/assess/site', (req, res) => {
  counters.assessSite++;
  const { host, protocol, tlsValid, sampleText, title } = req.body || {};
  if (!host || typeof host !== 'string' || host.length > 255) {
    return res.status(400).json({ error: 'host_required' });
  }
  if (/[^a-z0-9.\-:]/i.test(host)) return res.status(400).json({ error: 'host_invalid' });

  const result = assess({
    kind: 'site',
    title: title ? String(title).slice(0, 300) : '',
    body: sampleText ? String(sampleText).slice(0, 40000) : '',
    source: 'PAGE_SCAN',
    sourceName: 'Live page assessment',
    domainInfo: { host, protocol, tlsValid },
  }, regIndex);

  res.json({ host, assessedAt: new Date().toISOString(), ...result });
});

/**
 * Installed-extension audit.
 * Body: { extensions: [ chrome.management.ExtensionInfo-shaped ] }
 */
app.post('/api/assess/extensions', (req, res) => {
  counters.assessExtensions++;
  const list = Array.isArray(req.body?.extensions) ? req.body.extensions.slice(0, 300) : null;
  if (!list) return res.status(400).json({ error: 'extensions_required' });

  const results = list.map((ext) => {
    const r = assess({
      kind: 'extension',
      title: ext.name,
      summary: ext.description,
      source: 'EXTENSION_AUDIT',
      sourceName: 'Local extension audit',
      extensionInfo: ext,
      extraDomains: ext.updateUrl ? [safeHost(ext.updateUrl)].filter(Boolean) : [],
    }, regIndex);
    return { id: ext.id, name: ext.name, ...r };
  });

  results.sort((a, b) => b.score - a.score);
  res.json({ assessedAt: new Date().toISOString(), count: results.length, results });
});

function safeHost(u) {
  try { return new URL(u).hostname; } catch { return null; }
}

app.get('/api/lists', (req, res) => {
  const byList = {};
  for (const e of store.listEntries) byList[e.list] = (byList[e.list] || 0) + 1;
  res.json({ total: store.listEntries.length, byList, sources: LIST_SOURCES.map(({ id, name, url, verified, note }) => ({ id, name, url, verified, note })) });
});

app.get('/api/health', (req, res) => {
  const health = SOURCES.concat(LIST_SOURCES).map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    configuredVerified: s.verified,
    note: s.note || null,
    ...(store.sourceHealth[s.id] || { ok: null, lastRun: null, itemCount: 0, error: 'never run' }),
  }));
  const ok = health.filter((h) => h.ok).length;
  res.json({
    status: ok > 0 ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    lastIngest: store.lastIngest,
    itemsRetained: store.items.size,
    listEntries: store.listEntries.length,
    sourcesHealthy: ok,
    sourcesTotal: health.length,
    counters,
    sources: health,
  });
});

app.post('/api/admin/ingest', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.get('x-admin-token') !== token) return res.status(403).json({ error: 'forbidden' });
  const r = await ingestAll(store, { enrich: ENRICH });
  regIndex = r.regIndex;
  res.json({ ok: true, ...r, regIndex: undefined });
});

app.listen(PORT, () => {
  console.log(`[sheepdog] v${VERSION}`);
  console.log(`[sheepdog] listening on :${PORT}  store=${STORE_PATH}  enrich=${ENRICH}`);
});

// Kick an ingest at boot if the store is cold, then run on a timer.
(async () => {
  if (store.items.size === 0) {
    console.log('[sheepdog] cold store, running first ingest');
    const r = await ingestAll(store, { enrich: ENRICH });
    regIndex = r.regIndex;
  } else if (!store.listEntries.length) {
    await ingestLists(store);
    regIndex = buildIndex(store.listEntries);
  }
  setInterval(async () => {
    try {
      const r = await ingestAll(store, { enrich: ENRICH });
      regIndex = r.regIndex;
    } catch (err) {
      console.error('[sheepdog] scheduled ingest failed:', err.message);
    }
  }, INGEST_MINUTES * 60000);
})();

process.on('SIGTERM', async () => { await store.persist(); process.exit(0); });
process.on('SIGINT', async () => { await store.persist(); process.exit(0); });
