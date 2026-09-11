/**
 * Minimal RSS 2.0 / Atom parser and HTML-to-text extractor.
 *
 * Hand-rolled on purpose: the whole server has one production dependency, so
 * there is no supply-chain surface in a tool whose entire job is warning people
 * about supply-chain surface.
 */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  hellip: '…', mdash: '—', ndash: '–', middot: '·',
};

export function decodeEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENTITIES[n.toLowerCase()] !== undefined ? ENTITIES[n.toLowerCase()] : m));
}

function safeChar(code) {
  try {
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

function stripCdata(s) {
  return String(s || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
}

/** Pull the text content of the first <tag> inside a chunk. */
function tag(chunk, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = chunk.match(re);
  return m ? decodeEntities(stripCdata(m[1])).trim() : '';
}

/** Pull an attribute off the first matching self-closing or open tag. */
function tagAttr(chunk, name, attr) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'i');
  const m = chunk.match(re);
  if (!m) return '';
  const a = m[1].match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return a ? decodeEntities(a[1]).trim() : '';
}

/** Atom links carry rel/type; prefer rel="alternate" text/html. */
function atomLink(chunk) {
  const links = [...chunk.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const parse = (attrs) => {
    const get = (k) => {
      const a = attrs.match(new RegExp(`${k}\\s*=\\s*["']([^"']*)["']`, 'i'));
      return a ? a[1] : '';
    };
    return { rel: get('rel') || 'alternate', type: get('type'), href: get('href') };
  };
  const parsed = links.map(parse).filter((l) => l.href);
  const alt = parsed.find((l) => l.rel === 'alternate' && (!l.type || l.type.includes('html')));
  return decodeEntities((alt || parsed[0] || {}).href || '');
}

export function htmlToText(html, maxLen = 12000) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<(script|style|noscript|svg|iframe|form)\b[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  return s.slice(0, maxLen);
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * @returns {{ format: 'rss'|'atom'|null, title: string, items: Array }}
 */
export function parseFeed(xml) {
  if (typeof xml !== 'string' || xml.length < 20) {
    return { format: null, title: '', items: [] };
  }
  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(xml)
    || (/<feed\b/i.test(xml) && !/<rss\b/i.test(xml));

  const itemTag = isAtom ? 'entry' : 'item';
  const chunks = [...xml.matchAll(new RegExp(`<${itemTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${itemTag}>`, 'gi'))].map((m) => m[1]);

  const channelChunk = isAtom
    ? xml.slice(0, xml.search(/<entry\b/i) >= 0 ? xml.search(/<entry\b/i) : 4000)
    : (xml.match(/<channel(?:\s[^>]*)?>([\s\S]*?)(?=<item\b)/i) || [, xml.slice(0, 4000)])[1];

  const feedTitle = tag(channelChunk || '', 'title');

  const items = chunks.map((c) => {
    const title = tag(c, 'title');
    const link = isAtom ? atomLink(c) : (tag(c, 'link') || tagAttr(c, 'link', 'href'));
    const rawSummary = isAtom
      ? (tag(c, 'summary') || tag(c, 'content'))
      : (tag(c, 'content:encoded') || tag(c, 'description'));
    const published = parseDate(
      isAtom ? (tag(c, 'published') || tag(c, 'updated'))
             : (tag(c, 'pubDate') || tag(c, 'dc:date')),
    );
    const guid = tag(c, isAtom ? 'id' : 'guid') || link || title;
    const categories = [...c.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)]
      .map((m) => decodeEntities(stripCdata(m[1])).trim())
      .filter(Boolean)
      .slice(0, 8);
    const atomCats = [...c.matchAll(/<category\b[^>]*term\s*=\s*["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]));

    return {
      guid,
      title,
      url: link,
      summary: htmlToText(rawSummary, 4000),
      publishedAt: published,
      categories: [...new Set([...categories, ...atomCats])].slice(0, 8),
    };
  }).filter((i) => i.title || i.url);

  return { format: isAtom ? 'atom' : 'rss', title: feedTitle, items };
}
