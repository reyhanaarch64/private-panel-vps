'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const escHtml = s => String(s).replace(/&/g,"&").replace(/</g,"<").replace(/>/g,">");
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const ic = name => h('span', 'ms', name);
function ib(name, cls) {
  const b = h('button', cls || 'nbtn');
  b.type = 'button';
  b.append(ic(name));
  return b;
}
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } }
};

const S = {
  token: LS.get('vpsacc_token', ''), path: '', parent: null, scope: '/', items: [],
  sel: new Set(), selecting: false, clip: null, view: 'files', sort: LS.get('vpsacc_sort', 'name'),
  hidden: LS.get('vpsacc_hidden', '0') === '1', shown: 300, flash: null, sys: null
};

const join = (a, b) => (a === '/' ? '' : a) + '/' + b;
const baseOf = p => (p === '/' ? '/' : p.slice(p.lastIndexOf('/') + 1));
const dirOf = p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
const enc = encodeURIComponent;
const hashEnc = p => '#' + encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
const hashDec = () => { try { return decodeURIComponent(location.hash.slice(1)); } catch (e) { return ''; } };
const full = name => join(S.path, name);
const inScope = p => S.scope === '/' || p === S.scope || p.startsWith(S.scope + '/');
const getItem = n => S.items.find(i => i.name === n);

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 3);
  return (n >= 100 ? n.toFixed(0) : n.toFixed(1)).replace('.', ',') + ' ' + u[i];
}
function fmtDate(ms) {
  try {
    if (window.dayjs) {
      const d = window.dayjs(ms);
      const diff = Date.now() - ms;
      if (typeof d.fromNow === 'function' && diff < 6 * 864e5 && diff > -6e4) return d.fromNow();
      return d.format('D MMM YYYY, HH:mm');
    }
  } catch (e) { /* pakai bawaan */ }
  return new Date(ms).toLocaleString('id-ID');
}
function rwx(m) {
  return String(m).slice(-3).padStart(3, '0').split('').map(c => {
    const d = +c;
    return (d & 4 ? 'r' : '-') + (d & 2 ? 'w' : '-') + (d & 1 ? 'x' : '-');
  }).join('');
}

const IMG = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;
const VID = /\.(mp4|webm|mov|m4v)$/i;
const AUD = /\.(mp3|wav|ogg|m4a|flac|aac)$/i;
const ZIP = /\.zip$/i;
const BIN = /\.(tar|gz|tgz|bz2|xz|7z|rar|pdf|apk|exe|so|bin|iso|jar|class|woff2?|ttf|otf)$/i;
const KINDS = [
  [/\.(js|mjs|cjs)$/i, 'javascript', '#e3a900'], [/\.(ts|tsx|jsx)$/i, 'javascript', '#3178c6'],
  [/\.php$/i, 'php', '#7a86b8'], [/\.html?$/i, 'html', '#e8590c'], [/\.s?css$/i, 'css', '#2f6fed'],
  [/\.json$/i, 'data_object', '#f08c00'], [/\.(py|go|java|kt|c|h|cpp|rs|rb|pl|lua|cs)$/i, 'code', '#5e5ce6'],
  [/\.(sh|bash|zsh)$|^\.?(bashrc|profile|zshrc|bash_\w+)$/i, 'terminal', '#30b94d'], [/\.(md|markdown)$/i, 'article', '#6e6ee8'],
  [/\.(ya?ml|toml|ini|conf|env|service|properties)$/i, 'settings', '#8e8e93'], [/\.log$/i, 'receipt_long', '#8e8e93'],
  [/\.sql$/i, 'database', '#ff6b35'], [/\.pdf$/i, 'picture_as_pdf', '#ff3b30'],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, 'folder_zip', '#b08d57'],
  [IMG, 'image', '#ff375f'], [VID, 'movie', '#bf5af2'], [AUD, 'music_note', '#ff6a00'],
  [/\.(txt|csv|tsv|xml)$/i, 'description', '#8e8e93']
];
function kindOf(it) {
  if (it.type === 'dir') return { icon: 'folder', color: '#2aa7f5', k: 'dir' };
  const k = IMG.test(it.name) ? 'img' : VID.test(it.name) ? 'video' : AUD.test(it.name) ? 'audio' : ZIP.test(it.name) ? 'zip' : BIN.test(it.name) ? 'bin' : 'text';
  for (const [re, icon, color] of KINDS) if (re.test(it.name)) return { icon, color, k };
  return { icon: 'draft', color: '#8e8e93', k };
}

let lastErrToastAt = 0;
let lastErrToastMsg = '';
function toast(msg, kind) {
  if (kind === 'err') {
    const now = Date.now();
    const isNet = /server|terhubung|koneksi|network|fetch/i.test(String(msg || ''));
    if (isNet && now - lastErrToastAt < 2500) return;
    if (msg === lastErrToastMsg && now - lastErrToastAt < 1800) return;
    lastErrToastAt = now;
    lastErrToastMsg = String(msg || '');
  }
  const t = h('div', 'toast' + (kind === 'err' ? ' err' : ''));
  t.append(ic(kind === 'err' ? 'error' : 'check_circle'), h('span', null, msg));
  $('#toasts').append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, kind === 'err' ? 4500 : 2200);
}
let busyN = 0;
function busy(d) {
  busyN += d;
  $('#bar').classList.toggle('hidden', busyN <= 0);
}
async function run(fn) {
  busy(1);
  try {
    return await fn();
  } catch (e) {
    if (!e || e.name !== 'AbortError') toast((e && e.message) || 'Gagal', 'err');
    return undefined;
  } finally {
    busy(-1);
  }
}

async function api(method, url, body, o) {
  o = o || {};
  const opt = { method, headers: { Authorization: 'Bearer ' + S.token }, signal: o.signal };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetch('/api' + url, opt);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Tidak bisa terhubung ke server');
  }
  let data = null;
  try { data = await r.json(); } catch (e) { /* bukan json */ }
  if (r.status === 401 && !o.quiet) {
    doLogout('Sesi habis, masuk lagi');
    const er = new Error('Token tidak valid');
    er.name = 'AbortError';
    throw er;
  }
  if (!r.ok) {
    const er = new Error((data && data.error) || 'Error ' + r.status);
    er.status = r.status;
    throw er;
  }
  return data;
}

// tumpukan overlay, biar tombol back hp nutup sheet/editor
const ovs = [];
let skipPop = false;
const histDepth = () => (history.state && history.state.ov) || 0;
function openOv(node, o) {
  o = o || {};
  const e = { node, dirty: o.dirty, ask: o.ask, onhide: o.onhide };
  const orphan = histDepth() > ovs.length;
  ovs.push(e);
  if (orphan) history.replaceState({ ov: ovs.length }, '');
  else history.pushState({ ov: ovs.length }, '');
  document.body.appendChild(node);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('in')));
  return e;
}
function hideEntry(e) {
  e.node.classList.remove('in');
  if (e.onhide) e.onhide();
  setTimeout(() => e.node.remove(), 300);
}
function closeOv() {
  const e = ovs[ovs.length - 1];
  if (!e) return;
  if (histDepth() === ovs.length) history.back();
  else { ovs.pop(); hideEntry(e); }
}
function cleanOrphan() {
  const extra = histDepth() - ovs.length;
  if (extra > 0) { skipPop = true; history.go(-extra); }
}
function closeSilent() {
  const e = ovs.pop();
  if (e) hideEntry(e);
  setTimeout(cleanOrphan, 0);
}
function closeAllOv() {
  while (ovs.length) hideEntry(ovs.pop());
  setTimeout(cleanOrphan, 0);
}
window.addEventListener('popstate', ev => {
  if (skipPop) { skipPop = false; return; }
  const d = (ev.state && ev.state.ov) || 0;
  if (ovs.length > d) {
    const e = ovs[ovs.length - 1];
    if (e.dirty && e.dirty()) {
      history.pushState({ ov: ovs.length }, '');
      e.ask();
      return;
    }
    ovs.pop();
    hideEntry(e);
  } else {
    route();
  }
});

const OK = {};
function dialog(o) {
  return new Promise(resolve => {
    let result = o.cancelVal === undefined ? null : o.cancelVal;
    const ov = h('div', 'ov dlg');
    const back = h('div', 'back');
    const box = h('div', 'dialog');
    const body = h('div', 'dlg-body');
    if (o.title) body.append(h('div', 'dlg-title', o.title));
    if (o.msg) body.append(h('div', 'dlg-msg', o.msg));
    let inp = null;
    if (o.input) {
      inp = h('input', 'dlg-input');
      inp.value = o.value || '';
      inp.placeholder = o.placeholder || '';
      inp.autocapitalize = 'off';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      body.append(inp);
    }
    if (o.extra) body.append(o.extra);
    const btns = h('div', 'dlg-btns' + (o.col ? ' col' : ''));
    const finish = v => { result = v; closeOv(); };
    (o.buttons || []).forEach(b => {
      const bt = h('button', 'dlg-btn' + (b.cls ? ' ' + b.cls : ''), b.label);
      bt.type = 'button';
      bt.onclick = () => finish(b.val === OK ? (inp ? inp.value : true) : b.val);
      btns.append(bt);
    });
    if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') finish(inp.value); });
    box.append(body, btns);
    ov.append(back, box);
    back.onclick = () => closeOv();
    openOv(ov, { onhide: () => resolve(result) });
    if (inp) {
      setTimeout(() => {
        inp.focus();
        if (o.selectBase) {
          const i = inp.value.lastIndexOf('.');
          inp.setSelectionRange(0, i > 0 ? i : inp.value.length);
        } else inp.select();
      }, 320);
    }
  });
}
const confirmD = (title, msg, okLabel, danger) => dialog({
  title, msg, cancelVal: false,
  buttons: [{ label: 'Batal', val: false }, { label: okLabel || 'Ya', val: OK, cls: 'b' + (danger ? ' red' : '') }]
});
const promptD = (title, msg, value, okLabel, selectBase) => dialog({
  title, msg, input: true, value, selectBase, cancelVal: null,
  buttons: [{ label: 'Batal', val: null }, { label: okLabel || 'Simpan', val: OK, cls: 'b' }]
});

function sheet(title, items, o) {
  o = o || {};
  const ov = h('div', 'ov');
  const back = h('div', 'back');
  const wrap = h('div', 'sheet');
  const card = h('div', 'sheet-card');
  if (title) card.append(h('div', 'sh-title', title));
  items.forEach(it => {
    if (it.node) { card.append(it.node); return; }
    if (it.kv) {
      const r = h('div', 'kv');
      r.append(h('span', null, it.kv[0]), h('span', null, it.kv[1]));
      card.append(r);
      return;
    }
    const b = h('button', 'sh-item' + (it.red ? ' red' : '') + (it.dim ? ' dim' : '') + (it.fn ? '' : ' disabled'));
    b.type = 'button';
    if (it.icon) b.append(ic(it.icon));
    const lblWrap = h('span', 'lbl');
    lblWrap.append(document.createTextNode(it.label));
    if (it.sub) {
      const sm = h('small', 'sh-sub', it.sub);
      lblWrap.append(sm);
    }
    b.append(lblWrap);
    if (it.tick) b.append(h('span', 'ms tick', 'check'));
    if (it.fn) b.onclick = () => { closeSilent(); it.fn(); };
    else b.disabled = true;
    card.append(b);
  });
  const cancel = h('button', 'sh-cancel', o.cancel || 'Tutup');
  cancel.type = 'button';
  cancel.onclick = () => closeOv();
  wrap.append(card, cancel);
  ov.append(back, wrap);
  back.onclick = () => closeOv();
  openOv(ov);
}
