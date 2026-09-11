#!/usr/bin/env node
/**
 * Probe every configured source from THIS host and report what actually works.
 *
 * Run this after deploying, and any time the ticker goes quiet. Feed URLs move.
 *
 *   npm run check-sources
 */

import { SOURCES, LIST_SOURCES } from '../src/sources.js';
import { parseFeed } from '../src/rss.js';

const UA = 'Sheepdog/0.1 feed-reader';
const pad = (s, n) => String(s).padEnd(n).slice(0, n);

async function probe(src) {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(src.url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: '*/*' },
    });
    clearTimeout(timer);
    const body = await res.text();
    const ms = Date.now() - started;

    if (!res.ok) return { id: src.id, ok: false, detail: `HTTP ${res.status}`, ms };

    if (src.type === 'json') {
      const json = JSON.parse(body);
      const mapped = src.map ? src.map(json) : [];
      return { id: src.id, ok: mapped.length > 0, detail: `${mapped.length} entries`, ms };
    }

    const feed = parseFeed(body);
    if (!feed.items.length) return { id: src.id, ok: false, detail: 'parsed but zero items', ms };
    const newest = feed.items.map((i) => i.publishedAt).filter(Boolean).sort().pop();
    const ageDays = newest ? ((Date.now() - Date.parse(newest)) / 86400000).toFixed(1) : '?';
    return {
      id: src.id,
      ok: true,
      detail: `${feed.format} · ${feed.items.length} items · newest ${ageDays}d old · "${(feed.title || '').slice(0, 40)}"`,
      ms,
      stale: newest ? (Date.now() - Date.parse(newest)) > 21 * 86400000 : true,
    };
  } catch (err) {
    return { id: src.id, ok: false, detail: err.name === 'AbortError' ? 'timed out' : err.message, ms: Date.now() - started };
  }
}

const all = [...SOURCES, ...LIST_SOURCES];
console.log(`Probing ${all.length} sources...\n`);
const results = await Promise.all(all.map(probe));

let healthy = 0;
for (const r of results) {
  const mark = r.ok ? (r.stale ? 'STALE' : ' OK  ') : 'FAIL ';
  if (r.ok && !r.stale) healthy++;
  console.log(`[${mark}] ${pad(r.id, 18)} ${pad(r.ms + 'ms', 8)} ${r.detail}`);
}

console.log(`\n${healthy}/${all.length} sources healthy and fresh.`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log('\nFailing sources (edit server/src/sources.js to fix or remove):');
  for (const f of failed) console.log(`  - ${f.id}: ${f.detail}`);
}
process.exit(failed.length && healthy === 0 ? 1 : 0);
