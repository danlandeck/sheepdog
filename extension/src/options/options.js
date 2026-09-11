/* Settings page. Every control writes through to the service worker
   immediately, so there is no Save button to forget to press. */

const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => {
  void chrome.runtime.lastError; res(r);
}));

const FIELDS = {
  mode: 'value',
  backendUrl: 'value',
  pollMinutes: 'number',
  position: 'value',
  theme: 'value',
  speed: 'value',
  minBand: 'value',
  reserveSpace: 'checked',
  siteAssessment: 'checked',
  deepPageAnalysis: 'checked',
  extensionAudit: 'checked',
  alertThreshold: 'number',
};

let settings = null;
let saveTimer = null;

function flash(text, isErr) {
  const el = $('#saved');
  el.textContent = text;
  el.dataset.err = isErr ? '1' : '0';
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { el.textContent = ''; }, 2400);
}

const MODE_HINT = {
  guard: 'Nothing appears on screen at all until the site you are on, or an extension you have installed, looks dangerous. Then a red bar explains what is wrong in plain language and offers a way out. No news, no crawl, no noise.',
  ticker: 'A scrolling crawl of scored fraud and enforcement news sits along the edge of every page, with live alerts about your own situation mixed in. Click any headline for the full breakdown.',
};

/*
 * The same page ships in two very different situations, and saying the wrong
 * one is a privacy claim that is not true. A store install reads a static feed
 * and scores everything in the browser; a self-hosted install talks to a server
 * the user runs. Every sentence about where data goes is chosen from here.
 */
const COPY = {
  static: {
    heading: 'News feed',
    welcome: '<b>Sheepdog is on.</b> There is nothing to set up. It stays out of your way until a site or an extension looks dangerous, and everything below is optional.',
    site: 'The address of the tab you are on is checked on your own computer, against patterns and public enforcement lists held inside the extension. Nothing about the page is sent anywhere. A site scoring above your alert threshold raises a warning.',
    deep: 'Reads up to 20,000 characters of the page\'s visible text and scores it on your own computer, in memory. The text is never transmitted and never stored. Leave this off for any site where you handle confidential material.',
    audit: 'Reads the permissions your other extensions already hold and scores what a compromised or sold-on version of each could do. This runs entirely in your browser. Nothing about your extensions is sent anywhere.',
  },
  service: {
    heading: 'Backend',
    welcome: '<b>One thing to set up first.</b> This build reads from an aggregation service you run. Start it with <code>node src/index.js</code> in the <code>server/</code> folder, then confirm the address below reads <em>online</em>.',
    site: 'Sends only the domain to the service you configured above, never the full URL, path, or query string. If it cannot be reached, scoring falls back to your own machine. A site scoring above your alert threshold raises a warning.',
    deep: 'Sends up to 20,000 characters of the page\'s visible text to the service you configured above. It is scored in memory and never written to disk or logs. Leave this off for any site where you handle confidential material.',
    audit: 'Reads the permissions your other extensions already hold and scores what a compromised or sold-on version of each could do. Nothing about an extension leaves your browser except its name and permission list.',
  },
};

function renderCopy(s) {
  const isStatic = s.feedMode === 'static';
  const c = isStatic ? COPY.static : COPY.service;

  $('#dataHeading').textContent = c.heading;
  $('#welcomeBody').innerHTML = c.welcome;
  $('#hintSite').textContent = c.site;
  $('#hintDeep').textContent = c.deep;
  $('#hintAudit').textContent = c.audit;

  // Nothing to configure when the address is baked into the build.
  $('#backendField').hidden = isStatic;
  $('#feedInfo').hidden = !isStatic;
  if (isStatic) {
    $('#feedInfo').textContent =
      `Scam and fraud news is downloaded from ${s.feedUrl || 'the published feed'}. `
      + 'It is a public file, identical for every user, and it is the only address Sheepdog contacts.';
  }
}

function renderModeHint(mode) {
  const el = document.getElementById('modeHint');
  if (el) el.textContent = MODE_HINT[mode] || '';
}

function readForm() {
  const patch = {};
  for (const [id, kind] of Object.entries(FIELDS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    patch[id] = kind === 'checked' ? el.checked : kind === 'number' ? Number(el.value) : el.value;
  }
  patch.blocklist = $('#blocklist').value
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
    .filter(Boolean);
  patch.mutedSources = settings?.mutedSources || [];
  return patch;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const patch = readForm();
    if (patch.backendUrl && !/^https?:\/\//.test(patch.backendUrl)) {
      flash('Backend address needs to start with http:// or https://', true);
      return;
    }
    settings = await send({ type: 'SET_SETTINGS', patch });
    flash('Saved.');
  }, 250);
}

function fill(s) {
  settings = s;
  for (const [id, kind] of Object.entries(FIELDS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (kind === 'checked') el.checked = !!s[id];
    else el.value = s[id];
  }
  $('#blocklist').value = (s.blocklist || []).join('\n');
  $('#threshVal').textContent = s.alertThreshold;
  renderModeHint(s.mode);
  renderCopy(s);
}

async function testBackend() {
  const isStatic = settings?.feedMode === 'static';
  const url = isStatic ? '' : $('#backendUrl').value.trim();
  $('#testResult').textContent = 'Checking…';
  const r = await send({ type: 'TEST_BACKEND', url });
  if (!r?.ok) {
    $('#testResult').textContent = isStatic
      ? `The news feed could not be reached: ${r?.error || 'no response'}. Warnings about sites and extensions carry on working, because that scoring happens on your own computer.`
      : `Could not reach it: ${r?.error || 'no response'}. The ticker will keep scoring sites and extensions locally in the meantime.`;
    return;
  }
  const h = r.health;
  const items = h.itemsPublished ?? h.itemsRetained ?? 0;
  const when = h.generatedAt ? new Date(h.generatedAt).toLocaleString() : null;
  $('#testResult').textContent = isStatic
    ? `News feed reachable. ${items} stories, ${Number(h.listEntries || 0).toLocaleString()} enforcement entries indexed`
      + `${when ? `, last updated ${when}` : ''}.`
    : `Online. ${h.sourcesHealthy}/${h.sourcesTotal} sources healthy, ${items} items held, ${Number(h.listEntries || 0).toLocaleString()} regulatory entries indexed.`;
  renderSources(h.sources || []);
}

function renderSources(sources) {
  const wrap = $('#sources');
  if (!sources.length) { wrap.innerHTML = '<span class="hint">No sources reported.</span>'; return; }
  const muted = new Set(settings?.mutedSources || []);
  wrap.innerHTML = sources.map((s) => `
    <button class="srcbtn" data-id="${s.id}" data-ok="${s.ok ? 1 : 0}" data-muted="${muted.has(s.id) ? 1 : 0}"
      title="${s.ok ? `${s.itemCount} items on the last run` : `Failing: ${s.error || 'unknown error'}`}">
      <i></i>${s.name}
    </button>`).join('');
}

$('#sources').addEventListener('click', async (e) => {
  const b = e.target.closest('.srcbtn');
  if (!b) return;
  const id = b.dataset.id;
  const muted = new Set(settings.mutedSources || []);
  if (muted.has(id)) muted.delete(id); else muted.add(id);
  b.dataset.muted = muted.has(id) ? '1' : '0';
  settings = await send({ type: 'SET_SETTINGS', patch: { mutedSources: [...muted] } });
  flash('Saved.');
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'alertThreshold') $('#threshVal').textContent = e.target.value;
  if (e.target.id === 'mode') renderModeHint(e.target.value);
  if (e.target.closest('section')) save();
});
document.addEventListener('change', (e) => { if (e.target.closest('section')) save(); });
$('#test').addEventListener('click', testBackend);

$('#preview').addEventListener('click', async () => {
  const r = await send({ type: 'PREVIEW_WARNING' });
  $('#previewResult').textContent = r?.ok
    ? `Done. It scored ${r.score}/100 (${r.band}). Switch to any open website tab to see the warning. Click Dismiss on it when you are finished.`
    : 'Could not add the example. Try reloading the extension at chrome://extensions.';
});

(async () => {
  if (new URLSearchParams(location.search).get('welcome')) $('#welcome').hidden = false;
  fill(await send({ type: 'GET_SETTINGS' }));
  testBackend();
})();
