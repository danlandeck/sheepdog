/* GENERATED FILE - do not edit.
   Source of truth: /shared/structural.js
   Regenerate with: npm run build
*/
/**
 * Structural analysis.
 *
 * Two surfaces:
 *   analyzeDomain()    - what the hostname itself gives away
 *   analyzeExtension() - which capabilities an installed extension holds, and
 *                        therefore how much damage a compromised or sold-on
 *                        extension could do
 *
 * The extension pass is the honest version of "what software are they running":
 * a browser cannot enumerate the OS, but it can enumerate its own attack
 * surface precisely, and that is where extension supply-chain attacks land.
 */

/* ------------------------------------------------------------------ domains */

const SUSPICIOUS_TLDS = new Set([
  'zip', 'mov', 'top', 'xyz', 'click', 'link', 'tk', 'cf', 'ga', 'ml', 'gq',
  'rest', 'quest', 'cfd', 'sbs', 'lol', 'icu', 'work', 'fit', 'buzz', 'monster',
  'cyou', 'bond', 'kim', 'gdn', 'live', 'shop', 'autos', 'boats', 'beauty',
]);

// High-value brands whose names get typosquatted. Extend from the server.
const BRAND_TOKENS = [
  'paypal', 'apple', 'icloud', 'microsoft', 'office365', 'outlook', 'google',
  'gmail', 'amazon', 'netflix', 'coinbase', 'binance', 'metamask', 'ledger',
  'trezor', 'chase', 'wellsfargo', 'bankofamerica', 'citibank', 'usbank',
  'americanexpress', 'discover', 'venmo', 'zelle', 'cashapp', 'robinhood',
  'fidelity', 'schwab', 'vanguard', 'irs', 'usps', 'ups', 'fedex', 'dhl',
  'walmart', 'target', 'costco', 'instagram', 'facebook', 'whatsapp',
  'linkedin', 'steam', 'roblox', 'docusign', 'dropbox', 'adobe', 'okta',
];

const LURE_TOKENS = [
  'login', 'signin', 'verify', 'verification', 'secure', 'security', 'account',
  'update', 'confirm', 'billing', 'invoice', 'payment', 'refund', 'support',
  'helpdesk', 'recovery', 'unlock', 'suspended', 'alert', 'claim', 'reward',
  'giveaway', 'airdrop', 'bonus', 'wallet', 'connect', 'mint', 'presale',
  'auth', 'sso', 'webscr', 'service', 'customer',
];

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Strip common homoglyph substitutions before comparing to a brand. */
function deglyph(s) {
  return s
    .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e')
    .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/\$/g, 's').replace(/rn/g, 'm').replace(/vv/g, 'w')
    .replace(/[^a-z]/g, '');
}

export function parseHost(input) {
  let host = String(input || '').trim().toLowerCase();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) host = new URL(host).hostname;
  } catch { /* fall through, treat as bare host */ }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  const labels = host.split('.').filter(Boolean);
  const tld = labels.length > 1 ? labels[labels.length - 1] : '';
  // Naive eTLD+1. Good enough for scoring; the server can swap in the PSL.
  const twoPart = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);
  let registrable = labels.slice(-2).join('.');
  if (labels.length > 2 && twoPart.has(labels[labels.length - 2])) {
    registrable = labels.slice(-3).join('.');
  }
  const sld = registrable.split('.')[0] || '';
  return { host, labels, tld, registrable, sld, subdomains: labels.slice(0, Math.max(0, labels.length - registrable.split('.').length)) };
}

/**
 * @param {object} info { url, host, protocol, tlsValid, ageDays, isIdn }
 */
export function analyzeDomain(info = {}) {
  const findings = [];
  /**
   * `meta` carries a stable id and any structured values behind the finding.
   * The plain-language layer needs to know WHICH brand is being impersonated,
   * and parsing that back out of an English label would break the moment
   * anyone reworded it.
   */
  const add = (w, label, detail, meta) => findings.push({ weight: w, label, detail, ...(meta ? { meta } : {}) });

  const src = info.url || info.host || '';
  const { host, labels, tld, sld, subdomains, registrable } = parseHost(src);
  if (!host) return { score: 0, findings, host: '', registrable: '' };

  let protocol = info.protocol;
  if (!protocol && /^[a-z]+:\/\//.test(src)) {
    try { protocol = new URL(src).protocol.replace(':', ''); } catch { /* ignore */ }
  }

  // Computed up front: brand matching below needs these as corroboration.
  const lures = LURE_TOKENS.filter((t) => host.includes(t));
  const badTld = SUSPICIOUS_TLDS.has(tld);

  if (protocol === 'http') add(18, 'Unencrypted connection', 'The page is served over plain HTTP, so anything you type can be read in transit.', { id: 'insecure' });
  if (info.tlsValid === false) add(24, 'Invalid TLS certificate', 'The certificate does not validate for this hostname.', { id: 'bad_tls' });

  if (host.includes('xn--') || info.isIdn) {
    add(26, 'Internationalized domain', 'The hostname uses punycode, which is the standard way to render a lookalike domain with non-Latin characters.', { id: 'idn' });
  }

  if (badTld) {
    add(12, `High-abuse TLD (.${tld})`, `The .${tld} top-level domain has a disproportionately high share of malicious registrations.`, { id: 'bad_tld', tld });
  }

  /*
   * Brand-lookalike detection.
   *
   * Real phishing domains are almost never a bare misspelling. They are a
   * misspelling with a word bolted on: "bankofamerca-login", "arnazon-security",
   * "paypa1-verify". Comparing the whole label against the brand misses every
   * one of those, because the suffix inflates the edit distance past any usable
   * threshold. So the label is split into segments first and each is judged on
   * its own.
   *
   * The distance threshold scales with brand length. A two-character allowance
   * on a five-letter brand matches far too much ("chase" is two edits from
   * "chose", "cases", "chats"), and a false accusation that a legitimate site is
   * impersonating a bank is much more damaging here than a miss.
   *
   * Even at distance 1, a short brand is weak evidence on its own:
   * "chose-flowers.com" is one edit from "chase" and is a florist. So short
   * brands additionally require corroboration from something a real business
   * would not usually have, such as an account-action keyword in the address or
   * a high-abuse address ending. Long brands do not need it, because nothing is
   * accidentally one character from "bankofamerica".
   */
  const flat = deglyph(sld);
  const segments = [flat, ...sld.split(/[^a-z0-9]+/i).map(deglyph)].filter((x) => x.length >= 4);

  brandLoop:
  for (const brand of BRAND_TOKENS) {
    if (brand.length < 5) continue;
    const allowed = brand.length >= 8 ? 2 : 1;

    if (flat === brand) break;              // the brand's own domain

    for (const seg of segments) {
      if (seg === brand) continue;          // exact, handled as embedded below
      // Length has to be in the same neighbourhood, or "login" matches "ledger".
      if (Math.abs(seg.length - brand.length) > allowed) continue;
      const d = levenshtein(seg, brand);
      const corroborated = brand.length >= 8 || lures.length > 0 || badTld;
      if (d > 0 && d <= allowed && corroborated) {
        add(30, `Lookalike of "${brand}"`, `The domain label "${sld}" is ${d} character${d === 1 ? '' : 's'} away from ${brand}.`, { id: 'lookalike', brand });
        break brandLoop;
      }
    }

    /*
     * A brand name appearing somewhere inside the label is much weaker evidence
     * than it looks, because several of these brands are ordinary English
     * words. "applebees.com", "targetpractice.org" and "discovermagazine.com"
     * are real businesses, not impersonators.
     *
     * So the brand has to either BE one of the address segments outright
     * ("chase-verify", "arnazon-security"), or come with corroboration. Glued
     * inside a longer word with nothing else suspicious is left alone.
     */
    if (flat.includes(brand) && flat !== brand) {
      const isOwnSegment = segments.includes(brand);
      if (isOwnSegment || lures.length > 0 || badTld) {
        add(22, `Brand name embedded in domain`, `"${brand}" appears inside the registered domain "${registrable}", which the brand does not control.`, { id: 'brand_embedded', brand, registrable });
        break brandLoop;
      }
    }
  }

  // Brand token parked in a subdomain (paypal.com.secure-verify.xyz)
  const subJoined = subdomains.join('.');
  const subBrand = BRAND_TOKENS.find((b) => b.length >= 5 && subJoined.includes(b));
  if (subBrand) {
    add(28, 'Brand name in subdomain', `"${subBrand}" appears only in the subdomain. The domain actually being visited is ${registrable}.`, { id: 'brand_subdomain', brand: subBrand, registrable });
  }

  if (lures.length) {
    add(Math.min(20, 8 + lures.length * 4), 'Account-action keywords in hostname', `Contains ${lures.slice(0, 4).map((l) => `"${l}"`).join(', ')}. Legitimate services keep these on paths, not in the registered domain.`, { id: 'lure_keywords', lures });
  }

  if (labels.length >= 5) add(12, 'Deeply nested subdomains', `${labels.length} labels deep, a common way to push the real domain out of view on mobile.`);
  const hyphens = (sld.match(/-/g) || []).length;
  if (hyphens >= 3) add(12, 'Heavy hyphenation', `${hyphens} hyphens in the domain label.`);
  if (/\d{4,}/.test(sld)) add(10, 'Long digit run in domain', 'Bulk-registered domains commonly carry numeric suffixes.');
  if (sld.length >= 30) add(9, 'Unusually long domain label', `${sld.length} characters.`);

  if (typeof info.ageDays === 'number') {
    if (info.ageDays < 30) add(28, 'Domain registered within 30 days', `First registered roughly ${Math.max(0, Math.round(info.ageDays))} days ago. Most fraud domains are used and burned inside a month.`, { id: 'fresh_domain', ageDays: info.ageDays });
    else if (info.ageDays < 180) add(14, 'Domain under six months old', `Registered roughly ${Math.round(info.ageDays)} days ago.`, { id: 'young_domain', ageDays: info.ageDays });
  }

  const raw = findings.reduce((s, f) => s + f.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-raw / 40)))));
  findings.sort((a, b) => b.weight - a.weight);
  return { score, findings, host, registrable };
}

/* --------------------------------------------------------------- extensions */

/**
 * Permission risk weights. The question each answers is "if this extension
 * were sold, compromised, or malicious from the start, what could it do?"
 */
export const PERMISSION_RISK = {
  debugger: { w: 32, why: 'Can attach the Chrome DevTools protocol to any page: full control over content, network, and storage, and it bypasses most other protections.' },
  nativeMessaging: { w: 26, why: 'Can talk to a program installed on your operating system, which is how a browser extension reaches beyond the browser sandbox.' },
  proxy: { w: 24, why: 'Can route all of your browser traffic through a server of its choosing.' },
  '<all_urls>': { w: 24, why: 'Can read and modify the content of every site you visit, including your bank and your email.' },
  webRequest: { w: 18, why: 'Can observe every network request the browser makes.' },
  webRequestBlocking: { w: 20, why: 'Can block or redirect network requests before they are sent.' },
  declarativeNetRequestWithHostAccess: { w: 14, why: 'Can rewrite and redirect requests on the hosts it can access.' },
  cookies: { w: 18, why: 'Can read session cookies, which are equivalent to being logged in as you.' },
  management: { w: 16, why: 'Can see, disable, or uninstall your other extensions, including security ones.' },
  history: { w: 14, why: 'Can read your full browsing history.' },
  downloads: { w: 12, why: 'Can start downloads and see what you download.' },
  clipboardRead: { w: 16, why: 'Can read whatever you copy, which is how crypto address swapping and password theft happen.' },
  scripting: { w: 12, why: 'Can inject code into pages.' },
  tabs: { w: 10, why: 'Can see the URL and title of every tab.' },
  bookmarks: { w: 6, why: 'Can read and modify your bookmarks.' },
  privacy: { w: 12, why: 'Can change browser privacy and security settings.' },
  desktopCapture: { w: 18, why: 'Can capture your screen.' },
  audioCapture: { w: 16, why: 'Can capture microphone audio.' },
  videoCapture: { w: 16, why: 'Can capture camera video.' },
  identity: { w: 10, why: 'Can obtain OAuth tokens tied to your signed-in account.' },
  contentSettings: { w: 10, why: 'Can change per-site permission settings.' },
  declarativeNetRequest: { w: 8, why: 'Can filter network requests by static rule.' },
  storage: { w: 1, why: 'Local storage for the extension itself. Routine.' },
  alarms: { w: 0, why: 'Scheduling. Routine.' },
  notifications: { w: 1, why: 'Desktop notifications. Routine.' },
};

const BROAD_HOST = /^(\*:\/\/\*\/\*|<all_urls>|\*:\/\/\*\.?\*\/?\*?|https?:\/\/\*\/\*)$/;

/**
 * @param {object} ext Shape of chrome.management.ExtensionInfo, plus optional
 *   { userCount, lastUpdated, listedInStore, ownershipChangedAt }
 */
export function analyzeExtension(ext = {}) {
  const findings = [];
  const add = (w, label, detail, meta) => findings.push({ weight: w, label, detail, ...(meta ? { meta } : {}) });

  const perms = new Set(ext.permissions || []);
  const hosts = ext.hostPermissions || [];

  const broad = hosts.filter((h) => BROAD_HOST.test(h));
  if (broad.length) {
    const r = PERMISSION_RISK['<all_urls>'];
    add(r.w, 'Access to every website', r.why, { id: 'all_urls' });
  }

  for (const p of perms) {
    const r = PERMISSION_RISK[p];
    if (r && r.w >= 6) add(r.w, `Permission: ${p}`, r.why, { id: 'perm', permission: p });
  }

  // Dangerous combinations are worth more than the sum of their parts.
  if (broad.length && perms.has('cookies')) {
    add(16, 'Combination: all-sites access plus cookie access', 'Together these are enough to silently take over a logged-in session on any site.', { id: 'combo_session' });
  }
  if (broad.length && (perms.has('webRequest') || perms.has('webRequestBlocking'))) {
    add(14, 'Combination: all-sites access plus request interception', 'Enough to insert affiliate codes, swap payment destinations, or exfiltrate form data.');
  }
  if (perms.has('clipboardRead') && (perms.has('scripting') || broad.length)) {
    add(14, 'Combination: clipboard access plus page injection', 'The standard shape of a crypto address-swapping attack.', { id: 'combo_clipboard' });
  }
  if (perms.has('management') && broad.length) {
    add(12, 'Combination: all-sites access plus extension management', 'Can disable a security extension and then act unobserved.');
  }

  if (ext.installType === 'sideload') add(22, 'Sideloaded install', 'Installed by another program on your computer rather than by you from the Web Store.', { id: 'sideload' });
  if (ext.installType === 'development') add(14, 'Unpacked developer install', 'Loaded from a local folder. Its code can change without any review or update notice.');
  if (ext.installType === 'admin') add(4, 'Installed by policy', 'Pushed by an administrator or enterprise policy.');

  if (ext.updateUrl && !/clients2\.google\.com|chrome\.google\.com/.test(ext.updateUrl)) {
    add(20, 'Self-hosted updates', `Updates come from ${ext.updateUrl} rather than the Chrome Web Store, so new code ships without store review.`);
  }
  if (ext.listedInStore === false) add(18, 'Not listed in the Chrome Web Store', 'The listing is unlisted or has been removed, which often follows a policy takedown.');
  if (!ext.homepageUrl && !ext.optionsUrl) add(6, 'No homepage or options page', 'No published point of contact for the developer.');
  if (ext.enabled === false) add(-8, 'Currently disabled', 'The extension is installed but not running.');

  if (typeof ext.userCount === 'number' && ext.userCount < 1000 && broad.length) {
    add(10, 'Small user base with broad access', `Roughly ${ext.userCount.toLocaleString()} users. Low-install extensions with all-sites access are the usual acquisition target for supply-chain buyers.`);
  }
  if (ext.ownershipChangedAt) {
    add(24, 'Recent ownership change', 'Extensions that change hands are routinely repurposed for data collection or ad injection shortly afterward.');
  }

  const raw = findings.reduce((s, f) => s + Math.max(0, f.weight), 0)
    + findings.reduce((s, f) => s + Math.min(0, f.weight), 0);
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-Math.max(0, raw) / 55)))));
  findings.sort((a, b) => b.weight - a.weight);
  return { score, findings, name: ext.name, id: ext.id };
}
