// tema terang/gelap, dipanggil di head biar nggak kedip pas buka
(function () {
  var KEY = 'vpsacc_theme';
  var COLOR = { light: '#f2f2f7', dark: '#000000' };

  function get() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : 'auto';
    } catch (e) { return 'auto'; }
  }

  function paint(mode) {
    var root = document.documentElement;
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    // warna status bar browser ikut tema pilihan
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      if (!m.getAttribute('data-orig')) m.setAttribute('data-orig', m.getAttribute('content'));
      m.setAttribute('content', mode === 'auto' ? m.getAttribute('data-orig') : COLOR[mode]);
    }
  }

  function set(mode) {
    try {
      if (mode === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) { /* abaikan */ }
    paint(mode);
  }

  window.vpsTheme = { get: get, set: set };
  paint(get());
})();
