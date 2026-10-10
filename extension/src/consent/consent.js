/* The consent page.
 *
 * This is the prominent disclosure Chrome's user data policy asks for, and the
 * Agree button is the affirmative consent. Nothing in the extension reads a
 * tab, reads the installed extensions or touches the network until that button
 * has been pressed; the checks live in the service worker.
 *
 * Opening this page does not itself read or download anything. It talks only to
 * the extension's own service worker.
 */

const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => {
  void chrome.runtime.lastError; res(r);
}));

/*
 * The same page ships in two situations, and a disclosure that describes the
 * wrong one is worse than none. A store install scores everything in the
 * browser and downloads one public file. A self-hosted build talks to a
 * collector the person runs themselves. Each sentence about where data goes is
 * chosen from here, the same way the settings page does it.
 */
const COPY = {
  static: (s) => ({
    whereSite: 'Checked on your own computer. Never sent anywhere.',
    whereText: 'Checked on your own computer, in memory. Never sent anywhere and never saved.',
    whereExt: 'Checked on your own computer. Never sent anywhere. The latest result is saved on your computer so you can read it.',
    download: `One thing: a public file of scam news and reference lists, from ${s.feedUrl || 'the published feed'}, `
      + 'every 15 minutes unless you change how often, plus the detail of a news headline if you click one. The files are the same for every user and the request '
      + 'says nothing about you or the pages you visit. As with any download, the company hosting the file'
      + `${/\.github\.io(\/|$)/.test(s.feedUrl || '') ? ' (GitHub)' : ''} sees the internet address (IP address) the request came from, in its ordinary server logs. `
      + 'Sheepdog\'s developer does not receive those logs. This is the only address Sheepdog ever contacts.',
  }),
  service: (s) => ({
    whereSite: `This is a self-hosted build. The domain of the page (never the full address) is sent to the collector you configured at ${s.backendUrl || 'the address in settings'}. If that cannot be reached, it is checked on your own computer instead.`,
    whereText: `This is a self-hosted build. The text is sent to the collector you configured at ${s.backendUrl || 'the address in settings'} and scored in memory there.`,
    whereExt: `This is a self-hosted build. The details listed are sent to the collector you configured at ${s.backendUrl || 'the address in settings'}. The latest result is saved on your computer.`,
    download: `Scam news and reference lists from the collector you configured at ${s.backendUrl || 'the address in settings'}, every 15 minutes unless you change how often. `
      + 'That collector sees the internet address (IP address) each request came from.',
  }),
};

function show(which) {
  $('#ask').hidden = which !== 'ask';
  $('#off').hidden = which !== 'off';
  window.scrollTo(0, 0);
}

function renderCopy(settings) {
  const s = settings || {};
  const c = (s.feedMode === 'static' ? COPY.static : COPY.service)(s);
  for (const [id, text] of Object.entries(c)) $(`#${id}`).textContent = text;
  if (s.feedMode === 'static' && s.feedUrl) $('#policy').href = `${String(s.feedUrl).replace(/\/+$/, '')}/privacy.html`;
}

function renderCurrent(consent) {
  const when = consent?.at ? new Date(consent.at).toLocaleDateString() : '';
  $('#current').textContent = consent?.status === 'granted'
    ? `Sheepdog is currently on. You agreed${when ? ` on ${when}` : ''}.`
    : 'Sheepdog is currently off.';
  $('#agree').textContent = consent?.status === 'granted' ? 'Keep Sheepdog on' : 'Agree and turn on Sheepdog';
  $('#decline').textContent = consent?.status === 'granted' ? 'Turn Sheepdog off' : 'No thanks, keep it off';
}

async function decide(granted) {
  $('#agree').disabled = true;
  $('#decline').disabled = true;
  const consent = await send({ type: 'SET_CONSENT', granted });
  $('#agree').disabled = false;
  $('#decline').disabled = false;

  if (!consent) {
    $('#current').textContent = 'Sheepdog did not respond. Reload this page and try again.';
    return;
  }
  if (consent.status === 'granted') {
    location.replace(chrome.runtime.getURL('src/options/options.html?welcome=1'));
  } else {
    show('off');
  }
}

$('#agree').addEventListener('click', () => decide(true));
$('#decline').addEventListener('click', () => decide(false));
$('#review').addEventListener('click', async () => {
  renderCurrent(await send({ type: 'GET_CONSENT' }));
  show('ask');
});

$('#remove').addEventListener('click', async () => {
  // Removing yourself needs no extra permission, and Chrome shows its own
  // confirmation before anything happens.
  try {
    await chrome.management.uninstallSelf({ showConfirmDialog: true });
  } catch {
    $('#removeHint').textContent =
      'Nothing was removed. To remove Sheepdog yourself, right-click its toolbar icon and choose "Remove from Chrome".';
  }
});

(async () => {
  const [consent, settings] = await Promise.all([send({ type: 'GET_CONSENT' }), send({ type: 'GET_SETTINGS' })]);
  renderCopy(settings);
  renderCurrent(consent);
  // ?review=1 is the "let me read it again" route from the popup and settings.
  const review = new URLSearchParams(location.search).get('review');
  show(consent?.status === 'declined' && !review ? 'off' : 'ask');
})();
