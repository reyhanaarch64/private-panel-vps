(function (root) {
'use strict';

const h = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const icon = name => h('span', 'ms', name);
let options = null;
let manager = null;

function closeMenu() {
  const menu = document.getElementById('copilotPlusMenu');
  if (menu) menu.classList.add('hidden');
}

function openManager() {
  if (!options) return;
  closeMenu();
  const overlay = h('div', 'ov copilot-mcp-overlay');
  const backdrop = h('div', 'back');
  const sheet = h('div', 'sheet');
  const card = h('div', 'sheet-card copilot-mcp-sheet');
  const heading = h('div', 'copilot-mcp-heading');
  const back = h('button', 'term-action copilot-mcp-back');
  back.type = 'button';
  back.title = 'Kembali ke daftar konektor';
  back.append(icon('arrow_back'));
  const title = h('div');
  const close = h('button', 'term-action');
  close.type = 'button';
  close.title = 'Tutup';
  close.append(icon('close'));
  heading.append(back, title, close);
  const content = h('div', 'copilot-mcp-content');
  card.append(heading, content);
  sheet.append(card);
  overlay.append(backdrop, sheet);
  close.onclick = options.closeOv;
  backdrop.onclick = options.closeOv;
  back.onclick = () => renderList();
  manager = { overlay, title, back, content, servers: [], selectedName: null };
  options.openOv(overlay);
  loadServers().catch(error => {
    content.replaceChildren(h('div', 'copilot-mcp-empty', error.message || 'Daftar MCP gagal dimuat.'));
  });
}

function setHeading(name, subtitle, showBack) {
  if (!manager) return;
  manager.title.replaceChildren(h('strong', null, name), h('p', null, subtitle));
  manager.back.hidden = !showBack;
}

async function loadServers() {
  const response = await options.api('GET', '/copilot/mcp/servers');
  if (!manager) return;
  manager.servers = response.servers || [];
  if (manager.selectedName) {
    const selected = manager.servers.find(server => server.name === manager.selectedName);
    if (selected) renderDetail(selected);
    else renderList();
  } else renderList();
}

function renderList() {
  if (!manager) return;
  manager.selectedName = null;
  setHeading('MCP connectors', 'Pilih konektor untuk melihat detail dan mengatur akses.', false);
  const list = h('div', 'copilot-mcp-list');
  const add = h('button', 'copilot-mcp-add-connector');
  add.type = 'button';
  add.append(icon('add'), h('span', null, 'Tambah konektor'));
  add.onclick = () => renderAdd();
  list.append(add);
  if (!manager.servers.length) {
    list.append(h('div', 'copilot-mcp-empty', 'Belum ada konektor MCP.'));
  } else {
    manager.servers.forEach(server => {
      const item = h('button', 'copilot-mcp-connector');
      item.type = 'button';
      item.append(h('strong', null, server.name), icon('chevron_right'));
      item.onclick = () => renderDetail(server);
      list.append(item);
    });
  }
  manager.content.replaceChildren(list);
}

function textInput(type, placeholder, label) {
  const input = document.createElement('input');
  input.type = type;
  input.autocomplete = type === 'password' ? 'new-password' : 'off';
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  if (type === 'password') input.maxLength = 4096;
  return input;
}

function field(label, input) {
  const wrapper = h('label', 'copilot-mcp-field');
  wrapper.append(h('span', null, label), input);
  return wrapper;
}

function addHeaderRow(list, existingName, form) {
  const row = h('div', 'copilot-mcp-header-row');
  const name = textInput('text', 'Nama header, contoh: Authorization', 'Nama header');
  name.maxLength = 256;
  const value = textInput('password', existingName ? 'Kosongkan untuk mempertahankan nilai tersimpan' : 'Nilai header', 'Nilai header');
  if (existingName) {
    name.value = existingName;
    name.readOnly = true;
  }
  const remove = h('button', 'copilot-mcp-header-remove', existingName ? 'Hapus' : 'Buang');
  remove.type = 'button';
  remove.setAttribute('aria-label', existingName ? 'Hapus header ' + existingName : 'Buang header baru');
  const entry = { row, name, value, existingName, remove: false };
  remove.onclick = () => {
    if (!existingName) {
      form.headerRows = form.headerRows.filter(item => item !== entry);
      row.remove();
      return;
    }
    entry.remove = !entry.remove;
    row.classList.toggle('removed', entry.remove);
    remove.textContent = entry.remove ? 'Pertahankan' : 'Hapus';
    remove.setAttribute('aria-pressed', String(entry.remove));
    value.disabled = entry.remove;
  };
  row.append(name, value, remove);
  form.headerRows.push(entry);
  list.append(row);
}

function headerEditor(names, existing = false) {
  const section = h('div', 'copilot-mcp-header-section');
  section.append(h('div', 'copilot-mcp-header-label', 'Header autentikasi'));
  const list = h('div', 'copilot-mcp-header-list');
  const form = { headerRows: [] };
  (names || []).forEach(name => addHeaderRow(list, name, form));
  if (!existing && !form.headerRows.length) addHeaderRow(list, null, form);
  const add = h('button', 'copilot-mcp-add-header', 'Tambah header');
  add.type = 'button';
  add.onclick = () => addHeaderRow(list, null, form);
  section.append(list, add);
  return { section, form };
}

function collectHeaders(form) {
  const headers = Object.create(null);
  const preserveHeaderNames = [];
  const removeHeaderNames = [];
  const names = new Set();
  for (const row of form.headerRows) {
    const name = (row.existingName || row.name.value).trim();
    const value = row.value.value;
    if (!row.existingName && !name && !value) continue;
    if (!name || (!row.existingName && !value)) {
      options.toast('Isi nama dan nilai untuk header baru', 'err');
      (row.existingName ? row.value : (!name ? row.name : row.value)).focus();
      return null;
    }
    const lower = name.toLowerCase();
    if (names.has(lower)) {
      options.toast('Nama header ' + name + ' tercantum lebih dari sekali', 'err');
      row.name.focus();
      return null;
    }
    names.add(lower);
    if (row.existingName && row.remove) removeHeaderNames.push(row.existingName);
    else if (value) Object.defineProperty(headers, name, {
      value, enumerable: true, configurable: true, writable: true
    });
    else if (row.existingName) preserveHeaderNames.push(row.existingName);
  }
  return { headers, preserveHeaderNames, removeHeaderNames };
}

function renderAdd() {
  if (!manager) return;
  setHeading('Tambah konektor', 'Kredensial tidak akan ditampilkan kembali setelah disimpan.', true);
  const form = h('div', 'copilot-mcp-add-form');
  form.append(h('h3', null, 'Koneksi MCP'));
  const name = textInput('text', 'contoh: docs', 'Nama konektor');
  name.maxLength = 64;
  const url = textInput('url', 'https://server.example/mcp', 'URL endpoint MCP');
  url.autocomplete = 'url';
  form.append(field('Nama konektor', name), field('URL endpoint /mcp', url));
  const headers = headerEditor([], false);
  form.append(headers.section);
  form.append(h('div', 'copilot-mcp-warning',
    'Server akan diuji saat disimpan. Header disimpan privat di server; nilai rahasia tidak dikirim kembali pada daftar konektor. Izin otomatis hanya berlaku jika runtime secara eksplisit menandai panggilan sebagai read-only.'));
  const save = h('button', 'copilot-mcp-save', 'Hubungkan dan simpan');
  save.type = 'button';
  save.onclick = async () => {
    const values = collectHeaders(headers.form);
    if (!values) return;
    save.disabled = true;
    save.textContent = 'Menyambungkan…';
    try {
      await options.api('POST', '/copilot/mcp/servers', {
        name: name.value,
        url: url.value,
        headers: values.headers
      });
      await loadServers();
      options.toast('Konektor MCP tersambung dan disimpan');
    } catch (error) {
      options.toast(error.message || 'Konektor MCP gagal ditambahkan', 'err');
    } finally {
      save.disabled = false;
      save.textContent = 'Hubungkan dan simpan';
    }
  };
  form.append(save);
  manager.content.replaceChildren(form);
}

function renderDetail(server) {
  if (!manager) return;
  manager.selectedName = server.name;
  setHeading(server.name, 'Detail konektor · ' + (server.status || 'unknown'), true);
  const content = h('div', 'copilot-mcp-detail');
  const form = h('div', 'copilot-mcp-add-form');
  form.append(h('h3', null, 'Pengaturan konektor'));
  const url = textInput('url', 'https://server.example/mcp', 'URL endpoint MCP');
  url.value = server.url;
  url.autocomplete = 'url';
  form.append(field('URL endpoint /mcp', url));
  const headers = headerEditor(server.headerNames || [], true);
  form.append(headers.section);
  form.append(h('div', 'copilot-mcp-warning',
    'Nilai tersimpan tidak pernah ditampilkan. Kosongkan untuk mempertahankannya, isi nilai baru untuk mengganti, atau pilih Hapus untuk menghapus header. Perubahan koneksi akan menemukan ulang tools; kebijakan tools yang tetap tersedia dipertahankan.'));
  const save = h('button', 'copilot-mcp-save', 'Simpan dan temukan ulang tools');
  save.type = 'button';
  save.onclick = async () => {
    const values = collectHeaders(headers.form);
    if (!values) return;
    save.disabled = true;
    save.textContent = 'Menyambungkan…';
    try {
      await options.api('PUT', '/copilot/mcp/servers/' + encodeURIComponent(server.name), {
        url: url.value,
        ...values
      });
      await loadServers();
      options.toast('Konektor diperbarui dan tools ditemukan ulang');
    } catch (error) {
      options.toast(error.message || 'Konektor gagal diperbarui', 'err');
    } finally {
      save.disabled = false;
      save.textContent = 'Simpan dan temukan ulang tools';
    }
  };
  form.append(save);
  content.append(form);

  const tools = h('section', 'copilot-mcp-tools');
  const toolsHeading = h('div', 'copilot-mcp-tools-heading');
  toolsHeading.append(h('strong', null, 'Tools (' + (server.tools || []).length + ')'));
  const allowAll = h('button', 'copilot-mcp-allow-all', 'Izinkan semua panggilan read-only');
  allowAll.type = 'button';
  allowAll.title = 'Tool hanya akan dilewati persetujuannya jika runtime secara eksplisit menandai panggilan sebagai read-only. Panggilan mutating atau unknown tetap meminta persetujuan.';
  allowAll.onclick = () => updateAllPolicies(server, allowAll);
  toolsHeading.append(allowAll);
  tools.append(toolsHeading, h('p', 'copilot-mcp-warning',
    'Panggilan mutating atau yang sifatnya tidak diketahui tetap meminta persetujuan, termasuk untuk tool yang diizinkan di bawah.'));
  if ((server.tools || []).length) {
    server.tools.forEach(tool => {
      const row = h('div', 'copilot-mcp-tool');
      const detail = h('div', 'copilot-mcp-tool-info');
      detail.append(h('strong', null, tool.name));
      if (tool.description) detail.append(h('small', null, tool.description));
      const button = h('button', 'copilot-mcp-policy' + (tool.requireApproval ? '' : ' auto'),
        tool.requireApproval ? 'Selalu tanyakan' : 'Izinkan panggilan read-only');
      button.type = 'button';
      button.title = tool.requireApproval
        ? 'Minta persetujuan setiap kali tool digunakan'
        : 'Lewati persetujuan hanya jika runtime secara eksplisit menandai panggilan sebagai read-only';
      button.onclick = () => updateToolPolicy(server, tool, button);
      row.append(detail, button);
      tools.append(row);
    });
  } else tools.append(h('div', 'copilot-mcp-empty', 'Konektor belum mengekspos tools.'));
  content.append(tools);
  if (server.lastError) content.append(h('div', 'copilot-mcp-server-error', server.lastError));
  const remove = h('button', 'copilot-mcp-delete', 'Hapus konektor');
  remove.type = 'button';
  remove.onclick = () => removeServer(server.name);
  content.append(remove);
  manager.content.replaceChildren(content);
}

async function updateToolPolicy(server, tool, button) {
  button.disabled = true;
  try {
    await options.api('PUT', '/copilot/mcp/servers/' + encodeURIComponent(server.name) + '/tool-policy', {
      toolName: tool.name,
      requireApproval: !tool.requireApproval
    });
    await loadServers();
  } catch (error) {
    options.toast(error.message || 'Kebijakan tool gagal diubah', 'err');
  } finally {
    button.disabled = false;
  }
}

async function updateAllPolicies(server, button) {
  button.disabled = true;
  try {
    await options.api('PUT', '/copilot/mcp/servers/' + encodeURIComponent(server.name) + '/tool-policy', {
      allowAllReadOnly: true
    });
    await loadServers();
    options.toast('Izin read-only diterapkan; panggilan mutating tetap meminta persetujuan');
  } catch (error) {
    options.toast(error.message || 'Kebijakan tools gagal diubah', 'err');
  } finally {
    button.disabled = false;
  }
}

async function removeServer(name) {
  const confirmed = await options.confirmD(
    'Hapus konektor MCP?',
    name + ' dan pengaturan izin tools-nya akan dihapus dari panel.',
    'Hapus',
    true
  );
  if (!confirmed) return;
  try {
    await options.api('DELETE', '/copilot/mcp/servers/' + encodeURIComponent(name));
    await loadServers();
    options.toast('Konektor MCP dihapus');
  } catch (error) {
    options.toast(error.message || 'Konektor MCP gagal dihapus', 'err');
  }
}

function init(config) {
  options = config;
  const button = document.getElementById('copilotPlus');
  const menu = document.getElementById('copilotPlusMenu');
  const manage = document.getElementById('copilotMcpManage');
  if (!button || !menu || !manage) return;
  button.addEventListener('click', event => {
    event.preventDefault();
    menu.classList.toggle('hidden');
  });
  manage.addEventListener('click', openManager);
  document.addEventListener('pointerdown', event => {
    const wrapper = button.parentElement;
    if (wrapper && !wrapper.contains(event.target)) closeMenu();
  });
}

root.CopilotMcp = { init };
})(window);
