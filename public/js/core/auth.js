'use strict';

function showLogin(msg) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#lgErr').textContent = msg || '';
  $('#lgToken').value = '';
}
function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
}
async function doLogin() {
  const t = $('#lgToken').value.trim();
  if (!t) return;
  $('#lgErr').textContent = '';
  busy(1);
  try {
    S.token = t;
    const d = await api('GET', '/ping', undefined, { quiet: true });
    LS.set('vpsacc_token', t);
    S.sys = d;
    S.scope = d.scope;
    showApp();
    startAt(hashDec() || S.scope);
  } catch (e) {
    S.token = '';
    $('#lgErr').textContent = e.status === 401 ? 'Token salah' : e.message;
  } finally {
    busy(-1);
  }
}
function doLogout(msg) {
  S.token = '';
  LS.del('vpsacc_token');
  S.path = '';
  S.items = [];
  S.clip = null;
  if (processPollTimer) { clearInterval(processPollTimer); processPollTimer = null; }
  if (CP.pollTimer) { clearInterval(CP.pollTimer); CP.pollTimer = null; }
  if (CP.loginPollTimer) { clearInterval(CP.loginPollTimer); CP.loginPollTimer = null; }
  CP.loginJobId = null;
  webTerminals.forEach(t => {
    try { t.ws.close(1000, 'logout'); } catch (e) { /* abaikan */ }
    try { t.term.dispose(); } catch (e) { /* abaikan */ }
    try { t.host.remove(); } catch (e) { /* abaikan */ }
  });
  webTerminals.length = 0;
  activeWebTerminalId = null;
  termModifiers = { ctrl: false, alt: false };
  closeAllOv();
  showLogin(msg);
}
