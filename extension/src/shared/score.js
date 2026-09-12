/* GENERATED FILE - do not edit.
   Source of truth: /shared/score.js
   Regenerate with: npm run build
*/
/**
 * Composite risk assessment.
 *
 * Every assessable thing (a news item, a live site, an installed extension)
 * resolves to the same result shape so the ticker can render all three
 * identically and the detail panel needs only one template.
 *
 * Four passes are scored and weighted:
 *   behavioral  - manipulation language in the text (what a scam sounds like)
 *   incident    - what actually happened and at what scale (news pathway)
 *   structural  - what the domain or the permission set gives away
 *   regulatory  - matches against enforcement and advisory lists
 *
 * A fifth input, source confidence, is deliberately NOT additive. Publisher
 * authority tells you how much to trust the finding, not how dangerous the
 * subject is, so it multiplies the composite instead of adding to it.
 * Additive provenance was giving a procedural FTC notice the same score as an
 * SEC Ponzi charge, which is exactly the failure this design avoids.
 */

import { analyzeText } from './lexicon.js';
import { analyzeIncident } from './incident.js';
import { analyzeDomain, analyzeExtension, parseHost } from './structural.js';
import { crossReference } from './regulatory.js';

export const BANDS = [
  { id: 'low',      min: 0,  label: 'Low',      color: '#16a34a', text: '#062e13' },
  { id: 'elevated', min: 25, label: 'Elevated', color: '#f59e0b', text: '#2a2000' },
  { id: 'high',     min: 50, label: 'High',     color: '#f97316', text: '#2b1200' },
  { id: 'severe',   min: 75, label: 'Severe',   color: '#dc2626', text: '#ffffff' },
];

export function bandFor(score) {
  let out = BANDS[0];
  for (const b of BANDS) if (score >= b.min) out = b;
  return out;
}

/** How much the publisher itself is worth, 0..1. */
const SOURCE_AUTHORITY = {
  FTC: 1.0, FTC_CONSUMER: 1.0, SEC: 1.0, CFPB: 1.0, FCC: 1.0, IC3: 1.0, DOJ: 1.0,
  CISA: 0.95,
  KREBS: 0.8, BLEEPINGCOMPUTER: 0.75, THEHACKERNEWS: 0.7,
  USER_SUBMITTED: 0.3, PAGE_SCAN: 0.5, EXTENSION_AUDIT: 0.9,
};

/** Weights per kind, each summing to 1 across the four scored passes. */
const WEIGHTS = {
  news:      { behavioral: 0.20, incident: 0.44, structural: 0.06, regulatory: 0.30 },
  site:      { behavioral: 0.36, incident: 0.04, structural: 0.40, regulatory: 0.20 },
  extension: { behavioral: 0.04, incident: 0.00, structural: 0.68, regulatory: 0.28 },
};

function confidenceFor(input, kind) {
  const src = (input.source || '').toUpperCase();
  const authority = SOURCE_AUTHORITY[src] ?? 0.5;
  const notes = [];

  // A local measurement is exactly as reliable as what it measured. Nothing to
  // discount, so these carry no multiplier at all.
  if (kind === 'site') {
    notes.push({ label: 'Live page assessment', detail: 'Scored from the hostname, and from visible page text only if you switched that on. Nothing but the domain left your browser.' });
    return { multiplier: 1, authority, notes };
  }
  if (kind === 'extension') {
    notes.push({ label: 'Local extension audit', detail: 'Scored from the permissions this extension already holds in your browser. Nothing was fetched about it.' });
    return { multiplier: 1, authority, notes };
  }

  if (authority >= 0.95) {
    notes.push({ label: 'Primary regulatory source', detail: `Published directly by ${input.sourceName || src}, not a secondhand report, so the specifics can be taken at face value.` });
  } else if (authority >= 0.7) {
    notes.push({ label: 'Established security press', detail: `${input.sourceName || src} has a track record of verified reporting, but the underlying documents are worth checking.` });
  } else {
    notes.push({ label: 'Secondary source', detail: 'Treat the specifics as unconfirmed until a primary source is located.' });
  }
  if (input.enforcement) {
    notes.push({ label: 'Enforcement channel', detail: 'This feed carries formal regulatory actions, so the conduct described has been acted on rather than merely alleged by a third party.' });
  }

  const multiplier = Number((0.72 + authority * 0.36).toFixed(3));
  return { multiplier, authority, notes };
}

/**
 * @param {object} input
 *   kind: 'news' | 'site' | 'extension'
 *   title, summary, body, url, source, sourceName, publishedAt, enforcement
 *   domainInfo (site), extensionInfo (extension), extraDomains
 * @param {object} regIndex from regulatory.buildIndex()
 */
export function assess(input = {}, regIndex = null) {
  const kind = input.kind || 'news';
  const w = WEIGHTS[kind] || WEIGHTS.news;

  const text = [input.title, input.summary, input.body].filter(Boolean).join('\n\n');

  const behavioral = analyzeText(text);
  const incident = w.incident > 0 ? analyzeIncident(text) : { score: 0, hits: [], categories: [] };

  /*
   * For a news item, `url` is the PUBLISHER's address. Scoring sec.gov or
   * krebsonsecurity.com structurally says nothing about the story and only
   * adds a guaranteed-zero pass that dilutes everything else, so the news
   * pathway examines only domains the article is actually about, supplied by
   * the caller in extraDomains.
   */
  const subjectDomain = input.domainInfo
    || (kind === 'news'
      ? (input.extraDomains?.[0] ? { host: input.extraDomains[0] } : null)
      : { url: input.url });

  const structural = kind === 'extension'
    ? analyzeExtension(input.extensionInfo || {})
    : analyzeDomain(subjectDomain || {});

  const domains = [];
  if (structural.registrable) domains.push(structural.registrable);
  if (structural.host) domains.push(structural.host);
  for (const d of input.extraDomains || []) domains.push(d);

  const regulatory = crossReference({ text, domains }, regIndex);
  const confidence = confidenceFor(input, kind);

  /*
   * Renormalize over the passes that actually had something to examine.
   *
   * A pass that could not run is absence of evidence, not evidence of safety.
   * Weighting an unrunnable pass at zero silently caps the maximum achievable
   * score: with no URL and no regulatory list loaded, a news item could never
   * exceed 64 no matter how severe the incident. So inapplicable weight is
   * redistributed across the passes that did run.
   *
   * An index that ran and found nothing IS applicable and correctly dilutes:
   * we checked, and the subject was not listed. A near-empty index has not
   * meaningfully checked anything, so it only counts once it either holds a
   * real corpus or produces a match.
   */
  const applicable = {
    behavioral: text.trim().length > 0,
    incident: w.incident > 0 && text.trim().length > 0,
    structural: kind === 'extension'
      ? Object.keys(input.extensionInfo || {}).length > 0
      : Boolean(structural.host),
    regulatory: (regulatory.listSize >= 50) || regulatory.matches.length > 0,
  };

  const live = Object.entries(w).filter(([k, weight]) => weight > 0 && applicable[k]);
  const liveTotal = live.reduce((a, [, weight]) => a + weight, 0);
  const norm = liveTotal > 0 ? 1 / liveTotal : 0;

  const scores = { behavioral, incident, structural, regulatory };
  const weighted = live.reduce((a, [k, weight]) => a + scores[k].score * weight * norm, 0);

  let score = Math.round(Math.max(0, Math.min(100, weighted * confidence.multiplier)));

  // Floors. A confirmed regulatory domain hit is never a green item, and a
  // severe permission profile is never green either.
  if (regulatory.matches.some((m) => m.matchedOn === 'domain' && m.severity === 'high')) {
    score = Math.max(score, 78);
  }
  if (kind === 'extension' && structural.score >= 80) score = Math.max(score, 72);
  if (kind === 'site' && structural.findings.some((f) => f.weight >= 26)) score = Math.max(score, 62);

  const band = bandFor(score);

  const sig = (key, s, weight, extra) => {
    const effective = applicable[key] && weight > 0 ? weight * norm : 0;
    return {
      score: s.score,
      weight,                                        // nominal, before renormalization
      effectiveWeight: Number(effective.toFixed(4)), // share of this particular assessment
      applicable: !!applicable[key],
      contribution: Math.round(s.score * effective * confidence.multiplier),
      ...extra,
    };
  };

  return {
    score,
    band: band.id,
    bandLabel: band.label,
    color: band.color,
    kind,
    signals: {
      behavioral: sig('behavioral', behavioral, w.behavioral, { categories: behavioral.categories, hits: behavioral.hits }),
      incident: sig('incident', incident, w.incident, { categories: incident.categories, hits: incident.hits }),
      structural: sig('structural', structural, w.structural, { findings: structural.findings, host: structural.host || null }),
      regulatory: sig('regulatory', regulatory, w.regulatory, { matches: regulatory.matches, listSize: regulatory.listSize }),
      confidence: {
        multiplier: confidence.multiplier,
        authority: confidence.authority,
        notes: confidence.notes,
      },
    },
    headline: input.title || buildHeadline(input, { structural, band, kind }),
  };
}

function buildHeadline(input, ctx) {
  if (ctx.kind === 'site') return `${ctx.structural.host || 'This site'}: ${ctx.band.label.toLowerCase()} risk`;
  if (ctx.kind === 'extension') return `${input.extensionInfo?.name || 'Extension'}: ${ctx.band.label.toLowerCase()} risk`;
  return 'Unclassified item';
}

/** One-line rationale for the ticker tooltip and the top of the detail panel. */
export function explain(result) {
  const s = result.signals;
  const parts = [
    [s.regulatory.contribution, s.regulatory.matches.length, (n) => `${n} regulatory list match${n === 1 ? '' : 'es'}`],
    [s.incident.contribution, s.incident.categories.length, (n) => `${n} incident indicator${n === 1 ? '' : 's'}`],
    [s.structural.contribution, s.structural.findings.length, (n) => `${n} structural finding${n === 1 ? '' : 's'}`],
    [s.behavioral.contribution, s.behavioral.categories.length, (n) => `${n} manipulation pattern${n === 1 ? '' : 's'}`],
  ]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(([, n, fmt]) => fmt(n));

  return parts.length ? `${parts.join(', ')}.` : 'No adverse signals detected.';
}

export { parseHost };
