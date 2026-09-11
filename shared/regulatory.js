/**
 * Regulatory cross-reference.
 *
 * A "list" here is any authoritative set of named bad actors, bad domains, or
 * known-exploited software. The server keeps these in one normalized shape so
 * that adding a source is a config change rather than a code change:
 *
 *   {
 *     list:      'FTC_ENFORCEMENT',
 *     entity:    'Humboldt Merchant Services',
 *     aliases:   ['Humboldt Merchant'],
 *     domains:   ['hbms.com'],
 *     action:    'FTC enforcement action',
 *     severity:  'high' | 'medium' | 'low',
 *     date:      '2026-09-08',
 *     url:       'https://www.ftc.gov/...'
 *   }
 *
 * Severity maps to points. A domain match is worth much more than a name match,
 * because names collide and domains do not.
 */

const SEVERITY_POINTS = { high: 45, medium: 28, low: 15 };

/** Words too common to be worth matching on their own. */
const STOPWORDS = new Set([
  'inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'co', 'group',
  'holdings', 'international', 'services', 'service', 'solutions', 'systems',
  'technologies', 'technology', 'global', 'partners', 'capital', 'financial',
  'the', 'and', 'of', 'for', 'llp', 'plc', 'gmbh', 'sa', 'bv', 'pte',
]);

function tokenize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/** Build a lookup index once, then reuse it for every item scored. */
export function buildIndex(entries = []) {
  const byDomain = new Map();
  const byToken = new Map();
  const all = [];

  for (const e of entries) {
    if (!e || !e.entity) continue;
    const rec = {
      list: e.list || 'UNKNOWN',
      entity: e.entity,
      aliases: e.aliases || [],
      domains: (e.domains || []).map((d) => String(d).toLowerCase().replace(/^www\./, '')),
      action: e.action || 'Listed by a regulator',
      severity: e.severity || 'medium',
      date: e.date || null,
      url: e.url || null,
    };
    all.push(rec);

    for (const d of rec.domains) {
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(rec);
    }

    const names = [rec.entity, ...rec.aliases];
    for (const n of names) {
      const toks = tokenize(n);
      // Index on the rarest-looking token pair so we do not match on "capital".
      const key = toks.slice(0, 3).join(' ');
      if (!key) continue;
      if (!byToken.has(key)) byToken.set(key, []);
      byToken.get(key).push({ ...rec, _key: key, _tokens: toks });
    }
  }

  return { byDomain, byToken, size: all.length, entries: all };
}

/**
 * @param {object} target { text, domains: string[] }
 * @param {object} index  from buildIndex()
 */
export function crossReference(target = {}, index) {
  const matches = [];
  if (!index || !index.size) return { score: 0, matches, listSize: 0 };

  const seen = new Set();
  const push = (rec, how, detail) => {
    const key = `${rec.list}|${rec.entity}|${how}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({
      list: rec.list,
      entity: rec.entity,
      action: rec.action,
      severity: rec.severity,
      date: rec.date,
      url: rec.url,
      matchedOn: how,
      detail,
      points: how === 'domain' ? SEVERITY_POINTS[rec.severity] || 28 : Math.round((SEVERITY_POINTS[rec.severity] || 28) * 0.55),
    });
  };

  // Domain matching, including parent-domain suffix.
  for (const raw of target.domains || []) {
    const d = String(raw).toLowerCase().replace(/^www\./, '');
    if (index.byDomain.has(d)) {
      for (const rec of index.byDomain.get(d)) push(rec, 'domain', `${d} appears on ${rec.list}.`);
      continue;
    }
    const parts = d.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parent = parts.slice(i).join('.');
      if (index.byDomain.has(parent)) {
        for (const rec of index.byDomain.get(parent)) push(rec, 'domain', `${d} sits under ${parent}, which appears on ${rec.list}.`);
        break;
      }
    }
  }

  // Entity-name matching against the text body.
  const text = String(target.text || '').toLowerCase();
  if (text.length > 20) {
    for (const [key, recs] of index.byToken) {
      const toks = key.split(' ');
      if (toks.length < 2) continue; // single-token names are too noisy
      const allPresent = toks.every((t) => text.includes(t));
      if (!allPresent) continue;
      // Require the tokens to appear near each other, not scattered.
      const first = text.indexOf(toks[0]);
      const window = text.slice(Math.max(0, first - 60), first + 160);
      if (!toks.every((t) => window.includes(t))) continue;
      for (const rec of recs) push(rec, 'entity', `"${rec.entity}" is named on ${rec.list}: ${rec.action}.`);
    }
  }

  matches.sort((a, b) => b.points - a.points);
  const raw = matches.slice(0, 4).reduce((s, m, i) => s + m.points * (i === 0 ? 1 : 0.4), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-raw / 35)))));
  return { score, matches: matches.slice(0, 8), listSize: index.size };
}

/**
 * Derive list entries from enforcement press releases we already ingest.
 * FTC and SEC title conventions are stable enough to pull a defendant name out
 * of, and this is what keeps the list fresh without a paid data provider.
 */
export function deriveEntriesFromEnforcement(item) {
  const out = [];
  const t = item.title || '';
  const src = (item.source || '').toUpperCase();

  const patterns = [
    /(?:Action|Charges?|Complaint|Suit|Case)\s+Against\s+([A-Z][\w.,'&\- ]{3,70}?)(?:\s+for\b|\s+Over\b|,|$)/,
    /^SEC\s+(?:Charges|Sues|Files\s+Charges\s+Against)\s+([A-Z][\w.,'&\- ]{3,70}?)(?:\s+(?:for|with|in|over)\b|,|$)/,
    /^FTC\s+(?:Sues|Charges)\s+([A-Z][\w.,'&\- ]{3,70}?)(?:\s+(?:for|over)\b|,|$)/,
    /^([A-Z][\w.,'&\- ]{3,70}?)\s+(?:to\s+Pay|Must\s+Pay|Agrees\s+to\s+Pay|Will\s+Pay|Settles)\b/,
    /(?:Operators?\s+of|Behind)\s+([A-Z][\w.,'&\- ]{3,70}?)(?:\s+(?:Scheme|Fraud|Operation)\b|,|$)/,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m && m[1]) {
      const entity = m[1].replace(/\s+/g, ' ').trim().replace(/[,.]$/, '');
      if (tokenize(entity).length >= 2) {
        out.push({
          list: src.includes('SEC') ? 'SEC_ENFORCEMENT' : src.includes('CFPB') ? 'CFPB_ENFORCEMENT' : 'FTC_ENFORCEMENT',
          entity,
          domains: [],
          action: t.slice(0, 200),
          severity: 'high',
          date: item.publishedAt ? String(item.publishedAt).slice(0, 10) : null,
          url: item.url || null,
        });
      }
      break;
    }
  }
  return out;
}
