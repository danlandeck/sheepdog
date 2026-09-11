#!/usr/bin/env node
/**
 * The scoring engine is the one piece of logic that has to run in two places:
 * on the server for the news feed, and inside the extension for local fallback
 * scoring when the backend is unreachable.
 *
 * An extension can only load files inside its own folder, so /shared is the
 * canonical copy and this script mirrors it into extension/src/shared/.
 * Run it after any change to /shared, or just run `npm run build`.
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'shared');
const dest = join(root, 'extension', 'src', 'shared');

const BANNER = `/* GENERATED FILE - do not edit.
   Source of truth: /shared/%NAME%
   Regenerate with: npm run build
*/
`;

await mkdir(dest, { recursive: true });
const files = (await readdir(src)).filter((f) => f.endsWith('.js'));

for (const f of files) {
  const body = await readFile(join(src, f), 'utf8');
  await writeFile(join(dest, f), BANNER.replace('%NAME%', f) + body, 'utf8');
  console.log(`synced shared/${f} -> extension/src/shared/${f}`);
}
console.log(`\n${files.length} module${files.length === 1 ? '' : 's'} in sync.`);
