(function () {
  var MEMBER_LINKS = [
    { href: "/competitions", label: "Competitions" },
    { href: "/scripts", label: "Scripts" },
    { href: "/request-script", label: "Request a Script" },
  ];

  // Pages that live under a member nav link, for active-state highlighting.
  var MEMBER_PARENTS = {
    "/eggs": "/competitions",
    "/mug/": "/competitions",
  };

  var ADMIN_LINKS = [
    { href: "/admin", label: "Admin Hub" },
    { href: "/war-pay", label: "War Pay" },
    { href: "/oc", label: "OC Tracker" },
    { href: "/energy", label: "Energy" },
    { href: "/xr", label: "Xanax Runners" },
    { href: "/wars", label: "War Room" },
    { href: "/war", label: "War Analyzer" },
    { href: "/xanax", label: "Xanax Tracker" },
    { href: "/chain", label: "Chain Performance" },
  ];

  var CSS =
    ".site-nav{background:#1d1b16;border-bottom:1px solid #332f26;margin-bottom:16px;" +
    'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px}' +
    ".site-nav .sn-row{display:flex;align-items:center;flex-wrap:wrap;gap:2px 8px;padding:8px 16px;max-width:1200px;margin:0 auto}" +
    ".site-nav.sn-admin{background:#232019}" +
    ".site-nav .sn-brand{color:#ffd700;font-weight:700;font-size:15px;letter-spacing:.05em;text-transform:uppercase;text-decoration:none;margin-right:12px}" +
    ".site-nav .sn-brand:hover{color:#ffe14d}" +
    ".site-nav .sn-brand b{color:#988f7c;font-weight:600}" +
    ".site-nav a.sn-link{color:#988f7c;text-decoration:none;padding:5px 9px;border-radius:6px;white-space:nowrap}" +
    ".site-nav a.sn-link:hover{color:#f1ede4;background:#2a271f}" +
    ".site-nav a.sn-link.active{color:#f1ede4;background:#332f26}" +
    ".site-nav .sn-right{margin-left:auto}";

  function norm(p) {
    p = p.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
    return p === "" ? "/" : p;
  }

  var current = norm(location.pathname);
  if (MEMBER_PARENTS[current]) current = MEMBER_PARENTS[current];

  function linkHtml(l) {
    var active = norm(l.href) === current ? " active" : "";
    return '<a class="sn-link' + active + '" href="' + l.href + '">' + l.label + "</a>";
  }

  var isAdminPage = ADMIN_LINKS.some(function (l) { return norm(l.href) === current; });

  var html;
  if (isAdminPage) {
    // Admin pages: logo only. The Admin Hub page is the menu.
    html =
      '<nav class="site-nav sn-admin">' +
      '<div class="sn-row">' +
      '<a class="sn-brand" href="/admin">Resilience <b>Admin</b></a>' +
      '<span class="sn-right">' +
      (window.Auth && window.Auth.isAdmin() ? '<a class="sn-link" href="#" id="snSignout">Sign out</a>' : "") +
      "</span>" +
      "</div>" +
      "</nav>";
  } else {
    // Member pages: member links plus a single entry point to the admin area.
    html =
      '<nav class="site-nav">' +
      '<div class="sn-row">' +
      '<a class="sn-brand" href="/">Resilience</a>' +
      MEMBER_LINKS.map(linkHtml).join("") +
      '<span class="sn-right"><a class="sn-link" href="/admin">Admin</a></span>' +
      "</div>" +
      "</nav>";
  }

  var style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  var mount = document.getElementById("site-nav");
  if (!mount) {
    mount = document.createElement("div");
    mount.id = "site-nav";
    document.body.insertBefore(mount, document.body.firstChild);
  }
  mount.innerHTML = html;

  var signout = document.getElementById("snSignout");
  if (signout) {
    signout.addEventListener("click", function (e) {
      e.preventDefault();
      window.Auth.logout();
    });
  }
})();
