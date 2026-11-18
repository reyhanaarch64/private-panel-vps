'use strict';

// package manager (apt)
const PK = { data: null, q: '', filter: 'all', results: null, searching: false, seq: 0, timer: null, shown: 150 };
let pkgJob = null;

async function loadPackages() {
  const d = await run(() => api('GET', '/pkg/overview'));
  if (!d) return;
  PK.data = d;
  // lanjut pantau kalau ada job yang masih jalan (misal habis refresh halaman)
  if (d.job && d.job.status === 'running' && (!pkgJob || pkgJob.id !== d.job.id)) pkgStartWatch(d.job);
  renderPackages();
}

function pkgSec(text) { return h('div', 'pkg-sec', text); }

function pkgRow(p, installed) {
  const row = h('div', 'pkg-row' + (installed ? ' tap' : ''));
  const main = h('div', 'pkg-main');
  const top = h('div', 'pkg-top');
  top.append(h('span', 'pkg-name', p.name));
  if (installed && p.version) top.append(h('span', 'pkg-ver', p.version));
  main.append(top, h('div', 'pkg-desc', p.desc || ''));
  if (installed) main.append(h('div', 'pkg-meta', fmtSize(p.size || 0) + (p.manual ? ' · dipasang manual' : ' · dependensi')));
  row.append(main);
  if (installed) {
    row.onclick = () => pkgInfoSheet(p);
  } else {
    const b = h('button', 'pkg-get' + (PK.data && PK.data.full ? '' : ' off'), 'Pasang');
    b.type = 'button';
    b.onclick = () => pkgInstall(p);
    row.append(b);
  }
  return row;
}

function renderPackages() {
  const list = $('#pkgList');
  const d = PK.data;
  list.textContent = '';
  if (!d) {
    list.append(h('div', 'proc-empty', 'Memuat daftar package…'));
    return;
  }
  $('#pkgNote').classList.toggle('hidden', !!d.full);
  const j = pkgJob;
  if (j && (j.status === 'running' || j.status === 'failed')) {
    const what = j.kind === 'update' ? 'perbarui daftar package' : 'pasang ' + j.name;
    const b = h('button', 'pkg-running', (j.status === 'running' ? 'Sedang ' + what : 'Gagal ' + what) + ' · lihat log');
    b.type = 'button';
    b.onclick = pkgLogSheet;
    list.append(b);
  }
  const q = PK.q.trim().toLowerCase();
  let inst = d.packages;
  if (PK.filter === 'manual') inst = inst.filter(p => p.manual);
  if (q) inst = inst.filter(p => p.name.toLowerCase().includes(q) || (p.desc || '').toLowerCase().includes(q));
  list.append(pkgSec('Sudah terpasang (' + inst.length + ')'));
  if (!inst.length) list.append(h('div', 'proc-empty', 'Tidak ada package terpasang yang cocok'));
  inst.slice(0, PK.shown).forEach(p => list.append(pkgRow(p, true)));
  if (inst.length > PK.shown) {
    const m = h('button', 'morerow', 'Tampilkan lebih banyak (' + (inst.length - PK.shown) + ')');
    m.type = 'button';
    m.onclick = () => { PK.shown += 150; renderPackages(); };
    list.append(m);
  }
  if (q) {
    const res = PK.results || [];
    list.append(pkgSec('Belum terpasang · hasil cari' + (PK.results ? ' (' + res.length + ')' : '')));
    if (PK.searching) list.append(h('div', 'proc-empty', 'Mencari…'));
    else if (q.length < 2) list.append(h('div', 'proc-empty', 'Ketik minimal 2 huruf buat cari package lain'));
    else if (!res.length) list.append(h('div', 'proc-empty', 'Tidak ada package lain yang cocok'));
    res.forEach(p => list.append(pkgRow(p, false)));
  } else {
    const rec = d.recommended || [];
    list.append(pkgSec('Belum terpasang · rekomendasi (' + rec.length + ')'));
    if (!rec.length) list.append(h('div', 'proc-empty', 'Semua rekomendasi sudah terpasang'));
    rec.forEach(p => list.append(pkgRow(p, false)));
  }
}

function pkgInfoSheet(p) {
  sheet(p.name, [
    { kv: ['Versi', p.version || '-'] },
    { kv: ['Ukuran', fmtSize(p.size || 0)] },
    { kv: ['Dipasang', p.manual ? 'Manual' : 'Otomatis (dependensi)'] },
    { kv: ['Deskripsi', p.desc || '-'] }
  ]);
}

function pkgSearchInput() {
  PK.q = $('#pkgSearch').value;
  clearTimeout(PK.timer);
  PK.results = null;
  const q = PK.q.trim().toLowerCase();
  const my = ++PK.seq;
  if (q.length < 2) {
    PK.searching = false;
    renderPackages();
    return;
  }
  PK.searching = true;
  renderPackages();
  PK.timer = setTimeout(async () => {
    let r = [];
    // karakter aneh nggak dikirim ke server, hasilnya kosong aja
    if (/^[a-z0-9][a-z0-9+._ \-]*$/.test(q)) {
      try {
        const d = await api('GET', '/pkg/search?q=' + enc(q));
        r = d.results || [];
      } catch (e) {
        if (e && e.name !== 'AbortError') toast((e && e.message) || 'Gagal mencari', 'err');
      }
    }
    if (my !== PK.seq) return;
    PK.results = r;
    PK.searching = false;
    renderPackages();
  }, 350);
}

async function pkgInstall(p) {
  if (!PK.data || !PK.data.full) {
    toast('Pasang package dimatikan di scope terbatas; ubah scope ke full di config.json lalu restart', 'err');
    return;
  }
  const ok = await confirmD('Pasang "' + p.name + '"?', 'Dipasang ke VPS lewat apt-get sebagai root.', 'Pasang');
  if (!ok) return;
  const r = await run(() => api('POST', '/pkg/install', { name: p.name }));
  if (!r) return;
  pkgStartWatch(r.job);
  pkgLogSheet();
}

async function pkgUpdate() {
  if (!PK.data || !PK.data.full) {
    toast('Perbarui daftar dimatikan di scope terbatas; ubah scope ke full di config.json lalu restart', 'err');
    return;
  }
  const r = await run(() => api('POST', '/pkg/update'));
  if (!r) return;
  pkgStartWatch(r.job);
  pkgLogSheet();
}

function pkgStartWatch(job) {
  if (pkgJob && pkgJob.tick) clearInterval(pkgJob.tick);
  const j = { id: job.id, kind: job.kind, name: job.name, status: 'running', code: null, log: '', next: 0, busy: false, tick: null, view: null };
  pkgJob = j;
  j.tick = setInterval(() => pkgPollJob(j), 1000);
  pkgPollJob(j);
  if (S.view === 'packages') renderPackages();
}

async function pkgPollJob(j) {
  if (j.busy) return;
  j.busy = true;
  try {
    const d = await api('GET', '/pkg/job/' + j.id + '?from=' + j.next, undefined, { quiet: true });
    j.log += d.log;
    j.next = d.next;
    j.status = d.status;
    j.code = d.code;
    if (j.view) j.view();
    if (d.status !== 'running') {
      clearInterval(j.tick);
      j.tick = null;
      const what = j.kind === 'update' ? 'Daftar package' : '"' + j.name + '"';
      if (d.status === 'done') toast(j.kind === 'update' ? 'Daftar package diperbarui' : what + ' terpasang');
      else toast('Gagal: ' + (j.kind === 'update' ? 'perbarui daftar' : 'pasang ' + j.name), 'err');
      if (S.view === 'packages') loadPackages();
    }
  } catch (e) {
    // job hilang (server restart), berhenti pantau
    if (e && e.status === 404) {
      clearInterval(j.tick);
      j.tick = null;
      j.status = 'failed';
      j.log += '\n[job tidak ditemukan, mungkin panel sempat restart]\n';
      if (j.view) j.view();
      if (S.view === 'packages') renderPackages();
    }
  } finally {
    j.busy = false;
  }
}

function pkgLogSheet() {
  const j = pkgJob;
  if (!j) return;
  const st = h('div', 'pkg-logstat');
  const pre = h('pre', 'pkg-log');
  const box = h('div');
  box.append(st, pre);
  const draw = first => {
    // sheet sudah ditutup, lepas dari job
    if (!first && !pre.isConnected) { if (j.view === draw) j.view = null; return; }
    const stick = first || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
    pre.textContent = j.log || 'Menunggu output…';
    if (stick) pre.scrollTop = pre.scrollHeight;
    const name = j.kind === 'update' ? 'Perbarui daftar package' : 'Pasang ' + j.name;
    st.className = 'pkg-logstat' + (j.status === 'done' ? ' ok' : (j.status === 'failed' ? ' bad' : ''));
    st.textContent = j.status === 'running' ? name + ' · berjalan…' : (j.status === 'done' ? name + ' · selesai' : name + ' · gagal' + (j.code != null ? ' (kode ' + j.code + ')' : ''));
  };
  j.view = draw;
  sheet(null, [{ node: box }]);
  draw(true);
}

function initPackages() {
  $('#pkgSearch').addEventListener('input', pkgSearchInput);
  $('#pkgRefresh').onclick = () => loadPackages();
  $('#pkgUpdate').onclick = pkgUpdate;
  document.querySelectorAll('[data-pkgfilter]').forEach(b => {
    b.onclick = () => {
      PK.filter = b.dataset.pkgfilter;
      PK.shown = 150;
      document.querySelectorAll('[data-pkgfilter]').forEach(x => x.classList.toggle('active', x === b));
      renderPackages();
    };
  });
}
