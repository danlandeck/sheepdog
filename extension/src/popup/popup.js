/* Popup: status, the highest-risk items in the current feed, and the local
   extension audit. Clicking an entry opens its source in a new tab. */

const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => {
  void chrome.runtime.lastError; res(r);
}));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function timeAgo(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function entry(i) {
  return `<div class="entry" data-url="${esc(i.url || '')}">
    <span class="chip" data-b="${esc(i.band)}" style="background:${esc(i.color)}">${i.score}</span>
    <span class="body">
      <span class="t">${esc(i.title)}</span>
      <span class="m">${esc(i.sourceName || i.source || '')} · ${esc(i.bandLabel)} risk${i.publishedAt ? ` · ${timeAgo(i.publishedAt)}` : ''}</span>
    </span>
  </div>`;
}

async function loadFeed() {
  const p = await send({ type: 'TICKER_INIT' });
  if (!p) { $('#status').textContent = 'Service worker did not respond. Reload the extension.'; return; }

  $('#enabled').checked = !!p.settings.enabled;
  $('#dot').dataset.s = p.status.backend || 'unknown';

  const parts = [];
  parts.push(p.status.backend === 'online' ? 'Backend online' : `Backend offline (${p.status.lastError || 'unreachable'})`);
  parts.push(`${p.status.itemCount || 0} items`);
  if (p.status.alertCount) parts.push(`${p.status.alertCount} live alert${p.status.alertCount === 1 ? '' : 's'}`);
  if (p.status.lastPoll) parts.push(`updated ${timeAgo(p.status.lastPoll)}`);
  $('#status').textContent = parts.join(' · ');

  const top = [...(p.items || [])].sort((a, b) => b.score - a.score).slice(0, 25);
  $('#list').innerHTML = top.length ? top.map(entry).join('') : '<div class="muted">Nothing above your current filter.</div>';
}

/**
 * Reading your installed extensions is an optional permission, requested here
 * rather than at install time. chrome.permissions.request must run inside a
 * user gesture, which a click in the popup satisfies.
 */
async function ensureManagementPermission() {
  const state = await send({ type: 'HAS_MANAGEMENT' });
  if (state?.granted) return true;
  try {
    return await chrome.permissions.request({ permissions: ['management'] });
  } catch {
    return false;
  }
}

async function loadAudit(force) {
  const wrap = $('#extList');
  if (force) {
    const ok = await ensureManagementPermission();
    if (!ok) {
      wrap.innerHTML = '<div class="muted">Sheepdog needs permission to read your installed extensions before it can audit them. Nothing about them leaves your browser except each one\'s name and permission list.</div>';
      return;
    }
    $('#audit').disabled = true;
    wrap.innerHTML = '<div class="muted">Auditing installed extensions…</div>';
    await send({ type: 'RUN_EXT_AUDIT' });
    $('#audit').disabled = false;
  }
  const data = await send({ type: 'GET_EXT_AUDIT' });
  const results = data?.results || [];
  $('#auditWhen').textContent = data?.runAt ? `Last run ${timeAgo(data.runAt)}` : 'Never run';

  if (!results.length) {
    wrap.innerHTML = '<div class="muted">No audit data yet. Run one above.</div>';
    return;
  }
  wrap.innerHTML = results.slice(0, 40).map((r) => `<div class="entry" data-url="">
    <span class="chip" data-b="${esc(r.band)}" style="background:${esc(r.color)}">${r.score}</span>
    <span class="body">
      <span class="t">${esc(r.name)}</span>
      <span class="m">${esc(r.bandLabel)} risk · ${r.signals?.structural?.findings?.length || 0} structural finding${(r.signals?.structural?.findings?.length || 0) === 1 ? '' : 's'}${
        r.signals?.structural?.findings?.[0] ? ` · ${esc(r.signals.structural.findings[0].label)}` : ''}</span>
    </span>
  </div>`).join('');
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    $('#pane-top').hidden = tab.dataset.tab !== 'top';
    $('#pane-ext').hidden = tab.dataset.tab !== 'ext';
    if (tab.dataset.tab === 'ext') loadAudit(false);
    return;
  }
  const row = e.target.closest('.entry');
  if (row?.dataset.url) chrome.tabs.create({ url: row.dataset.url });
});

$('#enabled').addEventListener('change', async (e) => {
  await send({ type: 'SET_SETTINGS', patch: { enabled: e.target.checked } });
  loadFeed();
});
$('#refresh').addEventListener('click', async () => {
  $('#status').textContent = 'Refreshing…';
  await send({ type: 'REFRESH_NOW' });
  loadFeed();
});
$('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#audit').addEventListener('click', () => loadAudit(true));

loadFeed();
