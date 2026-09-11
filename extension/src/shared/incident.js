/* GENERATED FILE - do not edit.
   Source of truth: /shared/incident.js
   Regenerate with: npm run build
*/
/**
 * Incident severity.
 *
 * The behavioral lexicon scores manipulation language, which is what a scam
 * itself sounds like. A news article *about* a scam sounds nothing like that:
 * it is written in reportorial prose and trips almost none of it. Without this
 * pass, "SEC Charges Northstar With Operating a Ponzi Scheme" scores the same
 * as "FTC Extends Public Comment Period", which makes the crawl useless.
 *
 * So this pass answers a different question: what actually happened, how bad
 * is it, and how many people does it touch?
 */

export const INCIDENT_CATEGORIES = {
  criminal: { label: 'Criminal proceeding', cap: 40, context: 'Charges, arrests, indictments, pleas, or sentencing. The conduct is established well past allegation.' },
  enforcement: { label: 'Regulatory enforcement', cap: 34, context: 'A regulator has formally acted: a suit, a settlement, an injunction, or an asset freeze.' },
  scheme: { label: 'Named fraud scheme', cap: 36, context: 'The article names a recognized fraud structure rather than describing a general risk.' },
  victim_loss: { label: 'Confirmed victim losses', cap: 34, context: 'Money was actually taken from identified victims.' },
  active_threat: { label: 'Active exploitation', cap: 38, context: 'An attack is underway right now rather than being theoretically possible.' },
  exposure: { label: 'Data exposure', cap: 28, context: 'Personal or credential data has been exposed or is being traded.' },
  targeting: { label: 'Targets a vulnerable group', cap: 26, context: 'The campaign is aimed at people less able to absorb the loss or spot the pretext.' },
  advisory: { label: 'Official advisory', cap: 18, context: 'A warning issued to the public or to industry, ahead of or alongside harm.' },
  magnitude: { label: 'Scale', cap: 34, context: 'The reported dollar value or number of people affected.' },
  procedural: { label: 'Procedural or administrative', cap: 0, context: 'Rulemaking, comment periods, appointments, meetings. No incident.' },
};

const P = [
  // criminal
  { c: 'criminal', w: 24, re: /\b(?:indicted|indictment|arrested|arrests?|charged\s+criminally|criminal\s+charges)\b/i, note: 'Arrests or indictments' },
  { c: 'criminal', w: 26, re: /\b(?:pleaded|pled)\s+guilty|guilty\s+plea|convicted|conviction\b/i, note: 'Conviction or guilty plea' },
  { c: 'criminal', w: 24, re: /\bsentenced\s+to\b|\bprison\s+(?:term|sentence)\b/i, note: 'Sentencing' },
  { c: 'criminal', w: 20, re: /\b(?:extradited|takedown|seized\s+(?:domains?|servers?)|dismantled)\b/i, note: 'Law enforcement takedown' },

  // enforcement
  { c: 'enforcement', w: 20, re: /\b(?:sues?|sued|files?\s+(?:suit|complaint|charges)|takes?\s+action\s+against)\b/i, note: 'Regulator filed an action' },
  { c: 'enforcement', w: 20, re: /\b(?:SEC|FTC|CFPB|DOJ|FCC|Commission|Bureau)\s+(?:charges|charged|accuses|alleges)\b/i, note: 'Agency brought charges' },
  { c: 'enforcement', w: 18, re: /\b(?:settle(?:s|d|ment)|consent\s+order|stipulated\s+judgment)\b/i, note: 'Settlement or consent order' },
  { c: 'enforcement', w: 22, re: /\b(?:asset\s+freeze|temporary\s+restraining\s+order|preliminary\s+injunction|receiver\s+appointed)\b/i, note: 'Assets frozen or receiver appointed' },
  { c: 'enforcement', w: 18, re: /\b(?:must\s+pay|ordered\s+to\s+pay|agrees\s+to\s+pay|civil\s+penalty|disgorge\w*)\b/i, note: 'Monetary judgment or penalty' },
  { c: 'enforcement', w: 16, re: /\b(?:banned|barred|permanently\s+enjoined)\s+from\b/i, note: 'Industry ban' },

  // scheme
  { c: 'scheme', w: 26, re: /\b(?:ponzi|pyramid)\s+scheme\b/i, note: 'Ponzi or pyramid scheme' },
  { c: 'scheme', w: 22, re: /\b(?:pig\s+butchering|romance\s+(?:scam|fraud))\b/i, note: 'Romance or pig-butchering fraud' },
  { c: 'scheme', w: 20, re: /\b(?:business\s+email\s+compromise|bec)\b/i, note: 'Business email compromise' },
  { c: 'scheme', w: 20, re: /\b(?:advance[\s-]fee|affinity)\s+(?:fraud|scheme|scam)\b/i, note: 'Advance-fee or affinity fraud' },
  { c: 'scheme', w: 18, re: /\b(?:tech\s+support|grandparent|imposter|impersonation)\s+(?:scam|fraud|scheme)\b/i, note: 'Impersonation-based scam' },
  { c: 'scheme', w: 18, re: /\b(?:money\s+laundering|mule\s+network|shell\s+compan(?:y|ies))\b/i, note: 'Laundering infrastructure' },
  { c: 'scheme', w: 18, re: /\b(?:wire|securities|investment|mail|bank)\s+fraud\b/i, note: 'Named fraud offense' },
  { c: 'scheme', w: 16, re: /\b(?:fake|sham|fraudulent|counterfeit|spoofed|cloned|malicious)\s+(?:websites?|web\s?pages?|pages?|sites?|stores?|shops?|merchants?|apps?|extensions?|invoices?|dealerships?|profiles?|listings?|emails?|texts?|job\s+offers?|support\s+numbers?|login\s+pages?)\b/i, note: 'Fraudulent sites, apps, or listings' },
  // Campaigns described in the press rarely use enforcement vocabulary, so
  // match how a threat article actually reads.
  { c: 'scheme', w: 18, re: /\b(?:scams?|frauds?|schemes?)\b.{0,30}\b(?:targeting|aimed\s+at|move[sd]?\s+(?:from|to)|spreading|surge|surging|rise|rising|network|ring|operation|campaign)\b/i, note: 'An active scam trend or operation' },
  { c: 'scheme', w: 16, re: /\b(?:job|employment|task|investment|crypto|refund|delivery|toll|utility)\s+scams?\b/i, note: 'Named consumer scam category' },

  // victim_loss
  { c: 'victim_loss', w: 22, re: /\b(?:defrauded|bilked|swindled|scammed)\s+(?:consumers|investors|victims|users|customers|out\s+of)\b/i, note: 'Victims were defrauded' },
  { c: 'victim_loss', w: 22, re: /\b(?:stole|stolen|steals?|stealing|drains?|drained|draining|siphon\w*|empt(?:y|ies|ied)|wipe[ds]?\s+out)\b.{0,45}\b(?:funds|money|wallets?|accounts?|savings|deposits|balances?|crypto\w*|millions?|billions?)\b/i, note: 'Funds taken' },
  { c: 'victim_loss', w: 20, re: /\b(?:wallets?|accounts?|balances?)\s+(?:were\s+|are\s+|is\s+|was\s+)?(?:drained|emptied|cleaned\s+out|wiped)\b/i, note: 'Accounts or wallets emptied' },
  { c: 'victim_loss', w: 10, re: /\bvictims?\b/i, note: 'Identified victims' },
  { c: 'victim_loss', w: 18, re: /\b(?:losses|lost)\s+(?:of\s+)?(?:more\s+than\s+)?\$[\d,.]+\s*(?:million|billion|thousand|m|b|k)?\b/i, note: 'Quantified losses' },
  { c: 'victim_loss', w: 16, re: /\brefunds?\s+(?:to|for)\s+(?:consumers|victims|customers)\b/i, note: 'Consumer redress ordered' },

  // active_threat
  { c: 'active_threat', w: 28, re: /\b(?:actively\s+exploited|exploited\s+in\s+(?:the\s+wild|attacks)|zero[\s-]day)\b/i, note: 'Exploited in the wild' },
  { c: 'active_threat', w: 24, re: /\bransomware\b/i, note: 'Ransomware activity' },
  { c: 'active_threat', w: 22, re: /\b(?:ongoing|active|widespread)\s+(?:campaign|attacks?|targeting|phishing)\b/i, note: 'Campaign underway' },
  { c: 'active_threat', w: 20, re: /\b(?:malware|infostealer|backdoor|trojan|rootkit|keylogger)\b/i, note: 'Malware involved' },
  { c: 'active_threat', w: 20, re: /\b(?:supply[\s-]chain\s+(?:attack|compromise)|malicious\s+(?:extensions?|packages?|updates?))\b/i, note: 'Supply-chain compromise' },
  { c: 'active_threat', w: 18, re: /\b(?:account\s+takeovers?|credential\s+stuffing|session\s+hijack\w*)\b/i, note: 'Account takeover activity' },
  { c: 'active_threat', w: 18, re: /\b(?:phishing|smishing|vishing|spoofing|spoofed?|impersonat\w+)\b/i, note: 'Phishing or impersonation technique in use' },
  { c: 'active_threat', w: 16, re: /\b(?:wallet[\s-]?drain\w*|approval\s+(?:phishing|scam)|seed\s+phrase\s+theft)\b/i, note: 'Wallet-draining technique' },

  // exposure
  { c: 'exposure', w: 20, re: /\b(?:data\s+breach|breached|exposed)\b.{0,50}\b(?:records?|accounts?|customers?|users?|patients?)\b/i, note: 'Records exposed' },
  { c: 'exposure', w: 18, re: /\b(?:leaked|for\s+sale\s+on|posted\s+to)\b.{0,40}\b(?:dark\s+web|forum|marketplace)\b/i, note: 'Data offered for sale' },
  { c: 'exposure', w: 16, re: /\b(?:social\s+security\s+numbers|drivers?\s+licenses?|passport\s+numbers|payment\s+card\s+data)\b/i, note: 'Identity documents involved' },

  // targeting
  { c: 'targeting', w: 20, re: /\b(?:elder(?:ly)?|senior\s+citizens?|older\s+adults?)\b.{0,40}\b(?:fraud|scam|target\w*|victim\w*)\b/i, note: 'Targets older adults' },
  { c: 'targeting', w: 18, re: /\b(?:veterans?|immigrants?|students?|job\s+seekers?|small\s+businesses)\b.{0,40}\b(?:target\w*|scam\w*|fraud)\b/i, note: 'Targets a specific vulnerable group' },
  { c: 'targeting', w: 16, re: /\b(?:critical\s+infrastructure|hospitals?|schools?|utilities)\b.{0,40}\b(?:target\w*|attack\w*|breach\w*)\b/i, note: 'Targets critical services' },

  // advisory
  { c: 'advisory', w: 14, re: /\b(?:warns?|warning|alert|advisory|urges?|public\s+service\s+announcement)\b/i, note: 'Official warning issued' },
  { c: 'advisory', w: 12, re: /\b(?:what\s+to\s+(?:know|watch\s+for)|how\s+to\s+(?:spot|avoid|protect))\b/i, note: 'Consumer guidance' },

  // procedural: negative weight, pulls administrative noise back down
  { c: 'procedural', w: -18, re: /\b(?:comment\s+period|request\s+for\s+comment|proposed\s+rule(?:making)?|final\s+rule|notice\s+of\s+proposed)\b/i, note: 'Rulemaking or comment period' },
  { c: 'procedural', w: -16, re: /\b(?:appoints?|appointed|names?\s+new|to\s+host|roundtable|advisory\s+committee|will\s+testify|remarks\s+(?:to|at)|agenda\s+and\s+panelists)\b/i, note: 'Administrative or scheduling notice' },
  { c: 'procedural', w: -12, re: /\b(?:annual\s+report|workshop|public\s+meeting|solicits?\s+(?:input|nominations))\b/i, note: 'Routine publication' },
];

/** Dollar and headcount magnitude, parsed rather than pattern-matched. */
function magnitude(text) {
  const out = [];
  let points = 0;

  const money = [...text.matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s*(billion|million|thousand|b|m|k)?\b/gi)];
  let maxUsd = 0;
  for (const m of money) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || '').toLowerCase();
    const mult = unit.startsWith('b') ? 1e9 : unit.startsWith('m') ? 1e6 : unit.startsWith('k') || unit.startsWith('t') ? 1e3 : 1;
    maxUsd = Math.max(maxUsd, n * mult);
  }
  if (maxUsd >= 1e9) { points += 26; out.push({ label: 'Losses or penalties in the billions', detail: fmtUsd(maxUsd) }); }
  else if (maxUsd >= 1e8) { points += 20; out.push({ label: 'Losses or penalties over $100 million', detail: fmtUsd(maxUsd) }); }
  else if (maxUsd >= 1e6) { points += 14; out.push({ label: 'Losses or penalties in the millions', detail: fmtUsd(maxUsd) }); }
  else if (maxUsd >= 1e5) { points += 8; out.push({ label: 'Six-figure sum reported', detail: fmtUsd(maxUsd) }); }

  const people = [...text.matchAll(/\b([\d,]{3,})\s*(?:\+|plus)?\s*(million|thousand)?\s+(?:victims|consumers|customers|people|users|accounts|records|investors)\b/gi)];
  let maxPeople = 0;
  for (const m of people) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const unit = (m[2] || '').toLowerCase();
    maxPeople = Math.max(maxPeople, n * (unit === 'million' ? 1e6 : unit === 'thousand' ? 1e3 : 1));
  }
  if (maxPeople >= 1e6) { points += 20; out.push({ label: 'Millions of people affected', detail: `${Math.round(maxPeople / 1e6)} million` }); }
  else if (maxPeople >= 1e4) { points += 12; out.push({ label: 'Tens of thousands affected', detail: maxPeople.toLocaleString() }); }
  else if (maxPeople >= 1e3) { points += 7; out.push({ label: 'Thousands affected', detail: maxPeople.toLocaleString() }); }

  return { points, notes: out };
}

function fmtUsd(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} billion`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 2)} million`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function analyzeIncident(text) {
  const hits = [];
  const categories = [];
  if (!text || typeof text !== 'string') return { score: 0, hits, categories };

  const hay = text.replace(/\s+/g, ' ').slice(0, 40000);
  const perCat = new Map();

  for (const p of P) {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g');
    const m = re.exec(hay);
    if (!m) continue;
    const start = Math.max(0, m.index - 30);
    hits.push({
      category: p.c,
      categoryLabel: INCIDENT_CATEGORIES[p.c].label,
      note: p.note,
      weight: p.w,
      evidence: hay.slice(start, Math.min(hay.length, m.index + m[0].length + 40)).trim().slice(0, 90),
    });
    const cur = perCat.get(p.c) || { total: 0, n: 0 };
    const cap = INCIDENT_CATEGORIES[p.c].cap;
    const applied = cur.n === 0 ? p.w : p.w * 0.45;
    cur.total = p.w < 0 ? cur.total + applied : Math.min(cap, cur.total + applied);
    cur.n++;
    perCat.set(p.c, cur);
  }

  const mag = magnitude(hay);
  if (mag.points) {
    perCat.set('magnitude', { total: Math.min(INCIDENT_CATEGORIES.magnitude.cap, mag.points), n: mag.notes.length });
    for (const n of mag.notes) {
      hits.push({ category: 'magnitude', categoryLabel: 'Scale', note: n.label, weight: 0, evidence: n.detail });
    }
  }

  let raw = 0;
  for (const [id, v] of perCat) {
    raw += v.total;
    if (v.total !== 0) {
      categories.push({
        id,
        label: INCIDENT_CATEGORIES[id].label,
        context: INCIDENT_CATEGORIES[id].context,
        points: Math.round(v.total),
        matches: v.n,
      });
    }
  }
  categories.sort((a, b) => b.points - a.points);

  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-Math.max(0, raw) / 42)))));
  hits.sort((a, b) => b.weight - a.weight);
  return { score, hits: hits.slice(0, 20), categories };
}
