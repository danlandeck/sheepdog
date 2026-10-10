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
 td,th{border-bottom:1px solid #e3e8ee;padding:.5rem .4rem;text-align:left;font-size:.95rem;vertical-align:top}
 .lead{background:#f4f1fb;border-left:4px solid #5B12C4;padding:1rem 1.2rem;border-radius:0 6px 6px 0}
 code{background:#f0f2f5;padding:.1rem .35rem;border-radius:4px;font-size:.9em}
</style>
<h1>Sheepdog privacy policy</h1>
<p class="sub">Last updated ${today}</p>

<p class="lead"><strong>Sheepdog reads the address of the pages you open so it can warn you about
scam websites. It does that on your own computer and sends none of it anywhere.</strong>
It does nothing at all until you agree. No accounts, no advertising, no analytics, no tracking.</p>

<h2>Your consent comes first</h2>
<p>When Sheepdog is installed it opens a page that lists what it reads and why, and asks you to
agree. Until you choose <strong>Agree and turn on Sheepdog</strong>, it reads nothing, checks nothing
and downloads nothing. If you choose not to agree, it stays installed but switched off, and does
not ask again. You can withdraw your agreement at any time in settings, which stops everything
and deletes what Sheepdog had stored other than your settings.</p>

<h2>What Sheepdog reads, and what it does with it</h2>
<table>
<tr><th>What</th><th>Why</th><th>Where it goes</th></tr>
<tr><td>The address and title of each page you open</td>
    <td>To check the address against the patterns scam sites use and against public enforcement lists, and warn you if it looks fraudulent.</td>
    <td>Checked on your own computer. Never transmitted: not the full address, not the domain, not a hash of it.</td></tr>
<tr><td>The visible text of the page, up to 20,000 characters. <em>Only if you turn on "Also analyze visible page text". Off by default.</em></td>
    <td>To spot scam wording, such as demands for gift cards or fake virus warnings.</td>
    <td>Checked on your own computer, in memory. Never transmitted and never saved.</td></tr>
<tr><td>Your other installed extensions: each one's name, description, ID, whether it is switched on, where it was installed from, its web addresses and its permissions. <em>Only if you ask for a review, and only after you grant Chrome's separate permission prompt.</em></td>
    <td>To tell you what each extension could do with the access it already holds.</td>
    <td>Checked on your own computer. Never transmitted. The most recent result is saved on your computer so you can read it.</td></tr>
</table>
<p>Sheepdog uses this information only to provide the warnings described here. It is never used
for anything else, never sold, and never shared with anyone, because it never leaves your
computer.</p>
<p><strong>What you type is never read.</strong> Passwords, card numbers, form contents and search
queries are not read, stored or sent.</p>

<h2>What leaves your browser</h2>
<p>Downloads of public files, and nothing else:</p>
<table>
<tr><th>Request</th><th>What it says about you</th></tr>
<tr><td><code>feed.json</code> the scored news, every 15 minutes unless you change how often</td><td>Nothing. The same file everyone gets.</td></tr>
<tr><td><code>lists.json</code> reference lists, once a day</td><td>Nothing. The same file everyone gets.</td></tr>
<tr><td><code>health.json</code> the feed's status, when you open the settings page</td><td>Nothing. The same file everyone gets.</td></tr>
<tr><td><code>items/&lt;id&gt;.json</code> one headline's detail, when you click it</td><td>That someone opened that headline. Not tied to you, and there is no account to tie it to.</td></tr>
</table>
<p>These are static files hosted on GitHub Pages. The requests carry no cookies and
no identifiers, and nothing about the pages you visit. Like any web server, the host records
standard request logs including IP addresses; those logs belong to the hosting provider
(GitHub), are not available to or analysed by the developer, and are not connected to anything
else. None of these downloads happens before you agree.</p>
<p>This is not a promise layered over a service that could do otherwise. There is no
server to receive your data, and the extension has permission to contact exactly
one address, which you can read in its manifest.</p>

<h2>Stored on your own device</h2>
<p>Your settings, whether and when you agreed, a cached copy of the news feed and the reference
lists, and your most recent extension review if you ran one. If a page triggers a warning, that
warning, including the site's address, is kept for up to six hours so it can be shown to you,
then discarded. Sheepdog keeps no history of the pages you visit. All of it stays in your
browser and is deleted when you uninstall.</p>

<h2>Never collected</h2>
<p>Names, email addresses, account information, passwords, payment details, location, cookies,
tracking identifiers, analytics or telemetry of any kind. No record of your browsing is kept
or sent. Nothing is sold or shared with advertisers or data brokers, and nothing is used to
determine creditworthiness or for lending purposes.</p>
<p>Sheepdog's use of information complies with the
<a href="https://developer.chrome.com/docs/webstore/program-policies/limited-use">Chrome Web Store User Data Policy</a>,
including the Limited Use requirements.</p>

<h2>Your controls</h2>
<table>
<tr><th>You want to</th><th>Do this</th></tr>
<tr><td>Not turn it on at all</td><td>Choose "No thanks, keep it off" on the first page it shows you</td></tr>
<tr><td>Withdraw your agreement later</td><td>Choose "Turn Sheepdog off and withdraw consent" in settings</td></tr>
<tr><td>Stop site checking</td><td>Turn off "Assess the site in the active tab" in settings</td></tr>
<tr><td>Stop page-text analysis</td><td>Turn off "Also analyze visible page text" (off by default)</td></tr>
<tr><td>Stop it on one site</td><td>Add that domain to the blocklist in settings</td></tr>
<tr><td>Revoke extension-review access</td><td>Withdraw consent in settings, or remove the permission in Chrome's extension settings</td></tr>
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
