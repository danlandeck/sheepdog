/**
 * Sheepdog content script.
 *
 * Renders the crawl inside a closed-off shadow root so that no page stylesheet
 * can reach it and none of its styles leak onto the page. The whole UI is one
 * host element pinned to the viewport edge.
 *
 * This script never reads page content unless deep page analysis is switched on
 * in settings, and even then it takes a bounded text sample and hands it
 * straight to the service worker.
 */

(() => {
  'use strict';

  if (window.top !== window.self) return;                 // top frame only
  if (document.getElementById('__sheepdog_root__')) return;
  if (!document.body) return;

  const HIDE_KEY = '__sheepdog_hidden__';
  const SPEEDS = { slow: 35, normal: 60, fast: 95 };       // pixels per second

  let state = { settings: null, items: [], status: {} };
  let host, shadow, bar, track, panel, statusDot, countEl;
  let hidden = false;
  let panelOpenId = null;

  /* ------------------------------------------------------------- utilities */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const send = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(r);
      });
    } catch { resolve(null); }
  });

  function timeAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  }

  /* ---------------------------------------------------------------- styles */

  const CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

.wrap {
  position: fixed;
  left: 0; right: 0;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--fg);
  --bg: #0b0f14;
  --bg2: #121922;
  --fg: #e6edf3;
  --dim: #8b98a5;
  --line: #223041;
  --accent: #A78BFA;          /* light violet, 7.1:1 on the dark ground */
  --brand: #4B0082;           /* indigo, deeper than UW purple and higher contrast */
  --brand-fg: #ffffff;        /* white on indigo is 13.0:1 */
  contain: layout style;
}
.wrap[data-theme="light"] {
  --bg: #ffffff; --bg2: #f2f5f8; --fg: #16202b; --dim: #5c6b7a; --line: #d7dee6;
  --accent: #4B0082; --brand: #4B0082; --brand-fg: #ffffff;
}
.wrap[data-pos="bottom"] { bottom: 0; }
.wrap[data-pos="top"] { top: 0; }

.bar {
  display: flex; align-items: stretch;
  height: 36px;
  background: var(--bg);
  border-top: 1px solid var(--line);
  box-shadow: 0 -6px 24px rgba(0,0,0,.32);
}
.wrap[data-pos="top"] .bar { border-top: none; border-bottom: 1px solid var(--line); box-shadow: 0 6px 24px rgba(0,0,0,.32); }

/* ---- brand ---- */
.brand {
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px; flex: 0 0 auto;
  background: var(--brand);
  color: var(--brand-fg);
  border-right: 1px solid var(--line);
  cursor: default; user-select: none;
}
.brand b { font-size: 11px; letter-spacing: .13em; font-weight: 700; text-transform: uppercase; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.45); flex: 0 0 auto; }
.dot[data-s="online"] { background: #16a34a; box-shadow: 0 0 0 2px rgba(22,163,74,.22); }
.dot[data-s="offline"] { background: #f97316; box-shadow: 0 0 0 2px rgba(249,115,22,.22); }

/* ---- crawl ---- */
.viewport { position: relative; flex: 1 1 auto; overflow: hidden; }
.viewport::after {
  content: ''; position: absolute; inset: 0 0 0 auto; width: 48px; pointer-events: none;
  background: linear-gradient(to right, transparent, var(--bg));
}
.track {
  display: flex; align-items: center; height: 100%;
  width: max-content;
  will-change: transform;
  animation-name: crawl; animation-timing-function: linear; animation-iteration-count: infinite;
}
.track[data-paused="1"] { animation-play-state: paused; }
@keyframes crawl { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
@media (prefers-reduced-motion: reduce) { .track { animation: none; } .viewport { overflow-x: auto; } }

.item {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 0 18px; height: 100%;
  white-space: nowrap; cursor: pointer;
  border-right: 1px solid var(--line);
  background: transparent;
}
.item:hover { background: var(--bg2); }
.item .chip {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; height: 18px; padding: 0 6px;
  border-radius: 3px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
  color: #08120a;
}
.item .src { color: var(--dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
.item .ttl { font-weight: 500; max-width: 62ch; overflow: hidden; text-overflow: ellipsis; }
.item .live {
  font-size: 9px; font-weight: 800; letter-spacing: .1em; padding: 2px 5px; border-radius: 3px;
  background: #dc2626; color: #fff;
}
.item .ago { color: var(--dim); font-size: 11px; }

.empty { display: flex; align-items: center; padding: 0 16px; color: var(--dim); height: 100%; }

/* ---- controls ---- */
.ctrls { display: flex; align-items: center; gap: 2px; padding: 0 6px; flex: 0 0 auto; background: var(--bg2); border-left: 1px solid var(--line); }
.btn {
  appearance: none; border: 0; background: transparent; color: var(--dim);
  width: 28px; height: 28px; border-radius: 4px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; font-size: 13px;
}
.btn:hover { background: rgba(127,127,127,.16); color: var(--fg); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.legend { display: flex; align-items: center; gap: 3px; padding: 0 8px 0 4px; }
.legend i { width: 9px; height: 9px; border-radius: 2px; display: block; }
.count { color: var(--dim); font-size: 11px; padding-right: 6px; font-variant-numeric: tabular-nums; }

/* ---- detail panel ---- */
.panel {
  background: var(--bg); border-top: 1px solid var(--line);
  max-height: min(64vh, 560px); overflow-y: auto; display: none;
}
.panel[data-open="1"] { display: block; }
.wrap[data-pos="top"] .panel { border-top: none; border-bottom: 1px solid var(--line); }
.phead { display: flex; gap: 14px; padding: 16px 18px 12px; border-bottom: 1px solid var(--line); align-items: flex-start; }
.ring { flex: 0 0 auto; width: 62px; height: 62px; position: relative; }
.ring svg { transform: rotate(-90deg); }
.ring .num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pmeta { flex: 1 1 auto; min-width: 0; }
.pmeta h2 { margin: 0 0 6px; font-size: 15px; font-weight: 650; line-height: 1.35; }
.pmeta .sub { color: var(--dim); font-size: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #08120a; }
.pmeta a { color: var(--accent); text-decoration: none; }
.pmeta a:hover { text-decoration: underline; }
.pclose { margin-left: auto; }

.psum { padding: 12px 18px; color: var(--dim); font-size: 12.5px; border-bottom: 1px solid var(--line); }

.sigs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0; }
.sig { padding: 14px 18px; border-bottom: 1px solid var(--line); border-right: 1px solid var(--line); }
.sig h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); font-weight: 700; }
.sig .val { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.sig .val b { font-size: 20px; font-variant-numeric: tabular-nums; }
.sig .val span { color: var(--dim); font-size: 11px; }
.meter { height: 5px; border-radius: 3px; background: rgba(127,127,127,.2); overflow: hidden; margin-bottom: 10px; }
.meter i { display: block; height: 100%; border-radius: 3px; }
.sig ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.sig li { font-size: 12px; }
.sig li .l { font-weight: 600; display: block; }
.sig li .d { color: var(--dim); display: block; margin-top: 2px; }
.sig li .ev { display: block; margin-top: 3px; padding: 4px 7px; border-radius: 3px; background: rgba(127,127,127,.12); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dim); white-space: normal; word-break: break-word; }
.none { color: var(--dim); font-size: 12px; font-style: italic; }
.pfoot { padding: 10px 18px 14px; color: var(--dim); font-size: 11px; }
.loading { padding: 28px 18px; text-align: center; color: var(--dim); }

/* ---- guard mode ---------------------------------------------------------
   Deliberately not a crawl. Guard shows nothing at all until something is
   wrong, and then it is the loudest thing on the screen: one sentence, one
   piece of advice, and a way out. Larger type and higher contrast than the
   ticker, because the person reading it is not a security enthusiast. */
.guard {
  background: #b91c1c; color: #fff;
  border-top: 3px solid #7f1d1d;
  box-shadow: 0 -10px 40px rgba(0,0,0,.45);
  padding: 14px 18px;
  display: flex; align-items: flex-start; gap: 14px;
  font-size: 15px; line-height: 1.5;
}
.wrap[data-pos="top"] .guard { border-top: none; border-bottom: 3px solid #7f1d1d; }
.guard .sign {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%;
  background: rgba(255,255,255,.16); display: flex; align-items: center; justify-content: center;
  font-size: 19px; font-weight: 700;
}
.guard .msg { flex: 1 1 auto; min-width: 0; }
.guard .head { display: block; font-size: 17px; font-weight: 700; margin-bottom: 3px; }
.guard .adv { display: block; opacity: .95; }
.guard .why { margin-top: 7px; font-size: 13px; opacity: .85; }
.guard .why li { margin-top: 2px; }
.guard ul { margin: 4px 0 0; padding-left: 18px; }
.guard .acts { display: flex; gap: 8px; flex: 0 0 auto; align-items: center; flex-wrap: wrap; }
.gbtn {
  appearance: none; border: 1px solid rgba(255,255,255,.5); background: transparent; color: #fff;
  padding: 8px 14px; border-radius: 6px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer;
  white-space: nowrap;
}
.gbtn:hover { background: rgba(255,255,255,.14); }
.gbtn[data-primary] { background: #fff; color: #7f1d1d; border-color: #fff; }
.gbtn[data-primary]:hover { background: #ffe4e4; }
.gbtn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
@media (max-width: 720px) {
  .guard { flex-direction: column; }
  .guard .acts { width: 100%; }
}
`;

  /* ---------------------------------------------------------------- render */

  function build() {
    host = document.createElement('div');
    host.id = '__sheepdog_root__';
    shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.setAttribute('role', 'complementary');
    wrap.setAttribute('aria-label', 'Sheepdog');
    wrap.innerHTML = `
      <div class="panel" part="panel" role="dialog" aria-label="Risk assessment detail"></div>
      <div class="bar">
        <div class="brand"><span class="dot" data-s="unknown"></span><b>Sheepdog</b></div>
        <div class="viewport"><div class="track"></div></div>
        <div class="ctrls">
          <span class="legend" title="Risk scale: green is lowest, red is highest">
            <i style="background:#16a34a"></i><i style="background:#eab308"></i><i style="background:#f97316"></i><i style="background:#dc2626"></i>
          </span>
          <span class="count"></span>
          <button class="btn" data-a="pause" title="Pause the crawl" aria-label="Pause the crawl">❚❚</button>
          <button class="btn" data-a="refresh" title="Refresh now" aria-label="Refresh now">⟳</button>
          <button class="btn" data-a="options" title="Settings" aria-label="Settings">⚙</button>
          <button class="btn" data-a="hide" title="Hide until this tab is reloaded" aria-label="Hide the ticker">✕</button>
        </div>
      </div>`;

    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);

    bar = shadow.querySelector('.bar');
    track = shadow.querySelector('.track');
    panel = shadow.querySelector('.panel');
    statusDot = shadow.querySelector('.dot');
    countEl = shadow.querySelector('.count');

    bar.addEventListener('mouseenter', () => track.dataset.paused = '1');
    bar.addEventListener('mouseleave', () => { if (!manualPause) track.dataset.paused = '0'; });

    shadow.querySelector('.ctrls').addEventListener('click', onControl);
    shadow.addEventListener('click', onGuardClick);
    track.addEventListener('click', onItemClick);
    panel.addEventListener('click', onPanelClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panelOpenId) closePanel();
    }, true);

    return wrap;
  }

  let manualPause = false;

  function onControl(e) {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const a = btn.dataset.a;
    if (a === 'pause') {
      manualPause = !manualPause;
      track.dataset.paused = manualPause ? '1' : '0';
      btn.textContent = manualPause ? '▶' : '❚❚';
      btn.title = manualPause ? 'Resume the crawl' : 'Pause the crawl';
    } else if (a === 'refresh') {
      btn.style.opacity = '.4';
      send({ type: 'REFRESH_NOW' }).then((p) => { btn.style.opacity = ''; if (p) apply(p); });
    } else if (a === 'options') {
      send({ type: 'OPEN_OPTIONS' });
    } else if (a === 'hide') {
      hide();
    }
  }

  function hide() {
    hidden = true;
    host.style.display = 'none';
    try { sessionStorage.setItem(HIDE_KEY, '1'); } catch { /* ignore */ }
    releaseSpace();
  }

  function show() {
    hidden = false;
    host.style.display = '';
    try { sessionStorage.removeItem(HIDE_KEY); } catch { /* ignore */ }
    applySpace();
  }

  /* --------------------------------------------------------- crawl content */

  function itemHtml(i) {
    const chipStyle = `background:${esc(i.color || '#6b7280')};${(i.band === 'severe') ? 'color:#fff;' : ''}`;
    return `<div class="item" data-id="${esc(i.id)}" role="button" tabindex="0"
        title="${esc(i.title)} — ${esc(i.bandLabel)} risk, score ${i.score}/100">
      <span class="chip" style="${chipStyle}">${Number(i.score) || 0}</span>
      ${i.live ? '<span class="live">LIVE</span>' : ''}
      <span class="src">${esc(i.source || '')}</span>
      <span class="ttl">${esc(i.title)}</span>
      <span class="ago">${esc(timeAgo(i.publishedAt))}</span>
    </div>`;
  }

  function renderTrack() {
    const items = state.items || [];
    if (!items.length) {
      track.style.animationName = 'none';
      track.innerHTML = `<div class="empty">${
        state.status?.backend === 'offline'
          ? 'Backend unreachable. Live page and extension scoring still active.'
          : 'No items above your current risk filter.'
      }</div>`;
      return;
    }

    const once = items.map(itemHtml).join('');
    track.innerHTML = once + once;   // duplicate for a seamless loop

    // Measure and set the animation duration so speed is constant regardless
    // of how many items are in the crawl.
    requestAnimationFrame(() => {
      const w = track.scrollWidth / 2;
      const pps = SPEEDS[state.settings?.speed] || SPEEDS.normal;
      const dur = Math.max(20, Math.round(w / pps));
      // Set the duration ONLY. Writing the `animation` shorthand inline also
      // resets animation-play-state to running at inline specificity, which
      // silently defeats the [data-paused] pause rule in the stylesheet.
      track.style.animationName = 'crawl';
      track.style.animationDuration = `${dur}s`;
      track.dataset.paused = manualPause ? '1' : '0';
    });
  }

  /**
   * Guard mode. Renders nothing unless something is actually wrong, which is
   * the entire point: a warning that is always on screen is wallpaper, and
   * wallpaper does not get read on the day it matters.
   */
  function renderGuard() {
    const urgent = (state.items || []).filter((i) => i.live && i.plain && i.plain.urgent);
    const bar = shadow.querySelector('.bar');
    let guard = shadow.querySelector('.guard');

    if (!urgent.length) {
      if (guard) guard.remove();
      if (bar) bar.style.display = 'none';
      host.style.pointerEvents = 'none';
      return;
    }

    host.style.pointerEvents = '';
    if (bar) bar.style.display = 'none';

    const a = urgent[0];
    const p = a.plain;
    if (!guard) {
      guard = document.createElement('div');
      guard.className = 'guard';
      guard.setAttribute('role', 'alert');
      shadow.querySelector('.wrap').appendChild(guard);
    }

    guard.innerHTML = `
      <span class="sign" aria-hidden="true">!</span>
      <span class="msg">
        <span class="head">${esc(p.headline)}</span>
        <span class="adv">${esc(p.advice)}</span>
        ${p.reasons?.length ? `<div class="why">Why: <ul>${p.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
      </span>
      <span class="acts">
        ${a.kind === 'site' ? '<button class="gbtn" data-primary data-g="leave">Take me back</button>' : ''}
        <button class="gbtn" data-g="details" data-id="${esc(a.id)}">Tell me more</button>
        <button class="gbtn" data-g="dismiss" data-id="${esc(a.id)}">Dismiss</button>
      </span>`;
  }

  function onGuardClick(e) {
    const b = e.target.closest('.gbtn');
    if (!b) return;
    const act = b.dataset.g;
    if (act === 'leave') {
      // Prefer going back. If this page opened directly there is nothing to go
      // back to, so leave for a blank page rather than stranding the user.
      if (history.length > 1) history.back();
      else location.replace('about:blank');
    } else if (act === 'details') {
      openPanel(b.dataset.id);
    } else if (act === 'dismiss') {
      send({ type: 'DISMISS_ALERT', id: b.dataset.id });
      shadow.querySelector('.guard')?.remove();
      host.style.pointerEvents = 'none';
    }
  }

  function renderChrome() {
    const wrap = shadow.querySelector('.wrap');
    wrap.dataset.theme = state.settings?.theme || 'dark';
    wrap.dataset.pos = state.settings?.position || 'bottom';
    statusDot.dataset.s = state.status?.backend || 'unknown';
    statusDot.title = state.status?.backend === 'online'
      ? `Backend online. Last poll ${timeAgo(state.status.lastPoll)}.`
      : `Backend offline: ${state.status?.lastError || 'not reachable'}. Local scoring still active.`;
    const alerts = state.status?.alertCount || 0;
    countEl.textContent = alerts ? `${state.items.length} · ${alerts} live` : `${state.items.length}`;
  }

  function applySpace() {
    if (!state.settings?.reserveSpace || hidden) return releaseSpace();
    const pos = state.settings.position === 'top' ? 'Top' : 'Bottom';
    document.documentElement.style.setProperty(`scroll-padding-${pos.toLowerCase()}`, '36px');
    document.body.style[`padding${pos}`] = '36px';
  }

  function releaseSpace() {
    document.body.style.paddingBottom = '';
    document.body.style.paddingTop = '';
  }

  /* ------------------------------------------------------------ the panel */

  async function openPanel(id) {
    const item = (state.items || []).find((i) => i.id === id);
    panelOpenId = id;
    panel.dataset.open = '1';
    panel.innerHTML = `<div class="loading">Loading the full breakdown…</div>`;

    const detail = await send({ type: 'GET_DETAIL', id });
    if (panelOpenId !== id) return;

    if (!detail || detail.error) {
      panel.innerHTML = `
        <div class="phead">
          <div class="pmeta">
            <h2>${esc(item?.title || 'Item')}</h2>
            <div class="sub">Detail is unavailable: ${esc(detail?.message || 'the backend did not respond')}.</div>
          </div>
          <button class="btn pclose" data-a="close" aria-label="Close">✕</button>
        </div>`;
      return;
    }

    panel.innerHTML = renderDetail(detail, item);
    panel.scrollTop = 0;
  }

  function closePanel() {
    panelOpenId = null;
    panel.dataset.open = '0';
    panel.innerHTML = '';
  }

  function ring(score, color) {
    const r = 26, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
    return `<div class="ring">
      <svg width="62" height="62" viewBox="0 0 62 62" aria-hidden="true">
        <circle cx="31" cy="31" r="${r}" fill="none" stroke="rgba(127,127,127,.22)" stroke-width="6"/>
        <circle cx="31" cy="31" r="${r}" fill="none" stroke="${esc(color)}" stroke-width="6"
                stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
      </svg>
      <span class="num">${Number(score) || 0}</span>
    </div>`;
  }

  function meter(score, color) {
    return `<div class="meter"><i style="width:${Math.max(2, Math.min(100, score))}%;background:${esc(color)}"></i></div>`;
  }

  function sigBlock(title, sig, color, renderList) {
    if (!sig) return '';
    const eff = sig.effectiveWeight ?? sig.weight ?? 0;
    const pct = Math.round(eff * 100);
    const share = sig.applicable === false
      ? 'not applicable to this item, so its weight was redistributed'
      : `${pct}% of this score · contributes ${sig.contribution} points`;
    return `<section class="sig">
      <h3>${esc(title)}</h3>
      <div class="val"><b>${sig.score}</b><span>/100 · ${share}</span></div>
      ${meter(sig.score, color)}
      ${renderList(sig)}
    </section>`;
  }

  function renderDetail(d, fallback) {
    const s = d.signals || {};
    const color = d.color || fallback?.color || '#6b7280';
    const title = d.title || fallback?.title || 'Assessment';
    const url = d.url || fallback?.url;
    const band = d.bandLabel || fallback?.bandLabel || '';
    const when = d.publishedAt || d.assessedAt || fallback?.publishedAt;

    const li = (label, detail, evidence) => `<li>
      <span class="l">${esc(label)}</span>
      ${detail ? `<span class="d">${esc(detail)}</span>` : ''}
      ${evidence ? `<span class="ev">…${esc(evidence)}…</span>` : ''}
    </li>`;

    const behavioral = sigBlock('Behavioral analysis', s.behavioral, color, (sig) => {
      if (!sig.categories?.length) return '<p class="none">No manipulation patterns detected in the text analyzed.</p>';
      const hitsBy = {};
      for (const h of sig.hits || []) (hitsBy[h.category] ||= []).push(h);
      return `<ul>${sig.categories.slice(0, 6).map((c) => {
        const h = (hitsBy[c.id] || [])[0];
        return li(`${c.label} · ${c.points} pts`, c.context, h?.evidence);
      }).join('')}</ul>`;
    });

    const structural = sigBlock('Structural analysis', s.structural, color, (sig) => {
      if (!sig.findings?.length) return '<p class="none">Nothing structurally unusual.</p>';
      return `<ul>${sig.findings.slice(0, 8).map((f) => li(f.label, f.detail)).join('')}</ul>`;
    });

    const regulatory = sigBlock('Regulatory cross-reference', s.regulatory, color, (sig) => {
      if (!sig.matches?.length) {
        return `<p class="none">No match across ${(sig.listSize || 0).toLocaleString()} indexed enforcement and advisory entries.</p>`;
      }
      return `<ul>${sig.matches.slice(0, 6).map((m) => li(
        `${m.list} · ${m.entity}`,
        `${m.detail} Matched on ${m.matchedOn}.${m.date ? ` Dated ${m.date}.` : ''}`,
      )).join('')}</ul>`;
    });

    const incident = s.incident && s.incident.weight > 0 ? sigBlock('Incident severity', s.incident, color, (sig) => {
      if (!sig.categories?.length) return '<p class="none">Nothing here describes a concrete incident.</p>';
      const hitsBy = {};
      for (const h of sig.hits || []) (hitsBy[h.category] ||= []).push(h);
      return `<ul>${sig.categories.slice(0, 6).map((c) => {
        const h = (hitsBy[c.id] || [])[0];
        const sign = c.points < 0 ? '' : '+';
        return li(`${c.label} · ${sign}${c.points} pts`, c.context, h?.evidence);
      }).join('')}</ul>`;
    }) : '';

    // Confidence is a multiplier, not a scored pass, so it gets its own shape.
    const conf = s.confidence;
    const confidence = conf ? `<section class="sig">
      <h3>Source confidence</h3>
      <div class="val"><b>×${conf.multiplier}</b><span>applied to the weighted composite, not added to it</span></div>
      ${meter(Math.round((conf.authority || 0) * 100), color)}
      <ul>${(conf.notes || []).map((n) => li(n.label, n.detail)).join('')}</ul>
    </section>` : '';

    return `
      <div class="phead">
        ${ring(d.score ?? fallback?.score ?? 0, color)}
        <div class="pmeta">
          <h2>${esc(title)}</h2>
          <div class="sub">
            <span class="pill" style="background:${esc(color)};${d.band === 'severe' ? 'color:#fff' : ''}">${esc(band)} risk · ${d.score ?? fallback?.score ?? 0}/100</span>
            <span>${esc(d.sourceName || fallback?.sourceName || '')}</span>
            ${when ? `<span>${esc(timeAgo(when))}</span>` : ''}
            ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open the source ↗</a>` : ''}
          </div>
        </div>
        <button class="btn pclose" data-a="close" aria-label="Close the detail panel">✕</button>
      </div>
      ${d.summary ? `<div class="psum">${esc(d.summary)}</div>` : ''}
      <div class="sigs">${incident}${regulatory}${behavioral}${structural}${confidence}</div>
      <div class="pfoot">
        Composite score is a weighted blend of the scored passes above, multiplied by source confidence, then floored by any confirmed regulatory domain match.
        This is a screening signal, not a verdict, and not legal or financial advice.
        ${d.kind === 'site' || d.kind === 'extension' ? ' Scored on your machine or from the domain alone; no browsing history was transmitted.' : ''}
      </div>`;
  }

  function onItemClick(e) {
    const el = e.target.closest('.item');
    if (!el) return;
    e.preventDefault();
    const id = el.dataset.id;
    if (panelOpenId === id) return closePanel();
    openPanel(id);
  }

  function onPanelClick(e) {
    if (e.target.closest('[data-a="close"]')) closePanel();
  }

  /* ------------------------------------------------------------ deep scan */

  function pageSample() {
    // Bounded, visible-text-only sample. Skips nav and script content.
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    const text = (main.innerText || '').replace(/\s+/g, ' ').trim();
    return text.slice(0, 20000);
  }

  async function maybeDeepScan() {
    if (!state.settings?.deepPageAnalysis) return;
    if (!/^https?:$/.test(location.protocol)) return;
    const bl = state.settings.blocklist || [];
    if (bl.some((b) => location.hostname === b || location.hostname.endsWith(`.${b}`))) return;
    await send({
      type: 'PAGE_CONTEXT',
      host: location.hostname,
      protocol: location.protocol.replace(':', ''),
      title: document.title,
      sampleText: pageSample(),
    });
  }

  /* ------------------------------------------------------------ lifecycle */

  function apply(payload) {
    if (!payload) return;
    state = { settings: payload.settings || state.settings, items: payload.items || [], status: payload.status || {} };
    if (!state.settings?.enabled) { host.style.display = 'none'; releaseSpace(); return; }
    if (!hidden) host.style.display = '';
    renderChrome();

    if (state.settings?.mode === 'guard') {
      renderGuard();
      releaseSpace();          // guard never reserves layout space
    } else {
      shadow.querySelector('.guard')?.remove();
      const bar = shadow.querySelector('.bar');
      if (bar) bar.style.display = '';
      host.style.pointerEvents = '';
      renderTrack();
      applySpace();
    }
    if (panelOpenId && !state.items.some((i) => i.id === panelOpenId)) closePanel();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'TICKER_UPDATE') apply(msg);
    if (msg?.type === 'SETTINGS_CHANGED') { state.settings = msg.settings; renderChrome(); renderTrack(); applySpace(); }
    if (msg?.type === 'TOGGLE_VISIBILITY') (hidden ? show() : hide());
  });

  window.addEventListener('pagehide', releaseSpace);

  (async () => {
    try { hidden = sessionStorage.getItem(HIDE_KEY) === '1'; } catch { /* ignore */ }
    build();
    if (hidden) host.style.display = 'none';

    // A cold service worker can miss the first message, which would leave an
    // empty bar until the next broadcast. Retry a couple of times, backing off.
    let payload = null;
    for (const delay of [0, 400, 1500]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      payload = await send({ type: 'TICKER_INIT' });
      if (payload) break;
    }
    apply(payload);
    setTimeout(maybeDeepScan, 1200);
  })();
})();
