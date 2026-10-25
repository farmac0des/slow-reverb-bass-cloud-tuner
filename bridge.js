// Isolated world: settings go to the page; levels from the page go to the popup.
(function () {
  const KEYS = ['speed', 'reverb', 'bass'];
  const send = (settings) => window.postMessage({ source: 'ae-bridge', settings }, '*');
  const load = () => chrome.storage.local.get(KEYS, send);
  load();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') load();
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'ae-level') return;
    chrome.runtime.sendMessage({ type: 'ae-level', bins: e.data.bins }).catch(() => {});
  });
})();
