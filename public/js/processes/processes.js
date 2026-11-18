'use strict';

function processDetail(p) {
  const ram = fmtSize(p.rss);
  sheet('Proses · PID ' + p.pid, [
    { kv: ['Nama', p.name] }, { kv: ['Pemilik', p.user + ' (UID ' + p.uid + ')'] },
    { kv: ['Status', p.state] }, { kv: ['Parent PID', String(p.ppid)] },
    { kv: ['CPU', p.cpu.toFixed(1) + '%'] }, { kv: ['RAM (RSS)', ram + ' (' + (Number(p.rssPct) || 0).toFixed(2) + '%)'] },
    { kv: ['Asal', p.source === 'terminal' ? 'Web Terminal' : 'Global VPS'] },
    { kv: ['Executable', p.executable || 'tidak tersedia'] },
    { kv: ['Command', p.command || p.name] },
    ...(p.protected ? [{ kv: ['Aksi', 'proses panel / sistem inti dilindungi'] }] : [
      { label: 'Hentikan · SIGTERM', icon: 'stop_circle', red: true, fn: () => signalProcess(p, 'TERM') },
      { label: 'Paksa hentikan · SIGKILL', icon: 'delete_forever', red: true, fn: () => signalProcess(p, 'KILL') }
    ])
  ]);
}
async function signalProcess(p, signal) {
  const label = signal === 'KILL' ? 'SIGKILL' : 'SIGTERM';
  const yes = await confirmD(label + ' PID ' + p.pid + '?', 'Command: ' + (p.command || p.name) + '\nAksi ini dapat menghentikan service atau aplikasi yang sedang digunakan.', 'Hentikan', true);
  if (!yes) return;
  const result = await run(() => api('POST', '/processes/' + p.pid + '/signal', { signal, startTime: p.startTime }));
  if (result) { toast(label + ' dikirim ke PID ' + p.pid); setTimeout(refreshProcesses, 800); }
}

async function refreshProcesses() {
  if (processLoading || S.view !== 'processes') return;
  processLoading = true;
  try {
    processSnapshot = await api('GET', '/processes');
    processData = processSnapshot.processes || [];
    renderProcesses();
    $('#procUpdated').textContent = 'diperbarui ' + new Date(processSnapshot.sampledAt).toLocaleTimeString('id-ID') + ' · refresh 2,5 detik';
  } catch (e) {
    if (e.status !== 401) $('#procUpdated').textContent = 'gagal memuat: ' + e.message;
  } finally { processLoading = false; }
}
function renderProcesses() {
  if (processSnapshot) {
    $('#procCpu').textContent = processSnapshot.cpu.toFixed(1) + '%';
    $('#procRam').textContent = fmtSize(processSnapshot.mem.used) + ' / ' + fmtSize(processSnapshot.mem.total);
    $('#procCount').textContent = String(processSnapshot.count);
  }
  const q = $('#procSearch').value.trim().toLowerCase();
  const sort = $('#procSort').value;
  let rows = processData.filter(p => processFilter === 'all' || p.source === processFilter);
  if (q) rows = rows.filter(p => String(p.pid).includes(q) || p.name.toLowerCase().includes(q) || p.command.toLowerCase().includes(q) || p.user.toLowerCase().includes(q));
  rows.sort((a, b) => sort === 'ram' ? b.rss - a.rss : sort === 'pid' ? a.pid - b.pid : sort === 'name' ? a.name.localeCompare(b.name) : b.cpu - a.cpu);
  const list = $('#procList');
  list.textContent = '';
  if (!rows.length) { list.append(h('div', 'proc-empty', 'Tidak ada proses yang cocok')); return; }
  const frag = document.createDocumentFragment();
  rows.forEach(p => {
    const row = h('button', 'proc-row');
    row.type = 'button';
    row.dataset.processPid = String(p.pid);
    const top = h('div', 'proc-rowtop');
    const name = h('strong', 'proc-name', p.name);
    const pid = h('span', 'proc-pid', 'PID ' + p.pid);
    const source = h('span', 'proc-origin ' + (p.source === 'terminal' ? 'terminal' : ''), p.source === 'terminal' ? 'Terminal web' : 'Global');
    top.append(name, pid, source);
    const cmd = h('div', 'proc-command', p.command || p.name);
    const meta = h('div', 'proc-meta');
    meta.append(h('span', null, p.user + ' · ' + p.state), h('span', null, 'CPU ' + p.cpu.toFixed(1) + '%'), h('span', null, 'RAM ' + fmtSize(p.rss) + ' · ' + (Number(p.rssPct) || 0).toFixed(1) + '%'));
    row.append(top, cmd, meta);
    frag.append(row);
  });
  list.append(frag);
}
