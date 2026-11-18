'use strict';

function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
  return new Promise((ok, bad) => {
    const ta = h('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(ta);
    ta.focus();
    ta.select();
    let r = false;
    try { r = document.execCommand('copy'); } catch (e) { /* gagal */ }
    ta.remove();
    if (r) ok(); else bad(new Error('gagal menyalin'));
  });
}

const PAL = ['#1c1c1e', '#ff453a', '#32d74b', '#ffd60a', '#0a84ff', '#bf5af2', '#64d2ff', '#e5e5ea',
  '#636366', '#ff6961', '#4cd964', '#ffe066', '#409cff', '#da8fff', '#70d7ff', '#ffffff'];
function c256(n) {
  if (isNaN(n) || n < 0 || n > 255) return null;
  if (n < 16) return PAL[n];
  if (n >= 232) { const g = 8 + 10 * (n - 232); return 'rgb(' + g + ',' + g + ',' + g + ')'; }
  n -= 16;
  const v = x => (x ? 55 + x * 40 : 0);
  return 'rgb(' + v(Math.floor(n / 36)) + ',' + v(Math.floor(n / 6) % 6) + ',' + v(n % 6) + ')';
}

// emulator terminal sederhana: warna ansi, \r, hapus baris, clear. bukan buat aplikasi layar penuh (top, nano)
function Term(box, out) {
  const MAXL = 2500;
  const lines = [{ ch: [], sk: [] }];
  const nodes = [];
  const dirty = new Set();
  const cssCache = new Map();
  let row = 0;
  let col = 0;
  let top = 0;
  let pend = '';
  let raf = 0;
  let stick = true;
  let st = { fg: null, bg: null, f: 0 };
  let skey = '';
  box.addEventListener('scroll', () => { stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60; }, { passive: true });
  const ensure = r => { while (lines.length <= r) lines.push({ ch: [], sk: [] }); return lines[r]; };
  const mark = r => { dirty.add(r); };

  function cssFor(k) {
    let c = cssCache.get(k);
    if (c !== undefined) return c;
    const p = k.split('|');
    let fg = p[0] || null;
    let bg = p[1] || null;
    const f = +p[2];
    if (f & 16) { const t = fg || '#e5e5ea'; fg = bg || '#0b0b0d'; bg = t; }
    c = '';
    if (fg) c += 'color:' + fg + ';';
    if (bg) c += 'background:' + bg + ';';
    if (f & 1) c += 'font-weight:700;';
    if (f & 2) c += 'opacity:.65;';
    if (f & 4) c += 'font-style:italic;';
    if (f & 8) c += 'text-decoration:underline;';
    cssCache.set(k, c);
    return c;
  }
  function put(chr) {
    const L = ensure(row);
    while (L.ch.length < col) { L.ch.push(' '); L.sk.push(''); }
    L.ch[col] = chr;
    L.sk[col] = skey;
    col++;
    mark(row);
  }
  function sgr(a) {
    if (!a.length) a = [0];
    for (let k = 0; k < a.length; k++) {
      const v = isNaN(a[k]) ? 0 : a[k];
      if (v === 0) st = { fg: null, bg: null, f: 0 };
      else if (v === 1) st.f |= 1;
      else if (v === 2) st.f |= 2;
      else if (v === 3) st.f |= 4;
      else if (v === 4) st.f |= 8;
      else if (v === 7) st.f |= 16;
      else if (v === 22) st.f &= ~3;
      else if (v === 23) st.f &= ~4;
      else if (v === 24) st.f &= ~8;
      else if (v === 27) st.f &= ~16;
      else if (v >= 30 && v <= 37) st.fg = PAL[v - 30];
      else if (v === 39) st.fg = null;
      else if (v >= 40 && v <= 47) st.bg = PAL[v - 40];
      else if (v === 49) st.bg = null;
      else if (v >= 90 && v <= 97) st.fg = PAL[v - 90 + 8];
      else if (v >= 100 && v <= 107) st.bg = PAL[v - 100 + 8];
      else if (v === 38 || v === 48) {
        const t = v === 38 ? 'fg' : 'bg';
        if (a[k + 1] === 5) { st[t] = c256(a[k + 2]); k += 2; }
        else if (a[k + 1] === 2) { st[t] = 'rgb(' + a[k + 2] + ',' + a[k + 3] + ',' + a[k + 4] + ')'; k += 4; }
      }
    }
    skey = (st.fg || st.bg || st.f) ? (st.fg || '') + '|' + (st.bg || '') + '|' + st.f : '';
  }
  function clearAll() {
    lines.length = 0;
    lines.push({ ch: [], sk: [] });
    nodes.length = 0;
    out.textContent = '';
    dirty.clear();
    row = 0;
    col = 0;
    top = 0;
  }
  function csi(p, f) {
    const a = p.replace(/^[?>!=]/, '').split(';').map(x => (x === '' ? NaN : +x));
    const n1 = isNaN(a[0]) ? 1 : a[0];
    const m0 = isNaN(a[0]) ? 0 : a[0];
    if (f === 'm') { sgr(p === '' ? [] : a); return; }
    if (/^[?>!=]/.test(p)) return;
    if (f === 'K') {
      const L = ensure(row);
      if (m0 === 0) { L.ch.length = Math.min(L.ch.length, col); L.sk.length = L.ch.length; }
      else if (m0 === 1) { for (let k = 0; k < col && k < L.ch.length; k++) { L.ch[k] = ' '; L.sk[k] = ''; } }
      else { L.ch.length = 0; L.sk.length = 0; }
      mark(row);
    } else if (f === 'J') {
      if (m0 === 2 || m0 === 3) clearAll();
      else if (m0 === 0) {
        const L = ensure(row);
        L.ch.length = Math.min(L.ch.length, col);
        L.sk.length = L.ch.length;
        mark(row);
        lines.length = row + 1;
        while (nodes.length > lines.length) nodes.pop().remove();
      }
    } else if (f === 'H' || f === 'f') {
      row = top + (isNaN(a[0]) ? 1 : a[0]) - 1;
      col = (isNaN(a[1]) ? 1 : a[1]) - 1;
      ensure(row);
    } else if (f === 'A') row = Math.max(0, row - n1);
    else if (f === 'B') { row += n1; ensure(row); }
    else if (f === 'C') col += n1;
    else if (f === 'D') col = Math.max(0, col - n1);
    else if (f === 'G') col = Math.max(0, n1 - 1);
    else if (f === 'd') { row = top + n1 - 1; ensure(row); }
  }
  function render() {
    raf = 0;
    while (nodes.length < lines.length) {
      const d = document.createElement('div');
      d.className = 'tl';
      out.append(d);
      nodes.push(d);
      dirty.add(nodes.length - 1);
    }
    for (const i of dirty) {
      const L = lines[i];
      const d = nodes[i];
      if (!L || !d) continue;
      d.textContent = '';
      let k = 0;
      while (k < L.ch.length) {
        let e = k + 1;
        while (e < L.ch.length && L.sk[e] === L.sk[k]) e++;
        const t = L.ch.slice(k, e).join('');
        if (L.sk[k]) {
          const sp = document.createElement('span');
          sp.style.cssText = cssFor(L.sk[k]);
          sp.textContent = t;
          d.append(sp);
        } else d.append(document.createTextNode(t));
        k = e;
      }
    }
    dirty.clear();
    if (lines.length > MAXL + 300) {
      const cut = lines.length - MAXL;
      lines.splice(0, cut);
      for (let i = 0; i < cut; i++) nodes.shift().remove();
      row = Math.max(0, row - cut);
      top = Math.max(0, top - cut);
    }
    if (stick) box.scrollTop = box.scrollHeight;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

  this.write = text => {
    const s = pend + text;
    pend = '';
    const n = s.length;
    let i = 0;
    while (i < n) {
      const c = s[i];
      if (c === '\x1b') {
        if (i + 1 >= n) { pend = s.slice(i); break; }
        const d = s[i + 1];
        if (d === '[') {
          let j = i + 2;
          while (j < n && !(s.charCodeAt(j) >= 0x40 && s.charCodeAt(j) <= 0x7e)) j++;
          if (j >= n) { pend = s.slice(i); break; }
          csi(s.slice(i + 2, j), s[j]);
          i = j + 1;
          continue;
        }
        if (d === ']') {
          let j = i + 2;
          while (j < n && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++;
          if (j >= n) { pend = s.slice(i); break; }
          i = s[j] === '\x07' ? j + 1 : j + 2;
          continue;
        }
        i += (d === '(' || d === ')') ? 3 : 2;
        continue;
      }
      if (c === '\r') col = 0;
      else if (c === '\n') { row++; col = 0; ensure(row); }
      else if (c === '\b') { if (col > 0) col--; }
      else if (c === '\t') col = (col + 8) & ~7;
      else if (c >= ' ') put(c);
      i++;
    }
    if (pend.length > 300) pend = '';
    schedule();
  };
  this.clear = () => { clearAll(); pend = ''; st = { fg: null, bg: null, f: 0 }; skey = ''; schedule(); };
  this.text = () => lines.map(L => L.ch.join('')).join('\n').replace(/\n+$/, '');
}

const termCols = () => Math.max(40, Math.min(200, Math.floor((window.innerWidth - 26) / 7.3)));

async function opRunScript(name) {
  // jalankan di web terminal asli (PTY) biar TUI seperti nano bisa diketik langsung
  const fp = full(name);
  setView('terminal');
  const cmd = 'clear; bash ' + JSON.stringify(fp) + '\n';
  const existing = activeWebTerminal();
  if (existing && existing.ready && existing.ws && existing.ws.readyState === WebSocket.OPEN) {
    try {
      existing.ws.send(JSON.stringify({ type: 'input', data: cmd }));
      existing.term.focus();
      return;
    } catch (e) { /* buat session baru */ }
  }
  await createWebTerminalSession(cmd);
}

function openTerminal(job) {
  const pg = h('div', 'page dark');
  const head = h('div', 'page-head');
  const row = h('div', 'page-row');
  const bClose = ib('close');
  const title = h('div', 'page-title');
  const ts = h('small', null, 'Memulai…');
  title.append(h('b', null, job.name), ts);
  const bCopy = ib('content_copy');
  const bStop = h('button', 'tbtn red', 'Stop');
  bStop.type = 'button';
  row.append(bClose, title, bCopy, bStop);
  head.append(row);
  const box = h('div', 'termbox');
  const out = h('div');
  box.append(out);
  const bar = h('div', 'tbar');
  const keys = h('div', 'tkeys');
  const inRow = h('div', 'tin');
  const inp = h('input');
  inp.placeholder = 'Ketik masukan lalu Kirim';
  inp.autocapitalize = 'off';
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.setAttribute('autocorrect', 'off');
  const bSend = h('button', null, 'Kirim');
  bSend.type = 'button';
  inRow.append(inp, bSend);
  bar.append(keys, inRow);
  pg.append(head, box, bar);

  const term = new Term(box, out);
  let id = job.id;
  let from = 0;
  let gen = 0;
  let stopped = false;
  let running = true;
  let stopping = false;
  let ctl = null;

  const setStatus = d => {
    running = d.running;
    if (d.running) ts.textContent = stopping ? 'Menghentikan…' : 'Berjalan…';
    else ts.textContent = d.killed ? 'Dihentikan' : (d.code === 0 ? 'Selesai • kode 0' : 'Gagal • kode ' + d.code);
    bStop.textContent = running ? (stopping ? 'Paksa' : 'Stop') : 'Ulangi';
    bStop.className = 'tbtn' + (running ? ' red' : '');
    bar.classList.toggle('hidden', !running);
  };
  async function loop() {
    const g = ++gen;
    while (!stopped && g === gen) {
      ctl = new AbortController();
      let d;
      try {
        d = await api('GET', '/run/' + id + '?from=' + from + '&wait=20', undefined, { signal: ctl.signal });
      } catch (e) {
        if (e.name === 'AbortError' || stopped || g !== gen) return;
        if (e.status === 404) { ts.textContent = 'Proses sudah dihapus dari server'; running = false; bar.classList.add('hidden'); return; }
        ts.textContent = 'Koneksi putus, mencoba lagi…';
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      if (g !== gen) return;
      if (d.truncated) term.write('\r\n[... output awal terpotong ...]\r\n');
      if (d.data) term.write(d.data);
      from = d.next;
      setStatus(d);
      if (!d.running) return;
    }
  }
  async function restart() {
    const j = await run(() => api('POST', '/run', { path: job.path, cols: termCols() }));
    if (!j) return;
    id = j.id;
    from = 0;
    stopping = false;
    term.clear();
    setStatus({ running: true });
    loop();
  }
  async function send(data) {
    if (!running) return;
    try { await api('POST', '/run/' + id + '/input', { data }); } catch (e) { toast(e.message, 'err'); }
  }
  const submit = () => { const v = inp.value; inp.value = ''; send(v + '\n'); inp.focus(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  bSend.onclick = submit;
  [['Ctrl+C', '\x03'], ['Ctrl+D', '\x04'], ['Tab', '\t'], ['Enter', '\n'], ['y', 'y\n'], ['n', 'n\n']].forEach(([lab, data]) => {
    const b = h('button', 'tkey', lab);
    b.type = 'button';
    b.addEventListener('mousedown', e => e.preventDefault());
    b.onclick = () => send(data);
    keys.append(b);
  });
  bStop.onclick = async () => {
    if (!running) { restart(); return; }
    const r = await run(() => api('POST', '/run/' + id + '/kill', { force: stopping }));
    if (r) { stopping = true; ts.textContent = 'Menghentikan…'; bStop.textContent = 'Paksa'; }
  };
  bCopy.onclick = () => copyText(term.text()).then(() => toast('Output disalin'), () => toast('Gagal menyalin', 'err'));
  bClose.onclick = () => closeOv();

  const vv = window.visualViewport;
  const fit = () => { pg.style.height = vv.height + 'px'; pg.style.top = vv.offsetTop + 'px'; };
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }
  openOv(pg, {
    onhide: () => {
      stopped = true;
      if (ctl) ctl.abort();
      if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
      if (running) toast('Skrip tetap jalan di server (Menu, Proses skrip)');
    }
  });
  loop();
}

async function jobsSheet() {
  const d = await run(() => api('GET', '/run'));
  if (!d) return;
  if (!d.jobs.length) { toast('Belum ada skrip yang dijalankan'); return; }
  sheet('Proses skrip', d.jobs.slice(0, 8).map(j => ({
    label: j.name + (j.running ? ' • berjalan' : j.killed ? ' • dihentikan' : ' • kode ' + j.code),
    icon: j.running ? 'play_circle' : (j.code === 0 && !j.killed ? 'check_circle' : 'error'),
    fn: () => openTerminal(j)
  })));
}
