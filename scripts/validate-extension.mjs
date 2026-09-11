#!/usr/bin/env node
/**
 * Pre-flight checks for the unpacked extension.
 *
 * Chrome reports manifest and CSP problems as a single unhelpful line at load
 * time, so catch the common ones here instead:
 *   - every file the manifest references actually exists
 *   - every JS file parses, with the service worker parsed as an ES module
 *     and content scripts parsed as classic scripts (an import in a content
 *     script fails silently at runtime)
 *   - no inline <script> or on* handlers, which MV3's CSP blocks outright
 *   - the shared modules are in sync with /shared
 *
 *   npm run validate
 */

import { readFile, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const note = (m) => notes.push(m);

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

/* ---------------------------------------------------------------- manifest */

let manifest;
try {
  manifest = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8'));
} catch (err) {
  console.error(`manifest.json is not valid JSON: ${err.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail(`manifest_version is ${manifest.manifest_version}, expected 3`);
if (!/^\d+\.\d+(\.\d+)?/.test(manifest.version || '')) fail(`version "${manifest.version}" is not a valid extension version`);

const referenced = new Set();
const collect = (v) => {
  if (typeof v === 'string' && /\.(js|html|css|png|json)$/.test(v)) referenced.add(v);
  else if (Array.isArray(v)) v.forEach(collect);
  else if (v && typeof v === 'object') Object.values(v).forEach(collect);
};
collect(manifest);

for (const rel of referenced) {
  if (!(await exists(join(ext, rel)))) fail(`manifest references a missing file: ${rel}`);
}
note(`manifest references ${referenced.size} files, all present`);

const swPath = manifest.background?.service_worker;
if (!swPath) fail('no background.service_worker declared');
if (manifest.background && manifest.background.type !== 'module') {
  fail('background.type must be "module" because the service worker uses import statements');
}

/* ------------------------------------------------------------ script parse */

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = await walk(ext);
const jsFiles = files.filter((f) => extname(f) === '.js');

const moduleFiles = new Set([
  join(ext, swPath || ''),
  ...files.filter((f) => f.includes(`${join('src', 'shared')}`)),
]);

const contentScripts = new Set(
  (manifest.content_scripts || []).flatMap((cs) => (cs.js || []).map((j) => join(ext, j))),
);

// `node --check` picks its parsing goal from the file extension, so module
// files are copied to a .mjs temp before checking. Parsing a module as a
// classic script (or the reverse) produces confusing false failures.
const tmp = join(tmpdir(), `sheepdog-validate-${process.pid}`);
await mkdir(tmp, { recursive: true });

for (const f of jsFiles) {
  const isModule = moduleFiles.has(f);
  const src = await readFile(f, 'utf8');

  const probe = join(tmp, `probe.${isModule ? 'mjs' : 'cjs'}`);
  await writeFile(probe, src, 'utf8');
  try {
    await run(process.execPath, ['--check', probe]);
  } catch (err) {
    const msg = String(err.stderr || err.message).split('\n').find((l) => /Error|Unexpected/.test(l)) || err.message;
    fail(`${relative(root, f)} does not parse as ${isModule ? 'an ES module' : 'a classic script'}: ${msg.trim()}`);
    continue;
  }

  if (contentScripts.has(f) && /^\s*import\s/m.test(src)) {
    fail(`${relative(root, f)} is a content script but uses "import", which Chrome does not support there`);
  }
  if (!isModule && !contentScripts.has(f) && /^\s*import\s/m.test(src)) {
    note(`${relative(root, f)} uses import; make sure it is loaded as a module`);
  }
}
await rm(tmp, { recursive: true, force: true });
note(`${jsFiles.length} JavaScript files parse cleanly (${moduleFiles.size} as ES modules, ${jsFiles.length - moduleFiles.size} as classic scripts)`);

/* ------------------------------------------------------------------ CSP */

for (const f of files.filter((f) => extname(f) === '.html')) {
  const src = await readFile(f, 'utf8');
  const rel = relative(root, f);
  if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(src)) {
    fail(`${rel} contains an inline <script>, which MV3's content security policy blocks`);
  }
  const on = src.match(/\son[a-z]+\s*=\s*["']/i);
  if (on) fail(`${rel} contains an inline event handler (${on[0].trim()}), which MV3's CSP blocks`);
  for (const m of src.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const target = m[1];
    if (/^(https?:|data:|#|mailto:)/.test(target)) continue;
    if (!(await exists(join(dirname(f), target)))) fail(`${rel} references a missing local file: ${target}`);
  }
}
note('no inline scripts or handlers in any extension page');

/* --------------------------------------------------------- shared in sync */

const sharedSrc = join(root, 'shared');
const sharedDest = join(ext, 'src', 'shared');
for (const f of (await readdir(sharedSrc)).filter((f) => f.endsWith('.js'))) {
  const a = await readFile(join(sharedSrc, f), 'utf8');
  let b;
  try { b = await readFile(join(sharedDest, f), 'utf8'); }
  catch { fail(`extension/src/shared/${f} is missing. Run: npm run build`); continue; }
  if (!b.includes(a)) fail(`extension/src/shared/${f} is stale. Run: npm run build`);
}
note('shared scoring modules are in sync with /shared');

/* ------------------------------------------------- development default */

/*
 * The checked-in service worker must default to 'service' mode. If it defaults
 * to 'static' with no address baked in, loading extension/ unpacked reports
 * "No feed address configured" and never talks to a local collector, which
 * breaks development for everyone with no obvious cause.
 */
{
  const sw = await readFile(join(ext, swPath || ''), 'utf8');
  const m = sw.match(/feedMode:\s*'(\w+)'/);
  const u = sw.match(/feedUrl:\s*'([^']*)'/);
  if (!m) fail('could not find the feedMode default in the service worker');
  else if (m[1] === 'static' && (!u || !u[1])) {
    fail('the checked-in service worker defaults to static mode with no feed address, which breaks local development. It should default to service mode; build-release.mjs sets static.');
  } else {
    note(`development default is ${m[1]} mode`);
  }
}

/* ------------------------------------------------------------- permissions */

const perms = new Set(manifest.permissions || []);
const hosts = manifest.host_permissions || [];
if (hosts.includes('<all_urls>')) {
  note('declares <all_urls>: required for the crawl to render on every page. Documented in the README and the settings page.');
}
if (perms.has('management')) note('declares "management": required for the installed-extension audit.');

/* ----------------------------------------------------------------- report */

for (const n of notes) console.log(`  ok   ${n}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'} found.`);
  process.exit(1);
}
console.log('\nExtension bundle looks loadable.');
