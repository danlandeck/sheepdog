import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/*
 * The consent gate.
 *
 * Chrome's user data policy requires a disclosure and an affirmative yes before
 * any user data is handled, and the store rejected a build for not having one.
 * These tests load the real service worker against a stand-in for the chrome.*
 * APIs and prove the property that matters: before the user agrees, no tab is
 * read, the installed extensions are not read, and nothing is fetched. A change
 * that adds a new code path around the gate should fail here.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function event() {
  const fns = [];
  return { addListener: (f) => fns.push(f), fire: (...a) => Promise.all(fns.map((f) => f(...a))), fns };
}

function fakeChrome() {
  const store = {};
  const calls = { managementGetAll: 0, tabsCreated: [], alarms: {}, badge: null, sent: [], permissionsRemoved: 0 };
  const pick = (keys) => {
    if (keys == null) return { ...store };
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, structuredClone(store[k])]));
  };
  const chrome = {
    storage: { local: {
      get: async (keys) => pick(keys),
      set: async (obj) => { Object.assign(store, structuredClone(obj)); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
    } },
    alarms: {
      clearAll: async () => { calls.alarms = {}; },
      create: (name, info) => { calls.alarms[name] = info; },
      onAlarm: event(),
    },
    runtime: {
      id: 'sheepdog-under-test',
      getURL: (p) => `chrome-extension://sheepdog-under-test/${p}`,
      onInstalled: event(), onStartup: event(), onMessage: event(),
      openOptionsPage: () => {},
    },
    tabs: {
      create: async (o) => { calls.tabsCreated.push(o.url); },
      query: async () => [{ id: 1 }],
      sendMessage: async (id, msg) => { calls.sent.push(msg); },
      onUpdated: event(),
    },
    action: {
      setBadgeText: async ({ text }) => { calls.badge = text; },
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {},
    },
    permissions: {
      contains: async () => true,              // worst case: already granted
      remove: async () => { calls.permissionsRemoved += 1; return true; },
    },
    management: {
      getAll: async () => { calls.managementGetAll += 1; return []; },
    },
    commands: { onCommand: event() },
  };
  return { chrome, store, calls };
}

const { chrome, store, calls } = fakeChrome();
globalThis.chrome = chrome;

const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return { ok: true, status: 200, json: async () => ({ items: [], entries: [] }) };
};

await import(pathToFileURL(join(root, 'extension', 'src', 'background', 'service-worker.js')).href);

/** Deliver a runtime message the way Chrome does and wait for the reply. */
function message(msg) {
  return new Promise((resolve) => {
    for (const f of chrome.runtime.onMessage.fns) f(msg, {}, resolve);
  });
}

const PHISH = { url: 'https://paypa1-secure-login.top/signin', title: 'Sign in to your account' };

async function everythingThatCouldTouchUserData() {
  await chrome.runtime.onStartup.fire();
  await chrome.tabs.onUpdated.fire(1, { status: 'complete' }, PHISH);
  await chrome.alarms.onAlarm.fire({ name: 'poll' });
  await chrome.alarms.onAlarm.fire({ name: 'extAudit' });
  await message({ type: 'REFRESH_NOW' });
  await message({ type: 'RUN_EXT_AUDIT' });
  await message({ type: 'TEST_BACKEND' });
  await message({ type: 'GET_DETAIL', id: 'anything' });
  await message({ type: 'PREVIEW_WARNING' });
  await message({ type: 'PAGE_CONTEXT', host: 'paypa1-secure-login.top', protocol: 'https', title: 'x', sampleText: 'verify your account' });
  await message({ type: 'SET_SETTINGS', patch: { deepPageAnalysis: true } });
  // Let any un-awaited work started by the alarm listener settle.
  await new Promise((r) => setTimeout(r, 20));
}

function assertInert(label) {
  assert.deepEqual(fetched, [], `${label}: something was downloaded`);
  assert.equal(calls.managementGetAll, 0, `${label}: the installed extensions were read`);
  assert.deepEqual(Object.keys(calls.alarms), [], `${label}: an alarm was scheduled`);
  assert.equal((store.alerts || []).length, 0, `${label}: a site was assessed`);
  assert.equal(store.feed, undefined, `${label}: a feed was stored`);
  assert.equal(store.extensionAudit, undefined, `${label}: an extension review was stored`);
}

test('a fresh install opens the consent page and does nothing else', async () => {
  await chrome.runtime.onInstalled.fire({ reason: 'install' });
  assert.equal(calls.tabsCreated.length, 1);
  assert.match(calls.tabsCreated[0], /src\/consent\/consent\.html$/);
  assert.equal(calls.badge, 'OFF');
  assertInert('after install');
});

test('before the user answers, nothing reads a tab, the extensions, or the network', async () => {
  await everythingThatCouldTouchUserData();
  assertInert('undecided');
  const payload = await message({ type: 'TICKER_INIT' });
  assert.equal(payload.consent, 'undecided');
  assert.deepEqual(payload.items, []);
});

test('declining leaves it off, and does not ask again on update', async () => {
  const c = await message({ type: 'SET_CONSENT', granted: false });
  assert.equal(c.status, 'declined');
  await everythingThatCouldTouchUserData();
  assertInert('declined');
  assert.equal(calls.badge, 'OFF');

  const before = calls.tabsCreated.length;
  await chrome.runtime.onInstalled.fire({ reason: 'update' });
  assert.equal(calls.tabsCreated.length, before, 'a declined user was asked again');
  assertInert('declined, after update');
});

test('only an explicit true grants consent', async () => {
  for (const granted of [undefined, null, 'yes', 1, {}]) {
    const c = await message({ type: 'SET_CONSENT', granted });
    assert.equal(c.status, 'declined', `granted=${JSON.stringify(granted)} was accepted`);
  }
});

test('agreeing turns everything on', async () => {
  // The audit setting above was patched while off; make the starting point explicit.
  await message({ type: 'SET_SETTINGS', patch: { deepPageAnalysis: false, feedMode: 'static', feedUrl: 'https://example.test/feed' } });
  const c = await message({ type: 'SET_CONSENT', granted: true });
  assert.equal(c.status, 'granted');
  assert.equal(calls.badge, '');
  assert.ok(calls.alarms.poll, 'the poll alarm was not scheduled');

  await chrome.alarms.onAlarm.fire({ name: 'poll' });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(fetched.includes('https://example.test/feed/feed.json'), 'the feed was not fetched after consent');

  await chrome.tabs.onUpdated.fire(1, { status: 'complete' }, PHISH);
  assert.equal(store.alerts.length, 1, 'a lookalike sign-in page raised no warning after consent');
  assert.equal(store.alerts[0].id, 'site:paypa1-secure-login.top');

  await message({ type: 'RUN_EXT_AUDIT' });
  assert.equal(calls.managementGetAll, 1);

  // Scoring a site must not have contacted anything but the feed.
  assert.ok(fetched.every((u) => u.startsWith('https://example.test/feed/')), `unexpected request: ${fetched.join(', ')}`);
  assert.ok(fetched.every((u) => !u.includes('paypa1')), 'a visited address appeared in a request');
});

test('withdrawing consent stops everything and deletes what was gathered', async () => {
  const c = await message({ type: 'SET_CONSENT', granted: false });
  assert.equal(c.status, 'declined');
  assert.deepEqual(Object.keys(calls.alarms), []);
  for (const k of ['feed', 'alerts', 'status', 'detailCache', 'lists', 'extensionAudit']) {
    assert.equal(store[k], undefined, `${k} survived withdrawal`);
  }
  assert.ok(store.settings, 'settings should be kept');
  assert.ok(calls.permissionsRemoved >= 1, 'the extension-review permission was not handed back');

  const last = calls.sent.filter((m) => m.type === 'TICKER_UPDATE').at(-1);
  assert.equal(last.consent, 'declined', 'open pages were not told to remove the bar');

  fetched.length = 0;
  calls.managementGetAll = 0;
  await everythingThatCouldTouchUserData();
  assertInert('withdrawn');
});

test('an answer to older terms counts as no answer', async () => {
  store.consent = { status: 'granted', version: 0, at: new Date().toISOString() };
  const payload = await message({ type: 'TICKER_INIT' });
  assert.equal(payload.consent, 'undecided');
  const before = calls.tabsCreated.length;
  await chrome.runtime.onInstalled.fire({ reason: 'update' });
  assert.equal(calls.tabsCreated.length, before + 1, 'the user was not asked about the new terms');
  assertInert('stale consent');
});
