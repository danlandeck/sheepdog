/**
 * Plain-language warnings.
 *
 * The scored result is written for someone who wants the reasoning. Guard mode
 * is for someone who does not: an older relative, someone mid-transaction,
 * someone who has never heard the word "punycode" and never needs to.
 *
 * "paypa1-secure-login.top scores 63/100, structural findings: lookalike of
 * paypal, high-abuse TLD" tells that person nothing. "This site is pretending
 * to be PayPal. Do not type your password." tells them everything.
 *
 * Rules this module holds itself to:
 *   - One short sentence for the headline. Second person, present tense.
 *   - Name the brand being impersonated. That is the single most useful fact.
 *   - No jargon at all: no TLD, punycode, domain, permission, host, score.
 *   - Always say what to DO, not only what is wrong.
 *   - Never say "may" or "might" when the finding is definite, and never say
 *     "is a scam" when it is a pattern match. Overclaiming burns trust the
 *     first time it is wrong, and underclaiming gets ignored.
 */

/** Brand tokens are lowercase and unspaced. People do not read them that way. */
const BRAND_DISPLAY = {
  paypal: 'PayPal', apple: 'Apple', icloud: 'iCloud', microsoft: 'Microsoft',
  office365: 'Microsoft 365', outlook: 'Outlook', google: 'Google', gmail: 'Gmail',
  amazon: 'Amazon', netflix: 'Netflix', coinbase: 'Coinbase', binance: 'Binance',
  metamask: 'MetaMask', ledger: 'Ledger', trezor: 'Trezor', chase: 'Chase',
  wellsfargo: 'Wells Fargo', bankofamerica: 'Bank of America', citibank: 'Citibank',
  usbank: 'U.S. Bank', americanexpress: 'American Express', discover: 'Discover',
  venmo: 'Venmo', zelle: 'Zelle', cashapp: 'Cash App', robinhood: 'Robinhood',
  fidelity: 'Fidelity', schwab: 'Charles Schwab', vanguard: 'Vanguard',
  irs: 'the IRS', usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL',
  walmart: 'Walmart', target: 'Target', costco: 'Costco',
  instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn', steam: 'Steam', roblox: 'Roblox', docusign: 'DocuSign',
  dropbox: 'Dropbox', adobe: 'Adobe', okta: 'Okta',
};

const brandName = (b) => BRAND_DISPLAY[b] || (b ? b[0].toUpperCase() + b.slice(1) : 'a company you know');

/** Behavioral categories, said the way a person would say them. */
const BEHAVIOR_PLAIN = {
  guaranteed_returns: 'It promises returns that no real investment can guarantee.',
  urgency: 'It is pushing you to act immediately so you do not stop to check.',
  too_good: 'It promises far more than any legitimate offer would.',
  authority_impersonation: 'It is pretending to be a government agency.',
  irreversible_payment: 'It wants gift cards, a wire, or crypto, which cannot be reversed once sent.',
  secrecy: 'It is asking you to keep this from your family or your bank.',
  credential_harvest: 'It is asking for a password or a security code.',
  unsolicited_windfall: 'It says you have won or are owed money you never applied for.',
  tech_support: 'It claims your device has a problem and wants you to call or install something.',
  relationship_investment: 'It is an investment pitch from someone you met online.',
  social_proof: 'It leans on celebrity names and testimonials that are easy to fake.',
  job_scam: 'It offers easy money for simple tasks, then asks you to pay in first.',
  crypto_lure: 'It wants you to connect a crypto wallet to claim something.',
  evasion: 'It is telling you not to check reviews or verify anything.',
};

/** Finding ids, said the way a person would say them. */
function findingPlain(f, brand) {
  const id = f.meta?.id;
  switch (id) {
    case 'lookalike':
    case 'brand_embedded':
      return `The web address only looks like ${brandName(f.meta.brand)}. ${brandName(f.meta.brand)} does not own it.`;
    case 'brand_subdomain':
      return `The address starts with ${brandName(f.meta.brand)} but actually belongs to ${f.meta.registrable}.`;
    case 'idn':
      return 'The address uses lookalike characters to imitate a real one.';
    case 'insecure':
      return 'Anything you type on this page travels unprotected.';
    case 'bad_tls':
      return 'The site\'s security certificate does not check out.';
    case 'fresh_domain':
      return 'This website was created within the last month.';
    case 'young_domain':
      return 'This website is only a few months old.';
    case 'lure_keywords':
      return 'The address is built out of words like "verify" and "secure" to look official.';
    case 'bad_tld':
      return 'It uses an address ending that scam sites favor because it is cheap.';
    default:
      return null;
  }
}

const has = (findings, id) => findings.some((f) => f.meta?.id === id);
const find = (findings, id) => findings.find((f) => f.meta?.id === id);
const cat = (categories, id) => categories.some((c) => c.id === id);

/* ------------------------------------------------------------------- sites */

function siteWarning(result, ctx) {
  const s = result.signals;
  const findings = s.structural.findings || [];
  const cats = s.behavioral.categories || [];
  const host = ctx.host || s.structural.host || 'this site';

  const brandF = find(findings, 'lookalike') || find(findings, 'brand_subdomain') || find(findings, 'brand_embedded');
  const brand = brandF?.meta?.brand;
  const B = brand ? brandName(brand) : null;

  let headline, advice;

  if (B && cat(cats, 'credential_harvest')) {
    headline = `This page is built to steal your ${B} password.`;
    advice = `Do not enter it. Open ${B} yourself from your bookmarks or by searching.`;
  } else if (B) {
    headline = `This site is pretending to be ${B}.`;
    advice = `It is not ${B}. Do not enter a password or card details here.`;
  } else if (cat(cats, 'crypto_lure')) {
    headline = 'This page is trying to get into your crypto wallet.';
    advice = 'Do not connect your wallet and never share a recovery phrase.';
  } else if (cat(cats, 'tech_support')) {
    headline = 'This is the fake "your computer has a virus" scam.';
    advice = 'Close this tab. Do not call the number and do not install anything.';
  } else if (cat(cats, 'authority_impersonation')) {
    headline = 'This page is pretending to be a government agency.';
    advice = 'Real agencies do not demand payment or personal details this way. Close the tab.';
  } else if (cat(cats, 'credential_harvest')) {
    headline = 'This page is trying to collect your password.';
    advice = 'Do not enter it here. Go to the real site yourself and sign in there.';
  } else if (cat(cats, 'irreversible_payment')) {
    headline = 'This site wants payment you cannot get back.';
    advice = 'Gift cards, wires, and crypto are final. Pay by card or not at all.';
  } else if (cat(cats, 'guaranteed_returns') || cat(cats, 'too_good')) {
    headline = 'This page promises returns that are not real.';
    advice = 'No legitimate investment guarantees a return. Do not send money.';
  } else if (cat(cats, 'job_scam')) {
    headline = 'This looks like a fake job offer.';
    advice = 'A real employer never asks you to deposit your own money first.';
  } else if (has(findings, 'fresh_domain') && has(findings, 'lure_keywords')) {
    headline = 'This website was set up days ago and is asking for your details.';
    advice = 'Be careful. Check the company somewhere else before entering anything.';
  } else {
    headline = `Several things about ${host} match known scam patterns.`;
    advice = 'Be careful with anything you enter here.';
  }

  const reasons = [];
  for (const f of findings.slice(0, 6)) {
    const t = findingPlain(f, brand);
    if (t && !reasons.includes(t)) reasons.push(t);
    if (reasons.length >= 3) break;
  }
  for (const c of cats) {
    if (reasons.length >= 3) break;
    const t = BEHAVIOR_PLAIN[c.id];
    if (t && !reasons.includes(t)) reasons.push(t);
  }

  return { headline, advice, reasons };
}

/* -------------------------------------------------------------- extensions */

function extensionWarning(result, ctx) {
  const findings = result.signals.structural.findings || [];
  const name = ctx.name || 'An add-on you installed';

  const perms = new Set(findings.filter((f) => f.meta?.id === 'perm').map((f) => f.meta.permission));

  let headline, advice;

  if (perms.has('debugger')) {
    headline = `"${name}" can see and change everything you do online.`;
    advice = 'Very few add-ons need this. Remove it unless you are certain you trust it.';
  } else if (has(findings, 'sideload')) {
    headline = `You did not install "${name}". Another program put it in your browser.`;
    advice = 'Add-ons that arrive on their own are worth removing.';
  } else if (has(findings, 'combo_session')) {
    headline = `"${name}" could sign in as you on sites where you are already logged in.`;
    advice = 'If you do not use it often, remove it.';
  } else if (has(findings, 'combo_clipboard')) {
    headline = `"${name}" can read anything you copy, including passwords.`;
    advice = 'This is how copied crypto addresses get swapped. Remove it if you do not need it.';
  } else if (has(findings, 'all_urls')) {
    headline = `"${name}" can read everything you do on every website, including your bank.`;
    advice = 'That is a lot of trust to place in one add-on. Remove it if you no longer use it.';
  } else {
    headline = `"${name}" has more access to your browsing than most add-ons.`;
    advice = 'Worth reviewing if you do not remember installing it.';
  }

  const reasons = [];
  for (const f of findings.slice(0, 4)) {
    if (f.meta?.id === 'perm' && f.detail) {
      const short = f.detail.replace(/^Can /, 'It can ').replace(/\.$/, '.');
      if (!reasons.includes(short)) reasons.push(short);
    }
    if (reasons.length >= 2) break;
  }

  return { headline, advice, reasons };
}

/* -------------------------------------------------------------------- api */

/**
 * @param {object} result an assess() result
 * @param {object} ctx    { host } for sites, { name } for extensions
 * @returns {{ headline, advice, reasons, severity, urgent }}
 */
export function plainWarning(result, ctx = {}) {
  const base = result.kind === 'extension'
    ? extensionWarning(result, ctx)
    : siteWarning(result, ctx);

  return {
    ...base,
    severity: result.band,
    // Only the top band interrupts. Everything else can wait to be looked at.
    urgent: result.band === 'severe' || (result.band === 'high' && result.kind === 'site'),
  };
}

export { brandName };
