/**
 * Ingestion pipeline: fetch -> parse -> optionally enrich -> score -> store.
 */

import { createHash } from 'node:crypto';
import { parseFeed, htmlToText } from './rss.js';
import { SOURCES, LIST_SOURCES, MAX_ITEM_AGE_DAYS } from './sources.js';
import { idFor } from './store.js';
import { assess } from '../../shared/score.js';
import { buildIndex, deriveEntriesFromEnforcement } from '../../shared/regulatory.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const UA = 'Sheepdog/0.1 (+https://github.com/your-org/sheepdog) feed-reader';
const FETCH_TIMEOUT_MS = 20000;

async function fetchText(url, { accept = 'application/rss+xml, application/xml, text/xml, */*' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept, 'accept-language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Pull readable body text from an article page for the behavioral pass. */
async function enrich(url) {
  try {
    const html = await fetchText(url, { accept: 'text/html,application/xhtml+xml' });
    // Prefer the main content container when the page marks one.
    const main = html.match(/<(?:article|main)\b[\s\S]*?<\/(?:article|main)>/i);
    return htmlToText(main ? main[0] : html, 14000);
  } catch {
    return '';
  }
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function loadSeedLists() {
  try {
    const raw = await readFile(join(HERE, '..', 'seed-lists.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Refresh the structured regulatory lists (KEV and friends). */
export async function ingestLists(store, { log = console.log } = {}) {
  const derived = [];

  for (const src of LIST_SOURCES) {
    try {
      const text = await fetchText(src.url, { accept: 'application/json' });
      const json = JSON.parse(text);
      const mapped = src.map(json) || [];
      derived.push(...mapped);
      store.sourceHealth[src.id] = { ok: true, lastRun: new Date().toISOString(), itemCount: mapped.length, error: null };
      log(`[lists] ${src.id}: ${mapped.length} entries`);
    } catch (err) {
      store.sourceHealth[src.id] = { ok: false, lastRun: new Date().toISOString(), itemCount: 0, error: err.message };
      log(`[lists] ${src.id} FAILED: ${err.message}`);
    }
  }

  const seed = await loadSeedLists();
  // Enforcement entries derived from previously ingested press releases.
  const fromNews = [];
  for (const item of store.items.values()) {
    if (item.enforcement) fromNews.push(...deriveEntriesFromEnforcement(item));
  }

  const total = store.setListEntries([...seed, ...derived, ...fromNews]);
  log(`[lists] index now holds ${total} entries (${seed.length} seed, ${derived.length} structured, ${fromNews.length} derived from enforcement news)`);
  return total;
}

/**
 * Run one full ingest cycle.
 * @param {Store} store
 * @param {object} opts { enrich: boolean, log: fn, only: string[] }
 */
export async function ingestAll(store, opts = {}) {
  const log = opts.log || console.log;
  const doEnrich = opts.enrich !== false;
  const sources = SOURCES.filter((s) => !opts.only || opts.only.includes(s.id));

  let regIndex = buildIndex(store.listEntries);
  const cutoff = new Date(Date.now() - MAX_ITEM_AGE_DAYS * 86400000).toISOString();
  let added = 0;

  for (const src of sources) {
    const startedAt = new Date().toISOString();
    try {
      const xml = await fetchText(src.url);
      const feed = parseFeed(xml);
      if (!feed.items.length) throw new Error('feed parsed but contained no items');

      const fresh = feed.items
        .filter((i) => !i.publishedAt || i.publishedAt > cutoff)
        .slice(0, 40);

      const bodies = doEnrich
        ? await mapLimit(fresh, 4, async (i) => (i.url ? enrich(i.url) : ''))
        : fresh.map(() => '');

      for (let n = 0; n < fresh.length; n++) {
        const raw = fresh[n];
        const body = bodies[n] || '';
        const id = idFor(src.id, raw.guid);

        const result = assess({
          kind: 'news',
          title: raw.title,
          summary: raw.summary,
          body,
          url: raw.url,
          source: src.id,
          sourceName: src.name,
          enforcement: !!src.enforcement,
          publishedAt: raw.publishedAt,
        }, regIndex);

        const contentHash = createHash('sha1')
          .update(`${raw.title}|${raw.summary}|${body.slice(0, 2000)}`)
          .digest('hex')
          .slice(0, 16);

        const changed = store.upsert({
          id,
          kind: 'news',
          source: src.id,
          sourceName: src.name,
          title: raw.title,
          summary: raw.summary.slice(0, 600),
          url: raw.url,
          categories: raw.categories,
          publishedAt: raw.publishedAt,
          firstSeen: new Date().toISOString(),
          enforcement: !!src.enforcement,
          contentHash,
          score: result.score,
          band: result.band,
          bandLabel: result.bandLabel,
          color: result.color,
          signals: result.signals,
        });
        if (changed) added++;
      }

      store.sourceHealth[src.id] = {
        ok: true, lastRun: startedAt, itemCount: fresh.length, error: null,
        format: feed.format, feedTitle: feed.title,
      };
      log(`[ingest] ${src.id}: ${fresh.length} fresh items`);
    } catch (err) {
      store.sourceHealth[src.id] = { ok: false, lastRun: startedAt, itemCount: 0, error: err.message };
      log(`[ingest] ${src.id} FAILED: ${err.message}`);
    }
  }

  // Enforcement news just ingested can produce new list entries; rebuild, then
  // rescore anything whose regulatory picture may have changed.
  await ingestLists(store, { log });
  regIndex = buildIndex(store.listEntries);

  const pruned = store.prune(MAX_ITEM_AGE_DAYS);
  store.lastIngest = new Date().toISOString();
  await store.persist();

  log(`[ingest] cycle complete: ${added} new or changed, ${pruned} pruned, ${store.items.size} retained`);
  return { added, pruned, retained: store.items.size, regIndex };
}
