'use strict';

function openSearch() {
  const pg = h('div', 'page');
  const head = h('div', 'page-head');
  const row = h('div', 'page-row');
  const box = h('div', 'sbox');
  const inp = h('input');
  inp.type = 'search';
  inp.placeholder = 'Cari nama / *.ext / pola';
  inp.autocapitalize = 'off';
  inp.autocomplete = 'off';
  box.append(ic('search'), inp);
  const cancel = h('button', 'nbtn txt', 'Batal');
  cancel.type = 'button';
  cancel.onclick = () => closeOv();
  row.append(box, cancel);
  head.append(row);

  const filters = h('div', 'sfilters');
  const onlyHere = h('label', 'sfilter');
  const onlyHereCb = h('input');
  onlyHereCb.type = 'checkbox';
  onlyHere.append(onlyHereCb, document.createTextNode(' Hanya folder ini'));
  const typeWrap = h('div', 'sfilter-types');
  const typeDefs = [
    ['all', 'Semua'], ['dir', 'Folder'], ['image', 'Gambar'], ['video', 'Video'],
    ['audio', 'Audio'], ['archive', 'Arsip'], ['doc', 'Dokumen'], ['code', 'Kode']
  ];
  const typeState = { value: 'all' };
  typeDefs.forEach(([val, lab]) => {
    const b = h('button', 'sfilter-chip' + (val === 'all' ? ' on' : ''), lab);
    b.type = 'button';
    b.onclick = () => {
      typeState.value = val;
      typeWrap.querySelectorAll('.sfilter-chip').forEach(x => x.classList.toggle('on', x === b));
      doSearch();
    };
    typeWrap.append(b);
  });
  filters.append(onlyHere, typeWrap);

  const res = h('div', 'sres');
  const stat = txt => { res.textContent = ''; res.append(h('div', 'sstat', txt)); };
  stat('Ketik nama, pola (*.log), atau pilih filter jenis file.');
  pg.append(head, filters, res);

  const showResults = d => {
    res.textContent = '';
    if (!d.items.length) { stat('Tidak ada hasil untuk "' + d.q + '"'); return; }
    const g = h('div', 'group');
    d.items.forEach(it => {
      const k = kindOf(it);
      const r = h('div', 'row');
      const box2 = h('div', 'ico');
      box2.style.background = k.color;
      box2.append(ic(k.icon));
      const main = h('div', 'rmain');
      main.append(h('div', 'rname', it.name), h('div', 'rmeta', it.dir + (it.size != null ? ' · ' + fmtSize(it.size) : '')));
      r.append(box2, main);
      r.onclick = () => {
        closeSilent();
        if (it.type === 'dir') go(it.path);
        else if (it.dir === S.path) { S.flash = it.name; render(); }
        else { S.flash = it.name; go(it.dir); }
      };
      g.append(r);
    });
    res.append(g);
    if (d.truncated) res.append(h('div', 'sstat', 'Hasil dibatasi, persempit kata kunci'));
  };

  let timer = null;
  let ctl = null;
  function doSearch() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = inp.value.trim();
      if (ctl) ctl.abort();
      if (!q && typeState.value === 'all') {
        stat('Ketik nama, pola (*.log), atau pilih filter jenis file.');
        return;
      }
      ctl = new AbortController();
      stat('Mencari…');
      const params = new URLSearchParams();
      params.set('path', S.path);
      params.set('q', q || '*');
      if (onlyHereCb.checked) params.set('depth', '1');
      if (typeState.value !== 'all') params.set('type', typeState.value);
      try {
        showResults(await api('GET', '/search?' + params.toString(), undefined, { signal: ctl.signal }));
      } catch (e) {
        if (e.name !== 'AbortError') stat(e.message);
      }
    }, 320);
  }
  inp.addEventListener('input', doSearch);
  onlyHereCb.addEventListener('change', doSearch);
  openOv(pg, { onhide: () => { if (ctl) ctl.abort(); } });
  setTimeout(() => inp.focus(), 330);
}

function sortSheet() {
  const set = v => () => { S.sort = v; LS.set('vpsacc_sort', v); render(); };
  sheet('Urutkan berdasarkan', [
    { label: 'Nama', icon: 'sort_by_alpha', tick: S.sort === 'name', fn: set('name') },
    { label: 'Terbaru diubah', icon: 'schedule', tick: S.sort === 'date', fn: set('date') },
    { label: 'Ukuran terbesar', icon: 'data_usage', tick: S.sort === 'size', fn: set('size') }
  ]);
}
async function serverInfo() {
  const d = await run(() => api('GET', '/ping'));
  if (!d) return;
  const gb = n => (n / 1073741824).toFixed(2).replace('.', ',') + ' GB';
  const up = Math.floor(d.uptime / 3600);
  const rows = [
    { kv: ['Hostname', d.hostname] }, { kv: ['Area akses', d.full ? '/ (penuh)' : d.scope] },
    { kv: ['Sistem', d.platform] }, { kv: ['Node', d.node] },
    { kv: ['Aktif', up >= 24 ? Math.floor(up / 24) + ' hari ' + (up % 24) + ' jam' : up + ' jam'] },
    { kv: ['Beban CPU', d.load.map(x => x.toFixed(2)).join(' / ')] },
    { kv: ['RAM bebas', gb(d.mem.free) + ' dari ' + gb(d.mem.total)] }
  ];
  if (d.disk) rows.push({ kv: ['Disk bebas', gb(d.disk.free) + ' dari ' + gb(d.disk.total)] });
  sheet('Info server', rows);
}
function menuSheet() {
  sheet(null, [
    { label: 'Urutkan', icon: 'sort', fn: sortSheet },
    {
      label: S.hidden ? 'Sembunyikan file tersembunyi' : 'Tampilkan file tersembunyi', icon: S.hidden ? 'visibility_off' : 'visibility',
      fn: () => { S.hidden = !S.hidden; LS.set('vpsacc_hidden', S.hidden ? '1' : '0'); render(); }
    },
    { label: 'Segarkan', icon: 'refresh', fn: () => reload() },
    { label: 'Terminal', icon: 'terminal', fn: () => setView('terminal') },
    { label: 'Pantau proses', icon: 'monitor_heart', fn: () => setView('processes') },
    { label: 'Package manager', icon: 'inventory_2', fn: () => setView('packages') },
    { label: 'Proses skrip lama', icon: 'code', fn: jobsSheet },
    { label: 'File publik', icon: 'public', fn: openPublicFiles },
    { label: 'Tampilan: ' + themeName(), icon: themeIcon(), fn: themeSheet },
    { label: 'Info server', icon: 'dns', fn: serverInfo },
    ...(installEv ? [{ label: 'Pasang aplikasi', icon: 'install_mobile', fn: doInstall }] : []),
    { label: 'Keluar', icon: 'logout', red: true, fn: () => doLogout() }
  ]);
}
function addSheet() {
  sheet('Buat di ' + baseOf(S.path), [
    { label: 'Folder baru', icon: 'create_new_folder', fn: opNewFolder },
    { label: 'File baru', icon: 'note_add', fn: opNewFile },
    { label: 'Unggah file', icon: 'upload_file', fn: pickUpload }
  ]);
}
