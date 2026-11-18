'use strict';

const MODES = {
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell', py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  jsx: 'javascript', json: { name: 'javascript', json: true }, ts: 'text/typescript', tsx: 'text/typescript',
  php: 'application/x-httpd-php', go: 'go', html: 'htmlmixed', htm: 'htmlmixed', css: 'css', xml: 'xml', svg: 'xml',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml', sql: 'sql', c: 'text/x-csrc', h: 'text/x-csrc',
  cpp: 'text/x-c++src', cc: 'text/x-c++src', hpp: 'text/x-c++src', java: 'text/x-java', kt: 'text/x-kotlin',
  rs: 'rust', lua: 'lua', rb: 'ruby', pl: 'perl', ini: 'properties', conf: 'properties', env: 'properties',
  properties: 'properties', service: 'properties', toml: 'toml', diff: 'diff', patch: 'diff', cs: 'text/x-csharp',
  scss: 'text/x-scss', less: 'text/x-less'
};
function modeFor(name, text) {
  const n = name.toLowerCase();
  const ext = n.includes('.') ? n.split('.').pop() : '';
  if (n === 'dockerfile') return 'dockerfile';
  if (n === 'nginx.conf') return 'nginx';
  if (/^(\.?bashrc|\.?profile|\.zshrc|\.bash_\w+|makefile)$/.test(n)) return 'shell';
  if (MODES[ext]) return MODES[ext];
  const first = (text || '').slice(0, 80).split('\n')[0];
  if (/^#!.*\b(ba|z|k)?sh\b/.test(first)) return 'shell';
  if (/^#!.*python/.test(first)) return 'python';
  if (/^#!.*node/.test(first)) return 'javascript';
  if (/^<\?php/.test(first)) return 'application/x-httpd-php';
  return null;
}

async function openEditor(name, copilotChatId) {
  const fp = full(name);
  const d = await run(() => api('GET', '/read?path=' + enc(fp)));
  if (!d) return false;
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : 'TEKS';
  const pg = h('div', 'page');
  pg.style.setProperty('--fs', LS.get('vpsacc_fs', '14') + 'px');
  const head = h('div', 'page-head');
  const row = h('div', 'page-row');
  const bClose = ib('close');
  const title = h('div', 'page-title');
  const tb = h('b', null, name);
  const ts = h('small', null, ext);
  title.append(tb, ts);
  const bFind = ib('search');
  const bCopilot = ib('smart_toy');
  bCopilot.title = 'Edit dengan Copilot';
  const bSet = ib('tune');
  const isMd = /\.(md|markdown)$/i.test(name);
  const bMd = isMd ? ib('visibility') : null;
  const bSave = h('button', 'savebtn', 'Simpan');
  bSave.type = 'button';
  if (bMd) row.append(bClose, title, bMd, bFind, bCopilot, bSet, bSave);
  else row.append(bClose, title, bFind, bCopilot, bSet, bSave);
  head.append(row);
  const find = h('div', 'findbar hidden');
  const fi = h('input');
  fi.placeholder = 'Cari di file…';
  fi.autocapitalize = 'off';
  fi.autocomplete = 'off';
  const fUp = ib('keyboard_arrow_up');
  const fDn = ib('keyboard_arrow_down');
  const fX = ib('close');
  find.append(fi, fUp, fDn, fX);
  const wrap = h('div', 'cmwrap');
  const preview = isMd ? h('div', 'md-preview hidden') : null;
  const editorCopilot = h('div', 'editor-copilot hidden');
  const editorMode = h('select', 'editor-copilot-mode');
  editorMode.setAttribute('aria-label', 'Mode edit Copilot');
  [['patch', 'Patch per blok (default)'], ['full', 'Tulis ulang kode penuh']].forEach(([value, label]) => {
    const option = h('option');
    option.value = value;
    option.textContent = label;
    editorMode.append(option);
  });
  const editorPrompt = h('textarea', 'editor-copilot-input');
  editorPrompt.rows = 2;
  editorPrompt.placeholder = 'Jelaskan perubahan yang diinginkan…';
  editorPrompt.setAttribute('aria-label', 'Instruksi untuk Copilot');
  const editorSend = h('button', 'editor-copilot-send');
  editorSend.type = 'button';
  editorSend.title = 'Kirim';
  editorSend.setAttribute('aria-label', 'Kirim');
  editorSend.append(h('span', 'ms', 'send'));
  const editorCopilotStatus = h('span', 'editor-copilot-status');
  editorCopilot.append(editorMode, editorPrompt, editorSend, editorCopilotStatus);
  const keys = h('div', 'keys');
  if (preview) pg.append(head, find, wrap, preview, editorCopilot, keys);
  else pg.append(head, find, wrap, editorCopilot, keys);

  let wrapOn = LS.get('vpsacc_wrap', '0') === '1';
  let ed;
  if (window.CodeMirror) {
    const cm = window.CodeMirror(wrap, {
      value: d.content, mode: modeFor(name, d.content), theme: 'ios', lineNumbers: true, lineWrapping: wrapOn,
      tabSize: 2, indentUnit: 2, indentWithTabs: false, matchBrackets: true, autoCloseBrackets: true, styleActiveLine: true,
      extraKeys: {
        Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.execCommand('insertSoftTab')),
        'Shift-Tab': c => c.indentSelection('subtract'),
        'Ctrl-S': () => save(), 'Cmd-S': () => save()
      }
    });
    ed = {
      get: () => cm.getValue(), focus: () => cm.focus(), insert: t => cm.replaceSelection(t, 'end'),
      set: t => cm.setValue(t), append: t => cm.replaceRange(t, cm.posFromIndex(cm.getValue().length)),
      replaceExact: (search, replacement) => {
        const source = cm.getValue();
        const first = source.indexOf(search);
        if (first < 0 || source.indexOf(search, first + 1) >= 0) {
          throw new Error(first < 0 ? 'Patch dilewati: teks acuan tidak ditemukan.' : 'Patch dilewati: teks acuan tidak unik.');
        }
        const from = cm.posFromIndex(first);
        const to = cm.posFromIndex(first + search.length);
        cm.operation(() => {
          cm.replaceRange(replacement, from, to, '+copilot');
          const end = cm.posFromIndex(first + replacement.length);
          cm.setCursor(end);
          cm.scrollIntoView({ from, to: end }, 90);
          if (replacement.length) {
            const mark = cm.markText(from, end, { className: 'copilot-edit-highlight' });
            setTimeout(() => mark.clear(), 1800);
          }
        });
        return true;
      },
      clear: () => cm.setValue(''),
      undo: () => cm.undo(), redo: () => cm.redo(), left: () => cm.execCommand('goCharLeft'), right: () => cm.execCommand('goCharRight'),
      tab: () => (cm.somethingSelected() ? cm.indentSelection('add') : cm.execCommand('insertSoftTab')),
      mark: () => cm.changeGeneration(), clean: g => cm.isClean(g),
      onChange: f => cm.on('change', f), onCursor: f => cm.on('cursorActivity', f),
      cursor: () => cm.getCursor(), refresh: () => cm.refresh(), wrap: on => cm.setOption('lineWrapping', on),
      selected: () => cm.getSelection(),
      find: (q, back) => {
        const opts = { caseFold: true };
        const last = cm.lastLine();
        let cur = cm.getSearchCursor(q, back ? cm.getCursor('from') : cm.getCursor('to'), opts);
        let hit = back ? cur.findPrevious() : cur.findNext();
        if (!hit) {
          cur = cm.getSearchCursor(q, back ? { line: last, ch: cm.getLine(last).length } : { line: 0, ch: 0 }, opts);
          hit = back ? cur.findPrevious() : cur.findNext();
        }
        if (!hit) return false;
        cm.setSelection(cur.from(), cur.to());
        cm.scrollIntoView({ from: cur.from(), to: cur.to() }, 90);
        return true;
      }
    };
  } else {
    const ta = h('textarea', 'fb');
    ta.value = d.content;
    ta.spellcheck = false;
    ta.style.whiteSpace = wrapOn ? 'pre-wrap' : 'pre';
    wrap.append(ta);
    ed = {
      get: () => ta.value, focus: () => ta.focus(),
      insert: t => { ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); },
      set: t => { ta.value = t; ta.dispatchEvent(new Event('input')); },
      append: t => { ta.setRangeText(t, ta.value.length, ta.value.length, 'end'); ta.dispatchEvent(new Event('input')); },
      replaceExact: (search, replacement) => {
        const first = ta.value.indexOf(search);
        if (first < 0 || ta.value.indexOf(search, first + 1) >= 0) {
          throw new Error(first < 0 ? 'Patch dilewati: teks acuan tidak ditemukan.' : 'Patch dilewati: teks acuan tidak unik.');
        }
        ta.setRangeText(replacement, first, first + search.length, 'end');
        ta.dispatchEvent(new Event('input'));
        const line = ta.value.slice(0, first + replacement.length).split('\n').length - 1;
        const lineHeight = Number.parseFloat(getComputedStyle(ta).lineHeight) || 20;
        ta.scrollTop = Math.max(0, line * lineHeight - ta.clientHeight / 3);
        return true;
      },
      clear: () => { ta.value = ''; ta.dispatchEvent(new Event('input')); },
      undo: () => document.execCommand('undo'), redo: () => document.execCommand('redo'),
      left: () => { ta.selectionStart = ta.selectionEnd = Math.max(0, ta.selectionStart - 1); },
      right: () => { ta.selectionStart = ta.selectionEnd = ta.selectionEnd + 1; },
      tab: () => ed.insert('  '), mark: () => ta.value, clean: g => ta.value === g,
      onChange: f => ta.addEventListener('input', f), onCursor: f => ta.addEventListener('keyup', f),
      cursor: () => { const v = ta.value.slice(0, ta.selectionStart).split('\n'); return { line: v.length - 1, ch: v[v.length - 1].length }; },
      refresh: () => {}, wrap: on => { ta.style.whiteSpace = on ? 'pre-wrap' : 'pre'; },
      selected: () => ta.value.slice(ta.selectionStart, ta.selectionEnd),
      find: (q, back) => {
        const v = ta.value.toLowerCase();
        const qq = q.toLowerCase();
        let i = back ? v.lastIndexOf(qq, ta.selectionStart - 1) : v.indexOf(qq, ta.selectionEnd);
        if (i < 0) i = back ? v.lastIndexOf(qq) : v.indexOf(qq);
        if (i < 0) return false;
        ta.focus();
        ta.setSelectionRange(i, i + q.length);
        return true;
      }
    };
  }

  let base = ed.mark();
  let dirty = false;
  let discard = false;
  let saving = false;
  const upd = () => {
    const nd = !ed.clean(base);
    if (nd !== dirty) {
      dirty = nd;
      bSave.classList.toggle('on', dirty);
      tb.textContent = (dirty ? '• ' : '') + name;
    }
  };
  const info = () => { const c = ed.cursor(); ts.textContent = ext + ' • Baris ' + (c.line + 1) + ', Kol ' + (c.ch + 1); };
  ed.onChange(upd);
  ed.onCursor(info);
  async function save() {
    if (saving || !dirty) return true;
    saving = true;
    const g = ed.mark();
    const content = ed.get();
    const r = await run(() => api('PUT', '/write', { path: fp, content }));
    saving = false;
    if (!r) return false;
    base = g;
    upd();
    const it = getItem(name);
    if (it) {
      it.size = typeof r.size === 'number' ? r.size : new TextEncoder().encode(content).length;
      it.mtime = Date.now();
      render();
    }
    toast('Tersimpan');
    return true;
  }
  bSave.onclick = save;
  bClose.onclick = () => closeOv();

  // markdown preview (marked.js)
  let mdPreview = false;
  const renderMd = () => {
    if (!preview) return;
    const src = ed.get();
    let html = '';
    try {
      if (window.marked && typeof window.marked.parse === 'function') html = window.marked.parse(src, { async: false });
      else if (window.marked) html = window.marked(src);
      else html = '<pre>' + escHtml(src) + '</pre>';
    } catch (e) {
      html = '<pre>' + escHtml(src) + '</pre>';
    }
    preview.innerHTML = html;
  };
  const setMdMode = (previewOn) => {
    if (!isMd || !preview || !bMd) return;
    mdPreview = !!previewOn;
    wrap.classList.toggle('hidden', mdPreview);
    preview.classList.toggle('hidden', !mdPreview);
    keys.classList.toggle('hidden', mdPreview);
    find.classList.add('hidden');
    bSave.classList.toggle('hidden', mdPreview);
    bFind.classList.toggle('hidden', mdPreview);
    bSet.classList.toggle('hidden', mdPreview);
    bMd.firstChild.textContent = mdPreview ? 'edit' : 'visibility';
    bMd.title = mdPreview ? 'Edit teks' : 'Preview markdown';
    ts.textContent = mdPreview ? 'PREVIEW' : ext;
    if (mdPreview) renderMd();
    else {
      try { ed.refresh(); ed.focus(); } catch (e) {}
      info();
    }
  };
  if (bMd) {
    bMd.title = 'Preview markdown';
    bMd.onclick = () => setMdMode(!mdPreview);
    // default preview buat file .md
    setTimeout(() => setMdMode(true), 0);
  }

  let editorCopilotActive = false;
  let editorClosed = false;
  let editorChatId = copilotChatId || null;
  const updateEditorCopilot = () => {
    editorPrompt.disabled = editorCopilotActive;
    editorMode.disabled = editorCopilotActive;
    editorSend.disabled = editorCopilotActive || !editorPrompt.value.trim();
    bCopilot.title = editorCopilotActive ? 'Copilot sedang bekerja' : 'Edit dengan Copilot';
  };
  editorPrompt.addEventListener('input', updateEditorCopilot);
  const sendEditorCopilot = async () => {
    const prompt = editorPrompt.value.trim();
    if (!prompt || editorCopilotActive) return;
    const mode = editorMode.value;
    editorCopilotActive = true;
    editorCopilotStatus.textContent = 'Menghubungkan ke chat…';
    updateEditorCopilot();
    try {
      if (!editorChatId) {
        const chat = await api('POST', '/copilot/chats/for-directory', { path: fp });
        editorChatId = chat.id;
      }
      setActiveCopilotChat(editorChatId);
      const started = await api('POST', '/copilot/chats/' + encodeURIComponent(editorChatId) + '/editor', {
        path: fp, content: ed.get(), prompt, mode
      });
      editorPrompt.value = '';
      updateEditorCopilot();
      editorCopilotStatus.textContent = 'Copilot sedang mengetik…';
      let after = started.after || 0;
      let began = false;
      let patchCount = 0;
      let patchBuffer = '';
      let patchStream = '';
      const appliedPatchIds = new Set();
      let finished = false;
      let editorFailed = false;
      const applyPatchLine = line => {
        const source = line.trim();
        if (!source) return;
        try {
          const patch = JSON.parse(source);
          if (!patch || !Number.isSafeInteger(patch.id) || patch.id < 1 ||
              typeof patch.find !== 'string' || !patch.find ||
              typeof patch.replace !== 'string') {
            throw new Error('Format patch Copilot tidak valid.');
          }
          if (appliedPatchIds.has(patch.id)) return;
          ed.replaceExact(patch.find, patch.replace);
          appliedPatchIds.add(patch.id);
          patchCount++;
          began = true;
          upd();
          editorCopilotStatus.textContent = 'Menerapkan patch ' + patchCount + '…';
        } catch (e) {
          editorFailed = true;
          toast(e.message || 'Patch Copilot gagal diterapkan', 'err');
        }
      };
      const consumePatchText = (text, flush = false) => {
        patchBuffer += text;
        const lines = patchBuffer.split('\n');
        patchBuffer = lines.pop() || '';
        lines.forEach(applyPatchLine);
        if (flush && patchBuffer.trim()) {
          applyPatchLine(patchBuffer);
          patchBuffer = '';
        }
      };
      while (!finished && !editorClosed) {
        try {
          const result = await api('GET', '/copilot/chats/' + encodeURIComponent(editorChatId) + '/events?after=' + after);
          after = result.next;
          (result.events || []).forEach(event => {
            const data = event.data || {};
            if (event.type === (mode === 'patch' ? 'editor_patch_delta' : 'assistant_delta') && data.text) {
              if (mode === 'patch') {
                patchStream += data.text;
                consumePatchText(data.text);
              } else {
                if (!began) { ed.clear(); began = true; }
                ed.append(data.text);
                upd();
              }
            } else if (event.type === (mode === 'patch' ? 'editor_patch_final' : 'assistant_final') &&
                typeof data.content === 'string' && data.content) {
              if (mode === 'patch') {
                if (data.content !== patchStream) {
                  patchBuffer = '';
                  patchStream = data.content;
                  consumePatchText(data.content);
                }
                consumePatchText('', true);
              } else {
                if (ed.get() !== data.content) ed.set(data.content);
                began = true;
                upd();
              }
            } else if (event.type === 'error') {
              editorFailed = true;
              toast(data.message || 'Copilot gagal mengedit file', 'err');
            } else if (event.type === 'turn_end') {
              finished = true;
            }
          });
          if (!result.running) finished = true;
        } catch (e) {
          editorFailed = true;
          toast(e.message || 'Koneksi Copilot terputus', 'err');
          finished = true;
        }
        if (!finished && !editorClosed) await new Promise(resolve => setTimeout(resolve, 220));
      }
      if (!began && !editorFailed) {
        editorFailed = true;
        toast(mode === 'patch' ? 'Copilot tidak menghasilkan patch yang dapat diterapkan' : 'Copilot tidak menghasilkan teks', 'err');
      }
      if (!editorFailed && !editorClosed) toast('Selesai • periksa perubahan lalu Simpan');
      else if (patchCount && !editorClosed) toast(patchCount + ' patch diterapkan; sebagian patch gagal.', 'err');
    } catch (e) {
      toast(e.message || 'Permintaan editor gagal dikirim', 'err');
    } finally {
      editorCopilotActive = false;
      editorCopilotStatus.textContent = '';
      updateEditorCopilot();
      if (!editorClosed) {
        upd();
        info();
      }
    }
  };
  bCopilot.onclick = async () => {
    if (mdPreview) setMdMode(false);
    if (editorCopilotActive) return;
    editorCopilot.classList.toggle('hidden');
    if (!editorCopilot.classList.contains('hidden')) {
      editorPrompt.focus();
      updateEditorCopilot();
    } else {
      return;
    }
  };
  editorSend.onclick = sendEditorCopilot;
  editorPrompt.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const mobile = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 680;
    if (!mobile) {
      event.preventDefault();
      sendEditorCopilot();
    }
  });
  updateEditorCopilot();

  const doFind = back => {
    const q = fi.value;
    if (!q) return;
    if (!ed.find(q, back)) toast('Tidak ditemukan', 'err');
  };
  bFind.onclick = () => {
    find.classList.toggle('hidden');
    if (!find.classList.contains('hidden')) {
      const s = ed.selected();
      if (s && s.length < 80 && s.indexOf('\n') < 0) fi.value = s;
      fi.focus();
      fi.select();
    }
  };
  fX.onclick = () => find.classList.add('hidden');
  fUp.onclick = () => doFind(true);
  fDn.onclick = () => doFind(false);
  fi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doFind(false); } });

  bSet.onclick = () => {
    let fs = +LS.get('vpsacc_fs', '14');
    const fsrow = h('div', 'fsrow');
    fsrow.append(h('span', null, 'Ukuran huruf'));
    const st = h('div', 'stepper');
    const mi = h('button', null, 'A−');
    const pl = h('button', null, 'A+');
    const val = h('b', null, String(fs));
    mi.type = pl.type = 'button';
    const apply = n => {
      fs = Math.max(10, Math.min(28, n));
      val.textContent = String(fs);
      LS.set('vpsacc_fs', String(fs));
      pg.style.setProperty('--fs', fs + 'px');
      ed.refresh();
    };
    mi.onclick = () => apply(fs - 1);
    pl.onclick = () => apply(fs + 1);
    st.append(mi, val, pl);
    fsrow.append(st);
    const wrow = h('div', 'fsrow');
    wrow.append(h('span', null, 'Bungkus baris'));
    const sw = h('button', 'sw' + (wrapOn ? ' on' : ''));
    sw.type = 'button';
    sw.onclick = () => {
      wrapOn = !wrapOn;
      sw.classList.toggle('on', wrapOn);
      LS.set('vpsacc_wrap', wrapOn ? '1' : '0');
      ed.wrap(wrapOn);
    };
    wrow.append(sw);
    sheet('Pengaturan editor', [{ node: fsrow }, { node: wrow }]);
  };

  const addKey = (label, fn, cls) => {
    const b = h('button', 'key' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    if (label.indexOf('#') === 0) b.append(ic(label.slice(1)));
    else b.textContent = label;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', fn);
    keys.append(b);
  };
  addKey('#keyboard_tab', () => ed.tab());
  addKey('#keyboard_arrow_left', () => ed.left());
  addKey('#keyboard_arrow_right', () => ed.right());
  addKey('#undo', () => ed.undo());
  addKey('#redo', () => ed.redo());
  '{}()[]<>;:="\'/\\|&$#!?~_-+*%.,@'.split('').forEach((c, i) => addKey(c, () => ed.insert(c), i === 0 ? 'gap' : ''));

  const vv = window.visualViewport;
  const fit = () => { pg.style.height = vv.height + 'px'; pg.style.top = vv.offsetTop + 'px'; ed.refresh(); };
  if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); }

  const ask = async () => {
    const c = await dialog({
      title: 'Simpan perubahan?', msg: name, col: true, cancelVal: 'stay',
      buttons: [{ label: 'Simpan', val: 'save', cls: 'b' }, { label: 'Buang perubahan', val: 'drop', cls: 'red' }, { label: 'Lanjut edit', val: 'stay' }]
    });
    if (c === 'drop') { discard = true; closeOv(); }
    else if (c === 'save') { if (await save()) closeOv(); }
  };
  openOv(pg, {
    dirty: () => dirty && !discard,
    ask,
    onhide: () => {
      editorClosed = true;
      if (vv) { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); }
    }
  });
  setTimeout(() => ed.refresh(), 320);
  return true;
}

async function openPreview(it) {
  const t = await run(() => api('POST', '/ticket', { path: full(it.name), inline: true }));
  if (!t) return;
  const k = kindOf(it).k;
  const pg = h('div', 'page dark');
  const head = h('div', 'page-head');
  const row = h('div', 'page-row');
  const bClose = ib('close');
  const title = h('div', 'page-title');
  title.append(h('b', null, it.name), h('small', null, fmtSize(it.size)));
  const bDl = ib('download');
  bClose.onclick = () => closeOv();
  bDl.onclick = () => opDownload(it.name);
  row.append(bClose, title, bDl);
  head.append(row);
  const body = h('div', 'pv');
  let m;
  if (k === 'img') { m = h('img'); m.alt = it.name; }
  else if (k === 'video') { m = h('video'); m.controls = true; m.playsInline = true; }
  else { m = h('audio'); m.controls = true; }
  m.src = t.url;
  body.append(m);
  pg.append(head, body);
  openOv(pg, { onhide: () => { if (m.pause) m.pause(); } });
}
