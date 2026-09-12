#!/usr/bin/env node
/**
 * Build a Chrome Web Store submission zip.
 *
 * The unpacked extension points at a local development server, which is correct
 * while working on it and completely broken for anyone who installs from a store.
 * This script bakes in the address the build should actually read from, so a
 * package that still points at localhost cannot be produced by forgetting a step.
 *
 *   node scripts/build-release.mjs --feed https://<user>.github.io/<repo>
 *   node scripts/build-release.mjs --feed https://<user>.github.io/<repo> --version 1.0.0
 *
 * Output: dist/sheepdog-<version>.zip.
 */

import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zipDirectory } from './lib/zip.mjs';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------- args */

const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

const feed = argOf('feed');
const backend = argOf('backend');
const versionArg = argOf('version');

if (!feed && !backend) {
  console.error(`
Missing --feed.

A store build has to point somewhere the public can actually reach. There are
two ways to do that:

  --feed https://you.github.io/sheepdog
      The normal choice. Points at static JSON published by the GitHub Action.
      No server exists, nothing has to stay running, and it costs nothing.
      Sites and extensions are scored inside the browser.

  --backend https://ticker.yourdomain.com
      For self-hosting a live collector instead.

An extension published pointing at localhost installs fine and then shows an
empty bar for every user, because localhost on their machine is their machine.
`);
  process.exit(1);
}

if (feed && backend) {
  console.error('Pass either --feed or --backend, not both. They are two different ways to reach the data.');
  process.exit(1);
}

const target = feed || backend;
const mode = feed ? 'static' : 'service';

let url;
try {
  url = new URL(target);
} catch {
  console.error(`${feed ? '--feed' : '--backend'} is not a valid URL: ${target}`);
  process.exit(1);
}

if (url.protocol !== 'https:') {
  console.error(`
${feed ? '--feed' : '--backend'} must be https, got "${url.protocol}//".

Chrome blocks insecure requests from extension pages, and the store will flag a
plaintext endpoint during review. Put TLS in front of the collector first.
`);
  process.exit(1);
}

if (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url.hostname)) {
  console.error(`That points at localhost (${url.hostname}). See the note above about why that ships a broken extension.`);
  process.exit(1);
}

// Keep any path, since a GitHub Pages feed lives under /<repo>/.
const targetClean = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;

/* ------------------------------------------------------------------ build */

const src = join(root, 'extension');
const dist = join(root, 'dist');
const staging = join(dist, 'extension');

console.log('Syncing shared scoring modules...');
await run(process.execPath, [join(root, 'scripts', 'sync-shared.mjs')]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(src, staging, { recursive: true });

// 1. Bake in where the data comes from.
const swPath = join(staging, 'src', 'background', 'service-worker.js');
let sw = await readFile(swPath, 'utf8');
const before = sw;

sw = sw.replace(/feedMode:\s*'(?:static|service)'/, `feedMode: '${mode}'`);
if (mode === 'static') {
  sw = sw.replace(/feedUrl:\s*''/, `feedUrl: '${targetClean}'`);
  // A store build never contacts a server, so the development default must not
  // ride along. It is unreachable code either way, but shipping a localhost
  // address inside a security extension invites exactly the question the
  // listing spends its time answering.
  sw = sw.replace(/backendUrl:\s*'http:\/\/localhost:8787'/, "backendUrl: ''");
} else {
  sw = sw.replace(/backendUrl:\s*'http:\/\/localhost:8787'/, `backendUrl: '${targetClean}'`);
}

if (sw === before) {
  console.error('Could not find the feed defaults in the service worker. Did their shape change?');
  process.exit(1);
}
await writeFile(swPath, sw, 'utf8');

// The options-page placeholder is cosmetic, but a store build showing
// "localhost" in its settings screenshot looks unfinished.
const optPath = join(staging, 'src', 'options', 'options.html');
let opt = await readFile(optPath, 'utf8');
opt = opt.replace(/placeholder="http:\/\/localhost:8787"/, `placeholder="${targetClean}"`);
await writeFile(optPath, opt, 'utf8');

// 2. Version.
const manifestPath = join(staging, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (versionArg) {
  if (!/^\d+(\.\d+){0,3}$/.test(versionArg)) {
    console.error(`--version must be 1 to 4 dot-separated integers, got "${versionArg}"`);
    process.exit(1);
  }
  manifest.version = versionArg;
}

/*
 * 3. Host permissions.
 *
 * In static mode the service worker fetches exactly one origin: the published
 * feed. Declaring <all_urls> would ask for far more than the extension uses and
 * hand a reviewer nothing to verify, so the build narrows it to the feed itself.
 *
 * The crawl still renders everywhere, because content_scripts.matches grants
 * injection independently of host_permissions. The install prompt still mentions
 * site access for that reason, but what the extension can FETCH is now one
 * address a reviewer can read off the manifest.
 */
if (mode === 'static') {
  manifest.host_permissions = [`${url.protocol}//${url.host}/*`];
} else {
  manifest.host_permissions = [`${url.protocol}//${url.host}/*`];
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

/* --------------------------------------------------------------- validate */

console.log('Validating the staged bundle...');
try {
  await run(process.execPath, [join(root, 'scripts', 'validate-extension.mjs')]);
} catch (err) {
  console.error(String(err.stdout || '') + String(err.stderr || ''));
  console.error('Validation failed. Fix the problems above before submitting.');
  process.exit(1);
}

// Store-listing limits, checked here so the upload form does not reject you.
const problems = [];
if ((manifest.name || '').length > 75) problems.push(`name is ${manifest.name.length} chars, limit 75`);
if ((manifest.description || '').length > 132) problems.push(`description is ${manifest.description.length} chars, limit 132`);
if (!manifest.icons?.['128']) problems.push('a 128x128 icon is required for the store listing');

// Anything still pointing at localhost is a hard stop.
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out); else out.push(p);
  }
  return out;
}
// No shipped build of either kind may carry a development address. This used
// to run only for --backend builds, which is backwards: a static build is the
// one that should contain no server reference at all.
for (const f of (await walk(staging)).filter((f) => ['.js', '.html', '.json'].includes(extname(f)))) {
  const body = await readFile(f, 'utf8');
  if (/localhost|127\.0\.0\.1/.test(body)) {
    problems.push(`${relative(staging, f)} still references localhost`);
  }
}

if (mode === 'static') {
  const swBody = await readFile(swPath, 'utf8');
  if (!swBody.includes(`feedUrl: '${targetClean}'`)) problems.push('the feed address was not baked in');
  if (!swBody.includes("feedMode: 'static'")) problems.push('feed mode was not set to static');
} else {
}

if (problems.length) {
  console.error('\nNot ready to submit:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

/* -------------------------------------------------------------------- zip */

const zipName = `sheepdog-${manifest.version}.zip`;
const zipPath = join(dist, zipName);

// Written in pure Node rather than shelling out to `zip`, which does not exist
// on Windows.
const { entries, bytes: size } = await zipDirectory(staging, zipPath);

console.log(`
Built ${zipName}  (${entries} files, ${(size / 1024).toFixed(0)} KB)

  file     dist/${zipName}
  data     ${targetClean}  (${mode === 'static' ? 'static feed, no server needed' : 'live collector'})
  version  ${manifest.version}

Upload that zip at https://chrome.google.com/webstore/devconsole

Before submitting, have ready:

  - the privacy policy URL, published alongside the feed at /privacy.html
  - a single purpose statement and a justification per permission
  - at least one 1280x800 screenshot
`);
