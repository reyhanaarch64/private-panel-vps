'use strict';

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; });
window.addEventListener('appinstalled', () => { installEv = null; toast('Aplikasi terpasang'); });
async function doInstall() {
  if (!installEv) return;
  const ev = installEv;
  installEv = null;
  ev.prompt();
  try { await ev.userChoice; } catch (e) { /* abaikan */ }
}
