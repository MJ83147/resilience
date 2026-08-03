(function () {
  // Validated against the wars Apps Script (?action=admincheck).
  var AUTH_URL = 'https://script.google.com/macros/s/AKfycbwIL60E_q7Qtv9AAXJk9FxvU4Wbq6JyI63M9xFNXA9w8wnx4pZNx0Vbg6L7KdmhEe-Mgw/exec';
  var KEY = 'resAdmin';
  var LEGACY_KEY = 'resWarAdmin';

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
      // Migrate the old wars.html storage, which held the raw password.
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        localStorage.removeItem(LEGACY_KEY);
        var cred = { uid: legacy };
        localStorage.setItem(KEY, JSON.stringify(cred));
        return cred;
      }
    } catch (e) {}
    return null;
  }

  function store(cred) {
    try { localStorage.setItem(KEY, JSON.stringify(cred)); } catch (e) {}
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {}
  }

  function tokenExpired(token) {
    var exp = Number(String(token).split('.')[0]);
    return !isNaN(exp) && exp < Date.now();
  }

  function isAdmin() {
    var cred = read();
    if (!cred) return false;
    if (cred.token) return !tokenExpired(cred.token);
    return !!cred.uid;
  }

  // Query-string credential for Apps Script calls (reads and writes).
  function param() {
    var cred = read();
    if (!cred) return '';
    if (cred.token) return 'token=' + encodeURIComponent(cred.token);
    return 'uid=' + encodeURIComponent(cred.uid);
  }

  function login(password, cb) {
    fetch(AUTH_URL + '?action=admincheck&uid=' + encodeURIComponent(password), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.admin) {
          // Newer Apps Script versions return a signed token; older ones only
          // confirm the password, in which case the password itself is kept.
          store(j.token ? { token: j.token } : { uid: password });
          cb(true);
        } else {
          cb(false, 'Wrong password.');
        }
      })
      .catch(function () { cb(false, 'Could not reach the data source.'); });
  }

  // Server-side re-check of the stored credential.
  // cb(true|false|null) - null means the check itself failed (network).
  function verify(cb) {
    var p = param();
    if (!p) { cb(false); return; }
    fetch(AUTH_URL + '?action=admincheck&' + p, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb(!!(j && j.admin)); })
      .catch(function () { cb(null); });
  }

  function logout() {
    clear();
    location.reload();
  }

  function showLogin() {
    var children = Array.prototype.slice.call(document.body.children);
    children.forEach(function (el) {
      if (el.id === 'site-nav' || el.tagName === 'SCRIPT') return;
      el.style.display = 'none';
    });

    var wrap = document.createElement('div');
    wrap.id = 'auth-gate';
    wrap.innerHTML =
      '<div class="panel" style="max-width:460px;margin:60px auto 0">' +
        '<h3>Admin area</h3>' +
        '<p class="cap">This page is for faction admins. Enter the password to continue.</p>' +
        '<div class="lookup"><input id="authPw" type="password" placeholder="Password" autocomplete="off"></div>' +
        '<button class="unlock-btn" id="authUnlock">Unlock</button>' +
        '<p class="note" id="authMsg"></p>' +
      '</div>';
    document.body.appendChild(wrap);

    var input = document.getElementById('authPw');
    var msg = document.getElementById('authMsg');
    function attempt() {
      var pw = input.value.trim();
      if (!pw) return;
      msg.textContent = 'Checking…';
      login(pw, function (ok, err) {
        if (ok) { location.reload(); }
        else { msg.textContent = err || 'Wrong password.'; }
      });
    }
    document.getElementById('authUnlock').addEventListener('click', attempt);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });
    input.focus();
  }

  // Call on admin pages. Client-side only: it hides the UI from non-admins.
  // Writes are enforced server-side by the Apps Script credential check.
  function gate() {
    function run() {
      if (!isAdmin()) { showLogin(); return; }
      verify(function (ok) {
        if (ok === false) { clear(); showLogin(); }
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  // Credential as an object, for merging into POST bodies.
  function cred() {
    var c = read();
    if (!c) return {};
    return c.token ? { token: c.token } : { uid: c.uid };
  }

  window.Auth = {
    isAdmin: isAdmin,
    param: param,
    cred: cred,
    login: login,
    verify: verify,
    logout: logout,
    gate: gate
  };

  // Admin pages load this script with a data-gate attribute instead of
  // calling Auth.gate() inline (the script is deferred, so inline callers
  // would run before Auth exists).
  var cs = document.currentScript;
  if (cs && cs.hasAttribute('data-gate')) gate();
})();
