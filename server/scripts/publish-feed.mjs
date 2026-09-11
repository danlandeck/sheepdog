#!/usr/bin/env node
/**
 * Publish the scored feed as plain static files.
 *
 * This is what makes a normal Chrome Web Store install work. A consumer who
 * installs from the store is never going to run a Node server, and pointing
 * every installed extension at feeds like ftc.gov directly would mean thousands
 * of browsers hammering a government site every fifteen minutes, which is both
 * abusive and a fast route to being blocked.
 *
 * So the fetching happens exactly once, here, in a scheduled job. The result is
 * a handful of static JSON files that any CDN or static host serves for free
 * and caches globally. Nothing runs between publishes.
 *
 *   node server/scripts/publish-feed.mjs --out public
 *
 * Output:
 *   public/feed.json          the scored crawl
 *   public/items/<id>.json    one file per item, for the detail panel
 *   public/lists.json         the regulatory index, so the extension can do
 *                             its own scoring offline
 *   public/health.json        source health, for your own monitoring
 */

import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, defaultStorePath } from '../src/store.js';
import { ingestAll } from '../src/ingest.js';
import { SOURCES, LIST_SOURCES } from '../src/sources.js';
import { BANDS } from '../../shared/score.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const outDir = join(root, argOf('out') || 'public');
const skipIngest = args.includes('--no-ingest');

const store = await new Store(process.env.STORE_PATH || defaultStorePath()).load();

if (!skipIngest) {
  console.log('Fetching and scoring sources...');
  await ingestAll(store, { enrich: process.env.ENRICH !== 'false' });
} else {
  console.log('Skipping ingest, publishing what is already stored.');
}

/* ------------------------------------------------------------------ write */

await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'items'), { recursive: true });

const all = store.list({ limit: 200 });

function toTickerItem(i) {
  return {
    id: i.id, kind: i.kind, title: i.title,
    source: i.source, sourceName: i.sourceName, url: i.url,
    publishedAt: i.publishedAt,
    score: i.score, band: i.band, bandLabel: i.bandLabel, color: i.color,
  };
}

const generatedAt = store.lastIngest || new Date().toISOString();

await writeFile(join(outDir, 'feed.json'), JSON.stringify({
  version: 1,
  generatedAt,
  lastIngest: store.lastIngest,
  bands: BANDS,
  count: all.length,
  items: all.map(toTickerItem),
}), 'utf8');

for (const item of all) {
  await writeFile(join(outDir, 'items', `${item.id}.json`), JSON.stringify(item), 'utf8');
}

/*
 * The regulatory index ships to the client too.
 *
 * Without it the extension's local scoring runs with an empty list, which
 * silently drops an entire pass and makes offline scores lower than they should
 * be. It is a few hundred kilobytes at most and it changes slowly, so the
 * extension fetches it once a day and keeps it.
 */
await writeFile(join(outDir, 'lists.json'), JSON.stringify({
  version: 1,
  generatedAt,
  count: store.listEntries.length,
  entries: store.listEntries,
}), 'utf8');

const health = SOURCES.concat(LIST_SOURCES).map((s) => ({
  id: s.id, name: s.name,
  ...(store.sourceHealth[s.id] || { ok: null, error: 'never run', itemCount: 0 }),
}));

await writeFile(join(outDir, 'health.json'), JSON.stringify({
  generatedAt,
  itemsPublished: all.length,
  listEntries: store.listEntries.length,
  sourcesHealthy: health.filter((h) => h.ok).length,
  sourcesTotal: health.length,
  sources: health,
}), 'utf8');

/*
 * The Chrome Web Store requires a publicly reachable privacy policy URL, and it
 * must stay reachable for as long as the extension is listed. Publishing it
 * alongside the feed means there is nothing else to host and nothing else to
 * remember to renew.
 */
const owner = process.env.PUBLISHER_NAME || '';
const email = process.env.PUBLISHER_EMAIL || '';
if (!owner || !email) {
  console.warn('\n  NOTE: set PUBLISHER_NAME and PUBLISHER_EMAIL to fill in the privacy policy.');
  console.warn('  Until you do, privacy.html ships with visible placeholders.\n');
}
const OWNER = owner || '[YOUR NAME OR LLC]';
const EMAIL = email || '[YOUR EMAIL]';
const today = new Date().toISOString().slice(0, 10);

await writeFile(join(outDir, 'privacy.html'), `<!doctype html>
<meta charset="utf-8"><title>Sheepdog privacy policy</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font:16px/1.65 system-ui,-apple-system,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.5rem;color:#1b2230}
 h1{font-size:1.7rem;margin:0 0 .3rem} h2{font-size:1.05rem;margin:2.2rem 0 .6rem}
 .sub{color:#5c6b7a;margin:0 0 2rem} table{border-collapse:collapse;width:100%}
 td,th{border-bottom:1px solid #e3e8ee;padding:.5rem .4rem;text-align:left;font-size:.95rem}
 .lead{background:#f4f1fb;border-left:4px solid #4B0082;padding:1rem 1.2rem;border-radius:0 6px 6px 0}
 code{background:#f0f2f5;padding:.1rem .35rem;border-radius:4px;font-size:.9em}
</style>
<h1>Sheepdog privacy policy</h1>
<p class="sub">Last updated ${today}</p>

<p class="lead"><strong>Sheepdog does not collect anything.</strong> No accounts, no advertising,
no analytics, no tracking. It downloads a public list of scam news, and does all
analysis of your browsing on your own computer.</p>

<h2>What leaves your browser</h2>
<p>Three file downloads, and nothing else:</p>
<table>
<tr><th>Request</th><th>What it says about you</th></tr>
<tr><td><code>feed.json</code> the scored news</td><td>Nothing. The same file everyone gets.</td></tr>
<tr><td><code>lists.json</code> reference lists, once a day</td><td>Nothing. The same file everyone gets.</td></tr>
<tr><td><code>items/&lt;id&gt;.json</code> one headline's detail, when you click it</td><td>That someone opened that headline. Not tied to you, and there is no account to tie it to.</td></tr>
</table>
<p>These are static files on a content delivery network. They carry no cookies and
no identifiers. Like any web server, the host records standard request logs
including IP addresses; those logs belong to the hosting provider, are not read
or analysed by the developer, and are not connected to anything else.</p>

<h2>What never leaves your browser</h2>
<p><strong>The sites you visit.</strong> Checking whether a site looks fraudulent happens entirely
inside your browser. The address is not sent anywhere: not the full URL, not the
path, not the domain, not a hash of it.</p>
<p><strong>Anything on the page.</strong> The optional "analyze visible page text" setting also runs
on your device. Turning it on transmits nothing; it only lets the local analysis
read more of the page.</p>
<p><strong>Your installed extensions.</strong> If you ask Sheepdog to review them, it reads each
one's name, install type and declared permissions, scores them on your device,
and shows you the result. That list is never transmitted.</p>
<p><strong>Everything you type.</strong> Passwords, card numbers, form contents and search queries
are never read and never sent.</p>
<p>This is not a promise layered over a service that could do otherwise. There is no
server to receive this data, and the extension has permission to contact exactly
one address, which you can read in its manifest.</p>

<h2>Stored on your own device</h2>
<p>Your settings, a cached copy of the news feed, the reference lists, and your most
recent extension audit if you ran one. All of it stays in your browser and is
deleted when you uninstall.</p>

<h2>Never collected</h2>
<p>Names, email addresses, account information, browsing history, passwords,
payment details, location, cookies, tracking identifiers, analytics or telemetry
of any kind. Nothing is sold or shared with advertisers or data brokers, and
nothing is used to determine creditworthiness or for lending purposes.</p>

<h2>Your controls</h2>
<table>
<tr><th>You want to</th><th>Do this</th></tr>
<tr><td>Stop site checking</td><td>Turn off "Assess the site in the active tab" in settings</td></tr>
<tr><td>Stop page-text analysis</td><td>Turn off "Also analyze visible page text" (off by default)</td></tr>
<tr><td>Stop it on one site</td><td>Add that domain to the blocklist in settings</td></tr>
<tr><td>Revoke extension-audit access</td><td>Remove the permission in Chrome's extension settings</td></tr>
<tr><td>Delete everything</td><td>Uninstall the extension</td></tr>
</table>

<h2>Children</h2>
<p>Sheepdog is not directed at children and does not knowingly collect information
from anyone under 13. It does not collect information from anyone.</p>

<h2>Changes</h2>
<p>If what the extension does with data changes, this policy is updated and the date
above revised.</p>

<h2>Contact</h2>
<p>${EMAIL}</p>
<p class="sub" style="margin-top:2.5rem">Sheepdog&trade; &copy; ${new Date().getFullYear()} ${OWNER}. Open source under the Apache License 2.0.</p>
`, 'utf8');

// A tiny index page, so opening the feed URL in a browser explains itself
// rather than showing a directory listing or a 404.
await writeFile(join(outDir, 'index.html'), `<!doctype html>
<meta charset="utf-8"><title>Sheepdog feed</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.5rem;color:#16202b}
code{background:#eef2f6;padding:.15rem .4rem;border-radius:4px}a{color:#0b6bcb}</style>
<h1>Sheepdog feed</h1>
<p>Static data for the Sheepdog browser extension. Regenerated automatically.</p>
<ul>
  <li><a href="feed.json">feed.json</a> the scored crawl (${all.length} items)</li>
  <li><a href="lists.json">lists.json</a> the regulatory index (${store.listEntries.length} entries)</li>
  <li><a href="health.json">health.json</a> source health</li>
</ul>
<p>Last updated ${generatedAt}.</p>
`, 'utf8');

const bytes = JSON.stringify({ items: all }).length;
console.log(`
Published to ${outDir}

  feed.json    ${all.length} items (${(bytes / 1024).toFixed(0)} KB before compression)
  items/       ${all.length} detail files
  lists.json   ${store.listEntries.length} regulatory entries
  health.json  ${health.filter((h) => h.ok).length}/${health.length} sources healthy

Serve this folder from any static host. Nothing needs to run between publishes.
`);
