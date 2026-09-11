/**
 * Feed sources.
 *
 * `verified` records whether the endpoint was confirmed to return a parseable
 * feed on 2026-09-09. The two marked false were reachable but refused the
 * checking client; run `npm run check-sources` from your own host to confirm
 * them there before trusting the flag either way.
 *
 * Adding a source is a config change: give it an id, a URL, a type, and an
 * authority tier. Everything downstream keys off `id`.
 */

export const SOURCES = [
  {
    id: 'FTC',
    name: 'FTC Press Releases (Consumer Protection)',
    url: 'https://www.ftc.gov/feeds/press-release-consumer-protection.xml',
    type: 'rss',
    enforcement: true,
    verified: true,
    weightHint: 'primary',
  },
  {
    id: 'FTC_CONSUMER',
    name: 'FTC Consumer Advice',
    url: 'https://consumer.ftc.gov/blog/rss',
    type: 'rss',
    enforcement: false,
    verified: true,
    weightHint: 'primary',
  },
  {
    id: 'SEC',
    name: 'SEC Press Releases',
    url: 'https://www.sec.gov/news/pressreleases.rss',
    type: 'rss',
    enforcement: true,
    verified: true,
    weightHint: 'primary',
  },
  {
    id: 'CFPB',
    name: 'CFPB Newsroom',
    url: 'https://www.consumerfinance.gov/about-us/newsroom/feed/',
    type: 'rss',
    enforcement: true,
    verified: true,
    weightHint: 'primary',
  },
  {
    id: 'IC3',
    name: 'FBI IC3 Industry Alerts',
    url: 'https://www.ic3.gov/CSA/RSS',
    type: 'rss',
    enforcement: false,
    verified: true,
    weightHint: 'primary',
  },
  {
    id: 'CISA',
    name: 'CISA Cybersecurity Advisories',
    url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml',
    type: 'rss',
    enforcement: false,
    verified: false,
    note: 'Refused an automated client during development. Confirm from your own host.',
    weightHint: 'primary',
  },
  {
    id: 'FCC',
    name: 'FCC Headlines',
    url: 'https://www.fcc.gov/news-events/headlines/feed',
    type: 'rss',
    enforcement: true,
    verified: false,
    note: 'Refused an automated client during development. Confirm from your own host.',
    weightHint: 'primary',
  },
  {
    id: 'KREBS',
    name: 'Krebs on Security',
    url: 'https://krebsonsecurity.com/feed/',
    type: 'rss',
    enforcement: false,
    verified: true,
    weightHint: 'press',
  },
  {
    id: 'BLEEPINGCOMPUTER',
    name: 'BleepingComputer',
    url: 'https://www.bleepingcomputer.com/feed/',
    type: 'rss',
    enforcement: false,
    verified: true,
    weightHint: 'press',
  },
  {
    id: 'THEHACKERNEWS',
    name: 'The Hacker News',
    url: 'https://feeds.feedburner.com/TheHackersNews',
    type: 'rss',
    enforcement: false,
    verified: true,
    weightHint: 'press',
  },
];

/**
 * Structured lists that are not news feeds. These feed the regulatory index
 * directly rather than the ticker.
 */
export const LIST_SOURCES = [
  {
    id: 'CISA_KEV',
    name: 'CISA Known Exploited Vulnerabilities',
    url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    type: 'json',
    verified: false,
    note: 'Refused an automated client during development. Confirm from your own host.',
    /** Map the KEV catalog into regulatory index entries. */
    map: (json) =>
      (json?.vulnerabilities || []).slice(0, 4000).map((v) => ({
        list: 'CISA_KEV',
        entity: `${v.vendorProject} ${v.product}`,
        aliases: [v.product],
        domains: [],
        action: `Known exploited vulnerability ${v.cveID}: ${v.vulnerabilityName}`,
        severity: v.knownRansomwareCampaignUse === 'Known' ? 'high' : 'medium',
        date: v.dateAdded || null,
        url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      })),
  },
];

/** Only items newer than this are kept on ingest. */
export const MAX_ITEM_AGE_DAYS = 45;
