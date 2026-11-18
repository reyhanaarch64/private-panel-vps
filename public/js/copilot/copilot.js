'use strict';

function setView(view) {
  if (S.selecting) { S.selecting = false; S.sel.clear(); }
  S.view = view;
  chrome();
  if (processPollTimer) { clearInterval(processPollTimer); processPollTimer = null; }
  if (CP.pollTimer) { clearInterval(CP.pollTimer); CP.pollTimer = null; }
  if (view === 'terminal') {
    if (!webTerminals.length) createWebTerminalSession();
    else {
      fitActiveWebTerminal();
      const cur = activeWebTerminal();
      if (cur && cur.term) try { cur.term.focus(); } catch (e) {}
    }
  } else if (view === 'packages') {
    loadPackages();
  } else if (view === 'processes') {
    refreshProcesses();
    processPollTimer = setInterval(() => { if (S.view === 'processes') refreshProcesses(); }, 2500);
  } else if (view === 'copilot') {
    loadCopilot();
    CP.pollTimer = setInterval(copilotPoll, 350);
  }
}

const CP = {
  chats: [], active: LS.get('vpsacc_copilot_active', null), after: 0, replayUntil: 0, pollTimer: null, polling: false, loaded: false,
  assistantNode: null, assistantText: '', activities: new Map(), workDrawer: null, workList: null, commandStates: new Map(),
  mcpApprovals: new Map(), busy: false, authenticated: false,
  settings: null,
  loginJobId: null, loginAfter: 0, loginOutput: '', loginPollTimer: null, loginPolling: false, loginStarting: false
};

function setActiveCopilotChat(id) {
  CP.active = id || null;
  if (CP.active) LS.set('vpsacc_copilot_active', CP.active);
  else LS.del('vpsacc_copilot_active');
}

function copilotScroll() {
  const box = $('#copilotMessages');
  box.scrollTop = box.scrollHeight;
}
function enhanceCopilotCodeBlocks(body) {
  body.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    if (!code) return;

    const source = code.textContent || '';
    const lineCount = source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
    const wrapper = h('div', 'copilot-code-block');
    const toolbar = h('div', 'copilot-code-toolbar');
    const copy = h('button', 'copilot-code-button');
    copy.type = 'button';
    copy.title = 'Salin kode';
    copy.setAttribute('aria-label', 'Salin kode');
    copy.append(ic('content_copy'), h('span', null, 'Salin'));
    copy.onclick = async () => {
      copy.disabled = true;
      try {
        await copyText(source);
        copy.lastChild.textContent = 'Tersalin';
        setTimeout(() => { copy.lastChild.textContent = 'Salin'; }, 1400);
      } catch (error) {
        toast('Gagal menyalin kode', 'err');
      } finally {
        copy.disabled = false;
      }
    };
    toolbar.append(copy);

    if (lineCount > 50) {
      pre.classList.add('copilot-code-collapsed');
      const toggle = h('button', 'copilot-code-button copilot-code-toggle', 'Lihat selengkapnya');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.onclick = () => {
        const expanded = pre.classList.contains('copilot-code-collapsed');
        pre.classList.toggle('copilot-code-collapsed', !expanded);
        toggle.textContent = expanded ? 'Tutup' : 'Lihat selengkapnya';
        toggle.setAttribute('aria-expanded', String(expanded));
      };
      toolbar.append(toggle);
    }

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.append(toolbar, pre);
  });
}
function renderCopilotMarkdown(body, text) {
  try {
    if (window.marked && typeof window.marked.parse === 'function' && window.DOMPurify) {
      const html = window.marked.parse(text, { gfm: true });
      body.innerHTML = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
      enhanceCopilotCodeBlocks(body);
      return;
    }
  } catch (e) {}
  body.textContent = text || '';
}
function copilotMessage(role, text) {
  const row = h('div', 'copilot-message ' + role);
  row.append(h('div', 'copilot-role', role === 'user' ? 'Kamu' : 'Copilot'));
  const body = h('div', 'copilot-message-body' + (role === 'assistant' ? '' : ' plain'));
  if (role === 'assistant') renderCopilotMarkdown(body, text || '');
  else body.textContent = text || '';
  row.append(body);
  $('#copilotMessages').append(row);
  copilotScroll();
  return body;
}
function copilotTyping() {
  if (CP.assistantNode) return;
  const body = copilotMessage('assistant', '');
  body.classList.add('copilot-typing');
  const dots = h('span', 'copilot-typing-dots');
  dots.setAttribute('role', 'status');
  dots.setAttribute('aria-label', 'Copilot sedang mengetik');
  for (let i = 0; i < 3; i++) dots.append(h('i'));
  body.append(dots);
  CP.assistantNode = body;
  CP.assistantText = '';
}
function clearCopilotTyping() {
  if (!CP.assistantNode || !CP.assistantNode.classList.contains('copilot-typing')) return;
  CP.assistantNode.closest('.copilot-message')?.remove();
  CP.assistantNode = null;
  CP.assistantText = '';
}
function copilotActivity(id, label) {
  let node = id && CP.activities.get(id);
  if (node) {
    if (label) $('.copilot-activity-title', node).textContent = label;
    return node;
  }
  node = h('div', 'copilot-activity');
  node.append(h('div', 'copilot-activity-title', label || 'Aktivitas Copilot'));
  const details = h('pre', 'copilot-activity-details');
  node.append(details);
  $('#copilotMessages').append(node);
  if (id) CP.activities.set(id, node);
  copilotScroll();
  return node;
}
function copilotActivityText(node) {
  return $('.copilot-activity-details', node);
}
function copilotWorkDrawer() {
  if (CP.workDrawer && CP.workDrawer.isConnected) return CP.workDrawer;
  const drawer = h('details', 'copilot-work-drawer');
  const summary = h('summary', 'copilot-work-summary');
  summary.append(ic('terminal'), h('strong', 'copilot-work-title', 'Aktivitas Copilot'));
  summary.append(h('span', 'copilot-work-count'));
  summary.append(ic('expand_more', 'copilot-work-chevron'));
  const list = h('div', 'copilot-work-items');
  drawer.append(summary, list);
  const messages = $('#copilotMessages');
  const assistantRow = CP.assistantNode && CP.assistantNode.closest('.copilot-message');
  if (assistantRow && assistantRow.parentElement === messages) messages.insertBefore(drawer, assistantRow);
  else messages.append(drawer);
  CP.workDrawer = drawer;
  CP.workList = list;
  return drawer;
}
function updateCopilotWorkSummary() {
  if (!CP.workDrawer || !CP.workList) return;
  const states = [...CP.commandStates.values()];
  const running = states.filter(state =>
    state === 'Berjalan' || state === 'Menyiapkan command' || state === 'Menunggu persetujuan'
  ).length;
  const failed = states.some(state => state === 'Gagal' || /^Kode [^0]/.test(state));
  $('.copilot-work-title', CP.workDrawer).textContent = running
    ? 'Copilot menjalankan perintah'
    : (failed ? 'Copilot menyelesaikan perintah dengan error' : 'Copilot menyelesaikan perintah');
  $('.copilot-work-count', CP.workDrawer).textContent = states.length + ' perintah';
}
function copilotCommandActivity(id, label, command, cwd) {
  let node = id && CP.activities.get(id);
  if (!node || !node.classList.contains('copilot-command-drawer')) {
    if (node) node.remove();
    node = h('details', 'copilot-command-drawer');
    const summary = h('summary', 'copilot-command-summary');
    summary.append(h('span', 'ms', 'terminal'));
    summary.append(h('span', 'copilot-command-state', label || 'Command'));
    summary.append(h('code', 'copilot-command-inline'));
    summary.append(h('span', 'ms copilot-command-chevron', 'expand_more'));
    const body = h('div', 'copilot-command-body');
    body.append(h('div', 'copilot-command-meta'));
    body.append(h('pre', 'copilot-command-full'));
    body.append(h('pre', 'copilot-command-output'));
    node.append(summary, body);
    copilotWorkDrawer();
    CP.workList.append(node);
    if (id) {
      CP.activities.set(id, node);
      node.dataset.activityId = id;
      node.addEventListener('toggle', () => {
        if (!CP.active || !node.dataset.activityId) return;
        const key = 'vpsacc_copilot_command_open_' + encodeURIComponent(CP.active) + '_' + encodeURIComponent(node.dataset.activityId);
        LS.set(key, node.open ? '1' : '0');
      });
      const key = 'vpsacc_copilot_command_open_' + encodeURIComponent(CP.active || '') + '_' + encodeURIComponent(id);
      node.open = LS.get(key, '0') === '1';
    }
    copilotScroll();
  }
  if (label) {
    $('.copilot-command-state', node).textContent = label;
    CP.commandStates.set(id, label);
    updateCopilotWorkSummary();
  }
  if (typeof command === 'string') {
    $('.copilot-command-inline', node).textContent = command || 'Command';
    $('.copilot-command-full', node).textContent = command ? '$ ' + command : '';
  }
  if (typeof cwd === 'string' && cwd) {
    const meta = $('.copilot-command-meta', node);
    meta.textContent = 'Di: ' + cwd;
    const full = $('.copilot-command-full', node);
    if (full.textContent) full.textContent += '\nDi: ' + cwd;
  }
  return node;
}
function appendCopilotCommandOutput(node, text) {
  const output = $('.copilot-command-output', node);
  const stick = node.open && output.scrollTop + output.clientHeight >= output.scrollHeight - 24;
  output.textContent = (output.textContent + (text || '')).slice(-24000);
  if (stick) output.scrollTop = output.scrollHeight;
}
function renderCopilotHistory(chat) {
  const box = $('#copilotMessages');
  box.replaceChildren();
  CP.activities.clear();
  CP.workDrawer = null;
  CP.workList = null;
  CP.commandStates.clear();
  CP.assistantNode = null;
  CP.assistantText = '';
  const history = [
    ...(chat.messages || []).map(message => ({ kind: 'message', at: message.at || 0, message })),
    ...(chat.activities || []).map(activity => ({ kind: 'activity', at: activity.startedAt || activity.endedAt || 0, activity }))
  ].sort((a, b) => a.at - b.at);
  history.forEach(item => {
    if (item.kind === 'message') {
      if (item.message.role === 'user') {
        CP.workDrawer = null;
        CP.workList = null;
        CP.commandStates.clear();
      }
      copilotMessage(item.message.role, item.message.content);
      if (item.message.role === 'assistant') {
        CP.workDrawer = null;
        CP.workList = null;
        CP.commandStates.clear();
      }
      return;
    }
    const a = item.activity;
    if (a.kind === 'command') {
      const label = a.running ? 'Berjalan' : (a.error ? 'Gagal' : (a.signal ? 'Dihentikan' : (a.code === 0 ? 'Selesai' : 'Kode ' + a.code)));
      const node = copilotCommandActivity(a.id, label, a.command, a.cwd);
      if (a.error || (a.code != null && a.code !== 0)) node.classList.add('failed');
      appendCopilotCommandOutput(node, a.output || '');
      if (a.error) appendCopilotCommandOutput(node, '\n' + a.error);
    } else {
      const node = copilotActivity(null, 'Tool • ' + (a.name || 'aktivitas'));
      const details = copilotActivityText(node);
      if (a.output) details.textContent += a.output;
      if (a.error) details.textContent += '\n' + a.error;
    }
  });
  if (!(chat.messages || []).length && !(chat.activities || []).length) {
    box.append(h('div', 'copilot-empty', 'Tanyakan sesuatu atau minta Copilot mengelola file dalam scope panel.'));
  }
}
function renderCopilotChats() {
  const list = $('#copilotChatList');
  list.replaceChildren();
  if (!CP.chats.length) {
    list.append(h('div', 'copilot-empty small', 'Belum ada chat.'));
    return;
  }
  CP.chats.forEach(chat => {
    const item = h('button', 'copilot-chat-item' + (chat.id === CP.active ? ' active' : ''));
    item.type = 'button';
    item.append(h('strong', null, chat.title || 'Chat baru'));
    if (chat.directory) item.append(h('small', null, chat.directory));
    item.append(h('small', null, fmtDate(chat.updatedAt) + (chat.running ? ' • berjalan' : '')));
    item.onclick = () => loadCopilotChat(chat.id);
    list.append(item);
  });
}
function updateCopilotControls() {
  const chat = CP.chats.find(x => x.id === CP.active);
  $('#copilotTitle').textContent = chat ? chat.title || 'Chat baru' : 'Pilih atau buat chat';
  $('#copilotDelete').disabled = !chat || CP.busy || chat.running;
  $('#copilotInput').disabled = !chat || !CP.authenticated || CP.busy || !!(chat && chat.running);
  $('#copilotSend').disabled = $('#copilotInput').disabled;
  $('#copilotPlus').disabled = !CP.authenticated || CP.loading || CP.busy || !!(chat && chat.running);
  $('#copilotNew').disabled = !CP.authenticated || CP.busy || !!CP.loading;
  $('#copilotLogin').disabled = !!CP.loading || CP.loginStarting || !!CP.loginJobId;
  $('#copilotLogin').classList.toggle('hidden', CP.authenticated);
  $('#copilotScope').textContent = CP.scope ? 'Scope ' + CP.scope : '';
  $('#copilotScope').classList.toggle('full', CP.scope === '/');
}
async function openCopilotSettings() {
  try {
    const result = await api('GET', '/copilot/settings');
    const settings = result.settings;
    const form = h('div', 'copilot-settings-form');
    const hint = h('div', 'copilot-settings-hint',
      'Preferensi berlaku untuk semua chat Copilot. Batas scope dan konfirmasi command tetap mengikuti pengaturan panel.');
    const selectField = (label, current, options) => {
      const field = h('label', 'copilot-setting-field');
      field.append(h('span', 'copilot-setting-label', label));
      const select = h('select', 'copilot-setting-select');
      options.forEach(([value, name]) => {
        const option = h('option', null, name);
        option.value = value;
        select.append(option);
      });
      select.value = current;
      field.append(select);
      return { field, select };
    };
    const language = selectField('Bahasa jawaban', settings.language, [
      ['auto', 'Ikuti bahasa chat'],
      ['id', 'Bahasa Indonesia'],
      ['en', 'English']
    ]);
    const verbosity = selectField('Panjang jawaban', settings.verbosity, [
      ['concise', 'Ringkas'],
      ['balanced', 'Seimbang'],
      ['detailed', 'Rinci']
    ]);
    const customLabel = h('label', 'copilot-setting-field');
    customLabel.append(h('span', 'copilot-setting-label', 'Prompt tambahan (system prompt)'));
    const instructions = h('textarea', 'copilot-setting-instructions');
    instructions.rows = 8;
    instructions.maxLength = 12000;
    instructions.placeholder = 'Contoh: utamakan langkah praktis, gunakan Bahasa Indonesia, dan jelaskan perubahan file secara singkat.';
    instructions.value = settings.instructions || '';
    customLabel.append(instructions);
    const save = h('button', 'btn copilot-settings-save', 'Simpan pengaturan');
    save.type = 'button';
    form.append(hint, language.field, verbosity.field, customLabel, save);
    sheet('Pengaturan Copilot', [{ node: form }]);
    save.onclick = async () => {
      save.disabled = true;
      try {
        const updated = await api('PUT', '/copilot/settings', {
          language: language.select.value,
          verbosity: verbosity.select.value,
          instructions: instructions.value
        });
        CP.settings = updated.settings;
        closeOv();
        toast('Pengaturan Copilot disimpan');
      } catch (e) {
        toast(e.message || 'Pengaturan Copilot gagal disimpan', 'err');
      } finally {
        save.disabled = false;
      }
    };
  } catch (e) {
    toast(e.message || 'Pengaturan Copilot gagal dibuka', 'err');
  }
}
async function loadCopilotChat(id) {
  try {
    const chat = await api('GET', '/copilot/chats/' + encodeURIComponent(id));
    setActiveCopilotChat(chat.id);
    CP.after = chat.running ? Math.max(0, chat.turnStartSeq - 1) : chat.eventSeq;
    CP.replayUntil = chat.running ? chat.eventSeq : 0;
    renderCopilotHistory(chat);
    renderCopilotChats();
    updateCopilotControls();
    if (chat.running) await copilotPoll();
    if (window.innerWidth <= 680) $('#copilotSidebar').classList.add('closed');
  } catch (e) {
    toast(e.message || 'Chat Copilot gagal dibuka', 'err');
  }
}
async function loadCopilot() {
  if (CP.loading) return;
  CP.loading = true;
  try {
    const status = await api('GET', '/copilot/status');
    CP.authenticated = !!status.authenticated;
    CP.scope = status.scope;
    $('#copilotAuthText').textContent = CP.authenticated
      ? 'Login Copilot aktif' + (status.authType ? ' • ' + status.authType : '')
      : 'Login Copilot diperlukan untuk menautkan akun ke panel.';
    $('#copilotAuth').classList.toggle('warning', !CP.authenticated);
    if (CP.authenticated) {
      stopCopilotLoginPolling();
      CP.loginJobId = null;
      CP.loginOutput = '';
      $('#copilotLoginFlow').classList.add('hidden');
    } else if (status.loginFlow && status.loginFlow.id) {
      if (CP.loginJobId !== status.loginFlow.id) {
        CP.loginAfter = 0;
        CP.loginOutput = '';
      }
      CP.loginJobId = status.loginFlow.id;
      $('#copilotLoginFlow').classList.remove('hidden');
      if (!CP.loginPollTimer) CP.loginPollTimer = setInterval(pollCopilotLogin, 700);
    }
    const data = await api('GET', '/copilot/chats');
    CP.chats = data.chats || [];
    CP.loaded = true;
    if (CP.active && !CP.chats.some(c => c.id === CP.active)) setActiveCopilotChat(null);
    if (!CP.active && CP.chats.length) setActiveCopilotChat(CP.chats[0].id);
    renderCopilotChats();
    updateCopilotControls();
    if (CP.active) await loadCopilotChat(CP.active);
    else renderCopilotHistory({ messages: [], activities: [] });
  } catch (e) {
    $('#copilotAuthText').textContent = e.message || 'Tidak dapat memeriksa login Copilot.';
    $('#copilotAuth').classList.add('warning');
  } finally {
    CP.loading = false;
    updateCopilotControls();
  }
}
function stopCopilotLoginPolling() {
  if (CP.loginPollTimer) clearInterval(CP.loginPollTimer);
  CP.loginPollTimer = null;
}
function showCopilotLoginOutput() {
  const clean = CP.loginOutput.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n');
  $('#copilotLoginOutput').textContent = clean;
  const url = clean.match(/https:\/\/github\.com\/login\/device(?:\?[^\s]*)?/i);
  const link = $('#copilotLoginUrl');
  if (url) {
    link.href = url[0].replace(/[.,;]+$/, '');
    link.classList.remove('hidden');
  } else link.classList.add('hidden');
  const code = clean.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/i);
  $('#copilotLoginCode').textContent = code ? code[0] : '';
  $('#copilotLoginCopy').classList.toggle('hidden', !code);
}
async function startCopilotLogin() {
  if (CP.loginStarting || CP.authenticated) return;
  CP.loginStarting = true;
  updateCopilotControls();
  try {
    const allowPlaintext = await confirmD(
      'Simpan token Copilot?',
      'Server tidak memiliki system keychain. Jika setuju, token login disimpan tanpa enkripsi di ~/.vpsacc-copilot/settings.json. Foldernya dibatasi untuk user yang menjalankan panel.',
      'Setuju & lanjutkan',
      true
    );
    if (!allowPlaintext) return;
    const result = await api('POST', '/copilot/login', { allowPlaintext: true });
    if (result.authenticated) {
      await loadCopilot();
      return;
    }
    CP.loginJobId = result.id;
    CP.loginAfter = 0;
    CP.loginOutput = 'Menunggu kode verifikasi dari GitHub…\n';
    $('#copilotLoginFlow').classList.remove('hidden');
    showCopilotLoginOutput();
    stopCopilotLoginPolling();
    CP.loginPollTimer = setInterval(pollCopilotLogin, 700);
    await pollCopilotLogin();
  } catch (e) {
    $('#copilotAuthText').textContent = e.message || 'Tidak dapat memulai login Copilot.';
    toast(e.message || 'Login Copilot gagal dimulai', 'err');
  } finally {
    CP.loginStarting = false;
    updateCopilotControls();
  }
}
async function pollCopilotLogin() {
  if (CP.loginPolling || !CP.loginJobId) return;
  CP.loginPolling = true;
  const id = CP.loginJobId;
  try {
    const result = await api('GET', '/copilot/login/' + encodeURIComponent(id) + '?after=' + CP.loginAfter);
    if (CP.loginJobId !== id) return;
    CP.loginOutput += result.output || '';
    CP.loginAfter = result.next;
    showCopilotLoginOutput();
    if (result.authenticated) {
      stopCopilotLoginPolling();
      CP.loginJobId = null;
      await loadCopilot();
    } else if (result.done) {
      stopCopilotLoginPolling();
      CP.loginJobId = null;
      $('#copilotAuthText').textContent = result.error || 'Login belum berhasil. Coba mulai login lagi.';
      $('#copilotLogin').classList.remove('hidden');
      $('#copilotLogin').disabled = false;
    }
  } catch (e) {
    if (e.status === 404) {
      stopCopilotLoginPolling();
      CP.loginJobId = null;
    }
    $('#copilotAuthText').textContent = e.message || 'Koneksi login Copilot terputus.';
  } finally {
    CP.loginPolling = false;
    updateCopilotControls();
  }
}
async function copilotPoll() {
  if (CP.polling || S.view !== 'copilot' || !CP.active) return;
  CP.polling = true;
  const id = CP.active;
  try {
    const result = await api('GET', '/copilot/chats/' + encodeURIComponent(id) + '/events?after=' + CP.after);
    if (id !== CP.active) return;
    (result.events || []).forEach(event => handleCopilotEvent(event));
    CP.after = result.next;
    const chat = CP.chats.find(c => c.id === id);
    if (chat) chat.running = !!result.running;
    updateCopilotControls();
    if (!result.running && (result.events || []).some(e => e.type === 'turn_end')) {
      const data = await api('GET', '/copilot/chats');
      CP.chats = data.chats || [];
      renderCopilotChats();
      updateCopilotControls();
    }
  } catch (e) {
    if (e.status !== 404) $('#copilotAuthText').textContent = e.message || 'Koneksi Copilot terputus.';
  } finally {
    CP.polling = false;
  }
}
function handleCopilotEvent(event) {
  const data = event.data || {};
  if (event.type === 'turn_start') {
    CP.workDrawer = null;
    CP.workList = null;
    CP.commandStates.clear();
    copilotTyping();
  } else if (event.type === 'assistant_delta') {
    if (!CP.assistantNode) CP.assistantNode = copilotMessage('assistant', '');
    CP.assistantNode.classList.remove('copilot-typing');
    CP.assistantText += data.text || '';
    renderCopilotMarkdown(CP.assistantNode, CP.assistantText);
    copilotScroll();
  } else if (event.type === 'assistant_final') {
    if (!CP.assistantNode) CP.assistantNode = copilotMessage('assistant', '');
    CP.assistantNode.classList.remove('copilot-typing');
    CP.assistantText = data.content || CP.assistantText;
    renderCopilotMarkdown(CP.assistantNode, CP.assistantText);
    CP.assistantNode = null;
    CP.assistantText = '';
  } else if (event.type === 'tool_start') {
    if (data.name === 'run_command' || data.name === 'run_safe_command') {
      const args = data.args || {};
      copilotCommandActivity(data.id, 'Menyiapkan command', args.command || args.action || data.name, args.cwd);
    } else {
      const node = copilotActivity(data.id, 'Tool • ' + data.name);
      copilotActivityText(node).textContent = JSON.stringify(data.args || {}, null, 2);
    }
  } else if (event.type === 'tool_complete') {
    const node = CP.activities.get(data.id) || copilotActivity(data.id);
    if (node.classList.contains('copilot-command-drawer')) {
      if (!data.success) node.classList.add('failed');
      if (data.error) appendCopilotCommandOutput(node, '\n' + data.error);
    } else {
      node.classList.toggle('failed', !data.success);
      const details = copilotActivityText(node);
      if (data.error) details.textContent += '\n' + data.error;
    }
  } else if (event.type === 'open_file') {
    const node = copilotActivity(data.id, 'File siap dibuka di editor');
    copilotActivityText(node).textContent = data.path || '';
    const actions = h('div', 'copilot-approval-actions');
    const button = h('button', 'btn', 'Buka di editor');
    button.type = 'button';
    button.onclick = async () => {
      button.disabled = true;
      try {
        const target = String(data.path || '');
        const slash = target.lastIndexOf('/');
        const directory = slash > 0 ? target.slice(0, slash) : '/';
        const name = target.slice(slash + 1);
        const chatId = CP.active;
        history.pushState({ nav: 1 }, '', hashEnc(directory));
        await load(directory);
        if (S.path !== directory) throw new Error('Direktori file tidak dapat dibuka.');
        if (!(await openEditor(name, chatId))) button.disabled = false;
      } catch (e) {
        button.disabled = false;
        toast(e.message || 'File gagal dibuka di editor', 'err');
      }
    };
    actions.append(button);
    node.append(actions);
  } else if (event.type === 'command_start') {
    const node = copilotCommandActivity(data.id, 'Berjalan', data.command || '', data.cwd || '');
    node.classList.remove('failed');
  } else if (event.type === 'command_output') {
    if (event.seq <= CP.replayUntil) return;
    const node = copilotCommandActivity(data.id, 'Berjalan');
    appendCopilotCommandOutput(node, data.text || '');
  } else if (event.type === 'command_end') {
    const label = data.error ? 'Gagal' : (data.signal ? 'Dihentikan' : (data.code === 0 ? 'Selesai' : 'Kode ' + data.code));
    const node = copilotCommandActivity(data.id, label);
    node.classList.toggle('failed', !!data.error || (data.code != null && data.code !== 0));
    if (data.error) appendCopilotCommandOutput(node, '\n' + data.error);
  } else if (event.type === 'approval_required' || event.type === 'mcp_approval_required') {
    if (event.type === 'mcp_approval_required') {
      showMcpApproval(data, CP.active);
      return;
    }
    const existing = CP.activities.get(data.id);
    const isCommand = !!(existing && existing.classList.contains('copilot-command-drawer'));
    const node = isCommand
      ? copilotCommandActivity(data.id, 'Menunggu persetujuan', data.command || '', data.cwd || '')
      : copilotActivity(data.id, 'Menunggu persetujuan command');
    if (isCommand) node.open = true;
    else copilotActivityText(node).textContent = '$ ' + data.command + '\nDi: ' + data.cwd;
    const actions = h('div', 'copilot-approval-actions' + (isCommand ? ' copilot-command-actions' : ''));
    [['Izinkan sekali', true], ['Tolak', false]].forEach(([label, approve]) => {
      const button = h('button', approve ? 'btn' : 'btn secondary', label);
      button.type = 'button';
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api('POST', '/copilot/chats/' + encodeURIComponent(CP.active) + '/approvals/' + encodeURIComponent(data.id), { approve });
          actions.replaceChildren(h('span', 'copilot-note', approve ? 'Disetujui' : 'Ditolak'));
        } catch (e) {
          button.disabled = false;
          toast(e.message || 'Persetujuan gagal', 'err');
        }
      };
      actions.append(button);
    });
    if (isCommand) {
      const oldActions = $('.copilot-command-actions', node);
      if (oldActions) oldActions.replaceWith(actions);
      else $('.copilot-command-body', node).append(actions);
    } else node.append(actions);
  } else if (event.type === 'approval_result') {
    if (CP.mcpApprovals.has(data.id)) {
      dismissMcpApproval(data.id);
      return;
    }
    const node = CP.activities.get(data.id);
    const actions = node && $('.copilot-approval-actions', node);
    if (node && node.classList.contains('copilot-command-drawer')) {
      $('.copilot-command-state', node).textContent = data.approved ? 'Disetujui' : 'Ditolak';
    } else if (node) {
      const isMcp = node.dataset.mcpApproval === '1';
      $('.copilot-activity-title', node).textContent = data.approved
        ? (isMcp ? 'MCP tool disetujui' : 'Command disetujui')
        : (isMcp ? 'MCP tool ditolak' : 'Command ditolak');
    }
    if (actions) actions.replaceChildren(h('span', 'copilot-note', (data.approved ? 'Disetujui' : 'Ditolak') + (data.reason ? ' • ' + data.reason : '')));
  } else if (event.type === 'error' || event.type === 'storage_error') {
    clearCopilotTyping();
    copilotMessage('system', data.message || 'Terjadi kesalahan Copilot.');
  } else if (event.type === 'turn_end') {
    clearCopilotTyping();
    CP.assistantNode = null;
    CP.assistantText = '';
  }
}

function showMcpApproval(data, chatId) {
  if (!data || !data.id || CP.mcpApprovals.has(data.id)) return;
  const overlay = h('div', 'ov dlg copilot-mcp-approval-overlay');
  const backdrop = h('div', 'back');
  const dialog = h('div', 'dialog copilot-mcp-approval');
  const body = h('div', 'dlg-body');
  const title = h('div', 'dlg-title', 'MCP tool meminta izin');
  const target = h('div', 'copilot-mcp-approval-target');
  target.append(h('strong', null, data.serverName || 'MCP'), h('span', null, data.title || data.toolName || 'Tool'));
  const args = h('pre', 'copilot-mcp-approval-args', JSON.stringify(data.args || {}, null, 2));
  const note = h('p', 'copilot-mcp-approval-note',
    'Izinkan sekali hanya untuk panggilan ini. Izin tersimpan berlaku untuk tool ini hanya jika runtime menandai panggilan berikutnya sebagai read-only; panggilan mutating atau unknown tetap meminta persetujuan.');
  const actions = h('div', 'copilot-mcp-approval-actions');
  const entry = { overlay, done: false, chatId };
  const submit = async (approve, rememberReadOnly) => {
    if (entry.done) return;
    entry.done = true;
    actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      await api('POST', '/copilot/chats/' + encodeURIComponent(chatId) + '/approvals/' + encodeURIComponent(data.id), {
        approve,
        rememberReadOnly: !!rememberReadOnly
      });
      CP.mcpApprovals.delete(data.id);
      if (overlay.isConnected) closeOv();
    } catch (error) {
      entry.done = false;
      actions.querySelectorAll('button').forEach(button => { button.disabled = false; });
      toast(error.message || 'Persetujuan MCP gagal', 'err');
    }
  };
  [
    { label: 'Izinkan sekali', approve: true, remember: false, cls: 'copilot-mcp-approval-once' },
    { label: 'Izinkan & jangan tanya lagi', approve: true, remember: true, cls: 'copilot-mcp-approval-always' },
    { label: 'Tolak', approve: false, remember: false, cls: 'copilot-mcp-approval-reject' }
  ].forEach(action => {
    const button = h('button', action.cls, action.label);
    button.type = 'button';
    button.onclick = () => submit(action.approve, action.remember);
    actions.append(button);
  });
  body.append(title, target, h('div', 'copilot-mcp-approval-args-label', 'Argumen (disanitasi)'), args, note);
  dialog.append(body, actions);
  overlay.append(backdrop, dialog);
  backdrop.onclick = () => closeOv();
  CP.mcpApprovals.set(data.id, entry);
  openOv(overlay, { onhide: () => { if (!entry.done) submit(false, false); } });
}

function dismissMcpApproval(id) {
  const entry = CP.mcpApprovals.get(id);
  if (!entry) return;
  entry.done = true;
  CP.mcpApprovals.delete(id);
  if (entry.overlay.isConnected) closeOv();
}

async function newCopilotChat() {
  try {
    const chat = await api('POST', '/copilot/chats', {});
    setActiveCopilotChat(chat.id);
    await loadCopilot();
    if (window.innerWidth <= 680) $('#copilotSidebar').classList.add('closed');
  } catch (e) {
    toast(e.message || 'Chat baru gagal dibuat', 'err');
  }
}
async function sendCopilotMessage(event) {
  event.preventDefault();
  const input = $('#copilotInput');
  const message = input.value.trim();
  if (!message || !CP.active || CP.busy) return;
  CP.busy = true;
  updateCopilotControls();
  try {
    await api('POST', '/copilot/chats/' + encodeURIComponent(CP.active) + '/messages', { message });
    input.value = '';
    await loadCopilotChat(CP.active);
    const chat = CP.chats.find(c => c.id === CP.active);
    if (chat) chat.running = true;
    updateCopilotControls();
  } catch (e) {
    toast(e.message || 'Pesan gagal dikirim', 'err');
  } finally {
    CP.busy = false;
    updateCopilotControls();
  }
}
async function deleteCopilotChat() {
  if (!CP.active || !(await confirmD('Hapus chat?', 'Riwayat chat dan aktivitasnya akan dihapus.', 'Hapus', true))) return;
  try {
    await api('DELETE', '/copilot/chats/' + encodeURIComponent(CP.active));
    setActiveCopilotChat(null);
    await loadCopilot();
  } catch (e) {
    toast(e.message || 'Chat gagal dihapus', 'err');
  }
}
