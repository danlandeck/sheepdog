/**
 * Sheepdog service worker.
 *
 * Responsibilities:
 *   1. Poll the aggregation backend for scored news items.
 *   2. Assess the active tab's domain and, when the user opts in, its visible
 *      text, injecting the result into the crawl as a live alert.
 *   3. Audit installed extensions on a schedule and raise alerts for the
 *      dangerous ones.
 *   4. Degrade to fully local scoring when the backend is unreachable.
 *
 * MV3 workers get killed aggressively, so nothing lives in memory across
 * messages. Every handler reads state from chrome.storage.
 */

import { assess } from '../shared/score.js';
import { buildIndex } from '../shared/regulatory.js';
import { plainWarning } from '../shared/plain.js';

/* --------------------------------------------------------------- settings */

export const DEFAULTS = {
  enabled: true,
  /*
   * Two ways to get the news feed.
   *
   * 'static' is what a Chrome Web Store install uses: a handful of JSON files
   * on a CDN, published by a scheduled job. No server exists, so there is
   * nothing for the user to run and nothing for anyone to keep alive. Site and
   * extension scoring happen entirely inside the browser, using the same engine
   * plus a regulatory index downloaded alongside the feed.
   *
   * 'service' points at a running collector, which is what development uses and
   * what someone self-hosting would choose.
   *
   * The checked-in default is 'service' so that loading this folder unpacked
   * works immediately against a local collector. build-release.mjs flips it to
   * 'static' and bakes in the published address, so the shipped build never
   * depends on anything running.
   */
  feedMode: 'service',       // static | service
  feedUrl: '',               // base URL of the published static feed
  backendUrl: 'http://localhost:8787',
  pollMinutes: 15,
  minBand: 'low',
  speed: 'normal',          // slow | normal | fast
  theme: 'dark',            // dark | light
  position: 'bottom',       // bottom | top
  reserveSpace: false,      // push page content up instead of overlaying
  siteAssessment: true,
  deepPageAnalysis: false,  // send page text to the backend for behavioral scoring
  extensionAudit: true,
  blocklist: [],
  mutedSources: [],
  alertThreshold: 50,       // minimum score for a live alert to be injected
  // guard: silent until something is actually wrong, for people who want
  // protection rather than a feed. ticker: the full crawl. New installs get
  // guard, because the crawl is opt-in attention and most people never asked
  // for it.
  mode: 'guard',            // guard | ticker
};

const BAND_RANK = { low: 0, elevated: 1, high: 2, severe: 3 };

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  await rescheduleAlarms(next);
  await broadcast({ type: 'SETTINGS_CHANGED', settings: next });
  return next;
}

/* ------------------------------------------------------------------ state */

async function getState() {
  const s = await chrome.storage.local.get(['feed', 'alerts', 'status', 'detailCache']);
  return {
    feed: s.feed || { items: [], fetchedAt: null },
    alerts: s.alerts || [],
    status: s.status || { backend: 'unknown', lastError: null, lastPoll: null },
    detailCache: s.detailCache || {},
  };
}

/* ---------------------------------------------------------------- backend */

function api(base, path) {
  return `${String(base).replace(/\/+$/, '')}${path}`;
}

/** Where the feed lives, whichever mode is in play. */
function feedBase(settings) {
  return settings.feedMode === 'static' ? settings.feedUrl : settings.backendUrl;
}

function feedUrlFor(settings) {
  return settings.feedMode === 'static'
    ? api(settings.feedUrl, '/feed.json')
    : api(settings.backendUrl, '/api/feed?limit=150');
}

function itemUrlFor(settings, id) {
  return settings.feedMode === 'static'
    ? api(settings.feedUrl, `/items/${encodeURIComponent(id)}.json`)
    : api(settings.backendUrl, `/api/item/${encodeURIComponent(id)}`);
}

async function fetchJson(url, init = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Deliberately NOT cache:'no-store'. The default cache mode lets the
    // browser send If-None-Match and turn an unchanged feed into a 304 with no
    // body, which is the difference between kilobytes and megabytes per user
    // per day. Freshness is governed by the server's cache-control instead.
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function pollFeed() {
  const settings = await getSettings();
  if (!settings.enabled) return;

  if (settings.feedMode === 'static' && !settings.feedUrl) {
    await chrome.storage.local.set({
      status: { backend: 'offline', lastError: 'No feed address configured', lastPoll: new Date().toISOString() },
    });
    await pushTickerUpdate();
    return;
  }

  try {
    const data = await fetchJson(feedUrlFor(settings));
    const items = (data.items || []).map((i) => ({ ...i, live: false }));
    await chrome.storage.local.set({
      feed: { items, fetchedAt: new Date().toISOString(), lastIngest: data.lastIngest || null },
      status: { backend: 'online', lastError: null, lastPoll: new Date().toISOString() },
    });
    await pushTickerUpdate();
    await refreshLists(settings);
  } catch (err) {
    await chrome.storage.local.set({
      status: { backend: 'offline', lastError: err.message, lastPoll: new Date().toISOString() },
    });
    await pushTickerUpdate();
  }
}

/* ------------------------------------------------- local regulatory index */

/**
 * The regulatory list is downloaded and kept, so that scoring a site works
 * with the full engine rather than silently skipping a whole pass.
 *
 * Without this, local scoring runs against an empty index and every site comes
 * back lower than it should. It changes slowly, so once a day is plenty.
 */
const LISTS_TTL_MS = 24 * 3600 * 1000;

async function refreshLists(settings) {
  const base = feedBase(settings);
  if (!base) return;
  const { lists } = await chrome.storage.local.get('lists');
  if (lists && Date.now() - lists.fetchedAt < LISTS_TTL_MS) return;

  const url = settings.feedMode === 'static'
    ? api(base, '/lists.json')
    : api(base, '/api/lists');
  try {
    const data = await fetchJson(url, {}, 20000);
    const entries = data.entries || [];
    if (entries.length) {
      await chrome.storage.local.set({ lists: { fetchedAt: Date.now(), entries } });
      cachedIndex = null;   // force a rebuild on next use
    }
  } catch { /* local scoring still works, just without the regulatory pass */ }
}

let cachedIndex = null;
let cachedIndexFrom = 0;

async function localIndex() {
  const { lists } = await chrome.storage.local.get('lists');
  const stamp = lists?.fetchedAt || 0;
  if (cachedIndex && cachedIndexFrom === stamp) return cachedIndex;
  cachedIndex = buildIndex(lists?.entries || []);
  cachedIndexFrom = stamp;
  return cachedIndex;
}

/* ------------------------------------------------------- live assessments */

/** Score locally, using the downloaded regulatory index when we have one. */
async function localAssess(input) {
  return assess(input, await localIndex());
}

async function assessSite({ host, protocol, title, sampleText }) {
  const settings = await getSettings();
  if (!host) return null;

  // With no server in the picture, scoring happens here. This is the normal
  // path for a store install, not a degraded fallback.
  if (settings.feedMode === 'static') {
    const r = await localAssess({
      kind: 'site',
      title,
      body: settings.deepPageAnalysis ? sampleText : '',
      source: 'PAGE_SCAN',
      sourceName: 'Live page assessment',
      domainInfo: { host, protocol },
    });
    return { host, assessedAt: new Date().toISOString(), ...r, offline: false, local: true };
  }

  const payload = { host, protocol, title };
  if (settings.deepPageAnalysis && sampleText) payload.sampleText = sampleText;

  try {
    const r = await fetchJson(api(settings.backendUrl, '/api/assess/site'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, 8000);
    return { ...r, offline: false };
  } catch {
    const r = await localAssess({
      kind: 'site',
      title,
      body: settings.deepPageAnalysis ? sampleText : '',
      source: 'PAGE_SCAN',
      sourceName: 'Live page assessment (local)',
      domainInfo: { host, protocol },
    });
    return { host, assessedAt: new Date().toISOString(), ...r, offline: true };
  }
}

/**
 * "management" is an optional permission, not a mandatory one.
 *
 * It is the single most heavily scrutinized permission in Chrome Web Store
 * review, and asking for it at install time would put "read your installed
 * extensions" in the very first prompt a user sees, for a feature they may
 * never use. Requesting it at the moment the user asks for an audit is both a
 * better install experience and a much cleaner review story.
 */
export async function hasManagementPermission() {
  try {
    return await chrome.permissions.contains({ permissions: ['management'] });
  } catch {
    return false;
  }
}

async function runExtensionAudit() {
  const settings = await getSettings();
  if (!settings.extensionAudit) return [];

  if (!(await hasManagementPermission())) {
    // Cannot prompt from here: chrome.permissions.request needs a user gesture,
    // so the popup asks. The scheduled audit simply stands down until then.
    return { needsPermission: true, results: [] };
  }

  let installed = [];
  try {
    installed = await chrome.management.getAll();
  } catch {
    return [];
  }

  const self = chrome.runtime.id;
  const candidates = installed
    .filter((e) => e.type === 'extension' && e.id !== self)
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      enabled: e.enabled,
      installType: e.installType,
      updateUrl: e.updateUrl,
      homepageUrl: e.homepageUrl,
      optionsUrl: e.optionsUrl,
      permissions: e.permissions || [],
      hostPermissions: e.hostPermissions || [],
    }));

  /*
   * With no server, every extension is scored right here. The engine is the
   * same one the publisher uses, so a store install is not running a reduced
   * version of anything.
   */
  const scoreLocally = async () => {
    const out = [];
    for (const ext of candidates) {
      out.push({
        id: ext.id,
        name: ext.name,
        ...(await localAssess({
          kind: 'extension',
          title: ext.name,
          summary: ext.description,
          source: 'EXTENSION_AUDIT',
          sourceName: 'Local extension audit',
          extensionInfo: ext,
        })),
      });
    }
    return out.sort((a, b) => b.score - a.score);
  };

  let results;
  if (settings.feedMode === 'static') {
    results = await scoreLocally();
  } else {
    try {
      const r = await fetchJson(api(settings.backendUrl, '/api/assess/extensions'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ extensions: candidates }),
      }, 15000);
      results = r.results || [];
    } catch {
      results = await scoreLocally();
    }
  }

  await chrome.storage.local.set({ extensionAudit: { runAt: new Date().toISOString(), results } });

  const risky = results.filter((r) => r.score >= settings.alertThreshold);
  for (const r of risky.slice(0, 5)) {
    await addAlert({
      id: `ext:${r.id}`,
      kind: 'extension',
      title: `${r.name} holds ${r.bandLabel.toLowerCase()}-risk browser permissions`,
      sourceName: 'Installed extension audit',
      source: 'EXTENSION_AUDIT',
      score: r.score,
      band: r.band,
      bandLabel: r.bandLabel,
      color: r.color,
      topSignal: 'Structural',
      publishedAt: new Date().toISOString(),
      detail: r,
      plain: plainWarning(r, { name: r.name }),
      live: true,
    });
  }
  return results;
}

/* ----------------------------------------------------------------- alerts */

const ALERT_TTL_MS = 6 * 3600 * 1000;

async function addAlert(alert) {
  const { alerts } = await getState();
  const now = Date.now();
  const kept = alerts.filter((a) => now - Date.parse(a.publishedAt || 0) < ALERT_TTL_MS && a.id !== alert.id && !a.dismissed);
  const next = [{ ...alert, publishedAt: alert.publishedAt || new Date().toISOString() }, ...kept].slice(0, 30);
  await chrome.storage.local.set({ alerts: next });
  await pushTickerUpdate();
}

async function dismissAlert(id) {
  const { alerts } = await getState();
  await chrome.storage.local.set({ alerts: alerts.filter((a) => a.id !== id) });
  await pushTickerUpdate();
}

/* -------------------------------------------------------- ticker assembly */

function floorOf(settings) {
  return BAND_RANK[settings.minBand] ?? 0;
}

async function buildTickerPayload() {
  const settings = await getSettings();
  const { feed, alerts, status } = await getState();

  const liveAlerts = alerts.filter((a) => !a.dismissed);

  // Guard mode carries no news at all. Its entire premise is that nothing
  // appears unless it concerns the user directly, so mixing in headlines would
  // defeat it.
  const news = settings.mode === 'guard' ? [] : feed.items
    .filter((i) => (BAND_RANK[i.band] ?? 0) >= floorOf(settings))
    .filter((i) => !settings.mutedSources.includes(i.source));

  // Alerts always lead the crawl regardless of the band filter: they are about
  // the user's current situation, not the news cycle.
  const items = [...liveAlerts, ...news].slice(0, 160);

  return {
    settings,
    status: { ...status, itemCount: items.length, alertCount: alerts.length, lastIngest: feed.lastIngest || null },
    items,
  };
}

async function broadcast(msg) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => (
    t.id ? chrome.tabs.sendMessage(t.id, msg).catch(() => {}) : Promise.resolve()
  )));
}

async function pushTickerUpdate() {
  const payload = await buildTickerPayload();
  await broadcast({ type: 'TICKER_UPDATE', ...payload });
}

/* ------------------------------------------------------------------ detail */

async function getDetail(id) {
  const settings = await getSettings();
  const { alerts, detailCache } = await getState();

  const alert = alerts.find((a) => a.id === id);
  if (alert?.detail) return alert.detail;

  if (detailCache[id] && Date.now() - detailCache[id].at < 3600000) return detailCache[id].data;

  try {
    const data = await fetchJson(itemUrlFor(settings, id), {}, 8000);
    const next = { ...detailCache, [id]: { at: Date.now(), data } };
    // Keep the cache small.
    const keys = Object.keys(next);
    if (keys.length > 60) for (const k of keys.slice(0, keys.length - 60)) delete next[k];
    await chrome.storage.local.set({ detailCache: next });
    return data;
  } catch (err) {
    return { error: 'detail_unavailable', message: err.message };
  }
}

/* ------------------------------------------------------------------ alarms */

async function rescheduleAlarms(settings) {
  await chrome.alarms.clearAll();
  const s = settings || await getSettings();
  if (!s.enabled) return;
  chrome.alarms.create('poll', { periodInMinutes: Math.max(5, Number(s.pollMinutes) || 15), when: Date.now() + 1000 });
  if (s.extensionAudit) chrome.alarms.create('extAudit', { periodInMinutes: 720, when: Date.now() + 15000 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll') pollFeed();
  if (alarm.name === 'extAudit') runExtensionAudit();
});

/* ---------------------------------------------------------------- lifecycle */

chrome.runtime.onInstalled.addListener(async (details) => {
  const settings = await getSettings();
  await chrome.storage.local.set({ settings });
  await rescheduleAlarms(settings);
  await pollFeed();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html?welcome=1') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await rescheduleAlarms();
  await pollFeed();
});

chrome.commands?.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-ticker') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_VISIBILITY' }).catch(() => {});
});

/* ----------------------------------------------------- tab-driven scanning */

const recentlyAssessed = new Map(); // host -> timestamp, in-memory best effort

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;
  const settings = await getSettings();
  if (!settings.enabled || !settings.siteAssessment) return;

  let host, protocol;
  try {
    const u = new URL(tab.url);
    if (!/^https?:$/.test(u.protocol)) return;
    host = u.hostname;
    protocol = u.protocol.replace(':', '');
  } catch { return; }

  if (settings.blocklist.some((b) => host === b || host.endsWith(`.${b}`))) return;

  const last = recentlyAssessed.get(host) || 0;
  if (Date.now() - last < 10 * 60000) return;
  recentlyAssessed.set(host, Date.now());
  if (recentlyAssessed.size > 500) recentlyAssessed.clear();

  const result = await assessSite({ host, protocol, title: tab.title });
  if (result && result.score >= settings.alertThreshold) {
    await addAlert({
      id: `site:${host}`,
      kind: 'site',
      title: `${host} scores ${result.score}/100 for fraud risk`,
      sourceName: result.offline ? 'Live page assessment (local scoring)' : 'Live page assessment',
      source: 'PAGE_SCAN',
      score: result.score,
      band: result.band,
      bandLabel: result.bandLabel,
      color: result.color,
      topSignal: 'Structural',
      url: `https://${host}/`,
      detail: result,
      plain: plainWarning(result, { host }),
      live: true,
    });
  }
});

/* --------------------------------------------------------------- messaging */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'TICKER_INIT': {
        sendResponse(await buildTickerPayload());
        break;
      }
      case 'GET_DETAIL': {
        sendResponse(await getDetail(msg.id));
        break;
      }
      case 'PAGE_CONTEXT': {
        const settings = await getSettings();
        if (!settings.deepPageAnalysis || !msg.host) { sendResponse({ ok: false }); break; }
        const result = await assessSite({
          host: msg.host, protocol: msg.protocol, title: msg.title, sampleText: msg.sampleText,
        });
        if (result && result.score >= settings.alertThreshold) {
          await addAlert({
            id: `site:${msg.host}`,
            kind: 'site',
            title: `${msg.host} scores ${result.score}/100 for fraud risk`,
            sourceName: result.offline ? 'Live page assessment (local scoring)' : 'Live page assessment',
            source: 'PAGE_SCAN',
            score: result.score,
            band: result.band,
            bandLabel: result.bandLabel,
            color: result.color,
            topSignal: 'Behavioral',
            url: `https://${msg.host}/`,
            detail: result,
            plain: plainWarning(result, { host: msg.host }),
            live: true,
          });
        }
        sendResponse({ ok: true, score: result?.score ?? null });
        break;
      }
      case 'DISMISS_ALERT': {
        await dismissAlert(msg.id);
        sendResponse({ ok: true });
        break;
      }
      case 'SET_SETTINGS': {
        sendResponse(await setSettings(msg.patch || {}));
        break;
      }
      case 'GET_SETTINGS': {
        sendResponse(await getSettings());
        break;
      }
      case 'REFRESH_NOW': {
        await pollFeed();
        sendResponse(await buildTickerPayload());
        break;
      }
      case 'RUN_EXT_AUDIT': {
        const out = await runExtensionAudit();
        // runExtensionAudit returns an array normally, or a needsPermission
        // marker when the optional permission has not been granted yet.
        sendResponse(Array.isArray(out) ? { results: out } : out);
        break;
      }
      case 'HAS_MANAGEMENT': {
        sendResponse({ granted: await hasManagementPermission() });
        break;
      }
      case 'GET_EXT_AUDIT': {
        const { extensionAudit } = await chrome.storage.local.get('extensionAudit');
        sendResponse(extensionAudit || { runAt: null, results: [] });
        break;
      }
      case 'PREVIEW_WARNING': {
        /*
         * Shows the user exactly what a real warning looks like, using the real
         * engine on a real lookalike address. Nothing is faked: this is the
         * same scoring path a genuine phishing page takes.
         *
         * Without this, the only way to confirm the extension works is to find
         * an actual fraudulent site, which is a terrible first-run experience.
         */
        const host = 'paypa1-secure-login.top';
        const r = await localAssess({
          kind: 'site',
          title: 'Sign in to your account',
          body: 'Your account has been suspended due to unusual sign-in activity. Verify your account and confirm your password within 24 hours.',
          source: 'PAGE_SCAN',
          sourceName: 'Example warning',
          domainInfo: { host, protocol: 'https' },
        });
        await addAlert({
          id: 'preview',
          kind: 'site',
          title: `${host} scores ${r.score}/100 for fraud risk`,
          sourceName: 'Example warning (not a real site you visited)',
          source: 'PAGE_SCAN',
          score: r.score, band: r.band, bandLabel: r.bandLabel, color: r.color,
          topSignal: 'Structural',
          detail: r,
          plain: plainWarning(r, { host }),
          live: true,
        });
        sendResponse({ ok: true, score: r.score, band: r.band });
        break;
      }
      case 'OPEN_OPTIONS': {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        break;
      }
      case 'TEST_BACKEND': {
        const settings = await getSettings();
        // A store install has no server to reach. The published feed carries the
        // same figures in a static health.json next to feed.json.
        const url = settings.feedMode === 'static'
          ? api(msg.url || settings.feedUrl, '/health.json')
          : api(msg.url || settings.backendUrl, '/api/health');
        try {
          const h = await fetchJson(url, {}, 8000);
          sendResponse({ ok: true, health: h });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown_message' });
    }
  })();
  return true; // keep the channel open for the async response
});
