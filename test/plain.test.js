import test from 'node:test';
import assert from 'node:assert/strict';
import { assess } from '../shared/score.js';
import { buildIndex } from '../shared/regulatory.js';
import { plainWarning } from '../shared/plain.js';

const IDX = buildIndex([]);
const site = (host, body = '', extra = {}) => plainWarning(
  assess({ kind: 'site', body, source: 'PAGE_SCAN', domainInfo: { host, ...extra } }, IDX),
  { host },
);
const ext = (info) => plainWarning(
  assess({ kind: 'extension', title: info.name, source: 'EXTENSION_AUDIT', extensionInfo: info }, IDX),
  { name: info.name },
);

/* The whole point of this module is that a non-expert can read the output. */
const JARGON = /\b(punycode|TLD|registrable|subdomain|hostname|permission|host_permissions|composite|structural|behavioral|regulatory|heuristic|entropy|levenshtein|score|API|JSON|manifest)\b/i;

test('names the impersonated brand in plain English', () => {
  const w = site('paypa1-secure-login.top', 'Verify your account password to continue.');
  assert.match(w.headline, /PayPal/);
  assert.doesNotMatch(w.headline, /paypa1|\.top/);
});

test('brand plus credential harvesting produces the strongest wording', () => {
  const w = site('paypa1-login.top', 'Please verify your account and confirm your password.');
  assert.match(w.headline, /steal your PayPal password/i);
  assert.match(w.advice, /bookmarks|search/i);
});

test('brand parked in a subdomain names the domain actually being visited', () => {
  const w = site('paypal.com.account-verify.sbs');
  assert.match(w.headline, /pretending to be PayPal/i);
  assert.ok(w.reasons.some((r) => r.includes('account-verify.sbs')), w.reasons.join(' | '));
});

test('brand tokens are rendered as people write them', () => {
  assert.match(site('wellsfarg0-secure.top').headline, /Wells Fargo/);
  assert.match(site('bankofamerca-login.xyz').headline, /Bank of America/);
});

test('recognises the tech support scam without any brand', () => {
  const w = site('pc-alert-support.xyz', 'Your computer is infected. Call this number immediately. Install AnyDesk to let our technicians help.');
  assert.match(w.headline, /virus|computer/i);
  assert.match(w.advice, /close|do not call/i);
});

test('recognises a wallet drainer', () => {
  const w = site('claim-airdrop.xyz', 'Connect your wallet to claim your airdrop reward now.');
  assert.match(w.headline, /crypto wallet/i);
  assert.match(w.advice, /recovery phrase/i);
});

test('recognises government impersonation', () => {
  const w = site('ssa-verify.top', 'Your Social Security number has been suspended due to fraud. A warrant for your arrest has been issued.');
  assert.match(w.headline, /government agency/i);
});

test('always gives an action, never only a diagnosis', () => {
  const cases = [
    site('paypa1-login.top', 'verify your password'),
    site('claim-airdrop.xyz', 'connect your wallet to claim'),
    site('random-site-9182.xyz', 'guaranteed returns of 20% monthly, act now'),
    site('plain-unknown.example'),
  ];
  for (const w of cases) {
    assert.ok(w.advice && w.advice.length > 10, `no advice for: ${w.headline}`);
    assert.ok(/^[A-Z]/.test(w.headline) && w.headline.endsWith('.'), `badly formed headline: ${w.headline}`);
  }
});

test('no jargon reaches the user, in any field', () => {
  const cases = [
    site('paypa1-secure-login.top', 'verify your account password'),
    site('xn--pypal-4ve.com', 'sign in'),
    site('deals.example', 'guaranteed returns, act now, gift cards only'),
    ext({ id: 'x', name: 'Sketchy', installType: 'sideload', permissions: ['debugger', 'cookies'], hostPermissions: ['<all_urls>'] }),
    ext({ id: 'y', name: 'Coupons', installType: 'normal', permissions: ['cookies'], hostPermissions: ['<all_urls>'] }),
  ];
  for (const w of cases) {
    const all = [w.headline, w.advice, ...w.reasons].join(' ');
    const m = all.match(JARGON);
    assert.equal(m, null, `jargon "${m?.[0]}" leaked in: ${all}`);
  }
});

test('headlines stay short enough to read at a glance', () => {
  for (const w of [
    site('paypa1-login.top', 'verify your password'),
    site('claim-airdrop.xyz', 'connect wallet'),
    ext({ id: 'z', name: 'Thing', installType: 'normal', permissions: ['debugger'], hostPermissions: ['<all_urls>'] }),
  ]) {
    assert.ok(w.headline.length <= 90, `too long (${w.headline.length}): ${w.headline}`);
  }
});

test('extension warnings lead with consequence, not capability', () => {
  const w = ext({ id: 'a', name: 'Sketchy Helper', installType: 'normal', permissions: ['debugger', 'cookies'], hostPermissions: ['<all_urls>'] });
  assert.match(w.headline, /see and change everything/i);
  assert.match(w.headline, /Sketchy Helper/);
});

test('a sideloaded extension leads with the fact the user did not install it', () => {
  const w = ext({ id: 'b', name: 'Bundled Thing', installType: 'sideload', permissions: ['tabs'], hostPermissions: [] });
  assert.match(w.headline, /did not install/i);
});

test('only the top band interrupts', () => {
  const severe = site('paypa1-secure-login.top', 'Verify your account password now. Gift cards only. Act now, only 2 spots left.');
  const mild = site('example.com');
  assert.equal(severe.urgent, true);
  assert.equal(mild.urgent, false);
});

test('a clean site produces no alarming language', () => {
  const w = site('www.consumerfinance.gov');
  assert.equal(w.urgent, false);
  assert.equal(w.severity, 'low');
});
