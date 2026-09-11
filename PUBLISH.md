# Publishing Sheepdog to the Chrome Web Store

Six things to do. Everything you need to paste is in this file.

The store listing is free. The developer account costs a one-time fee of a few
dollars, paid once, ever.

---

## 1. Put the feed online

The extension reads its news from static files. They have to live at a public
address before you can build the version you submit.

1. Push this folder to a **public** GitHub repository named `sheepdog`.
2. Repo **Settings** → **Pages** → Source: **GitHub Actions**.
3. Repo **Settings** → **Secrets and variables** → **Actions** → **Variables** tab
   → **New repository variable**, twice:

   | Name | Value |
   |---|---|
   | `PUBLISHER_NAME` | Your name, or your LLC |
   | `PUBLISHER_EMAIL` | An address you will keep |

4. **Actions** tab → **Publish feed** → **Run workflow**.

Confirm both of these load in a browser:

```
https://danlandeck.github.io/sheepdog/feed.json
https://danlandeck.github.io/sheepdog/privacy.html
```

The second is your privacy policy, which the store requires and which must stay
reachable for as long as the extension is listed. It is published automatically
with the feed, so there is nothing else to host.

From here it refreshes itself every four hours.

---

## 2. Build the file you upload

```
node scripts/build-release.mjs --feed https://danlandeck.github.io/sheepdog --version 1.0.0
```

Produces `dist/sheepdog-1.0.0.zip`. That is the file Google wants.

---

## 3. Take four screenshots

Required: at least one, **1280×800 PNG**. Take them from the running extension.
No marketing text over them.

1. The red warning bar on a page. This is the image people judge.
2. The detail panel open.
3. The settings page.
4. Ticker mode.

---

## 4. Create the developer account

<https://chrome.google.com/webstore/devconsole>

Sign in with a Google account you intend to keep permanently. The email cannot
be changed later, and a deleted account's address can never be reused. Pay the
one-time fee.

---

## 5. Upload and fill in the form

Click **New item**, upload the zip from step 2, then paste the following.

### Store name
```
Sheepdog Scam Alerts
```

### Category
Productivity

### Privacy policy URL
```
https://danlandeck.github.io/sheepdog/privacy.html
```

### Single purpose
```
Sheepdog warns you when the website you are on, or an extension you have
installed, matches known fraud patterns, and explains why in plain language.
```

### Detailed description
```
Sheepdog watches for the signs of a fraudulent website and tells you, in plain
language, when something is wrong.

QUIET UNTIL IT MATTERS

By default Sheepdog shows nothing at all. No bar, no badge, no noise. If you
land on a page built to impersonate your bank, it takes over the bottom of the
window in red and says exactly what is happening:

  "This page is built to steal your PayPal password."
  Do not enter it. Open PayPal yourself from your bookmarks or by searching.

Then it tells you why, in sentences anyone can read. No jargon, no scores to
interpret, and always something to do about it.

WHAT IT LOOKS FOR

  - Web addresses built to imitate a real company, including misspellings,
    lookalike characters, and a real brand name parked in front of a domain
    that has nothing to do with it
  - Pages asking for a password, a security code, or a wallet recovery phrase
  - Demands for payment by gift card, wire, or cryptocurrency
  - Fake virus warnings and fake support numbers
  - Investment pitches promising returns nobody can guarantee
  - Websites registered days ago that are already asking for your details

OPTIONAL: THE TICKER

If you want the news rather than just the warnings, switch to Ticker mode and a
crawl of scored fraud and enforcement stories runs along the edge of the page,
drawn from the Federal Trade Commission, the Securities and Exchange
Commission, the Consumer Financial Protection Bureau, and the FBI's Internet
Crime Complaint Center. Click any headline for the full reasoning behind its
score.

OPTIONAL: CHECK YOUR OTHER EXTENSIONS

Browser extensions get bought and repurposed, and the permissions you granted
survive the sale. Sheepdog can review the ones you have installed and tell you
what each could do with the access it already holds. This asks your permission
separately, at the moment you request it.

NOTHING ABOUT YOUR BROWSING IS TRANSMITTED

Sheepdog analyzes sites entirely on your own computer. The address of the page
you are on is never sent anywhere. There are no accounts, no advertising, no
analytics, and no tracking. The extension downloads a public list of scam news
and does everything else locally.

Risk assessments are screening signals from pattern analysis and public
enforcement records. They are not verdicts about any person or company, and
nothing here is legal or financial advice.
```

### Permission justifications

**storage**
```
Stores the user's own settings (mode, position, risk filter, per-domain
blocklist) and caches the downloaded news feed and reference lists locally so
the extension works immediately on page load and continues to function offline.
```

**alarms**
```
Schedules the periodic refresh of the downloaded news feed. A Manifest V3
service worker is terminated when idle, so chrome.alarms is the only way to
schedule recurring work.
```

**tabs**
```
Reads the hostname of the active tab so the extension can check that site for
fraud indicators and warn the user. The check runs entirely within the extension
on the user's device; the hostname is never transmitted. Full URLs, paths, and
query strings are never read.
```

**host permissions**
```
The extension fetches its scored news feed and reference lists from this single
static address. These are public files identical for every user, containing no
user data, and this is the only origin the extension contacts. Page content is
never sent anywhere, because all analysis runs locally.
```

**content scripts on all sites**
```
The warning banner must be able to appear on any page the user visits, since a
fraudulent site can be at any address. The content script renders the warning
inside a closed shadow root and does not read page content unless the user
enables optional local page-text analysis, which is off by default and which
still transmits nothing.
```

**management (optional permission)**
```
Requested only when the user explicitly asks Sheepdog to review their installed
extensions, never at install time. Used solely to read each extension's name,
install type, and declared permission list, which are scored on the user's own
device. The extension does not disable, uninstall, or modify any other
extension, and this information is never transmitted.
```

**Remote code**: answer **No**.
```
The extension executes no remotely hosted code. All logic ships inside the
package. Network requests return static JSON data only, which is rendered as
text and never evaluated.
```

### Data usage

Answer **No** to every category, including web history. Nothing is transmitted,
so every honest answer is no. Then tick all three certifications, which are true:

- Not sold to third parties, outside of approved use cases
- Not used or transferred for purposes unrelated to the item's single purpose
- Not used or transferred to determine creditworthiness or for lending purposes

---

## 6. Set visibility and submit

Under **Distribution**, choose **Unlisted** for your first release. Anyone with
the link installs it in one click, exactly like any store extension, but it stays
out of store search while you see how it behaves. Switching to Public later does
not require resubmitting from scratch.

Click **Submit for review**. Approval usually takes a few days, sometimes longer
for a first submission.

---

## After approval

Send your grandmother the store link. She clicks **Add to Chrome**. That is the
entire experience: no developer mode, no files, no folder to keep, nothing to
run. Works the same on Windows, Mac, Linux and ChromeOS, and Chrome updates it
for her automatically whenever you publish a new version.

---

## Shipping an update later

1. `node scripts/build-release.mjs --feed https://danlandeck.github.io/sheepdog --version 1.0.1`
2. Upload the new zip to the same listing.
3. Submit.

The version number must increase. Everything else stays as it is.

---

## If the review comes back rejected

The email names the specific policy. The most likely objection is **single
purpose**, because the extension audit can read as a separate product. If that
happens, remove the audit and resubmit: set `extensionAudit: false` in the
defaults in `extension/src/background/service-worker.js`, delete `"management"`
from `optional_permissions` in `extension/manifest.json`, rebuild, and describe
it in the listing as warnings only. Ship the audit later as an update.

Do not argue a rejection across several rounds. Rejections accumulate against
the account.

---

## Keeping it alive

Run this occasionally, or whenever the ticker goes quiet:

```
node server/scripts/check-sources.mjs
```

It prints OK or FAIL for every news source. Feed addresses move; this is the
only maintenance this project needs.
