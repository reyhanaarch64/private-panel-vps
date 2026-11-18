'use strict';

function visibleItems() {
  const a = S.items.filter(i => S.hidden || i.name[0] !== '.');
  const cmp = {
    name: (x, y) => x.name.localeCompare(y.name, 'id', { numeric: true, sensitivity: 'base' }),
    date: (x, y) => y.mtime - x.mtime,
    size: (x, y) => y.size - x.size
  }[S.sort];
  a.sort((x, y) => (x.type === 'dir' ? 0 : 1) - (y.type === 'dir' ? 0 : 1) || cmp(x, y));
  return a;
}

function rowEl(it) {
  const k = kindOf(it);
  const r = h('div', 'row' + (S.sel.has(it.name) ? ' sel' : ''));
  r.dataset.name = it.name;
  const chk = h('span', 'chk');
  chk.append(ic('check'));
  const box = h('div', 'ico');
  box.style.background = k.color;
  box.append(ic(k.icon));
  const main = h('div', 'rmain');
  main.append(h('div', 'rname', it.name));
  let meta = (it.type === 'dir' ? 'Folder' : fmtSize(it.size)) + ' • ' + fmtDate(it.mtime) + ' • ' + it.mode;
  if (it.link) meta = (it.broken ? 'Link rusak' : 'Link') + ' • ' + meta;
  main.append(h('div', 'rmeta', meta));
  const more = ib('more_horiz', 'rmore');
  r.append(chk, box, main, more);
  return r;
}

function render() {
  const items = visibleItems();
  const nm = baseOf(S.path);
  $('#largeTitle').textContent = nm;
  const cr = $('#crumbs');
  cr.textContent = '';
  const mk = (label, p, cur) => {
    const b = h('button', 'crumb' + (cur ? ' cur' : ''), label);
    b.type = 'button';
    if (!inScope(p)) b.disabled = true;
    b.onclick = () => { if (p !== S.path) go(p); };
    cr.append(b);
  };
  mk('/', '/', S.path === '/');
  const segs = S.path.split('/').filter(Boolean);
  let acc = '';
  segs.forEach((s, i) => { acc += '/' + s; mk(s, acc, i === segs.length - 1); });
  requestAnimationFrame(() => { cr.scrollLeft = cr.scrollWidth; });

  const list = $('#list');
  list.textContent = '';
  list.classList.toggle('selecting', S.selecting);
  if (!items.length) {
    const e = h('div', 'empty');
    e.append(ic('folder_open'), h('div', null, 'Folder kosong'));
    list.append(e);
  } else {
    const g = h('div', 'group');
    items.slice(0, S.shown).forEach(it => g.append(rowEl(it)));
    if (items.length > S.shown) {
      const m = h('button', 'morerow', 'Tampilkan lebih banyak (' + (items.length - S.shown) + ')');
      m.type = 'button';
      m.dataset.more = '1';
      g.append(m);
    }
    list.append(g);
  }
  const nd = items.filter(i => i.type === 'dir').length;
  const hid = S.items.length - items.length;
  $('#foot').textContent = items.length ? nd + ' folder, ' + (items.length - nd) + ' berkas' + (hid ? ' • ' + hid + ' tersembunyi' : '') : (hid ? hid + ' item tersembunyi' : '');
  chrome();
  if (S.flash) {
    const row = [...list.querySelectorAll('.row')].find(r => r.dataset.name === S.flash);
    if (row) { row.classList.add('flash'); row.scrollIntoView({ block: 'center' }); }
    S.flash = null;
  }
}

function chrome() {
  const files = S.view === 'files';
  $('#scroll').classList.toggle('hidden', !files);
  $('#terminalView').classList.toggle('hidden', S.view !== 'terminal');
  $('#processView').classList.toggle('hidden', S.view !== 'processes');
  $('#packageView').classList.toggle('hidden', S.view !== 'packages');
  $('#copilotView').classList.toggle('hidden', S.view !== 'copilot');
  $('#nav').classList.toggle('selecting', files && S.selecting);
  $('#nav').classList.toggle('scrolled', !files || $('#scroll').scrollTop > 48);
  const up = $('#btnUp');
  up.textContent = '';
  const sel = $('#btnSel');
  up.classList.toggle('hidden', !files);
  sel.classList.toggle('hidden', !files);
  // search cuma di layar file, menu ada di semua layar kecuali lagi mode pilih
  $('#btnSearch').classList.toggle('hidden', !files || S.selecting);
  $('#btnMenu').classList.toggle('hidden', files && S.selecting);
  if (files && S.selecting) {
    up.className = 'nbtn txt';
    up.textContent = 'Semua';
    sel.textContent = 'Selesai';
    $('#navTitle').textContent = S.sel.size ? S.sel.size + ' dipilih' : 'Pilih item';
  } else {
    up.className = 'nbtn' + (files && S.parent ? '' : ' dis');
    up.append(ic('arrow_back_ios_new'));
    sel.textContent = 'Pilih';
    $('#navTitle').textContent = files ? baseOf(S.path) : ({ terminal: 'Terminal', processes: 'Proses', packages: 'Package', copilot: 'Copilot' }[S.view] || '');
  }
  $('#tabbar').classList.toggle('hidden', S.selecting && files);
  const sb = $('#selbar');
  sb.classList.toggle('hidden', !S.selecting || !files);
  sb.classList.toggle('none', S.sel.size === 0);
  document.querySelectorAll('#tabbar .tab').forEach(t => t.classList.toggle('active',
    (S.view === 'files' && t.id === 'tabHome') || (S.view === 'terminal' && t.id === 'tabTerminal') || (S.view === 'processes' && t.id === 'tabProcesses') || (S.view === 'packages' && t.id === 'tabPackages') || (S.view === 'copilot' && t.id === 'tabCopilot')));
  up.classList.toggle('hidden', !files);
  sel.classList.toggle('hidden', !files);
  const pb = $('#pasteBar');
  if (files && S.clip && !S.selecting) {
    pb.classList.remove('hidden');
    $('#pasteTxt').textContent = S.clip.mode === 'unzip'
      ? S.clip.from.length + ' arsip siap diekstrak'
      : S.clip.from.length + ' item ' + (S.clip.mode === 'move' ? 'dipotong' : 'disalin');
    $('#pasteGo').textContent = S.clip.mode === 'unzip' ? 'Ekstrak' : 'Tempel';
  } else pb.classList.add('hidden');
}

function updateSel() {
  $('#list').querySelectorAll('.row').forEach(r => r.classList.toggle('sel', S.sel.has(r.dataset.name)));
  chrome();
}
function exitSelect() {
  S.selecting = false;
  S.sel.clear();
  render();
}

function go(p) {
  history.pushState({ nav: 1 }, '', hashEnc(p));
  load(p);
}
function route() {
  load(hashDec() || S.home);
}
function startAt(p) {
  history.replaceState({ nav: 1 }, '', hashEnc(p));
  load(p);
}
async function load(p, keepScroll) {
  if (S.view !== 'files') setView('files');
  const top = $('#scroll').scrollTop;
  const d = await run(() => api('GET', '/list?path=' + enc(p)));
  if (!d) {
    if (!S.path && p !== S.home) return load(S.home);
    return;
  }
  S.path = d.path;
  S.parent = d.parent;
  S.scope = d.scope;
  S.items = d.items;
  S.sel.clear();
  S.selecting = false;
  S.shown = 300;
  if (hashDec() !== d.path) history.replaceState(history.state, '', hashEnc(d.path));
  render();
  $('#scroll').scrollTop = keepScroll ? top : 0;
}
const reload = () => load(S.path, true);
