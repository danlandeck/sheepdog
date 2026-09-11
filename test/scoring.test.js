import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeText } from '../shared/lexicon.js';
import { analyzeIncident } from '../shared/incident.js';
import { analyzeDomain, analyzeExtension, parseHost } from '../shared/structural.js';
import { buildIndex, crossReference, deriveEntriesFromEnforcement } from '../shared/regulatory.js';
import { assess, bandFor, explain } from '../shared/score.js';

/* --------------------------------------------------------------- behavioral */

test('behavioral: clean copy scores near zero', () => {
  const r = analyzeText('The Federal Reserve held rates steady at its September meeting, citing balanced risks to employment and inflation.');
  assert.equal(r.score, 0);
  assert.equal(r.hits.length, 0);
});

test('behavioral: guaranteed-return pitch scores high and names the tactic', () => {
  const r = analyzeText(`
    EXCLUSIVE OPPORTUNITY. Our proprietary algorithm delivers guaranteed returns of 12% monthly.
    This is a risk-free investment and your principal is 100% protected.
    Only 7 spots left, and the offer expires at midnight. Act now before it's too late.
    Payment accepted in Bitcoin only. Don't tell anyone about this, keep it between us.
  `);
  assert.ok(r.score >= 75, `expected >= 75, got ${r.score}`);
  const cats = r.categories.map((c) => c.id);
  assert.ok(cats.includes('guaranteed_returns'));
  assert.ok(cats.includes('urgency'));
  assert.ok(cats.includes('irreversible_payment'));
  assert.ok(cats.includes('secrecy'));
  assert.ok(r.hits.every((h) => h.evidence && h.note));
});

test('behavioral: phishing copy trips credential harvesting', () => {
  const r = analyzeText('Your account has been suspended due to unusual sign-in activity. Click here to verify your account within 24 hours or it will be closed.');
  assert.ok(r.categories.some((c) => c.id === 'credential_harvest'));
  assert.ok(r.score >= 45, `expected >= 45, got ${r.score}`);
});

test('behavioral: repetition of one phrase does not run away with the score', () => {
  const once = analyzeText('Act now.');
  const many = analyzeText(Array(40).fill('Act now.').join(' '));
  assert.ok(many.score - once.score <= 12, `repetition inflated the score by ${many.score - once.score}`);
});

test('behavioral: several distinct tactics outrank one loud one', () => {
  const loud = analyzeText(Array(10).fill('guaranteed returns guaranteed profits').join(' '));
  const varied = analyzeText('Guaranteed returns. Act now, only 3 spots left. Payment in gift cards. Do not tell your bank. Verify your account to continue.');
  assert.ok(varied.score > loud.score, `varied ${varied.score} should beat loud ${loud.score}`);
});

/* --------------------------------------------------------------- structural */

test('parseHost handles multi-part public suffixes', () => {
  assert.equal(parseHost('https://foo.bar.example.co.uk/path').registrable, 'example.co.uk');
  assert.equal(parseHost('www.example.com').registrable, 'example.com');
  assert.equal(parseHost('https://a.b.c.paypal.com').sld, 'paypal');
});

test('structural: a plain well-known domain is clean', () => {
  const r = analyzeDomain({ url: 'https://www.consumerfinance.gov/' });
  assert.ok(r.score < 20, `expected < 20, got ${r.score}: ${JSON.stringify(r.findings)}`);
});

test('structural: typosquat is caught and named', () => {
  const r = analyzeDomain({ url: 'https://paypa1-secure-login.top/verify' });
  assert.ok(r.score >= 60, `expected >= 60, got ${r.score}`);
  const labels = r.findings.map((f) => f.label).join(' | ');
  assert.match(labels, /Lookalike|Brand name/);
  assert.match(labels, /High-abuse TLD/);
});

test('structural: brand parked in a subdomain is flagged against the real registrable domain', () => {
  const r = analyzeDomain({ url: 'https://paypal.com.account-verify.sbs/login' });
  assert.ok(r.findings.some((f) => f.label === 'Brand name in subdomain'));
  assert.equal(r.registrable, 'account-verify.sbs');
});

test('structural: plain HTTP and a fresh registration both count', () => {
  const r = analyzeDomain({ url: 'http://claim-your-reward.example/', protocol: 'http', ageDays: 4 });
  const labels = r.findings.map((f) => f.label);
  assert.ok(labels.includes('Unencrypted connection'));
  assert.ok(labels.some((l) => l.includes('within 30 days')));
});

test('extension: a storage-only extension is low risk', () => {
  const r = analyzeExtension({
    id: 'a', name: 'Tab Counter', installType: 'normal',
    permissions: ['storage', 'alarms'], hostPermissions: [], homepageUrl: 'https://example.com',
  });
  assert.ok(r.score < 20, `expected < 20, got ${r.score}`);
});

test('extension: all-sites plus cookies plus debugger is severe, with the combination called out', () => {
  const r = analyzeExtension({
    id: 'b', name: 'Sketchy Helper', installType: 'sideload',
    permissions: ['debugger', 'cookies', 'webRequest', 'management', 'clipboardRead', 'scripting'],
    hostPermissions: ['<all_urls>'],
    updateUrl: 'https://updates.sketchy.example/manifest.xml',
  });
  assert.ok(r.score >= 85, `expected >= 85, got ${r.score}`);
  const labels = r.findings.map((f) => f.label);
  assert.ok(labels.some((l) => l.startsWith('Combination:')));
  assert.ok(labels.includes('Sideloaded install'));
  assert.ok(labels.includes('Self-hosted updates'));
  assert.ok(r.findings.every((f) => f.detail && f.detail.length > 20), 'every finding needs a plain-language explanation');
});

/* --------------------------------------------------------------- regulatory */

const INDEX = buildIndex([
  { list: 'FTC_ENFORCEMENT', entity: 'Example Fraud Corp', domains: ['example-fraud-corp.test'], action: 'FTC enforcement action', severity: 'high', date: '2026-05-01' },
  { list: 'SEC_ENFORCEMENT', entity: 'Northstar Yield Partners', domains: [], action: 'SEC charged the firm with operating a Ponzi scheme', severity: 'high', date: '2026-04-02' },
]);

test('regulatory: exact domain match scores high', () => {
  const r = crossReference({ text: '', domains: ['example-fraud-corp.test'] }, INDEX);
  assert.ok(r.score >= 65, `expected >= 65, got ${r.score}`);
  assert.equal(r.matches[0].matchedOn, 'domain');
});

test('regulatory: subdomain inherits the parent listing', () => {
  const r = crossReference({ text: '', domains: ['pay.example-fraud-corp.test'] }, INDEX);
  assert.ok(r.matches.length > 0);
  assert.match(r.matches[0].detail, /sits under/);
});

test('regulatory: entity name in body text matches at a discount', () => {
  const byName = crossReference({ text: 'Investors in Northstar Yield Partners were told the fund was fully collateralized.', domains: [] }, INDEX);
  const byDomain = crossReference({ text: '', domains: ['example-fraud-corp.test'] }, INDEX);
  assert.ok(byName.matches.length > 0);
  assert.equal(byName.matches[0].matchedOn, 'entity');
  assert.ok(byName.score < byDomain.score, 'a name match must be worth less than a domain match');
});

test('regulatory: unrelated text produces no match', () => {
  const r = crossReference({ text: 'A quarterly earnings summary for an unrelated company.', domains: ['example.org'] }, INDEX);
  assert.equal(r.matches.length, 0);
  assert.equal(r.score, 0);
});

test('regulatory: defendant names are derived from real enforcement headlines', () => {
  const cases = [
    ['FTC Takes Action Against Humboldt Merchant Services for Knowingly Facilitating Payment Processing for Sham Merchants', 'Humboldt Merchant Services'],
    ['SEC Charges Northstar Yield Partners with Operating a Ponzi Scheme', 'Northstar Yield Partners'],
  ];
  for (const [title, expected] of cases) {
    const out = deriveEntriesFromEnforcement({ title, source: title.startsWith('SEC') ? 'SEC' : 'FTC', url: 'https://example.gov/x' });
    assert.equal(out.length, 1, `no entity derived from: ${title}`);
    assert.ok(out[0].entity.startsWith(expected.split(' ')[0]), `got "${out[0].entity}" for "${title}"`);
  }
});

/* ---------------------------------------------------------------- composite */

test('bands map to the documented thresholds', () => {
  assert.equal(bandFor(0).id, 'low');
  assert.equal(bandFor(24).id, 'low');
  assert.equal(bandFor(25).id, 'elevated');
  assert.equal(bandFor(50).id, 'high');
  assert.equal(bandFor(100).id, 'severe');
});

test('composite: a routine regulator headline stays low or elevated', () => {
  const r = assess({
    kind: 'news',
    title: 'FTC Extends Public Comment on Proposed Policy Statement Regarding Personalized Pricing',
    summary: 'The Commission extended the comment period by 30 days.',
    source: 'FTC', sourceName: 'FTC', enforcement: true,
    url: 'https://www.ftc.gov/news-events/news/press-releases/example',
  }, INDEX);
  assert.ok(r.score < 50, `expected < 50, got ${r.score}`);
  assert.ok(['low', 'elevated'].includes(r.band));
});

test('composite: a listed fraud domain with scam copy is severe', () => {
  const r = assess({
    kind: 'site',
    title: 'Claim your guaranteed 15% monthly returns',
    body: 'Guaranteed returns of 15% monthly, risk-free. Only 3 spots left, offer expires tonight. Send USDT to begin. Do not tell your bank.',
    source: 'PAGE_SCAN',
    domainInfo: { url: 'https://example-fraud-corp.test/', protocol: 'https' },
  }, INDEX);
  assert.equal(r.band, 'severe');
  assert.ok(r.score >= 78, `regulatory domain floor not applied: ${r.score}`);
});

test('composite: every result carries the four scored blocks plus confidence, weights summing to one', () => {
  const r = assess({ kind: 'news', title: 'Something happened', source: 'KREBS' }, INDEX);
  const s = r.signals;
  const scored = ['behavioral', 'incident', 'structural', 'regulatory'];
  for (const k of scored) {
    assert.ok(s[k], `missing signal block: ${k}`);
    assert.equal(typeof s[k].score, 'number');
    assert.equal(typeof s[k].contribution, 'number');
  }
  assert.ok(s.confidence, 'missing confidence block');
  assert.equal(typeof s.confidence.multiplier, 'number');
  const sum = scored.reduce((a, k) => a + s[k].weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`);
});

/* ------------------------------------------------------------------ incident */

test('incident: a Ponzi enforcement action clearly outranks a comment-period notice', () => {
  const ponzi = assess({
    kind: 'news', source: 'SEC', sourceName: 'SEC', enforcement: true,
    title: 'SEC Charges Northstar Yield Partners with Operating a Ponzi Scheme',
    summary: 'The SEC obtained an asset freeze and alleges the defendants defrauded investors out of $48 million across more than 3,000 accounts.',
  }, buildIndex([]));

  const procedural = assess({
    kind: 'news', source: 'FTC', sourceName: 'FTC', enforcement: true,
    title: 'FTC Extends Public Comment Period on Proposed Policy Statement Regarding Personalized Pricing',
    summary: 'The Commission extended the comment period by 30 days in response to stakeholder requests.',
  }, buildIndex([]));

  assert.ok(ponzi.score >= 50, `enforcement action scored only ${ponzi.score}`);
  assert.ok(procedural.score < 25, `procedural notice scored ${procedural.score}, should be low`);
  assert.ok(ponzi.score - procedural.score >= 30, `separation is only ${ponzi.score - procedural.score} points`);
});

test('incident: procedural language pulls an administrative item down', () => {
  const r = analyzeIncident('The Commission announced a proposed rulemaking and opened a comment period. An advisory committee will host a roundtable.');
  assert.ok(r.score <= 10, `expected near zero, got ${r.score}`);
});

test('incident: magnitude is parsed from the text, not pattern-matched', () => {
  const big = analyzeIncident('Investigators say the ring stole $2.3 billion from victims worldwide.');
  const small = analyzeIncident('Investigators say the ring stole $4,000 from victims worldwide.');
  assert.ok(big.score > small.score, `${big.score} should exceed ${small.score}`);
  assert.ok(big.categories.some((c) => c.id === 'magnitude'));
  assert.ok(big.hits.some((h) => /billion/i.test(h.evidence || '')));
});

test('incident: active exploitation registers even without dollar figures', () => {
  const r = analyzeIncident('Google warns of a new Chrome zero-day actively exploited in attacks against journalists.');
  assert.ok(r.score >= 40, `expected >= 40, got ${r.score}`);
  assert.ok(r.categories.some((c) => c.id === 'active_threat'));
});

test('confidence multiplies rather than adds, so authority alone cannot make an item risky', () => {
  const base = { kind: 'news', title: 'Agency publishes its annual report', summary: 'A routine annual publication.' };
  const authoritative = assess({ ...base, source: 'FTC', sourceName: 'FTC' }, buildIndex([]));
  const secondary = assess({ ...base, source: 'USER_SUBMITTED', sourceName: 'A reader' }, buildIndex([]));

  assert.ok(authoritative.score < 15, `authority inflated an empty item to ${authoritative.score}`);
  assert.ok(authoritative.signals.confidence.multiplier > secondary.signals.confidence.multiplier);
  assert.ok(authoritative.score >= secondary.score, 'a trusted source should not score lower on identical content');
});

test('confidence is neutral for local measurements', () => {
  const r = assess({ kind: 'site', domainInfo: { url: 'https://example.com/' }, source: 'PAGE_SCAN' }, buildIndex([]));
  assert.equal(r.signals.confidence.multiplier, 1);
});

test('composite: a severe permission profile cannot come back green', () => {
  const r = assess({
    kind: 'extension',
    title: 'Sketchy Helper',
    source: 'EXTENSION_AUDIT',
    extensionInfo: {
      id: 'b', name: 'Sketchy Helper', installType: 'sideload',
      permissions: ['debugger', 'cookies', 'webRequest', 'management', 'clipboardRead'],
      hostPermissions: ['<all_urls>'],
    },
  }, INDEX);
  assert.ok(r.score >= 72, `expected >= 72, got ${r.score}`);
  assert.notEqual(r.band, 'low');
});

test('explain produces a one-line rationale', () => {
  const r = assess({
    kind: 'site',
    body: 'Guaranteed returns, act now, only 2 spots left.',
    domainInfo: { url: 'https://paypa1-login.top/' },
    source: 'PAGE_SCAN',
  }, INDEX);
  const e = explain(r);
  assert.match(e, /pattern|finding|match/);
  assert.ok(e.length < 140);
});

test('assess tolerates an empty regulatory index', () => {
  const r = assess({ kind: 'site', domainInfo: { url: 'https://example.com/' }, source: 'PAGE_SCAN' }, buildIndex([]));
  assert.equal(r.signals.regulatory.matches.length, 0);
  assert.ok(Number.isFinite(r.score));
});

/* --------------------------------------------------- end-to-end calibration */

/*
 * The ticker's entire value is ordering, so this locks the relative ranking of
 * representative real-world headlines. A lexicon edit that reshuffles these has
 * broken the product even if every unit test still passes.
 */
test('calibration: representative headlines rank in a defensible order', () => {
  const index = buildIndex([
    { list: 'FTC_ENFORCEMENT', entity: 'Example Fraud Corp', domains: ['example-fraud-corp.test'], action: 'FTC enforcement action', severity: 'high', date: '2026-05-01' },
  ]);

  const score = (o) => assess({ kind: 'news', ...o }, index).score;

  const listedOperator = score({
    source: 'FTC', sourceName: 'FTC', enforcement: true,
    title: 'FTC Takes Action Against Example Fraud Corp for Operating a Deceptive Investment Platform',
    summary: 'The defendants promised guaranteed returns of 12% per month while operating the platform as a Ponzi scheme.',
    extraDomains: ['example-fraud-corp.test'],
  });

  const activeCampaign = score({
    source: 'FTC_CONSUMER', sourceName: 'FTC Consumer Advice',
    title: 'Scammers are spoofing car dealership websites: what to watch for',
    summary: 'Fake dealership sites ask victims for a deposit by wire transfer or gift card before they ever see the vehicle.',
  });

  const trendPiece = score({
    source: 'KREBS', sourceName: 'Krebs on Security',
    title: 'Task-Based Job Scams Move From Telegram to Mainstream Job Boards',
    summary: 'Recruits are told they can earn $300 per day completing tasks, then required to deposit their own funds.',
  });

  const procedural = score({
    source: 'CFPB', sourceName: 'CFPB', enforcement: true,
    title: 'CFPB Announces Joint Final Rule on Adopting Uniform Standards for Reporting Financial Data',
    summary: 'The rule harmonizes reporting formats across agencies. Compliance begins next year.',
  });

  assert.ok(listedOperator > activeCampaign, `listed operator ${listedOperator} must outrank active campaign ${activeCampaign}`);
  assert.ok(activeCampaign > trendPiece, `active campaign ${activeCampaign} must outrank trend piece ${trendPiece}`);
  assert.ok(trendPiece > procedural, `trend piece ${trendPiece} must outrank procedural notice ${procedural}`);
  assert.ok(procedural < 15, `procedural notice scored ${procedural}, should be near zero`);
  assert.equal(bandFor(listedOperator).id, 'severe');
});

test('calibration: the publisher domain never contributes to a news score', () => {
  const withUrl = assess({ kind: 'news', source: 'SEC', title: 'SEC Charges a Firm With Fraud', url: 'https://www.sec.gov/news/x' }, buildIndex([]));
  const withoutUrl = assess({ kind: 'news', source: 'SEC', title: 'SEC Charges a Firm With Fraud' }, buildIndex([]));
  assert.equal(withUrl.score, withoutUrl.score, 'publisher URL leaked into the score');
  assert.equal(withUrl.signals.structural.applicable, false);
});

/* ------------------------------------------------- brand-matching precision */

/*
 * Guard mode turns these findings into sentences like "This site is pretending
 * to be Chase." A false positive there tells someone a florist is a fake bank,
 * which is worse than saying nothing, so precision is locked down here.
 */
test('brand matching catches real typosquat shapes', () => {
  const cases = [
    'bankofamerca-login.xyz',        // missing letter plus a bolted-on word
    'arnazon-security.com',          // rn homoglyph
    'paypa1-verify.net',             // digit homoglyph
    'netfl1x-billing.top',
    'coinbse-wallet.xyz',
    'chase-verify.top',              // short brand, corroborated
    'paypalsecure.com',              // glued, corroborated by a lure word
    'paypal.com.account-verify.sbs', // brand parked in a subdomain
  ];
  for (const host of cases) {
    const f = analyzeDomain({ host }).findings
      .find((f) => ['lookalike', 'brand_embedded', 'brand_subdomain'].includes(f.meta?.id));
    assert.ok(f, `missed typosquat: ${host}`);
    assert.ok(f.meta.brand, `no brand recorded for ${host}`);
  }
});

test('brand matching does not accuse legitimate businesses', () => {
  const cases = [
    'chose-flowers.com',      // one edit from "chase", a florist
    'cases-and-covers.com',
    'applebees.com',          // contains "apple"
    'targetpractice.org',     // contains "target"
    'discovermagazine.com',   // contains "discover"
    'pineapple.com',
    'ledgerbooks.com',
    'apples.com',
    'chosen.org',
    'stripe.com',
    'github.com',
    'consumerfinance.gov',
  ];
  for (const host of cases) {
    const f = analyzeDomain({ host }).findings
      .find((f) => ['lookalike', 'brand_embedded'].includes(f.meta?.id));
    assert.equal(f, undefined, `false accusation against ${host}: ${f?.label}`);
  }
});
