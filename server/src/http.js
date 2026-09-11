/**
 * A tiny router over Node's built-in http module.
 *
 * This replaces Express. The server was using maybe five percent of what
 * Express offers, and in exchange it pulled in a dependency tree that shipped
 * known CVEs in its query-string parser. A tool whose entire purpose is warning
 * people about risky software should not itself install a vulnerable transitive
 * dependency to serve eight routes.
 *
 * The whole project now has zero production dependencies, which also means
 * there is nothing to `npm install` before running the server.
 */

import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const MAX_BODY_BYTES = 512 * 1024;

/**
 * `PORT=8788 node ...` is bash syntax and does nothing in PowerShell or cmd,
 * where it silently starts the server on the default port again. Show the form
 * that actually works on the platform the user is standing on.
 */
function altPortHint(port) {
  if (process.platform === 'win32') {
    return `  PowerShell:  $env:PORT=${port}; node src\\index.js\n` +
           `  cmd.exe:     set PORT=${port} && node src\\index.js`;
  }
  return `  PORT=${port} node src/index.js`;
}
const GZIP_MIN_BYTES = 1024;   // below this, compression costs more than it saves

class Res {
  constructor(raw, req) {
    this.raw = raw;
    this.req = req;
    this.statusCode = 200;
    this.headers = {};
  }
  status(code) { this.statusCode = code; return this; }
  set(k, v) { this.headers[k.toLowerCase()] = v; return this; }

  /**
   * JSON responses are gzipped when worth it, and support conditional GETs.
   *
   * Both matter far more than they look. Every client polls the feed on a
   * timer, and without these the server ships the entire feed to every user on
   * every poll even when nothing has changed since the last ingest. At ten
   * thousand users that is over a terabyte a month of re-sending identical
   * bytes. With an ETag most of those polls become a 304 with no body at all.
   */
  json(obj, { etag = false } = {}) {
    const accepts = String(this.req?.headers?.['accept-encoding'] || '');
    const body = Buffer.from(JSON.stringify(obj), 'utf8');

    if (etag) {
      // Derived from the body itself rather than from a timestamp. Keying on
      // "when did the last ingest run" invalidates every client's cache every
      // cycle even when the cycle added nothing, which is most cycles. Hashing
      // the bytes means the tag changes only when the content actually does,
      // and it cannot drift out of sync with what was sent.
      const tag = `"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`;
      this.set('etag', tag);
      const ifNoneMatch = this.req?.headers?.['if-none-match'];
      if (ifNoneMatch && ifNoneMatch === tag) {
        this.raw.writeHead(304, this.headers);
        return this.raw.end();
      }
    }

    this.set('content-type', 'application/json; charset=utf-8');
    this.set('vary', 'accept-encoding');

    let out = body;
    if (body.length >= GZIP_MIN_BYTES && /\bgzip\b/.test(accepts)) {
      out = gzipSync(body, { level: 6 });
      this.set('content-encoding', 'gzip');
    }

    this.set('content-length', out.length);
    this.raw.writeHead(this.statusCode, this.headers);
    this.raw.end(out);
  }

  sendStatus(code) {
    this.raw.writeHead(code, this.headers);
    this.raw.end();
  }
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const err = new Error('payload_too_large');
      err.code = 'payload_too_large';
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('invalid_json');
    err.code = 'invalid_json';
    throw err;
  }
}

/**
 * Routes are registered as literal paths, optionally ending in a single
 * `:param` segment. That covers everything this API needs, and a pattern
 * language nobody asked for is how routers grow bugs.
 */
export function createApp() {
  const routes = [];
  const middleware = [];

  const add = (method, path, handler) => {
    const parts = path.split('/').filter(Boolean);
    routes.push({ method, parts, handler });
  };

  const app = {
    use: (fn) => { middleware.push(fn); return app; },
    get: (p, h) => { add('GET', p, h); return app; },
    post: (p, h) => { add('POST', p, h); return app; },
    notFound: null,

    listen(port, cb) {
      const server = createServer(async (rawReq, rawRes) => {
        const res = new Res(rawRes, rawReq);
        let url;
        try {
          url = new URL(rawReq.url, `http://${rawReq.headers.host || 'localhost'}`);
        } catch {
          return res.status(400).json({ error: 'bad_request' });
        }

        const req = {
          method: rawReq.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          params: {},
          body: null,
          headers: rawReq.headers,
          get: (name) => rawReq.headers[String(name).toLowerCase()],
        };

        try {
          for (const fn of middleware) {
            let advanced = false;
            await fn(req, res, () => { advanced = true; });
            if (!advanced) return;               // middleware handled the response
          }

          const parts = req.path.split('/').filter(Boolean);
          const match = routes.find((r) => {
            if (r.method !== req.method || r.parts.length !== parts.length) return false;
            return r.parts.every((p, i) => p.startsWith(':') || p === parts[i]);
          });

          if (!match) {
            if (app.notFound) return app.notFound(req, res);
            return res.status(404).json({ error: 'not_found' });
          }

          match.parts.forEach((p, i) => { if (p.startsWith(':')) req.params[p.slice(1)] = decodeURIComponent(parts[i]); });

          if (req.method === 'POST') {
            try {
              req.body = await readBody(rawReq);
            } catch (err) {
              return res.status(err.code === 'payload_too_large' ? 413 : 400).json({ error: err.code });
            }
          }

          await match.handler(req, res);
        } catch (err) {
          console.error('[http] handler error:', err.message);
          if (!rawRes.headersSent) res.status(500).json({ error: 'internal_error' });
        }
      });

      // Without this, a port clash exits with a raw "Unhandled 'error' event"
      // stack trace, which is an alarming way to tell someone they already
      // have the server running in another window.
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`\nPort ${port} is already in use.\n`);
          console.error('Almost always this means the collector is already running in another');
          console.error('terminal window. Look for one that says "listening on :' + port + '".\n');
          console.error(`If you want a second copy on a different port, run:\n${altPortHint(8788)}\n`);
        } else if (err.code === 'EACCES') {
          console.error(`\nNot allowed to listen on port ${port}. Try one above 1024:\n${altPortHint(8787)}\n`);
        } else {
          console.error(`\nCould not start the server: ${err.message}\n`);
        }
        process.exit(1);
      });

      server.listen(port, cb);
      return server;
    },
  };

  return app;
}
