/**
 * Storage. A JSON file behind an in-memory map.
 *
 * The dataset is a few hundred scored items and a few thousand list entries, so
 * a database would be ceremony. Swap this module for Postgres when the ticker
 * has more than one server behind it; nothing else needs to change.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const MAX_ITEMS = 600;

export function idFor(source, guid) {
  return createHash('sha1').update(`${source}|${guid}`).digest('hex').slice(0, 16);
}

export class Store {
  constructor(file) {
    this.file = file;
    this.items = new Map();       // id -> full scored item
    this.listEntries = [];        // regulatory index source records
    this.sourceHealth = {};       // sourceId -> { ok, lastRun, itemCount, error }
    this.lastIngest = null;
    this._dirty = false;
    this._writing = false;
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8');
      const data = JSON.parse(raw);
      for (const it of data.items || []) this.items.set(it.id, it);
      this.listEntries = data.listEntries || [];
      this.sourceHealth = data.sourceHealth || {};
      this.lastIngest = data.lastIngest || null;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[store] load failed, starting empty:', err.message);
    }
    return this;
  }

  async persist() {
    if (this._writing) { this._dirty = true; return; }
    this._writing = true;
    try {
      await mkdir(dirname(this.file), { recursive: true });
      const payload = JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        lastIngest: this.lastIngest,
        sourceHealth: this.sourceHealth,
        listEntries: this.listEntries,
        items: this.list({ limit: MAX_ITEMS }),
      });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, payload, 'utf8');
      await rename(tmp, this.file);
    } catch (err) {
      console.error('[store] persist failed:', err.message);
    } finally {
      this._writing = false;
      if (this._dirty) { this._dirty = false; await this.persist(); }
    }
  }

  upsert(item) {
    const existing = this.items.get(item.id);
    if (existing && existing.contentHash === item.contentHash) return false;
    this.items.set(item.id, { ...existing, ...item, firstSeen: existing?.firstSeen || item.firstSeen });
    return true;
  }

  get(id) { return this.items.get(id) || null; }

  /** Newest first, filtered. */
  list({ limit = 120, minScore = 0, bands = null, since = null, sources = null } = {}) {
    let out = [...this.items.values()];
    if (minScore > 0) out = out.filter((i) => i.score >= minScore);
    if (bands && bands.length) out = out.filter((i) => bands.includes(i.band));
    if (sources && sources.length) out = out.filter((i) => sources.includes(i.source));
    if (since) out = out.filter((i) => (i.publishedAt || i.firstSeen) > since);
    out.sort((a, b) => String(b.publishedAt || b.firstSeen).localeCompare(String(a.publishedAt || a.firstSeen)));
    return out.slice(0, limit);
  }

  prune(maxAgeDays) {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
    let removed = 0;
    for (const [id, it] of this.items) {
      if ((it.publishedAt || it.firstSeen) < cutoff) { this.items.delete(id); removed++; }
    }
    // Hard cap regardless of age.
    if (this.items.size > MAX_ITEMS) {
      const keep = new Set(this.list({ limit: MAX_ITEMS }).map((i) => i.id));
      for (const id of [...this.items.keys()]) if (!keep.has(id)) { this.items.delete(id); removed++; }
    }
    return removed;
  }

  setListEntries(entries) {
    // Dedupe on list+entity, preferring the newest.
    const seen = new Map();
    for (const e of entries) {
      const k = `${e.list}|${String(e.entity).toLowerCase()}`;
      const prev = seen.get(k);
      if (!prev || String(e.date || '') > String(prev.date || '')) seen.set(k, e);
    }
    this.listEntries = [...seen.values()];
    return this.listEntries.length;
  }
}

/**
 * Resolved against this module's own location, not process.cwd().
 *
 * Otherwise `node server/src/index.js` from the project root and
 * `node src/index.js` from inside server/ would silently use two different
 * store files, and the ticker would come up empty depending on which directory
 * you happened to be standing in when you started it.
 */
export function defaultStorePath() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'store.json');
}
