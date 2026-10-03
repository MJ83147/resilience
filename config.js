// Clean URLs: GitHub Pages serves both /foo and /foo.html. If someone lands on
// a .html address (bookmark, external link), rewrite the address bar to the
// clean path without reloading. The clean path serves the same page.
(function () {
  var p = location.pathname;
  var clean = p.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  if (clean !== p) history.replaceState(null, '', clean + location.search + location.hash);
})();

// Site-wide config and Torn API access.
const CONFIG = {
  // Wars Apps Script: admin checks, war data, and (once deployed) the Torn proxy.
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwIL60E_q7Qtv9AAXJk9FxvU4Wbq6JyI63M9xFNXA9w8wnx4pZNx0Vbg6L7KdmhEe-Mgw/exec',

  // Cloudflare Worker Torn proxy (cloudflare/worker.js). All Torn calls go
  // through it; keys live in the Worker's TORN_KEYS secret, so none is
  // exposed here.
  WORKER_URL: 'https://torn-proxy.systoned.workers.dev',

  // Legacy Apps Script ?action=torn proxy. Superseded by WORKER_URL.
  USE_PROXY: false
};

// Fetch a Torn API path, e.g. tornFetch('v2/faction/basic').
// Accepts a bare path or a full https://api.torn.com/... URL (for paginated
// _metadata.links follow-ups). Returns parsed JSON.
async function tornFetch(path) {
  path = String(path)
    .replace(/^https?:\/\/api\.torn\.com\//, '')
    .replace(/^\//, '')
    .replace(/([?&])key=[^&]*&?/, '$1')
    .replace(/[?&]$/, '');

  if (CONFIG.WORKER_URL) {
    const wsep = CONFIG.WORKER_URL.indexOf('?') > -1 ? '&' : '?';
    const r = await fetch(CONFIG.WORKER_URL + wsep + 'path=' + encodeURIComponent(path));
    return r.json();
  }

  if (CONFIG.USE_PROXY) {
    const r = await fetch(CONFIG.SCRIPT_URL + '?action=torn&path=' + encodeURIComponent(path));
    return r.json();
  }

  const sep = path.indexOf('?') > -1 ? '&' : '?';
  const r = await fetch('https://api.torn.com/' + path + sep + 'key=' + CONFIG.apiKey);
  return r.json();
}
