import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Windows portability.
 *
 * These are bugs that pass every test on Linux and macOS and fail immediately
 * on Windows, which makes them close to invisible without a Windows machine to
 * hand. Each one here has actually bitten this project.
 */

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'public') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (['.js', '.mjs'].includes(extname(p))) out.push(p);
  }
  return out;
}

const SCANNED = ['scripts', 'server', 'shared'];
const files = [];
for (const d of SCANNED) files.push(...await walk(join(root, d)));

test('no dynamic import() is given a filesystem path', async () => {
  /*
   * import() takes a URL. An absolute POSIX path happens to work; an absolute
   * Windows path does not, because "C:\..." is read as a URL scheme named "c:"
   * and rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME. pathToFileURL() is the
   * portable conversion.
   */
  const offenders = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/\bimport\(\s*(join\(|resolve\(|`|path\.|__dirname|root\b)/.test(line)
          && !line.includes('pathToFileURL')) {
        offenders.push(`${f.replace(root + '/', '')}:${i + 1}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `dynamic import() given a path instead of a file URL:\n  ${offenders.join('\n  ')}`);
});

test('paths are built with node:path, not string concatenation', async () => {
  const offenders = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      // A slash glued directly onto a directory variable.
      if (/\b(root|dir|base|cwd)\s*\+\s*['"`]\//.test(line)) {
        offenders.push(`${f.replace(root + '/', '')}:${i + 1}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `hand-built paths break on Windows:\n  ${offenders.join('\n  ')}`);
});

test('no POSIX-only absolute paths are hardcoded', async () => {
  const offenders = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/['"`]\/(tmp|home|usr|var|etc|opt)\//.test(line)) {
        offenders.push(`${f.replace(root + '/', '')}:${i + 1}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `POSIX-only path:\n  ${offenders.join('\n  ')}`);
});

test('shipped shell commands do not assume bash', async () => {
  // `PORT=x cmd` is bash syntax and silently does nothing in PowerShell or cmd.
  const offenders = [];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/console\.(log|error)\(.*\b[A-Z_]{3,}=\S+\s+node\b/.test(line)
          && !line.includes('win32') && !line.includes('altPortHint')) {
        offenders.push(`${f.replace(root + '/', '')}:${i + 1}  ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `bash-only syntax shown to users without a Windows equivalent:\n  ${offenders.join('\n  ')}`);
});
