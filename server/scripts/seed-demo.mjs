#!/usr/bin/env node
/**
 * Seed the store with a small set of representative items, scored by the real
 * engine rather than hand-written.
 *
 * Two uses: seeing the ticker before the server has network access to the live
 * feeds, and having a stable data set while working on the UI.
 *
 *   npm run seed:demo
 *
 * Live ingest overwrites nothing here; demo items age out with everything else.
 */

import { Store, defaultStorePath, idFor } from '../src/store.js';
import { assess } from '../../shared/score.js';
import { buildIndex } from '../../shared/regulatory.js';
import { loadSeedLists } from '../src/ingest.js';

const now = Date.now();
const ago = (h) => new Date(now - h * 3600000).toISOString();

const DEMO = [
  {
    source: 'FTC', sourceName: 'FTC Press Releases (Consumer Protection)', enforcement: true,
    title: 'FTC Takes Action Against Example Fraud Corp for Operating a Deceptive Investment Platform',
    summary: 'The Commission alleges the defendants promised guaranteed returns of 12% per month and told investors their principal was fully protected, while operating the platform as a Ponzi scheme. Payments were accepted in cryptocurrency only.',
    url: 'https://www.ftc.gov/news-events/news/press-releases/example', publishedAt: ago(3),
    extraDomains: ['example-fraud-corp.test'],
  },
  {
    source: 'FTC_CONSUMER', sourceName: 'FTC Consumer Advice', enforcement: false,
    title: 'Scammers are spoofing car dealership websites: what to watch for',
    summary: 'Fake dealership sites ask for a deposit by wire transfer or gift card before you ever see the vehicle. Act now pressure and a deadline of 24 hours are the tell.',
    url: 'https://consumer.ftc.gov/consumer-alerts/example', publishedAt: ago(9),
  },
  {
    source: 'SEC', sourceName: 'SEC Press Releases', enforcement: true,
    title: 'SEC Charges Northstar Yield Partners with Operating a Ponzi Scheme',
    summary: 'The complaint alleges the firm told investors the fund was risk-free and that returns were guaranteed, while using new deposits to pay earlier investors.',
    url: 'https://www.sec.gov/newsroom/press-releases/example', publishedAt: ago(20),
  },
  {
    source: 'IC3', sourceName: 'FBI IC3 Industry Alerts', enforcement: false,
    title: 'Criminals Are Impersonating Bank Fraud Departments to Move Victim Funds',
    summary: 'Callers claim unusual sign-in activity was detected and tell the victim to verify their account, then instruct them not to tell bank employees, warning that staff may try to stop the transfer.',
    url: 'https://www.ic3.gov/CSA/example', publishedAt: ago(30),
  },
  {
    source: 'CFPB', sourceName: 'CFPB Newsroom', enforcement: true,
    title: 'CFPB Announces Joint Final Rule on Adopting Uniform Standards for Reporting Financial Data',
    summary: 'The rule harmonizes reporting formats across agencies. Compliance begins next year.',
    url: 'https://www.consumerfinance.gov/about-us/newsroom/example', publishedAt: ago(44),
  },
  {
    source: 'KREBS', sourceName: 'Krebs on Security', enforcement: false,
    title: 'Task-Based Job Scams Move From Telegram to Mainstream Job Boards',
    summary: 'Recruits are told they can earn $300 per day completing tasks, then required to deposit their own funds to unlock further work before any withdrawal is permitted.',
    url: 'https://krebsonsecurity.com/example', publishedAt: ago(52),
  },
  {
    source: 'BLEEPINGCOMPUTER', sourceName: 'BleepingComputer', enforcement: false,
    title: 'Fake Wallet-Connect Pages Drain Funds Through a Single Approval',
    summary: 'Victims are told to connect their wallet to claim an airdrop. A single signature grants unlimited spend approval, and the wallet is emptied minutes later.',
    url: 'https://www.bleepingcomputer.com/news/example', publishedAt: ago(64),
  },
  {
    source: 'FTC', sourceName: 'FTC Press Releases (Consumer Protection)', enforcement: true,
    title: 'FTC Extends Public Comment Period on Proposed Policy Statement Regarding Personalized Pricing',
    summary: 'The Commission extended the comment period by an additional 30 days in response to requests from stakeholders.',
    url: 'https://www.ftc.gov/news-events/news/press-releases/example-2', publishedAt: ago(72),
  },
];

const store = await new Store(process.env.STORE_PATH || defaultStorePath()).load();
if (!store.listEntries.length) store.setListEntries(await loadSeedLists());
const index = buildIndex(store.listEntries);

let n = 0;
for (const d of DEMO) {
  const r = assess({
    kind: 'news',
    title: d.title, summary: d.summary, body: d.summary,
    url: d.url, source: d.source, sourceName: d.sourceName,
    enforcement: d.enforcement, publishedAt: d.publishedAt,
    extraDomains: d.extraDomains,
  }, index);

  store.upsert({
    id: idFor(d.source, `demo:${d.title}`),
    kind: 'news', demo: true,
    source: d.source, sourceName: d.sourceName,
    title: d.title, summary: d.summary, url: d.url,
    categories: [], publishedAt: d.publishedAt, firstSeen: new Date().toISOString(),
    enforcement: d.enforcement, contentHash: `demo-${n}`,
    score: r.score, band: r.band, bandLabel: r.bandLabel, color: r.color, signals: r.signals,
  });
  console.log(`${String(r.score).padStart(3)} ${r.band.padEnd(9)} ${d.title.slice(0, 72)}`);
  n++;
}

await store.persist();
console.log(`\nSeeded ${n} demo items into ${store.file}. Start the server and the ticker will show them.`);
