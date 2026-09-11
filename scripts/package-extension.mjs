#!/usr/bin/env node
/** Zip extension/ for manual loading or archiving. Cross-platform. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zipDirectory } from './lib/zip.mjs';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await run(process.execPath, [join(root, 'scripts', 'sync-shared.mjs')]);
const out = join(root, 'sheepdog-extension.zip');
const { entries, bytes } = await zipDirectory(join(root, 'extension'), out, (rel) => !rel.includes('.DS_Store'));
console.log(`wrote sheepdog-extension.zip (${entries} files, ${(bytes / 1024).toFixed(0)} KB)`);
