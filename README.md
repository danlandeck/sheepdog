# Sheepdog

**Sheepdog watches for the signs of a fraudulent website and tells you, in plain language, when something is wrong.**

Sheepdog™ · Copyright © 2026 Daniel Landeck · Free and open source under the Apache License 2.0. The Sheepdog name, wordmark and logo are trademarks. See `LICENSE` and `NOTICE`.

---

## Install

**Sheepdog is awaiting review at the Chrome Web Store.** The install link goes here as soon as it is approved.

It will be free, with no paid tier, no upsell and no advertising.

When it is live, installing is one click from the store, on Chrome, Edge, Brave or any other Chromium browser. Nothing to download, no account, and nothing to configure. It works the moment it is added and updates itself.

---

## What it does

Most of the time, nothing. Sheepdog shows no bar, no badge and no notifications while you browse normally.

When you land on a page built to impersonate a real company, it takes over the bottom of the window in red and says what is happening:

> **This page is built to steal your PayPal password.**
> Do not enter it. Open PayPal yourself from your bookmarks or by searching.

Then it explains why, in sentences anyone can read. No scores to interpret and no jargon, and there is always something concrete to do about it.

### What it looks for

- Web addresses built to imitate a real company: misspellings, lookalike characters, and a real brand name parked in front of a domain that has nothing to do with it
- Pages asking for a password, a security code, or a crypto wallet recovery phrase
- Demands for payment by gift card, wire transfer, or cryptocurrency
- Fake virus warnings and fake support phone numbers
- Investment pitches promising returns nobody can guarantee
- Websites registered days ago that are already asking for your details

---

## Two things you can turn on

**The news ticker.** If you want the news rather than only the warnings, switch to Ticker mode and a crawl of scored fraud and enforcement stories runs along the edge of the page, drawn from the Federal Trade Commission, the Securities and Exchange Commission, the Consumer Financial Protection Bureau, the FBI's Internet Crime Complaint Center, and the security press. Every headline carries a risk score from 0 to 100 on a green to red scale, and clicking one opens the full reasoning behind it.

**A review of your other extensions.** Browser extensions get bought and repurposed, and the permissions you granted survive the sale. Sheepdog can review the ones you have installed and tell you what each one could do with the access it already holds. This asks your permission separately, at the moment you ask for it, and never at install time.

---

## Privacy

**Nothing about your browsing is transmitted anywhere.**

- Sites are analyzed entirely on your own computer. The address of the page you are on is never sent anywhere, not to a server of ours and not to anyone else.
- The extension review reads only each extension's name, install type and permission list, and scores them on your machine.
- No accounts, no sign-in, no advertising, no analytics, no tracking, no identifiers of any kind.
- The one thing Sheepdog downloads is a public news file, identical for every user, from a single fixed address. It contains no information about you.
- Optional deeper page analysis is off by default, and even switched on it reads the page text locally and transmits nothing.
- You can name domains where Sheepdog should not run at all.

The full privacy policy is published at `https://danlandeck.github.io/sheepdog/privacy.html` and linked from the store listing. It is generated from the same repository, so it cannot quietly drift from what the code does.

If you want to verify any of the above rather than take it on faith, the network behaviour is in `extension/src/background/service-worker.js`. There is exactly one address the extension contacts, and it is baked into the build.

---

## Honest limits

**Sheepdog cannot see software installed on your computer.** A browser extension is sandboxed to the browser: no filesystem, no running processes, no traffic from other applications. Anything claiming otherwise from within a browser extension is not telling you the truth.

What it does see precisely is the browser's own attack surface, which is where most consumer browser compromise actually happens: the site in the active tab, and the extensions you have installed.

**Sheepdog declares access to all websites,** which is the same broad permission it flags as high risk in other extensions. It needs it for one reason: a warning that has to appear on a fraudulent page cannot know in advance which page that will be. That is the honest trade, it is stated on the settings page too, and the extension review deliberately scores Sheepdog's own permissions the same way it scores everyone else's.

**Sheepdog is a screening tool, not a verdict.** Scores come from pattern analysis and public enforcement records. They are not judgments about any person or company, and nothing here is legal or financial advice. A clean result is not a guarantee that a site is safe, and no tool replaces caution about unexpected requests for money, passwords or codes.

---

## For developers

The source is here in full, and the scoring engine is the interesting part.

### How a score is built

Five passes. Four are scored and weighted; the fifth is a multiplier.

| Pass | What it answers | News | Site | Extension |
|---|---|---:|---:|---:|
| **Incident severity** | What happened, and at what scale | 44% | 4% | 0% |
| **Regulatory cross-reference** | Is this entity or domain on an enforcement or advisory list | 30% | 20% | 28% |
| **Behavioral analysis** | Does the text use manipulation tactics | 20% | 36% | 4% |
| **Structural analysis** | What the domain or the permission set gives away | 6% | 40% | 68% |
| **Source confidence** | How much to trust the finding | ×0.72–1.08 | ×1 | ×1 |

Bands: 0–24 low (green), 25–49 elevated (yellow), 50–74 high (orange), 75–100 severe (red).

Three decisions worth knowing about:

**Source confidence multiplies, it does not add.** An early version added points for publisher authority, which gave a routine FTC notice about a comment period the same score as an SEC Ponzi charge. Publisher authority tells you how much to trust a finding, not how dangerous the subject is.

**Weights renormalize over the passes that could actually run.** A pass with nothing to examine is absence of evidence, not evidence of safety. Inapplicable weight is redistributed, while a list that ran and found nothing still correctly dilutes. The detail panel shows each pass's effective share for that specific item.

**Behavioral and incident are different questions.** The behavioral lexicon detects what a scam sounds like ("guaranteed returns", "act now", "gift cards only"). A news article describing a scam is written in reportorial prose and trips almost none of it, so a separate pass scores what the article is about: indictments, asset freezes, active exploitation, funds drained, victim counts, dollar magnitude. Procedural language such as comment periods and rulemaking carries negative weight and pulls administrative noise back to zero.

`test/scoring.test.js` locks the relative ranking of representative real headlines, so a lexicon edit that reshuffles them fails the suite even when every unit test still passes.

### Architecture

There is no server. A scheduled GitHub Action fetches the sources every four hours, scores everything with the same engine the extension runs, and writes static JSON to GitHub Pages. Installed extensions read those files directly. Site and extension scoring happen entirely in the browser. Zero production dependencies, anywhere in the project.

```
shared/          Scoring engine. Canonical source, runs in Node and in the browser.
  lexicon.js       Behavioral: manipulation-language patterns
  incident.js      Incident severity: what happened and how big
  structural.js    Domain analysis and extension permission risk
  regulatory.js    List index, matching, enforcement-name derivation
  score.js         Composite, renormalization, bands
  plain.js         Plain-language translation of findings

server/          The collector. Runs in CI, not in production.
  src/sources.js   Feed configuration. Add a source here, nothing else.
  src/rss.js       RSS 2.0 / Atom parser, hand-rolled
  src/ingest.js    fetch -> parse -> enrich -> score -> store
  scripts/publish-feed.mjs   Writes the static feed, lists and privacy policy

extension/       Manifest V3. src/shared/ is a generated mirror of /shared.

scripts/
  build-release.mjs      Builds the store-ready zip against a feed address
  sync-shared.mjs        Mirrors /shared into the extension
  validate-extension.mjs Pre-flight: manifest refs, parse goals, CSP, sync
```

### Working on it

```bash
node scripts/sync-shared.mjs          # after any change to /shared
node --test "test/*.test.js"          # 58 tests
node scripts/validate-extension.mjs   # pre-flight before loading in Chrome
```

Nothing to install first. Node 18.17 or newer is the only requirement.

To run the collector locally instead of reading the published feed, start `node server/src/index.js` and point the extension's settings at it. To check whether every news source is still reachable, run `node server/scripts/check-sources.mjs`.

To build an installable package, run scripts/build-release.mjs with a --feed address and a --version. It bakes the feed address into the bundle, refuses anything that is not HTTPS, and validates the result before packaging.
