'use strict';

function wire() {
  const list = $('#list');
  let lp = null;
  let lpFired = false;
  let sx = 0;
  let sy = 0;
  list.addEventListener('pointerdown', e => {
    const row = e.target.closest('.row');
    if (!row || e.target.closest('.rmore')) return;
    lpFired = false;
    sx = e.clientX;
    sy = e.clientY;
    clearTimeout(lp);
    lp = setTimeout(() => {
      lpFired = true;
      if (navigator.vibrate) navigator.vibrate(15);
      if (!S.selecting) { S.selecting = true; S.sel.clear(); render(); }
      S.sel.add(row.dataset.name);
      updateSel();
    }, 430);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => list.addEventListener(t, () => clearTimeout(lp)));
  list.addEventListener('pointermove', e => {
    if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(lp);
  });
  list.addEventListener('contextmenu', e => e.preventDefault());
  list.addEventListener('click', e => {
    if (lpFired) { lpFired = false; return; }
    const mr = e.target.closest('.morerow');
    if (mr) { S.shown += 300; render(); return; }
    const row = e.target.closest('.row');
    if (!row) return;
    const it = getItem(row.dataset.name);
    if (!it) return;
    if (e.target.closest('.rmore')) { itemMenu(it); return; }
    if (S.selecting) {
      if (S.sel.has(it.name)) S.sel.delete(it.name); else S.sel.add(it.name);
      updateSel();
    } else openItem(it);
  });
  $('#scroll').addEventListener('scroll', e => $('#nav').classList.toggle('scrolled', e.target.scrollTop > 48), { passive: true });

  $('#btnUp').onclick = () => {
    if (S.selecting) {
      const all = visibleItems();
      if (S.sel.size === all.length) S.sel.clear(); else all.forEach(i => S.sel.add(i.name));
      updateSel();
    } else if (S.parent) go(S.parent);
  };
  $('#btnSel').onclick = () => { if (S.selecting) exitSelect(); else { S.selecting = true; render(); } };
  $('#tabHome').onclick = () => { setView('files'); if (S.path !== S.scope) go(S.scope); };
  $('#btnSearch').onclick = () => openSearch();
  $('#tabTerminal').onclick = () => setView('terminal');
  $('#tabProcesses').onclick = () => setView('processes');
  $('#tabPackages').onclick = () => setView('packages');
  $('#tabCopilot').onclick = () => setView('copilot');
  $('#copilotNew').onclick = newCopilotChat;
  $('#copilotLogin').onclick = startCopilotLogin;
  $('#copilotLoginCopy').onclick = () => copyText($('#copilotLoginCode').textContent)
    .then(() => toast('Kode verifikasi disalin'), () => toast('Gagal menyalin kode', 'err'));
  $('#copilotSettings').onclick = openCopilotSettings;
  $('#copilotDelete').onclick = deleteCopilotChat;
  $('#copilotComposer').addEventListener('submit', sendCopilotMessage);
  window.CopilotMcp.init({ api, toast, confirmD, openOv, closeOv });
  $('#copilotInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#copilotComposer').requestSubmit();
    }
  });
  $('#copilotShowList').onclick = () => $('#copilotSidebar').classList.remove('closed');
  initPackages();
  $('#tabAdd').onclick = () => { setView('files'); addSheet(); };
  $('#btnMenu').onclick = menuSheet;
  $('#termNew').onclick = createWebTerminalSession;
  $('#termClose').onclick = closeActiveWebTerminal;
  $('#procRefresh').onclick = refreshProcesses;
  $('#procSearch').addEventListener('input', renderProcesses);
  $('#procSort').addEventListener('change', renderProcesses);
  $('#procList').addEventListener('click', e => { const row = e.target.closest('[data-process-pid]'); if (row) { const proc = processData.find(p => p.pid === Number(row.dataset.processPid)); if (proc) processDetail(proc); } });
  document.querySelectorAll('.proc-filter').forEach(b => b.onclick = () => { processFilter = b.dataset.filter; document.querySelectorAll('.proc-filter').forEach(x => x.classList.toggle('active', x === b)); renderProcesses(); });
  $('#termKeys').addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) terminalKey(b.dataset.key); });
  $('#sbCopy').onclick = () => opClip('copy', [...S.sel]);
  $('#sbCut').onclick = () => opClip('move', [...S.sel]);
  $('#sbZip').onclick = () => opZip([...S.sel]);
  $('#sbDel').onclick = () => opDelete([...S.sel]);
  $('#sbMore').onclick = selMore;
  $('#pasteGo').onclick = opPaste;
  $('#pasteX').onclick = () => { S.clip = null; chrome(); };
  $('#fileInp').onchange = e => {
    const fs = [...e.target.files];
    if (fs.length) startUpload(fs);
  };

  $('#lgBtn').onclick = doLogin;
  $('#lgToken').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#lgEye').onclick = () => {
    const i = $('#lgToken');
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('#lgEye').firstChild.textContent = show ? 'visibility_off' : 'visibility';
  };
}
