// Site-wide config and Torn API access.
const CONFIG = {
  // Wars Apps Script: admin checks, war data, and (once deployed) the Torn proxy.
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwIL60E_q7Qtv9AAXJk9FxvU4Wbq6JyI63M9xFNXA9w8wnx4pZNx0Vbg6L7KdmhEe-Mgw/exec',

  // Set true after the ?action=torn proxy is added to the Apps Script.
  USE_PROXY: false,

  // TEMPORARY direct-call key, used only while USE_PROXY is false.
  // Delete this line when USE_PROXY goes true.
  apiKey: 'Ai7FeouMaJd9ufVr'
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

  if (CONFIG.USE_PROXY) {
    const r = await fetch(CONFIG.SCRIPT_URL + '?action=torn&path=' + encodeURIComponent(path));
    return r.json();
  }

  const sep = path.indexOf('?') > -1 ? '&' : '?';
  const r = await fetch('https://api.torn.com/' + path + sep + 'key=' + CONFIG.apiKey);
  return r.json();
}
