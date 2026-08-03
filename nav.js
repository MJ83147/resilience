(function () {
  var MEMBER_LINKS = [
    { href: '/', label: 'Dashboard' },
    { href: '/wars.html', label: 'War Room' },
    { href: '/war.html', label: 'War Analyzer' },
    { href: '/eggs.html', label: 'Egg Hunt' },
    { href: '/xr.html', label: 'Xanax Runners' },
    { href: '/mug/', label: 'Mug Board' },
    { href: '/chains/', label: 'Chain Watch' },
    { href: '/scripts.html', label: 'Scripts' }
  ];

  var ADMIN_LINKS = [
    { href: '/admin.html', label: 'Admin Hub' },
    { href: '/war-pay.html', label: 'War Pay' },
    { href: '/oc.html', label: 'OC Tracker' },
    { href: '/energy.html', label: 'Energy' },
    { href: '/xanax.html', label: 'Xanax Tracker' },
    { href: '/chain.html', label: 'Chain Performance' }
  ];

  var CSS =
    '.site-nav{background:#1d1b16;border-bottom:1px solid #332f26;margin-bottom:16px;' +
      'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px}' +
    '.site-nav .sn-row{display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px;padding:8px 16px;max-width:1200px;margin:0 auto}' +
    '.site-nav .sn-admin-row{border-top:1px solid #2a271f;background:#232019}' +
    '.site-nav .sn-brand{color:#ffd700;font-weight:700;font-size:15px;letter-spacing:.05em;text-transform:uppercase;text-decoration:none;margin-right:12px}' +
    '.site-nav .sn-brand:hover{color:#ffe14d}' +
    '.site-nav a.sn-link{color:#988f7c;text-decoration:none;padding:5px 9px;border-radius:6px;white-space:nowrap}' +
    '.site-nav a.sn-link:hover{color:#f1ede4;background:#2a271f}' +
    '.site-nav a.sn-link.active{color:#f1ede4;background:#332f26}' +
    '.site-nav .sn-label{color:#6b6353;font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-right:4px}';

  function norm(p) {
    p = p.replace(/\/index\.html$/, '/');
    return p === '' ? '/' : p;
  }

  var current = norm(location.pathname);

  function linkHtml(l) {
    var active = norm(l.href) === current ? ' active' : '';
    return '<a class="sn-link' + active + '" href="' + l.href + '">' + l.label + '</a>';
  }

  // Until auth ships, Auth is undefined and the admin row is always shown.
  var showAdmin = !window.Auth || window.Auth.isAdmin();

  var html =
    '<nav class="site-nav">' +
      '<div class="sn-row">' +
        '<a class="sn-brand" href="/">Resilience</a>' +
        MEMBER_LINKS.map(linkHtml).join('') +
      '</div>' +
      (showAdmin
        ? '<div class="sn-row sn-admin-row"><span class="sn-label">Admin</span>' +
            ADMIN_LINKS.map(linkHtml).join('') +
          '</div>'
        : '') +
    '</nav>';

  var style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  var mount = document.getElementById('site-nav');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'site-nav';
    document.body.insertBefore(mount, document.body.firstChild);
  }
  mount.innerHTML = html;
})();
