/**
 * Dynamic Navigation — renders navbar once, shared by all pages.
 *
 * Each page places an empty <nav id="navbar" data-active="home|projects|contact">
 * before the main content.  This script hydrates it with the standard navbar markup,
 * computing relative paths so it works from any directory depth.
 */
(function () {
  /* ---- compute base path from current URL depth ---- */
  var path = window.location.pathname;
  var base;
  if (path.indexOf('/pages/projects/') !== -1) {
    base = '../../';
  } else if (path.indexOf('/pages/') !== -1) {
    base = '../';
  } else {
    base = './';
  }

  /* ---- nav items (paths relative to repo root) ---- */
  var ITEMS = [
    { href: 'index.html',                label: '首页',   id: 'home' },
    { href: 'pages/projects.html',       label: '项目',   id: 'projects' },
    { href: 'pages/contact.html',        label: '联系',   id: 'contact' },
  ];

  /* ---- build markup ---- */
  function buildNav(activeId) {
    var linksHTML = ITEMS.map(function (item) {
      var cls = item.id === activeId ? ' class="active"' : '';
      return '<li><a href="' + base + item.href + '"' + cls + '>' + item.label + '</a></li>';
    }).join('');

    return ''
      + '<div class="nav-container">'
      + '  <a href="' + base + 'index.html" class="nav-logo">张严鑫</a>'
      + '  <ul class="nav-links">' + linksHTML + '</ul>'
      + '</div>';
  }

  /* ---- hydrate ---- */
  function hydrate() {
    var nav = document.getElementById('navbar');
    if (!nav) return;

    var activeId = nav.getAttribute('data-active') || 'home';
    nav.className = 'navbar';
    nav.innerHTML = buildNav(activeId);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrate);
  } else {
    hydrate();
  }
})();
