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
<meta charset="utf-8"><title>Sheepdog Scam Alerts privacy policy</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font:16px/1.65 system-ui,-apple-system,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1.5rem;color:#1b2230}
 h1{font-size:1.7rem;margin:0 0 .3rem} h2{font-size:1.05rem;margin:2.2rem 0 .6rem}
 .sub{color:#5c6b7a;margin:0 0 2rem} table{border-collapse:collapse;width:100%}
 td,th{border-bottom:1px solid #e3e8ee;padding:.5rem .4rem;text-align:left;font-size:.95rem;vertical-align:top}
 .lead{background:#f4f1fb;border-left:4px solid #5B12C4;padding:1rem 1.2rem;border-radius:0 6px 6px 0}
 code{background:#f0f2f5;padding:.1rem .35rem;border-radius:4px;font-size:.9em}
 li{margin:.25rem 0} a{color:#5B12C4} h2{scroll-margin-top:1rem}
</style>
<h1>Sheepdog Scam Alerts: Privacy Policy</h1>
<p class="sub">Effective date and last updated: ${today}. Applies to the Sheepdog Scam Alerts extension for Google Chrome as published in the Chrome Web Store.</p>

<p class="lead"><strong>Summary.</strong> Sheepdog reads the address and title of the web pages you open, and, only if you
turn it on, the visible text of the page, so it can warn you about scam websites. If you ask it to, it also reads
the list of your other installed extensions so it can warn you about risky ones. All of this is processed on your
own computer. None of it is transmitted to the developer or to anyone else, none of it is sold or shared, and none
of it is used for any purpose other than showing you those warnings. Sheepdog does nothing until you agree.</p>

<h2>Contents</h2>
<ol>
 <li><a href="#consent">Consent</a></li>
 <li><a href="#collection">Data collection: what user data Sheepdog accesses</a></li>
 <li><a href="#use">Data handling and use: how that data is used</a></li>
 <li><a href="#storage">Data storage and retention: where it is kept and for how long</a></li>
 <li><a href="#sharing">Data sharing and disclosure: who receives it</a></li>
 <li><a href="#network">Network requests: exactly what leaves your browser</a></li>
 <li><a href="#permissions">Browser permissions and why each is needed</a></li>
 <li><a href="#security">Data security</a></li>
 <li><a href="#limited-use">Chrome Web Store User Data Policy and Limited Use</a></li>
 <li><a href="#controls">Your choices, access and deletion</a></li>
 <li><a href="#children">Children</a></li>
 <li><a href="#changes">Changes to this policy</a></li>
 <li><a href="#contact">Contact</a></li>
</ol>

<h2 id="consent">1. Consent</h2>
<p>When Sheepdog is installed, it opens a page inside the extension that describes everything it reads, why, and
where it goes, and asks you to agree. Until you choose <strong>Agree and turn on Sheepdog</strong>:</p>
<ul>
 <li>no page address, page title or page text is read;</li>
 <li>your installed extensions are not read;</li>
 <li>nothing is downloaded and no network request of any kind is made;</li>
 <li>no background task is scheduled.</li>
</ul>
<p>If you choose <strong>No thanks, keep it off</strong>, Sheepdog stays installed but inactive, and its toolbar
icon shows OFF. You can withdraw consent at any time in settings. Withdrawing stops all activity, removes the
optional extension-review permission, and deletes all data Sheepdog had stored except your own settings. If what
Sheepdog reads ever changes, it asks for your consent again before doing anything new.</p>

<h2 id="collection">2. Data collection: what user data Sheepdog accesses</h2>
<p>In this policy, "accesses" means the extension reads the data on your device. Sheepdog does not transmit any of
the data below off your device, so the developer never receives it. The table lists every category of user data the
extension handles.</p>
<table>
<tr><th>Data</th><th>Chrome Web Store category</th><th>When it is accessed</th></tr>
<tr><td>Address (URL) and title of the page in the active tab. Only the host name and protocol are used for scoring; the path and query string are discarded immediately.</td>
    <td>Web history</td>
    <td>Each time a page finishes loading, while "Assess the site in the active tab" is on (on by default after you consent). Skipped for domains on your blocklist.</td></tr>
<tr><td>Visible text of the page, limited to the first 20,000 characters of the main content area.</td>
    <td>Website content</td>
    <td>Only if you turn on "Also analyze visible page text". <strong>Off by default.</strong></td></tr>
<tr><td>Information about your other installed extensions: name, description, extension ID, whether it is enabled, how it was installed, its update, homepage and options addresses, and its declared permissions.</td>
    <td>None of the listed categories (extension metadata)</td>
    <td>Only after you click to review your extensions and approve Chrome's separate permission prompt. While that permission is granted and the setting is on, the review re-runs on your computer every 12 hours.</td></tr>
</table>
<p><strong>Sheepdog does not access:</strong> anything you type (passwords, payment card numbers, form contents,
search queries, messages), cookies, browsing history stored by Chrome, bookmarks, downloads, location, contacts,
health or financial information, or authentication information. Sheepdog has no accounts and does not ask for your
name, email address or any other personal information.</p>
<p><strong>Sheepdog does not collect analytics, telemetry, crash reports or usage statistics</strong>, and
contains no advertising or third-party code.</p>

<h2 id="use">3. Data handling and use: how that data is used</h2>
<p>Each kind of data is used for one purpose only, which is the extension's single purpose of warning you about
scams:</p>
<ul>
 <li><strong>Page address and title:</strong> compared, on your computer, against patterns used by fraudulent sites
 (for example, lookalike spellings of bank names) and against public regulatory and enforcement lists, to produce a
 fraud-risk score. If the score passes your alert threshold, Sheepdog shows you a warning.</li>
 <li><strong>Page text (optional):</strong> scanned, on your computer and in memory only, for scam wording such as
 demands for gift cards or fake virus warnings, to refine that score. The text is discarded as soon as the score is
 calculated and is never saved.</li>
 <li><strong>Installed extension information:</strong> scored, on your computer, for what each extension could do
 with the access it holds, so Sheepdog can tell you which ones carry high risk.</li>
</ul>
<p>This data is <strong>not</strong> used for advertising, personalization, profiling, building a browsing history,
determining creditworthiness, lending, or any purpose unrelated to the warnings described above. No human, including
the developer, ever reads it.</p>

<h2 id="storage">4. Data storage and retention: where it is kept and for how long</h2>
<p>All storage is local, in Chrome's extension storage on your own computer. Sheepdog has no server and no database,
and keeps no copy of your data anywhere else.</p>
<table>
<tr><th>Stored item</th><th>Contains user data?</th><th>Retention</th></tr>
<tr><td>Your settings, including any domains you add to the blocklist</td><td>Only what you enter</td><td>Until you change them or uninstall</td></tr>
<tr><td>Your consent choice, the version you agreed to, and the time</td><td>No</td><td>Until you change it or uninstall</td></tr>
<tr><td>Warnings shown to you, including the host name of a flagged site</td><td>Yes: the host name of a site that triggered a warning</td><td>Up to 6 hours, at most 30 at a time; deleted sooner if you dismiss them</td></tr>
<tr><td>List of recently checked host names, so the same site is not re-checked repeatedly</td><td>Yes: host names</td><td>Held in memory only, never written to disk; each entry expires after 10 minutes, at most 500 entries, and all are cleared when Chrome closes the background worker</td></tr>
<tr><td>Your most recent extension review result</td><td>Yes: extension metadata listed in section 2</td><td>Replaced by the next review; deleted on withdrawal of consent or uninstall</td></tr>
<tr><td>Page text (optional feature)</td><td>Yes</td><td><strong>Never stored.</strong> Held in memory only while it is scored</td></tr>
<tr><td>Cached public news feed, reference lists and headline details</td><td>No</td><td>Feed until the next refresh; lists up to 24 hours; headline details up to 1 hour, at most 60</td></tr>
</table>
<p>Sheepdog does not keep a record of the pages you visit. Uninstalling the extension deletes everything listed above.
Withdrawing consent deletes everything except your settings and your consent choice.</p>

<h2 id="sharing">5. Data sharing and disclosure: who receives it</h2>
<p><strong>No one.</strong> Sheepdog does not sell, rent, transfer, share or disclose user data to the developer or
to any third party, including advertisers, data brokers, analytics providers or information resellers. Because the
user data described in section 2 never leaves your device, there is nothing to share, and no third party processes
it on the developer's behalf.</p>
<p>The only party that can observe any request from Sheepdog is the company that hosts the public news files
described in section 6 (GitHub, Inc., through GitHub Pages). As with any website, GitHub receives the internet (IP)
address of the device making the download and records it in its own server logs under
<a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">GitHub's privacy statement</a>.
Those requests contain no information about the pages you visit, your page text or your extensions. The developer
does not receive, read or have access to those logs.</p>
<p>The developer would disclose information only if legally required to, and holds no user data that could be
disclosed.</p>

<h2 id="network">6. Network requests: exactly what leaves your browser</h2>
<p>After you consent, Sheepdog makes only the following requests, all to the same public static host. None of them
includes cookies, identifiers, or any information about the pages you visit or your installed extensions.</p>
<table>
<tr><th>Request</th><th>When</th><th>What it reveals about you</th></tr>
<tr><td><code>feed.json</code>: public scam and fraud news</td><td>Every 15 minutes, or the interval you set</td><td>Nothing beyond your IP address to the host. The same file for every user.</td></tr>
<tr><td><code>lists.json</code>: public regulatory reference lists</td><td>At most once a day</td><td>Nothing beyond your IP address to the host. The same file for every user.</td></tr>
<tr><td><code>health.json</code>: the feed's status</td><td>When you open the settings page or click to test the feed</td><td>Nothing beyond your IP address to the host. The same file for every user.</td></tr>
<tr><td><code>items/&lt;id&gt;.json</code>: detail for one news headline</td><td>Only when you click a headline</td><td>That a headline was opened, from your IP address. Not linked to any account; there are no accounts.</td></tr>
</table>
<p>You can verify this yourself: Sheepdog is open source, and its complete code is published at
<a href="https://github.com/danlandeck/sheepdog">github.com/danlandeck/sheepdog</a>.</p>

<h2 id="permissions">7. Browser permissions and why each is needed</h2>
<table>
<tr><th>Permission</th><th>Why Sheepdog needs it</th></tr>
<tr><td><code>tabs</code></td><td>To read the address and title of the page you open, so it can be checked for fraud.</td></tr>
<tr><td>Access to sites (<code>&lt;all_urls&gt;</code> and a content script on web pages)</td><td>To show a warning on the page you are viewing, and, if you turn it on, to read the page's visible text for local analysis. Sheepdog uses this access only to read and display on the page in front of you; it does not use it to send data to any site.</td></tr>
<tr><td><code>storage</code></td><td>To keep the items listed in section 4 on your computer.</td></tr>
<tr><td><code>alarms</code></td><td>To refresh the public news file on a schedule and re-run the extension review.</td></tr>
<tr><td><code>management</code> (optional)</td><td>Requested only when you ask for an extension review, through Chrome's own prompt. Used only to read the information in section 2. You can remove it at any time.</td></tr>
</table>

<h2 id="security">8. Data security</h2>
<p>User data stays inside Chrome's extension storage on your own device, which is isolated from websites and other
extensions. All network requests use HTTPS. Because no user data is transmitted or stored off your device, there is
no server copy that could be breached.</p>

<h2 id="limited-use">9. Chrome Web Store User Data Policy and Limited Use</h2>
<p>The use of information received by Sheepdog adheres to the
<a href="https://developer.chrome.com/docs/webstore/program-policies/user-data-faq">Chrome Web Store User Data Policy</a>,
including the <a href="https://developer.chrome.com/docs/webstore/program-policies/limited-use">Limited Use</a> requirements.
Specifically, Sheepdog:</p>
<ul>
 <li>uses user data only to provide or improve its single purpose of warning you about scams, which is prominent in its user interface;</li>
 <li>does not transfer user data to third parties, except as required by law, for security purposes, or as part of a merger or acquisition with your notice (none of which currently applies, as no user data leaves your device);</li>
 <li>does not use or transfer user data for personalized advertising;</li>
 <li>does not use or transfer user data to determine creditworthiness or for lending purposes;</li>
 <li>does not allow humans to read user data.</li>
</ul>

<h2 id="controls">10. Your choices, access and deletion</h2>
<table>
<tr><th>You want to</th><th>Do this</th></tr>
<tr><td>Not turn it on at all</td><td>Choose "No thanks, keep it off" on the first page it shows you</td></tr>
<tr><td>Withdraw consent and delete stored data</td><td>Choose "Turn Sheepdog off and withdraw consent" in settings</td></tr>
<tr><td>Stop page-address checking</td><td>Turn off "Assess the site in the active tab" in settings</td></tr>
<tr><td>Stop page-text analysis</td><td>Turn off "Also analyze visible page text" (off by default)</td></tr>
<tr><td>Exclude a specific site</td><td>Add that domain to the blocklist in settings</td></tr>
<tr><td>Stop extension reviews</td><td>Turn off the extension review setting, or remove the permission in Chrome's extension settings</td></tr>
<tr><td>See what is stored</td><td>Open the Sheepdog popup for current warnings and your latest extension review; open settings for your settings and consent status</td></tr>
<tr><td>Delete everything</td><td>Uninstall the extension</td></tr>
</table>
<p>Because the developer holds no data about you, there is nothing to request access to or delete on the developer's
side. You can still contact the developer with any privacy question.</p>

<h2 id="children">11. Children</h2>
<p>Sheepdog is not directed at children under 13 and does not knowingly collect personal information from anyone,
including children.</p>

<h2 id="changes">12. Changes to this policy</h2>
<p>If Sheepdog's handling of user data changes, this policy will be updated before the change is released, the date
at the top will be revised, and, for any change to what the extension reads or where data goes, the extension will
ask for your consent again before the new behavior takes effect.</p>

<h2 id="contact">13. Contact</h2>
<p>Publisher: ${OWNER}<br>Email: <a href="mailto:${EMAIL}">${EMAIL}</a></p>
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
