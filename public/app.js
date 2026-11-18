'use strict';

// Bootstrap runs after the categorized classic-script modules have initialized.
function boot() {
  const fr = () => document.documentElement.classList.add('fr');
  if (document.fonts && document.fonts.load) {
    document.fonts.load('24px "Material Symbols Rounded"', 'folder').then(fr, fr);
    setTimeout(fr, 3000);
  } else fr();
  try {
    if (window.dayjs) {
      if (window.dayjs_plugin_relativeTime) window.dayjs.extend(window.dayjs_plugin_relativeTime);
      window.dayjs.locale('id');
    }
  } catch (e) { /* tanpa dayjs */ }
  $('#lgTitle').textContent = (document.body.dataset.host || 'VPS') + ' panel';
  $('#panelBrand').textContent = (document.body.dataset.host || 'VPS') + ' panel';
  document.title = (document.body.dataset.host || 'VPS') + ' panel';
  wire();
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (!S.token) { showLogin(); return; }
  api('GET', '/ping', undefined, { quiet: true }).then(d => {
    S.sys = d;
    S.scope = d.scope;
    showApp();
    startAt(hashDec() || S.scope);
  }).catch(e => showLogin(e.status === 401 ? 'Sesi habis, masuk lagi' : e.message));
}

boot();
