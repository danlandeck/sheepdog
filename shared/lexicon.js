/**
 * Behavioral analysis lexicon.
 *
 * Each entry is a manipulation pattern with a human-readable label, because the
 * detail panel shows the user exactly what fired and why. Weights are additive
 * points against a 100-point behavioral subscore; `cap` limits how much one
 * category can contribute no matter how many times it matches, so a page that
 * says "act now" forty times does not outrank a page that quietly guarantees
 * returns.
 *
 * `context` is a short sentence explaining the tactic in plain language. It is
 * surfaced verbatim in the UI, so keep it non-technical.
 */

export const CATEGORIES = {
  guaranteed_returns: {
    label: 'Guaranteed returns',
    cap: 30,
    context:
      'No lawful investment can guarantee a return. Language promising one is the single most reliable indicator of investment fraud.',
  },
  urgency: {
    label: 'Urgency pressure',
    cap: 20,
    context:
      'Artificial time pressure exists to stop you from verifying claims or consulting someone else before you act.',
  },
  too_good: {
    label: 'Implausible upside',
    cap: 25,
    context:
      'Returns or benefits far outside what the market offers, presented without a matching risk disclosure.',
  },
  authority_impersonation: {
    label: 'Authority impersonation',
    cap: 30,
    context:
      'Government agencies do not open contact by phone, text, or email demanding payment or personal data.',
  },
  irreversible_payment: {
    label: 'Irreversible payment demand',
    cap: 30,
    context:
      'Gift cards, wire transfers, crypto, and peer-to-peer cash apps are chosen by fraudsters precisely because the money cannot be clawed back.',
  },
  secrecy: {
    label: 'Secrecy request',
    cap: 25,
    context:
      'Being asked to keep a transaction private is an attempt to isolate you from anyone who might recognize the scheme.',
  },
  credential_harvest: {
    label: 'Credential harvesting',
    cap: 28,
    context:
      'Account-security framing that funnels you to a login form is the standard phishing structure.',
  },
  unsolicited_windfall: {
    label: 'Unsolicited windfall',
    cap: 25,
    context:
      'Prizes, inheritances, refunds, and unclaimed funds you did not apply for are a long-running advance-fee pattern.',
  },
  tech_support: {
    label: 'Tech support / remote access',
    cap: 30,
    context:
      'Requests to install remote-access software or call a support number shown on a page hand over control of your machine.',
  },
  relationship_investment: {
    label: 'Relationship-led investment',
    cap: 28,
    context:
      'Investment guidance from someone met through social media or messaging apps is the core of pig-butchering fraud.',
  },
  social_proof: {
    label: 'Manufactured social proof',
    cap: 15,
    context:
      'Testimonial volume, follower counts, and celebrity association are cheap to fabricate and easy to buy.',
  },
  job_scam: {
    label: 'Task-based job offer',
    cap: 22,
    context:
      'Pay-per-task remote work that requires you to deposit your own funds first is a money-laundering or advance-fee structure.',
  },
  crypto_lure: {
    label: 'Crypto lure',
    cap: 22,
    context:
      'Airdrops, wallet-connect prompts, and giveaway multipliers are used to drain wallets through a single approval.',
  },
  evasion: {
    label: 'Verification evasion',
    cap: 20,
    context:
      'Explicit discouragement of checks, reviews, or third-party verification.',
  },
};

/**
 * Pattern table. `re` must be global-free (we clone with flags at match time)
 * so the module stays reentrant.
 */
export const PATTERNS = [
  // guaranteed_returns
  { c: 'guaranteed_returns', w: 18, re: /\bguarantee(?:d|s)?\s+(?:returns?|profits?|income|payouts?|gains?|yields?)\b/i, note: 'Guarantees a financial return' },
  { c: 'guaranteed_returns', w: 16, re: /\b(?:risk[\s-]?free|zero[\s-]?risk|no[\s-]?risk)\s+(?:investment|trade|trading|return|opportunity)\b/i, note: 'Describes an investment as risk-free' },
  { c: 'guaranteed_returns', w: 15, re: /\b(?:principal|capital)\s+(?:is\s+)?(?:100%\s+)?(?:protected|guaranteed|insured)\b/i, note: 'Claims principal is protected' },
  { c: 'guaranteed_returns', w: 14, re: /\bdouble\s+your\s+(?:money|investment|deposit|crypto|bitcoin)\b/i, note: 'Promises to double funds' },
  { c: 'guaranteed_returns', w: 12, re: /\b(?:daily|weekly|monthly)\s+(?:returns?|profits?|payouts?)\s+of\s+\d/i, note: 'Advertises a fixed periodic return' },

  // too_good
  { c: 'too_good', w: 14, re: /\b\d{2,4}\s?%\s+(?:returns?|profit|gain|apy|roi)\b/i, note: 'Advertises an outsized percentage return' },
  { c: 'too_good', w: 12, re: /\bpassive\s+income\b/i, note: 'Passive-income framing' },
  { c: 'too_good', w: 13, re: /\b(?:get|become)\s+(?:rich|wealthy|a\s+millionaire)\b/i, note: 'Promises wealth' },
  { c: 'too_good', w: 12, re: /\b(?:secret|hidden|little[\s-]known)\s+(?:method|formula|strategy|loophole|system|trick)\b/i, note: 'Claims a secret method' },
  { c: 'too_good', w: 11, re: /\bfinancial\s+freedom\b/i, note: 'Financial-freedom framing' },
  { c: 'too_good', w: 12, re: /\b(?:no|without)\s+(?:experience|skills?|knowledge)\s+(?:needed|required|necessary)\b/i, note: 'Claims no expertise is needed' },
  { c: 'too_good', w: 10, re: /\bovernight\s+(?:success|riches|profits?|millionaire)\b/i, note: 'Promises overnight results' },

  // urgency
  { c: 'urgency', w: 10, re: /\bact\s+(?:now|fast|immediately|today)\b/i, note: 'Demands immediate action' },
  { c: 'urgency', w: 9, re: /\b(?:limited|last)\s+(?:time|chance|spots?|slots?|seats?|offer)\b/i, note: 'Claims limited availability' },
  { c: 'urgency', w: 10, re: /\b(?:expires?|ends?|closes?)\s+(?:in|within|today|tonight|at\s+midnight)\b/i, note: 'Countdown to expiry' },
  { c: 'urgency', w: 11, re: /\b(?:only|just)\s+\d{1,3}\s+(?:spots?|slots?|seats?|left|remaining|available)\b/i, note: 'Manufactured scarcity count' },
  { c: 'urgency', w: 12, re: /\bbefore\s+it'?s?\s+too\s+late\b/i, note: 'Fear-of-missing-out framing' },
  { c: 'urgency', w: 12, re: /\b(?:final|last)\s+(?:warning|notice|reminder)\b/i, note: 'Final-notice pressure' },
  { c: 'urgency', w: 11, re: /\b(?:within|in)\s+(?:24|48|72)\s+hours?\b.{0,40}\b(?:or|otherwise|to\s+avoid)\b/i, note: 'Deadline paired with a consequence' },

  // authority_impersonation
  { c: 'authority_impersonation', w: 20, re: /\b(?:irs|internal\s+revenue\s+service)\b.{0,60}\b(?:owe|payment|warrant|lawsuit|levy|arrest)\b/i, note: 'Invokes the IRS alongside a threat' },
  { c: 'authority_impersonation', w: 20, re: /\bsocial\s+security\s+(?:number|administration)\b.{0,60}\b(?:suspend|block|compromis|fraud|arrest)\w*/i, note: 'Claims a Social Security number is compromised' },
  { c: 'authority_impersonation', w: 18, re: /\b(?:warrant|writ)\s+(?:for\s+your\s+arrest|has\s+been\s+issued)\b/i, note: 'Threatens arrest' },
  { c: 'authority_impersonation', w: 16, re: /\bgovernment\s+(?:grant|refund|settlement)\b.{0,40}\b(?:qualif|eligib|claim)\w*/i, note: 'Offers a government grant or refund' },
  { c: 'authority_impersonation', w: 15, re: /\b(?:badge|agent|case|docket)\s+(?:number|id)\s*[:#]?\s*[A-Z0-9-]{4,}/i, note: 'Cites a badge or case number' },
  { c: 'authority_impersonation', w: 14, re: /\b(?:medicare|medicaid)\b.{0,50}\b(?:verify|confirm|reactivate|new\s+card)\b/i, note: 'Medicare verification pretext' },
  { c: 'authority_impersonation', w: 15, re: /\b(?:fbi|dea|customs|border\s+protection|sheriff)\b.{0,50}\b(?:seized|detained|investigation|fine)\b/i, note: 'Invokes law enforcement' },

  // irreversible_payment
  { c: 'irreversible_payment', w: 22, re: /\bgift\s+cards?\b.{0,60}\b(?:pay|payment|purchase|buy|send|code)\w*/i, note: 'Requests payment in gift cards' },
  { c: 'irreversible_payment', w: 18, re: /\b(?:wire\s+transfer|western\s+union|moneygram)\b/i, note: 'Requests a wire transfer' },
  { c: 'irreversible_payment', w: 16, re: /\b(?:zelle|cash\s?app|venmo)\b.{0,40}\b(?:only|required|friends\s+and\s+family)\b/i, note: 'Restricts payment to a non-reversible cash app' },
  { c: 'irreversible_payment', w: 18, re: /\b(?:bitcoin|crypto|usdt|ethereum)\s+(?:atm|kiosk)\b/i, note: 'Directs to a crypto ATM' },
  // Crypto-only demands show up in both word orders, so cover each.
  { c: 'irreversible_payment', w: 14, re: /\b(?:crypto\w*|bitcoin|btc|usdt|ethereum|eth)\b[\s,]*(?:payments?\s+)?only\b/i, note: 'Accepts only crypto' },
  { c: 'irreversible_payment', w: 14, re: /\b(?:only|exclusively)\s+(?:accept\w*|tak\w+|via|in|through)\s+(?:\w+\s+){0,2}?(?:crypto\w*|bitcoin|btc|usdt|ethereum)\b/i, note: 'Accepts only crypto' },
  { c: 'irreversible_payment', w: 13, re: /\bpayments?\s+(?:accepted\s+)?(?:in|via|by)\s+(?:crypto\w*|bitcoin|btc|usdt|ethereum|gift\s+cards?|wire)\b/i, note: 'Payment restricted to a non-reversible rail' },
  { c: 'irreversible_payment', w: 15, re: /\b(?:processing|release|clearance|transfer|customs)\s+fee\b.{0,40}\b(?:before|to\s+release|required)\b/i, note: 'Advance fee required before payout' },

  // secrecy
  { c: 'secrecy', w: 16, re: /\b(?:don'?t|do\s+not)\s+tell\s+(?:anyone|your\s+(?:family|bank|spouse))\b/i, note: 'Asks you to conceal the transaction' },
  { c: 'secrecy', w: 14, re: /\bkeep\s+this\s+(?:between\s+us|confidential|private|to\s+yourself)\b/i, note: 'Requests confidentiality' },
  { c: 'secrecy', w: 15, re: /\b(?:bank|teller|employee)s?\s+(?:may|will|might)\s+(?:try\s+to\s+)?(?:stop|question|block)\s+you\b/i, note: 'Preemptively discredits your bank' },

  // credential_harvest
  { c: 'credential_harvest', w: 18, re: /\b(?:verify|confirm|re-?enter|update)\s+your\s+(?:account|password|credentials|identity|login|payment\s+details)\b/i, note: 'Asks you to re-enter credentials' },
  { c: 'credential_harvest', w: 18, re: /\baccount\s+(?:has\s+been\s+)?(?:suspended|locked|limited|restricted|disabled)\b/i, note: 'Claims your account is locked' },
  { c: 'credential_harvest', w: 15, re: /\b(?:unusual|suspicious)\s+(?:sign[\s-]?in|login|activity)\s+(?:detected|attempt)\b/i, note: 'Alleges suspicious sign-in activity' },
  { c: 'credential_harvest', w: 16, re: /\b(?:click|tap)\s+(?:here|the\s+link)\s+to\s+(?:verify|confirm|restore|unlock|reactivate)\b/i, note: 'Link-driven account restoration' },
  { c: 'credential_harvest', w: 17, re: /\b(?:share|provide|enter)\s+(?:the\s+)?(?:otp|one[\s-]time\s+(?:code|password)|2fa|verification\s+code)\b/i, note: 'Requests a one-time verification code' },
  { c: 'credential_harvest', w: 20, re: /\b(?:seed\s+phrase|recovery\s+phrase|private\s+key|mnemonic)\b/i, note: 'Requests a wallet recovery phrase or private key' },

  // unsolicited_windfall
  { c: 'unsolicited_windfall', w: 16, re: /\byou(?:'ve|\s+have)\s+(?:been\s+)?(?:selected|chosen|won|awarded)\b/i, note: 'Claims you were selected or have won' },
  { c: 'unsolicited_windfall', w: 16, re: /\b(?:unclaimed|unpaid)\s+(?:funds|money|refund|balance|settlement)\b/i, note: 'Alleges unclaimed funds' },
  { c: 'unsolicited_windfall', w: 15, re: /\b(?:inheritance|next\s+of\s+kin|deceased\s+(?:client|relative))\b/i, note: 'Inheritance pretext' },
  { c: 'unsolicited_windfall', w: 14, re: /\b(?:lottery|sweepstakes|prize\s+draw)\b.{0,50}\b(?:winner|claim|congratulations)\b/i, note: 'Lottery or sweepstakes win' },

  // tech_support
  { c: 'tech_support', w: 20, re: /\b(?:anydesk|teamviewer|ultraviewer|logmein|supremo|quick\s?assist)\b/i, note: 'Names remote-access software' },
  { c: 'tech_support', w: 18, re: /\b(?:call|contact)\s+(?:this\s+number|support|microsoft|apple|our\s+technicians?)\s+(?:immediately|now|at\s+[\d(+])/i, note: 'Urges you to call a support number' },
  { c: 'tech_support', w: 18, re: /\byour\s+(?:computer|device|pc|mac)\s+(?:is|has\s+been)\s+(?:infected|compromised|locked|blocked)\b/i, note: 'Claims your device is infected' },
  { c: 'tech_support', w: 16, re: /\b(?:subscription|auto[\s-]?renewal)\b.{0,60}\b(?:charged|debited|cancel\s+within|refund)\b/i, note: 'Fake renewal or refund pretext' },
  { c: 'tech_support', w: 14, re: /\bdo\s+not\s+(?:shut\s?down|restart|turn\s+off)\s+your\s+(?:computer|device)\b/i, note: 'Tells you not to reboot' },

  // relationship_investment
  { c: 'relationship_investment', w: 18, re: /\b(?:trading|investment)\s+(?:mentor|coach|guru|uncle|aunt)\b/i, note: 'Personal investment mentor framing' },
  { c: 'relationship_investment', w: 16, re: /\b(?:met|matched|connected)\s+(?:on|through)\s+(?:whatsapp|telegram|instagram|tinder|bumble|hinge|facebook)\b.{0,60}\b(?:invest|trading|profit|platform)\b/i, note: 'Investment pitch from a social-app contact' },
  { c: 'relationship_investment', w: 15, re: /\b(?:pig\s+butchering|sha\s+zhu\s+pan)\b/i, note: 'Explicit reference to pig-butchering fraud' },
  { c: 'relationship_investment', w: 14, re: /\b(?:join|move)\s+(?:our|the)\s+(?:vip|private|exclusive)\s+(?:telegram|whatsapp|signal|discord)\s+(?:group|channel)\b/i, note: 'Pushes you into a private messaging group' },

  // social_proof
  { c: 'social_proof', w: 9, re: /\b(?:as\s+seen\s+on|featured\s+(?:in|on))\s+(?:forbes|cnbc|bloomberg|abc|nbc|cbs|fox)\b/i, note: 'Claims major-media coverage' },
  { c: 'social_proof', w: 10, re: /\b(?:elon\s+musk|warren\s+buffett|cathie\s+wood|jeff\s+bezos)\b.{0,50}\b(?:endorse|recommend|backs?|invest)\w*/i, note: 'Celebrity endorsement claim' },
  { c: 'social_proof', w: 8, re: /\bjoin\s+(?:over\s+)?[\d,]{4,}\s+(?:members|investors|traders|users)\b/i, note: 'Large-membership claim' },
  { c: 'social_proof', w: 9, re: /\b(?:thousands|millions)\s+of\s+(?:satisfied|happy)\s+(?:customers|clients|investors)\b/i, note: 'Unverifiable testimonial volume' },

  // job_scam
  { c: 'job_scam', w: 16, re: /\b(?:earn|make)\s+\$?\d{2,5}\s*(?:\+|per|a|\/)\s*(?:day|hour|week|task)\b/i, note: 'Specific per-task or per-day earnings claim' },
  { c: 'job_scam', w: 15, re: /\b(?:task|order)[\s-]?(?:based|grabbing)\s+(?:job|work|platform)\b/i, note: 'Task-grabbing work platform' },
  { c: 'job_scam', w: 15, re: /\b(?:deposit|top\s?up|prepay)\b.{0,50}\b(?:to\s+unlock|before\s+withdrawal|to\s+continue\s+tasks?)\b/i, note: 'Requires your own deposit to keep working' },
  { c: 'job_scam', w: 13, re: /\b(?:reship|package\s+forwarding|payment\s+processing)\s+(?:agent|job|from\s+home)\b/i, note: 'Reshipping or money-mule role' },

  // crypto_lure
  { c: 'crypto_lure', w: 16, re: /\b(?:connect|link)\s+your\s+wallet\b.{0,60}\b(?:claim|airdrop|verify|unlock|reward)\b/i, note: 'Wallet-connect paired with a reward' },
  { c: 'crypto_lure', w: 15, re: /\b(?:airdrop|free\s+mint)\b.{0,40}\b(?:claim|eligible|limited)\b/i, note: 'Airdrop or free-mint claim flow' },
  { c: 'crypto_lure', w: 18, re: /\bsend\s+[\d.]+\s*(?:btc|eth|sol|bnb)\b.{0,50}\b(?:receive|get|back|double|2x|5x)\b/i, note: 'Send-to-receive multiplier giveaway' },
  { c: 'crypto_lure', w: 13, re: /\b(?:liquidity|staking)\s+(?:pool|program)\b.{0,40}\b(?:guaranteed|fixed|daily)\s+(?:apy|apr|return)\b/i, note: 'Fixed-yield staking claim' },

  // evasion
  { c: 'evasion', w: 14, re: /\b(?:ignore|disregard)\s+(?:the\s+)?(?:negative\s+)?(?:reviews|warnings|reports)\b/i, note: 'Tells you to ignore warnings' },
  { c: 'evasion', w: 13, re: /\bno\s+(?:kyc|verification|id\s+(?:check|required)|background\s+check)\b/i, note: 'Advertises absence of identity checks' },
  { c: 'evasion', w: 12, re: /\b(?:unregulated|offshore)\s+(?:broker|exchange|platform)\b/i, note: 'Offshore or unregulated venue' },
  { c: 'evasion', w: 13, re: /\bdon'?t\s+(?:google|search|look\s+us\s+up)\b/i, note: 'Discourages independent research' },
];

const MAX_EVIDENCE = 90;

/**
 * Run the behavioral pass over a block of text.
 * Returns a 0..100 subscore plus the individual hits, deduped by pattern.
 */
export function analyzeText(text) {
  const hits = [];
  if (!text || typeof text !== 'string') {
    return { score: 0, hits, categories: [] };
  }
  const haystack = text.replace(/\s+/g, ' ').slice(0, 60000);
  const perCategory = new Map();

  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g');
    const seen = new Set();
    let m;
    let count = 0;
    while ((m = re.exec(haystack)) !== null && count < 5) {
      const key = m[0].toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        count++;
        const start = Math.max(0, m.index - 30);
        hits.push({
          category: p.c,
          categoryLabel: CATEGORIES[p.c].label,
          note: p.note,
          weight: p.w,
          evidence: haystack.slice(start, Math.min(haystack.length, m.index + m[0].length + 30)).trim().slice(0, MAX_EVIDENCE),
        });
      }
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }

  // Apply per-category caps: first hit at full weight, repeats at 40%.
  for (const h of hits) {
    const cur = perCategory.get(h.category) || { total: 0, n: 0 };
    const applied = cur.n === 0 ? h.weight : h.weight * 0.4;
    cur.total = Math.min(CATEGORIES[h.category].cap, cur.total + applied);
    cur.n++;
    perCategory.set(h.category, cur);
  }

  let raw = 0;
  const categories = [];
  for (const [cat, v] of perCategory) {
    raw += v.total;
    categories.push({
      id: cat,
      label: CATEGORIES[cat].label,
      context: CATEGORIES[cat].context,
      points: Math.round(v.total),
      matches: v.n,
    });
  }
  categories.sort((a, b) => b.points - a.points);

  // Saturating curve: several distinct categories matter more than one loud one.
  const distinctBonus = Math.max(0, categories.length - 1) * 4;
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-(raw + distinctBonus) / 45)))));

  hits.sort((a, b) => b.weight - a.weight);
  return { score, hits: hits.slice(0, 25), categories };
}
