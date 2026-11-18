'use strict';

// Terminal emulator xterm.js dengan satu PTY dan satu WebSocket per session.
const webTerminals = [];
let activeWebTerminalId = null;
let terminalSequence = 0;
let termModifiers = { ctrl: false, alt: false };
let processData = [];
let processSnapshot = null;
let processFilter = 'all';
let processPollTimer = null;
let processLoading = false;

function activeWebTerminal() {
  return webTerminals.find(t => t.localId === activeWebTerminalId) || null;
}
function terminalStatus(text) { $('#termStatus').textContent = text; }
function updateTerminalTabs() {
  const box = $('#termSessions');
  box.textContent = '';
  webTerminals.forEach(t => {
    const b = h('button', 'term-session' + (t.localId === activeWebTerminalId ? ' active' : ''), t.label);
    b.type = 'button';
    b.title = t.status;
    b.onclick = () => activateWebTerminal(t.localId);
    box.append(b);
  });
  const current = activeWebTerminal();
  $('#termClose').disabled = !current;
  if (!current) terminalStatus('belum ada terminal — tekan + untuk membuat session');
}
let termFontSize = Math.max(8, Math.min(28, parseInt(LS.get('vpsacc_term_fs', '13'), 10) || 13));
function setTerminalFontSize(size, announce) {
  size = Math.round(Math.max(8, Math.min(28, Number(size) || 13)));
  const changed = size !== termFontSize;
  termFontSize = size;
  LS.set('vpsacc_term_fs', String(size));
  webTerminals.forEach(t => {
    try { t.term.options.fontSize = size; } catch (e) {}
  });
  fitActiveWebTerminal();
  if (announce) {
    const t = activeWebTerminal();
    if (t) {
      const cols = t.term ? t.term.cols : '?';
      const rows = t.term ? t.term.rows : '?';
      terminalStatus(size + 'px · grid ' + cols + '×' + rows);
      clearTimeout(setTerminalFontSize._tm);
      setTerminalFontSize._tm = setTimeout(() => {
        if (activeWebTerminal() === t) terminalStatus(t.status);
      }, 1400);
    }
  }
  return changed;
}
function bindTerminalZoom() {
  const el = $('#termXterm');
  if (!el || el._zoomBound) return;
  el._zoomBound = true;
  let pinching = false;
  let startDist = 0;
  let startSize = termFontSize;
  const distOf = touches => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy) || 1;
  };
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      pinching = true;
      startDist = distOf(e.touches);
      startSize = termFontSize;
    }
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (!pinching || e.touches.length !== 2) return;
    e.preventDefault();
    const scale = distOf(e.touches) / startDist;
    // step 0.5-ish via round; rasio sel berubah lewat fontSize + fit
    const next = Math.round(startSize * scale);
    if (next !== termFontSize) setTerminalFontSize(next, true);
  }, { passive: false });
  const endPinch = e => {
    if (e.touches.length < 2) pinching = false;
  };
  el.addEventListener('touchend', endPinch);
  el.addEventListener('touchcancel', endPinch);
  // desktop: ctrl + scroll
  el.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    setTerminalFontSize(termFontSize + (e.deltaY < 0 ? 1 : -1), true);
  }, { passive: false });
}
function fitActiveWebTerminal() {
  const t = activeWebTerminal();
  if (!t || S.view !== 'terminal') return;
  requestAnimationFrame(() => {
    try {
      t.fit.fit();
      if (t.ws && t.ws.readyState === WebSocket.OPEN && t.term) {
        const cols = t.term.cols;
        const rows = t.term.rows;
        if (cols > 0 && rows > 0 && (t._lastCols !== cols || t._lastRows !== rows)) {
          t._lastCols = cols;
          t._lastRows = rows;
          try { t.ws.send(JSON.stringify({ type: 'resize', cols, rows })); } catch (e) {}
        }
      }
    } catch (e) { /* terminal belum memiliki ukuran */ }
  });
}
function activateWebTerminal(localId) {
  activeWebTerminalId = localId;
  termModifiers = { ctrl: false, alt: false };
  document.querySelectorAll('.term-key.modifier').forEach(b => b.classList.remove('on'));
  const active = activeWebTerminal();
  webTerminals.forEach(t => { t.host.classList.toggle('active', t === active); });
  updateTerminalTabs();
  if (active) terminalStatus(active.status);
  fitActiveWebTerminal();
}
function setTerminalStatus(t, text) {
  t.status = text;
  if (t.localId === activeWebTerminalId) terminalStatus(text);
  updateTerminalTabs();
}
function sendTerminalInput(data) {
  const t = activeWebTerminal();
  if (!t || !t.ws || t.ws.readyState !== WebSocket.OPEN || !t.ready) return;
  if (typeof data !== 'string' || !data.length) return;
  let payload = data;
  if (termModifiers.ctrl || termModifiers.alt) {
    const first = data.charAt(0);
    let out = '';
    if (termModifiers.alt) out += String.fromCharCode(27);
    if (termModifiers.ctrl) {
      const lower = first.toLowerCase().charCodeAt(0);
      let code = first.charCodeAt(0);
      if (lower >= 97 && lower <= 122) code = lower - 96;
      else if (first === ' ' || first === '@') code = 0;
      else if (first === '[' || first === '{') code = 27;
      else if (first === '\\' || first === '|') code = 28;
      else if (first === ']' || first === '}') code = 29;
      else if (first === '^' || first === '~') code = 30;
      else if (first === '_') code = 31;
      else if (first === '?') code = 127;
      out += String.fromCharCode(code);
      if (data.length > 1) out += data.slice(1);
    } else {
      out += data;
    }
    payload = out;
    termModifiers.ctrl = false;
    termModifiers.alt = false;
    document.querySelectorAll('.term-key.modifier').forEach(b => b.classList.remove('on'));
  }
  try {
    for (let i = 0; i < payload.length; i += 4096) t.ws.send(JSON.stringify({ type: 'input', data: payload.slice(i, i + 4096) }));
  } catch (e) { /* koneksi putus */ }
}
function terminalKey(key) {
  if (key === 'CTRL' || key === 'ALT') {
    const k = key.toLowerCase();
    termModifiers[k] = !termModifiers[k];
    const b = $('#termKeys').querySelector('[data-key="' + key + '"]');
    if (b) b.classList.toggle('on', termModifiers[k]);
    const t = activeWebTerminal();
    if (t) try { t.term.focus(); } catch (e) {}
    return;
  }
  const ESC = String.fromCharCode(27);
  const keys = {
    ESC: ESC,
    TAB: String.fromCharCode(9),
    HOME: ESC + '[H',
    END: ESC + '[F',
    PGUP: ESC + '[5~',
    PGDN: ESC + '[6~',
    UP: ESC + '[A',
    DOWN: ESC + '[B',
    RIGHT: ESC + '[C',
    LEFT: ESC + '[D',
    'C-X': String.fromCharCode(24),
    'C-O': String.fromCharCode(15),
    'C-W': String.fromCharCode(23),
    'C-G': String.fromCharCode(7),
    'C-C': String.fromCharCode(3),
    'C-D': String.fromCharCode(4),
    'C-Z': String.fromCharCode(26),
    'C-L': String.fromCharCode(12),
    'C-R': String.fromCharCode(18),
    'C-U': String.fromCharCode(21),
    'C-K': String.fromCharCode(11),
    'C-Y': String.fromCharCode(25)
  };
  if (keys[key] !== undefined) sendTerminalInput(keys[key]);
  const t = activeWebTerminal();
  if (t) try { t.term.focus(); } catch (e) {}
}

function bindTerminalTouchSelection(host, term) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let textTouchActive = false;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  host.addEventListener('touchstart', e => {
    cancel();
    textTouchActive = false;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const screen = host.querySelector('.xterm-screen');
    const rect = screen && screen.getBoundingClientRect();
    if (!rect || !term.cols || !term.rows || !rect.width || !rect.height) return;
    const col = Math.min(term.cols - 1, Math.max(0, Math.floor((touch.clientX - rect.left) / (rect.width / term.cols))));
    const row = Math.min(term.rows - 1, Math.max(0, Math.floor((touch.clientY - rect.top) / (rect.height / term.rows))));
    const buffer = term.buffer.active;
    const line = buffer.getLine(buffer.viewportY + row);
    if (!line) return;
    let hit = line.getCell(col);
    let hitCol = col;
    if (hit && hit.getWidth() === 0 && col > 0) {
      hit = line.getCell(col - 1);
      hitCol--;
    }
    if (!hit || !hit.getChars() || /^\s+$/.test(hit.getChars())) return;
    textTouchActive = true;
    startX = touch.clientX;
    startY = touch.clientY;
    timer = setTimeout(() => {
      timer = null;
      const currentBuffer = term.buffer.active;
      const currentLine = currentBuffer.getLine(currentBuffer.viewportY + row);
      if (!currentLine) return;
      const isWordCell = index => {
        const cell = currentLine.getCell(index);
        return !!cell && (cell.getWidth() === 0 || !!cell.getChars() && !/^\s+$/.test(cell.getChars()));
      };
      let start = hitCol;
      let end = hitCol + 1;
      while (start > 0 && isWordCell(start - 1)) start--;
      while (end < term.cols && isWordCell(end)) end++;
      term.select(start, row, end - start);
      const selected = term.getSelection();
      if (selected && navigator.clipboard && window.isSecureContext) {
        try { navigator.clipboard.writeText(selected).then(() => toast('Teks terminal disalin')).catch(() => {}); } catch (e) {}
      }
    }, 500);
  }, { passive: true });
  host.addEventListener('touchmove', e => {
    const touch = e.touches[0];
    if (e.touches.length !== 1 || !touch || Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) {
      cancel();
      textTouchActive = false;
    }
  }, { passive: true });
  host.addEventListener('contextmenu', e => {
    if (textTouchActive) e.preventDefault();
  });
  ['touchend', 'touchcancel'].forEach(type => host.addEventListener(type, () => {
    cancel();
    textTouchActive = false;
  }, { passive: true }));
}

let creatingTerminal = false;
async function createWebTerminalSession(initialCmd) {
  if (creatingTerminal) return;
  if (!window.Terminal || !window.FitAddon || !window.FitAddon.FitAddon) {
    toast('xterm.js gagal dimuat dari CDN', 'err');
    return;
  }
  if (webTerminals.length >= 8) { toast('maksimal 8 terminal aktif', 'err'); return; }
  creatingTerminal = true;
  const ticket = await run(() => api('POST', '/terminal-ticket', {}));
  if (!ticket) { creatingTerminal = false; return; }
  const localId = 'local-' + (++terminalSequence);
  const host = h('div', 'term-instance');
  $('#termXterm').append(host);
  // lineHeight 1 biar hitungan baris TUI (nano/htop/vim) pas sama tinggi sel
  const term = new window.Terminal({
    cursorBlink: true, convertEol: false, scrollback: 5000, allowProposedApi: true,
    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace",
    fontSize: termFontSize, lineHeight: 1.0, letterSpacing: 0, theme: {
      background: '#080a0f', foreground: '#e6edf3', cursor: '#f0f6fc', cursorAccent: '#080a0f',
      selectionBackground: '#264f78', black: '#0d1117', red: '#ff7b72', green: '#3fb950',
      yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
      brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
      brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc'
    }
  });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(host);
  bindTerminalTouchSelection(host, term);
  // tampilkan dulu biar fit dapat ukuran nyata
  const t = { localId, label: 'Terminal ' + terminalSequence, host, term, fit, ws: null, status: 'menghubungkan…', ready: false, id: null, initialCmd: initialCmd || null, _lastCols: 0, _lastRows: 0, ro: null };
  webTerminals.push(t);
  activateWebTerminal(localId);
  // tunggu layout 2 frame, lalu ukur
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  let cols = 80, rows = 24;
  try {
    fit.fit();
    cols = Math.max(20, term.cols || 80);
    rows = Math.max(8, term.rows || 24);
  } catch (e) {}
  t._lastCols = cols;
  t._lastRows = rows;
  const wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(wsScheme + '//' + location.host + '/ws/terminal?ticket=' + encodeURIComponent(ticket.ticket) + '&cols=' + cols + '&rows=' + rows);
  t.ws = ws;
  term.writeln('\x1b[90mMenghubungkan ke VPS (' + cols + 'x' + rows + ')…\x1b[0m');
  term.onData(data => sendTerminalInput(data));
  term.onResize(size => {
    if (ws.readyState === WebSocket.OPEN) {
      if (t._lastCols !== size.cols || t._lastRows !== size.rows) {
        t._lastCols = size.cols;
        t._lastRows = size.rows;
        try { ws.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows })); } catch (e) {}
      }
    }
  });
  host.addEventListener('pointerdown', () => { try { term.focus(); } catch (e) {} });
  // pantau perubahan ukuran container (keyboard mobile, rotate, dll)
  if (window.ResizeObserver) {
    t.ro = new ResizeObserver(() => fitActiveWebTerminal());
    t.ro.observe($('#termXterm'));
  }
  // timeout biar user tau kalau stuck
  t.connectTimer = setTimeout(() => {
    if (!t.ready && ws.readyState !== WebSocket.OPEN) {
      setTerminalStatus(t, 'timeout koneksi — coba tutup lalu buka lagi');
      term.writeln('\r\n\x1b[31mTimeout: WebSocket tidak terbuka. Coba tutup tab terminal lalu buka lagi.\x1b[0m');
      try { ws.close(); } catch (e) {}
    } else if (!t.ready) {
      setTerminalStatus(t, 'menunggu shell…');
      term.writeln('\r\n\x1b[33mMasih menunggu shell siap…\x1b[0m');
    }
  }, 8000);
  ws.onopen = () => {
    creatingTerminal = false;
    setTerminalStatus(t, 'terhubung · menyiapkan shell…');
    term.writeln('\x1b[90mWebSocket terbuka, menunggu shell…\x1b[0m');
    try { fit.fit(); } catch (e) {}
    // kirim resize awal
    try {
      const d = { cols: term.cols, rows: term.rows };
      ws.send(JSON.stringify({ type: 'resize', cols: d.cols, rows: d.rows }));
    } catch (e) {}
  };
  ws.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch (e) { return; }
    if (message.type === 'ready') {
      if (t.connectTimer) { clearTimeout(t.connectTimer); t.connectTimer = null; }
      t.id = message.id;
      t.ready = true;
      setTerminalStatus(t, (message.sandbox ? 'scope terbatas · di luar scope read-only' : 'mode full · akses filesystem penuh') + ' · PID ' + message.pid);
      const syncSize = () => {
        try { fit.fit(); } catch (e) {}
        const cols = term.cols, rows = term.rows;
        if (cols > 0 && rows > 0) {
          t._lastCols = cols; t._lastRows = rows;
          try { ws.send(JSON.stringify({ type: 'resize', cols, rows })); } catch (e) {}
        }
      };
      syncSize();
      setTimeout(syncSize, 50);
      setTimeout(syncSize, 200);
      setTimeout(syncSize, 500);
      try { term.focus(); } catch (e) {}
      if (t.initialCmd) {
        setTimeout(() => {
          try { t.ws.send(JSON.stringify({ type: 'input', data: t.initialCmd })); } catch (e) {}
          t.initialCmd = null;
        }, 250);
      }
    } else if (message.type === 'data') {
      term.write(message.data);
    } else if (message.type === 'exit') {
      t.ready = false;
      setTerminalStatus(t, 'shell selesai · exit ' + message.code + (message.signal ? ' · ' + message.signal : ''));
    } else if (message.type === 'error') {
      if (t.connectTimer) { clearTimeout(t.connectTimer); t.connectTimer = null; }
      t.ready = false;
      term.writeln('\r\n\x1b[31m' + message.message + '\x1b[0m');
      setTerminalStatus(t, 'gagal membuat terminal');
      toast(message.message, 'err');
    }
  };
  ws.onerror = () => {
    creatingTerminal = false;
    setTerminalStatus(t, 'koneksi WebSocket gagal');
    term.writeln('\r\n\x1b[31mWebSocket error\x1b[0m');
  };
  ws.onclose = event => {
    creatingTerminal = false;
    t.ready = false;
    if (t.connectTimer) { clearTimeout(t.connectTimer); t.connectTimer = null; }
    if (t.status.indexOf('shell selesai') !== 0 && t.status.indexOf('gagal') !== 0) {
      const why = event.code ? ('kode ' + event.code + (event.reason ? ' · ' + event.reason : '')) : 'tanpa kode';
      setTerminalStatus(t, 'koneksi ditutup · ' + why);
      term.writeln('\r\n\x1b[31mKoneksi ditutup (' + why + ')\x1b[0m');
    }
  };
}

function closeActiveWebTerminal() {
  const t = activeWebTerminal();
  if (!t) return;
  if (t.ro) { try { t.ro.disconnect(); } catch (e) {} t.ro = null; }
  if (t.connectTimer) { clearTimeout(t.connectTimer); t.connectTimer = null; }
  try { if (t.ws) t.ws.close(1000, 'session ditutup dari panel'); } catch (e) { /* abaikan */ }
  try { t.term.dispose(); } catch (e) { /* abaikan */ }
  t.host.remove();
  const i = webTerminals.indexOf(t);
  if (i >= 0) webTerminals.splice(i, 1);
  activeWebTerminalId = webTerminals.length ? webTerminals[webTerminals.length - 1].localId : null;
  activateWebTerminal(activeWebTerminalId);
}
