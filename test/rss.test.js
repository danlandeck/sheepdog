import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, htmlToText, decodeEntities } from '../server/src/rss.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Federal Trade Commission - Protecting America's Consumers</title>
  <link>https://www.ftc.gov</link>
  <item>
    <title>FTC Takes Action Against Humboldt Merchant Services</title>
    <link>https://www.ftc.gov/news-events/news/press-releases/2026/09/example-one</link>
    <description><![CDATA[<p>The FTC alleges the company &amp; its officers knowingly processed payments for sham merchants.</p>]]></description>
    <pubDate>Tue, 08 Sep 2026 08:00:00 -0400</pubDate>
    <guid isPermaLink="false">ftc-2026-09-08-humboldt</guid>
    <category>Consumer Protection</category>
  </item>
  <item>
    <title>Payment Processor Nuvei Must Pay $4.85 Million</title>
    <link>https://www.ftc.gov/news-events/news/press-releases/2026/09/example-two</link>
    <description>Settlement announced.</description>
    <pubDate>Fri, 04 Sep 2026 08:00:00 -0400</pubDate>
    <guid isPermaLink="false">ftc-2026-09-04-nuvei</guid>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CISA Cybersecurity Advisories</title>
  <entry>
    <title>Advisory on Exploited VPN Appliance</title>
    <link rel="alternate" type="text/html" href="https://www.cisa.gov/advisory/aa26-001"/>
    <link rel="self" href="https://www.cisa.gov/feed"/>
    <id>urn:uuid:aa26-001</id>
    <published>2026-09-01T12:00:00Z</published>
    <summary type="html">&lt;p&gt;Threat actors are exploiting CVE-2026-1234.&lt;/p&gt;</summary>
    <category term="ICS"/>
  </entry>
</feed>`;

test('parses RSS 2.0 including CDATA and entities', () => {
  const f = parseFeed(RSS);
  assert.equal(f.format, 'rss');
  assert.match(f.title, /Federal Trade Commission/);
  assert.equal(f.items.length, 2);

  const [a] = f.items;
  assert.equal(a.title, 'FTC Takes Action Against Humboldt Merchant Services');
  assert.equal(a.guid, 'ftc-2026-09-08-humboldt');
  assert.match(a.url, /example-one$/);
  assert.match(a.summary, /company & its officers/);
  assert.doesNotMatch(a.summary, /<p>/, 'HTML should be stripped from the summary');
  assert.equal(a.publishedAt, '2026-09-08T12:00:00.000Z');
  assert.deepEqual(a.categories, ['Consumer Protection']);
});

test('parses Atom and picks the alternate link, not the self link', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.format, 'atom');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].url, 'https://www.cisa.gov/advisory/aa26-001');
  assert.equal(f.items[0].guid, 'urn:uuid:aa26-001');
  assert.match(f.items[0].summary, /CVE-2026-1234/);
  assert.equal(f.items[0].publishedAt, '2026-09-01T12:00:00.000Z');
  assert.deepEqual(f.items[0].categories, ['ICS']);
});

test('malformed input degrades to an empty result rather than throwing', () => {
  for (const bad of ['', '<html><body>not a feed</body></html>', '<rss><channel>', null, undefined, 42]) {
    const f = parseFeed(bad);
    assert.equal(Array.isArray(f.items), true);
    assert.equal(f.items.length, 0);
  }
});

test('htmlToText drops scripts and collapses whitespace', () => {
  const out = htmlToText('<div><script>alert(1)</script><style>p{}</style><p>Hello   world</p><p>Second</p></div>');
  assert.doesNotMatch(out, /alert|style/);
  assert.match(out, /Hello world/);
  assert.match(out, /Second/);
});

test('decodeEntities handles named and numeric references', () => {
  assert.equal(decodeEntities('a &amp; b &#8212; c &#x2014; d &nbsp;e'), 'a & b — c — d  e');
});

test('items without a publish date still survive parsing', () => {
  const f = parseFeed(`<rss version="2.0"><channel><title>x</title><item><title>No date</title><link>https://e.test/a</link></item></channel></rss>`);
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].publishedAt, null);
});
