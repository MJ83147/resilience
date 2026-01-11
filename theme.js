(function() {
  // Create toggle button
  const btn = document.createElement('button');
  btn.className = 'theme-toggle';
  btn.id = 'themeToggle';
  btn.innerHTML = '<span class="theme-icon"></span><span class="theme-label"></span>';
  document.body.insertBefore(btn, document.body.firstChild);

  const icon = btn.querySelector('.theme-icon');
  const label = btn.querySelector('.theme-label');

  function getPreferredTheme() {
    const saved = localStorage.getItem('theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      icon.textContent = '🌙';
      label.textContent = 'Dark';
    } else {
      icon.textContent = '☀️';
      label.textContent = 'Light';
    }
  }

  setTheme(getPreferredTheme());

  btn.addEventListener('click', function() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
    if (!localStorage.getItem('theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
})();
