/**
 * A minimal ZIP writer, in pure Node.
 *
 * The release build previously shelled out to the `zip` binary, which does not
 * exist on Windows. Rather than add a dependency to a project that deliberately
 * has none, or tell Windows users to zip a folder by hand and hope they pick
 * the right one, the format is written directly. It is not a complicated
 * format: a local header and deflated bytes per entry, then a central directory
 * describing them, then a record saying where the directory starts.
 *
 * Deliberately not supported: ZIP64 (entries and archives are kilobytes),
 * encryption, and anything to do with reading archives.
 */

import { deflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/* CRC-32. node:zlib gained crc32 relatively recently, so fall back when absent. */
let TABLE = null;
function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[i] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** ZIP stores timestamps in the 1980-epoch MS-DOS format. */
function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2)),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

async function walk(dir, base, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) await walk(abs, base, out);
    else if (e.isFile()) out.push(abs);
  }
  return out;
}

/**
 * Zip the contents of `sourceDir` into `zipPath`.
 * Paths inside the archive are relative to sourceDir, always forward-slashed,
 * because a backslash in a ZIP entry name is not portable.
 *
 * @param {string} sourceDir
 * @param {string} zipPath
 * @param {(relPath: string) => boolean} [filter] return false to skip a file
 * @returns {Promise<{ entries: number, bytes: number }>}
 */
export async function zipDirectory(sourceDir, zipPath, filter) {
  const files = (await walk(sourceDir, sourceDir)).sort();
  const locals = [];
  const central = [];
  let offset = 0;

  for (const abs of files) {
    const rel = relative(sourceDir, abs).split(sep).join('/');
    if (filter && !filter(rel)) continue;

    const data = await readFile(abs);
    const { mtime, mode: fileMode } = await stat(abs);
    const { time, date } = dosDateTime(mtime);
    const crc = crc32(data);

    // Store rather than deflate when compression does not help, which is the
    // normal outcome for already-compressed data such as PNGs.
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const name = Buffer.from(rel, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra field length

    locals.push(local, name, body);

    const dirent = Buffer.alloc(46);
    dirent.writeUInt32LE(0x02014b50, 0);  // central directory signature
    dirent.writeUInt16LE(20, 4);          // version made by
    dirent.writeUInt16LE(20, 6);          // version needed
    dirent.writeUInt16LE(0x0800, 8);
    dirent.writeUInt16LE(method, 10);
    dirent.writeUInt16LE(time, 12);
    dirent.writeUInt16LE(date, 14);
    dirent.writeUInt32LE(crc, 16);
    dirent.writeUInt32LE(body.length, 20);
    dirent.writeUInt32LE(data.length, 24);
    dirent.writeUInt16LE(name.length, 28);
    dirent.writeUInt16LE(0, 30);          // extra
    dirent.writeUInt16LE(0, 32);          // comment
    dirent.writeUInt16LE(0, 34);          // disk number
    dirent.writeUInt16LE(0, 36);          // internal attrs
    /*
     * External attributes: the unix mode goes in the high 16 bits.
     *
     * Preserving the executable bit matters here. The double-click launchers
     * for macOS and Linux are useless if they come out of the archive
     * non-executable, and "chmod +x" is exactly the terminal step this is all
     * meant to avoid.
     *
     * The >>> 0 matters too: JavaScript's << returns a signed 32-bit value, so
     * mode << 16 overflows into the negatives without it.
     */
    const unixMode = (fileMode & 0o777) || 0o644;
    dirent.writeUInt32LE((((0o100000 | unixMode) << 16) >>> 0), 38);
    dirent.writeUInt32LE(offset, 42);     // offset of local header

    central.push(dirent, name);
    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const count = central.length / 2;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);       // end of central directory
  end.writeUInt16LE(0, 4);                // disk number
  end.writeUInt16LE(0, 6);                // disk with central directory
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);               // comment length

  const archive = Buffer.concat([...locals, centralBuf, end]);
  await writeFile(zipPath, archive);
  return { entries: count, bytes: archive.length };
}
