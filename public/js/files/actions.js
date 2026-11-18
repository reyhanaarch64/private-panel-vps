'use strict';

function report(r, verb) {
  if (r.failed && r.failed.length) toast(r.ok.length + ' ' + verb + ', ' + r.failed.length + ' gagal: ' + r.failed[0].error, 'err');
  else toast(r.ok.length + ' item ' + verb);
}

function openItem(it) {
  const k = kindOf(it);
  if (it.type === 'dir') go(full(it.name));
  else if (k.k === 'img' || k.k === 'video' || k.k === 'audio') openPreview(it);
  else if (isShell(it)) itemMenu(it);
  else if (k.k === 'text') openEditor(it.name).then(ok => { if (ok === false) itemMenu(it); });
  else itemMenu(it);
}

function itemMenu(it) {
  const k = kindOf(it);
  const items = [];
  if (isShell(it)) items.push({ label: 'Jalankan', icon: 'play_arrow', fn: () => opRunScript(it.name) });
  if (it.type === 'dir') items.push({ label: 'Buka', icon: 'folder_open', fn: () => go(full(it.name)) });
  else if (k.k === 'text') items.push({ label: 'Edit', icon: 'edit', fn: () => openEditor(it.name) });
  else if (k.k === 'img' || k.k === 'video' || k.k === 'audio') items.push({ label: 'Lihat', icon: 'visibility', fn: () => openPreview(it) });
  items.push(
    { label: 'Ubah nama', icon: 'drive_file_rename_outline', fn: () => opRename(it.name) },
    { label: 'Salin', icon: 'content_copy', fn: () => opClip('copy', [it.name]) },
    { label: 'Pindahkan', icon: 'drive_file_move', fn: () => opClip('move', [it.name]) }
  );
  if (it.type !== 'dir') items.push({ label: 'Unduh', icon: 'download', fn: () => opDownload(it.name) });
  // satu tombol aja, berubah sesuai status publikasi (file dan folder)
  if (it.pub === 'active') {
    items.push({ label: 'Link publik', icon: 'link', fn: () => opPublicLink(it.name) });
    if (it.type === 'dir') items.push({ label: 'Pengaturan folder publik', icon: 'tune', fn: () => opFolderSettings(it.name) });
  } else if (it.pub === 'inactive') items.push({ label: 'Aktifkan publikasi', icon: 'public', fn: () => opPublish(it.name, true) });
  else items.push({ label: 'Publikasikan', icon: 'public', fn: () => opPublish(it.name) });
  items.push({ label: 'Zip', icon: 'folder_zip', fn: () => opZip([it.name]) });
  if (k.k === 'zip') items.push({ label: 'Ekstrak di sini', icon: 'unarchive', fn: () => opUnzip([it.name]) });
  items.push(
    { label: 'Izin akses', icon: 'lock', fn: () => opChmod([it.name]) },
    { label: 'Info', icon: 'info', fn: () => opInfo(it.name) },
    { label: 'Hapus', icon: 'delete', red: true, fn: () => opDelete([it.name]) }
  );
  sheet(it.name, items);
}

// salin teks ke clipboard
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(() => toast('Link disalin')).catch(() => toast(t));
  } else toast(t);
}

// update status publikasi file di daftar yang lagi tampil
function setPubState(name, st) {
  const cur = S.items.find(x => x.name === name);
  if (cur) cur.pub = st;
}

async function showPublicLink(title, url) {
  const v = await dialog({
    title: title,
    msg: url,
    col: true,
    cancelVal: null,
    buttons: [
      { label: 'Salin link', val: 'copy', cls: 'b' },
      { label: 'Tutup', val: 'ok' }
    ]
  });
  if (v === 'copy') copyText(url);
}

async function opPublish(name, again) {
  const cur = getItem(name);
  const isDir = !!(cur && cur.type === 'dir');
  const body = { path: full(name) };
  // folder baru: tanya opsi dulu, kalau cuma diaktifkan lagi pakai pengaturan lama
  if (isDir && !again) {
    const o = await folderOptDialog('Publikasikan folder', { recursive: false, exclude: [] }, 'Publikasikan');
    if (!o) return;
    body.recursive = o.recursive;
    body.exclude = o.exclude;
  }
  const r = await run(() => api('POST', '/public/publish', body));
  if (!r) return;
  setPubState(name, 'active');
  await showPublicLink(again ? 'Publikasi diaktifkan' : (isDir ? 'Folder dipublikasikan' : 'File dipublikasikan'), r.url);
}

// dialog opsi publikasi folder: ikut sub folder atau nggak + daftar pengecualian
async function folderOptDialog(title, cur, okLabel) {
  const state = { recursive: !!cur.recursive };
  const box = h('div');
  const row = h('div', 'dlg-opt');
  const lbl = h('div');
  lbl.append(document.createTextNode('Sertakan sub folder'));
  lbl.append(h('small', null, 'Mati: cuma isi folder ini yang bisa dibuka'));
  const sw = h('button', 'sw' + (state.recursive ? ' on' : ''));
  sw.type = 'button';
  sw.onclick = () => { state.recursive = !state.recursive; sw.classList.toggle('on', state.recursive); };
  row.append(lbl, sw);
  const cap = h('div', 'dlg-lbl', 'Dikecualikan (satu per baris)');
  const area = h('textarea', 'dlg-area');
  area.value = (cur.exclude || []).join('\n');
  area.placeholder = '.git\n*.log\nnode_modules\nsub/cache';
  area.autocapitalize = 'off';
  area.autocomplete = 'off';
  area.spellcheck = false;
  box.append(row, cap, area);
  const ok = await dialog({
    title, msg: 'Isi folder tampil live sesuai folder aslinya.', extra: box, cancelVal: null,
    buttons: [{ label: 'Batal', val: null }, { label: okLabel || 'Simpan', val: OK, cls: 'b' }]
  });
  if (!ok) return null;
  return { recursive: state.recursive, exclude: area.value };
}

// simpan pengaturan folder yang sudah dipublikasikan
async function folderSettings(it) {
  const o = await folderOptDialog('Pengaturan folder publik', it, 'Simpan');
  if (!o) return false;
  const r = await run(() => api('POST', '/public/settings', { path: it.path, recursive: o.recursive, exclude: o.exclude }));
  if (r) toast('Pengaturan disimpan');
  return !!r;
}

async function opFolderSettings(name) {
  const d = await run(() => api('GET', '/public'));
  if (!d) return;
  const p = full(name);
  const it = (d.items || []).find(x => x.path === p);
  if (!it) {
    setPubState(name, null);
    toast('Data publikasi tidak ditemukan', 'err');
    return;
  }
  await folderSettings(it);
}

async function opPublicLink(name) {
  const d = await run(() => api('GET', '/public'));
  if (!d) return;
  const p = full(name);
  const it = (d.items || []).find(x => x.path === p);
  if (!it) {
    setPubState(name, null);
    toast('Data publikasi tidak ditemukan', 'err');
    return;
  }
  await showPublicLink('Link publik', it.url);
}

// judul pemisah bagian di dalam sheet
const pubSection = text => ({ node: h('div', 'sh-sec', text) });

async function openPublicFiles() {
  const d = await run(() => api('GET', '/public'));
  if (!d) return;
  const items = d.items || [];
  if (!items.length) {
    sheet('File publik', [{ label: 'Belum ada file atau folder yang pernah dipublikasikan', icon: 'info', fn: null }]);
    return;
  }
  const active = items.filter(x => x.active);
  const off = items.filter(x => !x.active);
  const rows = [];
  const addItem = it => {
    const isDir = it.type === 'dir';
    const info = isDir
      ? (it.exists ? 'Folder · ' + (it.recursive ? 'dengan sub folder' : 'isi folder saja') : 'folder hilang')
      : (it.exists ? fmtSize(it.size || 0) : 'file hilang');
    rows.push({
      label: it.name,
      icon: isDir ? (it.active ? 'folder_shared' : 'folder_off') : (it.active ? 'public' : 'public_off'),
      dim: !it.active,
      sub: info + ' · dibuka ' + (it.hits || 0) + 'x',
      fn: () => publicFileSheet(it)
    });
  };
  rows.push(pubSection('Aktif (' + active.length + ')'));
  if (active.length) active.forEach(addItem);
  else rows.push({ label: 'Tidak ada yang aktif', icon: 'info', dim: true, fn: null });
  rows.push(pubSection('Nonaktif (' + off.length + ')'));
  if (off.length) off.forEach(addItem);
  else rows.push({ label: 'Tidak ada yang nonaktif', icon: 'info', dim: true, fn: null });
  sheet('File publik', rows);
}

function publicFileSheet(it) {
  const isDir = it.type === 'dir';
  const items = [
    { kv: ['Status', it.active ? 'Aktif' : 'Nonaktif'] },
    { kv: ['Path', it.path] }
  ];
  if (isDir) {
    items.push({ kv: ['Jenis', 'Folder'] });
    items.push({ kv: ['Sub folder', it.recursive ? 'Ikut' : 'Tidak'] });
    items.push({ kv: ['Dikecualikan', (it.exclude && it.exclude.length) ? it.exclude.join(', ') : '-'] });
  }
  if (it.active) {
    items.push({ label: 'Salin link', icon: 'link', fn: () => copyText(it.url) });
    items.push({ label: 'Cabut publikasi', icon: 'public_off', fn: async () => {
      const r = await run(() => api('POST', '/public/unpublish', { path: it.path }));
      if (r) { toast('Publikasi dicabut (URL tetap)'); openPublicFiles(); }
    }});
  } else if (it.exists) {
    items.push({ label: 'Aktifkan publikasi', icon: 'public', fn: async () => {
      const r = await run(() => api('POST', '/public/publish', { path: it.path }));
      if (r) {
        toast('Publikasi diaktifkan (URL sama)');
        if (r.url && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(r.url).catch(() => {});
        }
        openPublicFiles();
      }
    }});
  }
  if (isDir && it.exists) {
    items.push({ label: 'Ubah pengaturan', icon: 'tune', fn: async () => {
      if (await folderSettings(it)) openPublicFiles();
    }});
  }
  items.push(pubSection('Database'));
  items.push({ label: 'Hapus dari database', icon: 'delete_forever', red: true, fn: async () => {
    const ok = await confirmD(
      'Hapus dari database?',
      'Link lama mati permanen. Kalau dipublikasikan lagi nanti, URL-nya baru (random).',
      'Hapus', true
    );
    if (!ok) return;
    const r = await run(() => api('POST', '/public/remove', { path: it.path }));
    if (r) {
      setPubState(it.name, null);
      toast('Dihapus dari database');
      openPublicFiles();
    }
  }});
  sheet(it.name, items);
}
async function opDelete(names) {
  const ok = await confirmD(names.length === 1 ? 'Hapus "' + names[0] + '"?' : 'Hapus ' + names.length + ' item?', 'Tidak bisa dibatalkan.', 'Hapus', true);
  if (!ok) return;
  const r = await run(() => api('POST', '/delete', { paths: names.map(full) }));
  if (!r) return;
  report(r, 'dihapus');
  await reload();
}
async function opRename(name) {
  const n = await promptD('Ubah nama', null, name, 'Simpan', true);
  if (!n || n === name) return;
  if (n.includes('/')) { toast('Nama tidak boleh mengandung /', 'err'); return; }
  const r = await run(() => api('POST', '/rename', { path: full(name), newName: n }));
  if (!r) return;
  report(r, 'diubah namanya');
  await reload();
}
function opClip(mode, names) {
  S.clip = { mode, from: names.map(full) };
  S.selecting = false;
  S.sel.clear();
  render();
  toast(names.length + ' item ' + (mode === 'move' ? 'dipotong, buka folder tujuan lalu Tempel' : 'disalin, buka folder tujuan lalu Tempel'));
}
async function opPaste() {
  const c = S.clip;
  if (!c) return;
  const r = await run(() => api('POST', c.mode === 'move' ? '/move' : '/copy', { from: c.from, to: S.path }));
  if (!r) return;
  report(r, c.mode === 'move' ? 'dipindah' : 'disalin');
  if (c.mode === 'move') {
    const left = c.from.filter(p => r.failed.some(f => f.path === p));
    S.clip = left.length ? { mode: 'move', from: left } : null;
  }
  await reload();
}
async function opNewFolder() {
  const n = await promptD('Folder baru', null, 'Folder baru', 'Buat');
  if (!n) return;
  if (n.includes('/')) { toast('Nama tidak boleh mengandung /', 'err'); return; }
  const r = await run(() => api('POST', '/mkdir', { path: full(n) }));
  if (!r) return;
  report(r, 'dibuat');
  await reload();
}
async function opNewFile() {
  const n = await promptD('File baru', 'Contoh: skrip.sh', '', 'Buat');
  if (!n) return;
  if (n.includes('/')) { toast('Nama tidak boleh mengandung /', 'err'); return; }
  if (getItem(n)) { toast('Nama itu sudah dipakai', 'err'); return; }
  const r = await run(() => api('PUT', '/write', { path: full(n), content: '' }));
  if (!r) return;
  await reload();
  openEditor(n);
}
async function opZip(names) {
  const n = await promptD('Buat zip', names.length + ' item', names.length === 1 ? names[0] + '.zip' : 'arsip.zip', 'Buat');
  if (!n) return;
  if (n.includes('/')) { toast('Nama tidak boleh mengandung /', 'err'); return; }
  const r = await run(() => api('POST', '/zip', { paths: names.map(full), out: join(S.path, n) }));
  if (!r) return;
  exitSelect();
  toast('Arsip dibuat: ' + baseOf(r.path));
  await reload();
}
async function opUnzip(names) {
  const choice = await dialog({
    title: 'Ekstrak arsip',
    msg: names.length + ' file zip',
    cancelVal: null,
    col: true,
    buttons: [
      { label: 'Ekstrak di sini', val: 'here', cls: 'b' },
      { label: 'Ekstrak ke folder…', val: 'to' },
      { label: 'Batal', val: null }
    ]
  });
  if (!choice) return;
  let body = { paths: names.map(full) };
  if (choice === 'to') {
    const dest = await promptD('Ekstrak ke', 'Path folder tujuan (absolut atau relatif ke scope)', S.path, 'Ekstrak');
    if (!dest) return;
    body.to = dest.startsWith('/') ? dest : join(S.path, dest);
    body.subfolder = true;
  }
  const r = await run(() => api('POST', '/unzip', body));
  if (!r) return;
  report(r, 'diekstrak');
  await reload();
}
async function opDownload(name) {
  const t = await run(() => api('POST', '/ticket', { path: full(name) }));
  if (!t) return;
  const a = document.createElement('a');
  a.href = t.url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function opInfo(name) {
  const d = await run(() => api('GET', '/info?path=' + enc(full(name))));
  if (!d) return;
  const rows = [{ kv: ['Nama', d.name] }, { kv: ['Lokasi', dirOf(d.path)] }, { kv: ['Jenis', (d.type === 'dir' ? 'Folder' : 'File') + (d.link ? ' (symlink)' : '')] }];
  if (d.type !== 'dir') rows.push({ kv: ['Ukuran', fmtSize(d.size) + ' (' + d.size.toLocaleString('id-ID') + ' byte)'] });
  rows.push({ kv: ['Izin', d.mode + '  ' + rwx(d.mode)] }, { kv: ['Pemilik (uid:gid)', d.uid + ':' + d.gid] }, { kv: ['Diubah', fmtDate(d.mtime)] });
  if (d.birth) rows.push({ kv: ['Dibuat', fmtDate(d.birth)] });
  if (d.target) rows.push({ kv: ['Tujuan link', d.target] });
  sheet('Info', rows);
}
function opChmod(names) {
  const first = getItem(names[0]);
  let m = parseInt(String(first.mode || '644').slice(-3), 8);
  const hasDir = names.some(n => { const i = getItem(n); return i && i.type === 'dir'; });
  let rec = false;
  const wrap = h('div');
  const oct = h('div', 'octal');
  const grid = h('div');
  const btns = [];
  const refresh = () => {
    const s = m.toString(8).padStart(3, '0');
    oct.textContent = s;
    oct.append(h('small', null, rwx(s)));
    btns.forEach(b => b.el.classList.toggle('on', !!(m & b.bit)));
  };
  [['Pemilik', 6], ['Grup', 3], ['Lainnya', 0]].forEach(([lab, sh]) => {
    const row = h('div', 'perm');
    row.append(h('span', null, lab));
    [['r', 4], ['w', 2], ['x', 1]].forEach(([t, v]) => {
      const b = h('button', 'pb', t);
      b.type = 'button';
      const bit = v << sh;
      b.onclick = () => { m ^= bit; refresh(); };
      btns.push({ el: b, bit });
      row.append(b);
    });
    grid.append(row);
  });
  wrap.append(oct, grid);
  const items = [{ node: wrap }];
  if (hasDir) {
    const r = h('div', 'fsrow');
    r.append(h('span', null, 'Terapkan ke isi folder'));
    const sw = h('button', 'sw');
    sw.type = 'button';
    sw.onclick = () => { rec = !rec; sw.classList.toggle('on', rec); };
    r.append(sw);
    items.push({ node: r });
  }
  const go2 = h('button', 'prim', 'Terapkan');
  go2.type = 'button';
  go2.onclick = async () => {
    closeSilent();
    const res = await run(() => api('POST', '/chmod', { paths: names.map(full), mode: m.toString(8).padStart(3, '0'), recursive: rec }));
    if (!res) return;
    report(res, 'diubah izinnya');
    await reload();
  };
  items.push({ node: go2 });
  refresh();
  sheet('Izin akses • ' + (names.length === 1 ? names[0] : names.length + ' item'), items, { cancel: 'Batal' });
}

function selMore() {
  const names = [...S.sel];
  const its = names.map(getItem).filter(Boolean);
  const items = [];
  if (names.length === 1) items.push({ label: 'Ubah nama', icon: 'drive_file_rename_outline', fn: () => opRename(names[0]) });
  items.push({ label: 'Izin akses', icon: 'lock', fn: () => opChmod(names) });
  if (its.length && its.every(i => kindOf(i).k === 'zip')) items.push({ label: 'Ekstrak di sini', icon: 'unarchive', fn: () => opUnzip(names) });
  if (names.length === 1) {
    if (its[0].type !== 'dir') items.push({ label: 'Unduh', icon: 'download', fn: () => opDownload(names[0]) });
    items.push({ label: 'Info', icon: 'info', fn: () => opInfo(names[0]) });
  }
  sheet(names.length + ' item dipilih', items);
}

function pickUpload() {
  const inp = $('#fileInp');
  inp.value = '';
  inp.click();
}
function progressDialog(title, onCancel) {
  const bar = h('div', 'prog');
  const fill = h('i');
  bar.append(fill);
  const pct = h('div', 'dlg-msg', '0%');
  const extra = h('div');
  extra.append(bar, pct);
  let done = false;
  dialog({ title, extra, cancelVal: null, buttons: [{ label: 'Batal', val: null, cls: 'red' }] }).then(() => { if (!done) onCancel(); });
  return {
    set(p) { fill.style.width = Math.round(p * 100) + '%'; pct.textContent = Math.round(p * 100) + '%'; },
    close() { if (!done) { done = true; closeOv(); } }
  };
}
async function startUpload(files) {
  const have = new Set(S.items.map(i => i.name));
  const dup = files.filter(f => have.has(f.name));
  let overwrite = false;
  if (dup.length) {
    const c = await dialog({
      title: 'File sudah ada', msg: dup.length + ' file bernama sama sudah ada di folder ini.', col: true, cancelVal: 'x',
      buttons: [{ label: 'Timpa', val: 'ow', cls: 'red' }, { label: 'Lewati yang sama', val: 'skip' }, { label: 'Batal', val: 'x' }]
    });
    if (c === 'x') return;
    if (c === 'ow') overwrite = true;
    else files = files.filter(f => !have.has(f.name));
    if (!files.length) return;
  }
  const xhr = new XMLHttpRequest();
  const ui = progressDialog('Mengunggah ' + files.length + ' file', () => xhr.abort());
  xhr.open('POST', '/api/upload?path=' + enc(S.path) + (overwrite ? '&overwrite=1' : ''));
  xhr.setRequestHeader('Authorization', 'Bearer ' + S.token);
  xhr.upload.onprogress = e => { if (e.lengthComputable) ui.set(e.loaded / e.total); };
  xhr.onload = () => {
    ui.close();
    let r = null;
    try { r = JSON.parse(xhr.responseText); } catch (e) { /* abaikan */ }
    if (xhr.status === 401) { doLogout('Sesi habis, masuk lagi'); return; }
    if (xhr.status >= 400 || !r) toast((r && r.error) || 'Upload gagal', 'err');
    else report(r, 'diunggah');
    setTimeout(reload, 350);
  };
  xhr.onerror = () => { ui.close(); toast('Upload gagal, koneksi putus', 'err'); };
  const fd = new FormData();
  files.forEach(f => fd.append('files', f, f.name));
  xhr.send(fd);
}
